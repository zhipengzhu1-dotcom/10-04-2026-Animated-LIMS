// Syntax-checks every JavaScript file in the project with `node --check`, and refuses hand-written SQL writes that
// would bypass the audit trail. No dependencies needed.
// Usage:  npm run check
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'data', 'data-dev']);
// Vendored third-party browser libraries are not ours to check.
const SKIP_PATHS = new Set([path.join(ROOT, 'public', 'vendor')]);

function* jsFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (SKIP_PATHS.has(file)) continue;
    if (entry.isDirectory()) yield* jsFiles(file);
    else if (entry.name.endsWith('.js')) yield file;
  }
}

let count = 0;
let failed = 0;
for (const file of jsFiles(ROOT)) {
  count++;
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(e.stderr.toString());
  }
}
console.log(failed ? `${failed} of ${count} files have syntax errors` : `Syntax OK (${count} files)`);

// Server writes go through repo.insert / repo.update so the audit trail records them. These tables are written by hand
// instead, each for the reason given; a table listed with columns may be updated by hand in those columns only.
const RAW_WRITES = {
  audit_log: 'the audit trail itself',
  sessions: 'sign-in sessions, not records',
  portal_sessions: 'sign-in sessions, not records',
  document_edit_links: 'short-lived edit links, not records',
  settings: 'setSettings audits every change',
  signatures: 'applySignature audits every signature',
  results: "result lines; their changes are logged on the Test's own entry",
  test_materials: "logged on the Test's own entry as standards & reagents",
  method_analytes: "logged on the Method's own entry",
  invoice_lines: "logged on the invoice's own entry",
  custody_events: 'the custody log is itself the record',
  inventory_txns: 'the stock ledger is itself the record',
  notebook_documents: "logged on the notebook entry's own entry",
  notebook_document_versions: "logged on the notebook entry's own entry",
  notebook_entries: { columns: ['body', 'updated_at'], why: 'the body is logged as a length change on the entry' },
  portal_threads: 'client conversations; the messages are the record',
  portal_messages: 'client conversations; the messages are the record',
  users: { columns: ['failed_logins', 'locked_until', 'last_login_at'], why: 'sign-in counters' },
  portal_users: { columns: ['failed_logins', 'locked_until', 'last_login_at'], why: 'sign-in counters' },
};
// repo.js is where audited writes happen; migrations in schema.js build the tables.
const WRITERS = new Set([path.join(ROOT, 'server', 'repo.js'), path.join(ROOT, 'server', 'schema.js')]);
const WRITE = /\b(INSERT(?:\s+OR\s+\w+)?\s+INTO|(?<!DO\s)UPDATE|DELETE\s+FROM)\s+(\w+)(?:\s+SET\s+([^'"`]*?)\s+WHERE\b)?/g;

/** The columns an UPDATE's SET clause assigns, ignoring commas inside parentheses. */
function setColumns(clause) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < clause.length; i++) {
    if (clause[i] === '(') depth++;
    else if (clause[i] === ')') depth--;
    else if (clause[i] === ',' && depth === 0) {
      parts.push(clause.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(clause.slice(start));
  return parts.map((p) => p.trim().split(/\s*=/)[0]);
}

const unaudited = [];
const serverFiles = [path.join(ROOT, 'server.js'), ...jsFiles(path.join(ROOT, 'server'))].filter((f) => !WRITERS.has(f));
for (const file of serverFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(WRITE)) {
    const [, verb, table, set] = m;
    const allowed = RAW_WRITES[table];
    if (typeof allowed === 'string') continue;
    const stray = allowed && verb === 'UPDATE' && set ? setColumns(set).filter((c) => !allowed.columns.includes(c)) : null;
    if (stray && !stray.length) continue;
    const line = text.slice(0, m.index).split('\n').length;
    const what = stray ? `${table}.${stray.join(', ')}` : table;
    unaudited.push(`${path.relative(ROOT, file)}:${line}: ${verb.split(/\s/)[0]} on ${what} by hand`);
  }
}
if (unaudited.length) {
  console.error(unaudited.join('\n'));
  console.error('Write through repo.insert / repo.update, or add the table to RAW_WRITES in scripts/check.js with the reason its changes still reach the audit trail.');
} else console.log('Audited writes OK');
process.exit(failed || unaudited.length ? 1 : 0);
