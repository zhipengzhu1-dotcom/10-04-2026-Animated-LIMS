import { get, run } from './db.js';
import { audit } from './audit.js';
import { notFound } from './http.js';
import { now } from './util.js';

const SECRET = new Set(['password_hash']);
const SKIP = new Set(['created_at', 'updated_at']);
const same = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));
const mask = (k, v) => (SECRET.has(k) ? '••••' : v);

/** Inserts a row and writes a CREATE audit entry. Returns the new id. */
export function insert(ctx, table, data, { summary, code, audit: doAudit = true } = {}) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const res = run(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    ...keys.map((k) => data[k]),
  );
  const id = Number(res.lastInsertRowid);
  if (doAudit) {
    const changes = {};
    for (const k of keys) if (data[k] != null && !SKIP.has(k)) changes[k] = [null, mask(k, data[k])];
    audit(ctx, { action: 'CREATE', entity: table, entity_id: id, entity_code: code ?? data.code ?? data.username ?? null, summary, changes });
  }
  return id;
}

/**
 * Updates only the fields that actually changed and records old → new values in the audit trail.
 * Returns the row as it is after the update.
 */
export function update(ctx, table, id, patch, { summary, reason, action = 'UPDATE', extraChanges, audit: doAudit = true } = {}) {
  const before = get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!before) throw notFound();
  const changes = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || same(before[k], v)) continue;
    changes[k] = [before[k] ?? null, v];
  }
  const keys = Object.keys(changes);
  if (keys.length) {
    run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => changes[k][1]), id);
  }
  const logged = { ...changes, ...(extraChanges || {}) };
  if (doAudit && Object.keys(logged).length) {
    for (const k of Object.keys(logged)) if (SECRET.has(k)) logged[k] = ['••••', '••••'];
    audit(ctx, { action, entity: table, entity_id: id, entity_code: before.code ?? before.username ?? null, summary, changes: logged, reason });
  }
  const after = { ...before };
  for (const k of keys) after[k] = changes[k][1];
  return after;
}

/** Next sequential code, e.g. nextCode('S') → "S-2026-0042". Counters restart each year. */
export function nextCode(prefix, { pad = 4, year = true } = {}) {
  const name = year ? `${prefix}-${now().getFullYear()}` : prefix;
  const row = get('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value', name);
  return `${name}-${String(row.value).padStart(pad, '0')}`;
}

export function mustGet(sql, id, what) {
  const row = get(sql, id);
  if (!row) throw notFound(what);
  return row;
}
