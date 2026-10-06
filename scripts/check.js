// Syntax-checks every JavaScript file in the project with `node --check`, refuses hand-written SQL writes that would
// bypass the audit trail, rules tables imported where they would make a cycle, Queue tables away from their rules
// tables, `can` flags written by hand, and verify feature maps naming code that is gone.
// No dependencies needed.
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

// A record's rules table lives beside its route module; a module outside server/routes/ never imports one from there,
// and no two server modules import each other. Where either would happen, the table moves to a server module of its own.
const ROUTES = path.join(ROOT, 'server', 'routes') + path.sep;
const IMPORT = /^import\s+(?:([\s\S]*?)\s+from\s+)?['"](\.[^'"]+)['"]/gm;
const imports = new Map(serverFiles.concat([...WRITERS]).map((file) => [file, [...fs.readFileSync(file, 'utf8').matchAll(IMPORT)].map((m) => ({ names: m[1] ?? '', to: path.resolve(path.dirname(file), m[2]) }))]));
const misplaced = [];
for (const [file, list] of imports) {
  if (file.startsWith(ROUTES)) continue;
  for (const { names, to } of list) {
    const tables = names.match(/\b\w+_RULES\b/g);
    if (tables && to.startsWith(ROUTES)) misplaced.push(`${path.relative(ROOT, file)} imports ${tables.join(', ')} from ${path.relative(ROOT, to)}`);
  }
}
const visiting = [];
const done = new Set();
const visit = (file) => {
  if (done.has(file) || !imports.has(file)) return;
  if (visiting.includes(file)) return misplaced.push(`import cycle: ${visiting.slice(visiting.indexOf(file)).concat(file).map((f) => path.relative(ROOT, f)).join(' -> ')}`);
  visiting.push(file);
  for (const { to } of imports.get(file)) visit(to);
  visiting.pop();
  done.add(file);
};
for (const file of imports.keys()) visit(file);
if (misplaced.length) {
  console.error(misplaced.join('\n'));
  console.error('Move the rules table to a server module of its own (as server/notebook.js holds ENTRY_RULES) and import it from there.');
} else console.log('Rules tables placed OK');

// A record's Queue table lives in the same module as its rules table, wherever that table lives.
/** Each `<RECORD><suffix>` table a server module exports, as [record, file]. */
const exported = (suffix) => [...imports.keys()].flatMap((file) => {
  const exports = fs.readFileSync(file, 'utf8').matchAll(new RegExp(`^export const (\\w+)${suffix}\\b`, 'gm'));
  return [...exports].map((m) => [m[1], file]);
});
const rulesHome = new Map(exported('_RULES'));
const strayQueues = [];
for (const [record, file] of exported('_QUEUES')) {
  const home = rulesHome.get(record);
  if (home === file) continue;
  const where = home ? `is not beside ${record}_RULES in ${path.relative(ROOT, home)}` : `has no ${record}_RULES`;
  strayQueues.push(`${path.relative(ROOT, file)}: ${record}_QUEUES ${where}`);
}
if (strayQueues.length) {
  console.error(strayQueues.join('\n'));
  console.error('Define each Queue table in the module that exports its rules table.');
} else console.log('Queue tables placed OK');

// A record's `can` is built with flags() from its rules table. These payloads still write `can` by hand, each for the
// reason given, and only as many times as listed.
const HAND_FLAGS = {
  'server/routes/business.js': { count: 1, why: 'Client has rules for attach only; its edit flag is a permission check' },
  'server/routes/resources.js': { count: 2, why: 'Instrument and Inventory item have rules for attach only' },
};
const handFlags = [];
for (const file of serverFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = [...text.matchAll(/\bcan\s*:\s*\{/g)].map((m) => text.slice(0, m.index).split('\n').length);
  const allowed = HAND_FLAGS[path.relative(ROOT, file).split(path.sep).join('/')]?.count ?? 0;
  if (lines.length > allowed) handFlags.push(...lines.map((line) => `${path.relative(ROOT, file)}:${line}: can written by hand`));
}
if (handFlags.length) {
  console.error(handFlags.join('\n'));
  console.error("Build can with flags(<RECORD>_RULES, record, person), or add the file to HAND_FLAGS in scripts/check.js with the reason it has no rules.");
} else console.log('Can flags OK');

// The verify skill's feature maps name source paths, rules and Queue tables and `[data-act=…]` / `[name=…]` selectors.
// A name that no longer exists in the code is drift: the next agent drives the app by a map that lies.
const FEATURES = path.join(ROOT, '.claude', 'skills', 'verify', 'features');
const shipped = ['public', 'server', 'server.js'].flatMap((p) => {
  const file = path.join(ROOT, p);
  return fs.statSync(file).isDirectory() ? [...jsFiles(file)] : [file];
}).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const drifted = [];
for (const name of fs.existsSync(FEATURES) ? fs.readdirSync(FEATURES).filter((f) => f.endsWith('.md')) : []) {
  const text = fs.readFileSync(path.join(FEATURES, name), 'utf8');
  const report = (token, why) => drifted.push(`${path.relative(ROOT, path.join(FEATURES, name))}: \`${token}\` ${why}`);
  for (const [, token] of text.matchAll(/`([^`\n]+)`/g)) {
    if (/^(public|server|test|docs)\/[\w./-]+$/.test(token) && !fs.existsSync(path.join(ROOT, token))) report(token, 'is not a file');
    if (/^[A-Z]+_(RULES|QUEUES)$/.test(token) && !shipped.includes(`export const ${token}`)) report(token, 'is not exported');
    for (const [, attr, values] of token.matchAll(/\[(data-[\w-]+|name)=([\w|-]+)\]/g)) {
      for (const value of values.split('|')) {
        if ((attr !== 'name' && !shipped.includes(attr)) || !new RegExp(`\\b${value}\\b`).test(shipped)) report(token, `names ${attr === 'name' ? value : `${attr} ${value}`}, which the code does not have`);
      }
    }
  }
}
if (drifted.length) {
  console.error(drifted.join('\n'));
  console.error('Update the feature map (see /maintain-verification-skill) so it names what the code has.');
} else console.log('Verify feature maps OK');
process.exit(failed || unaudited.length || misplaced.length || strayQueues.length || handFlags.length || drifted.length ? 1 : 0);
