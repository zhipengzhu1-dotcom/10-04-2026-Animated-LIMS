import crypto from 'node:crypto';
import { all, get, run } from './db.js';
import { nowIso } from './util.js';

// Every audit row is chained to the previous one with SHA-256, so any edit made outside the
// application (e.g. directly in the database file) is detectable with verifyChain().
const FIELDS = ['at', 'user_id', 'username', 'action', 'entity', 'entity_id', 'entity_code', 'summary', 'changes', 'reason', 'ip'];

const hashOf = (prev, rec) =>
  crypto.createHash('sha256').update(`${prev || 'GENESIS'}|${JSON.stringify(FIELDS.map((f) => rec[f] ?? null))}`).digest('hex');

// Values are normalised to exactly what SQLite stores (TEXT or INTEGER), otherwise the hash computed here
// would differ from the one recomputed from the stored row and break verification for good.
const text = (v) => (v == null || v === '' ? null : String(v));
const int = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));

export function audit(ctx, { action, entity = null, entity_id = null, entity_code = null, summary = null, changes = null, reason = null }) {
  const rec = {
    at: nowIso(),
    user_id: int(ctx?.user?.id),
    username: text(ctx?.user?.username) ?? 'system',
    action: text(action),
    entity: text(entity),
    entity_id: int(entity_id),
    entity_code: text(entity_code),
    summary: text(summary),
    changes: changes && Object.keys(changes).length ? JSON.stringify(changes) : null,
    reason: text(reason),
    ip: text(ctx?.ip),
  };
  const prev = get('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
  rec.prev_hash = prev?.hash ?? null;
  rec.hash = hashOf(rec.prev_hash, rec);
  run(
    `INSERT INTO audit_log (at, user_id, username, action, entity, entity_id, entity_code, summary, changes, reason, ip, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    rec.at, rec.user_id, rec.username, rec.action, rec.entity, rec.entity_id, rec.entity_code, rec.summary, rec.changes, rec.reason, rec.ip, rec.prev_hash, rec.hash,
  );
}

export function verifyChain() {
  let prev = null;
  let count = 0;
  for (const row of all('SELECT * FROM audit_log ORDER BY id')) {
    if ((row.prev_hash ?? null) !== prev || hashOf(prev, row) !== row.hash) {
      return { ok: false, count, brokenAt: row.id, at: row.at };
    }
    prev = row.hash;
    count++;
  }
  return { ok: true, count };
}
