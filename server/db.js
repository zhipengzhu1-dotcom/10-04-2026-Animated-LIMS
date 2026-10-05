import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { MIGRATIONS } from './schema.js';

let db;
const statements = new Map();

export function openDb(file = path.join(DATA_DIR, 'aliquot.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  statements.clear();
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate();
  return db;
}

export function closeDb() {
  statements.clear();
  db?.close();
  db = undefined;
}

function migrate() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

function stmt(sql) {
  let s = statements.get(sql);
  if (!s) {
    s = db.prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

const bind = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export const all = (sql, ...params) => stmt(sql).all(...bind(params));
export const get = (sql, ...params) => stmt(sql).get(...bind(params));
export const run = (sql, ...params) => stmt(sql).run(...bind(params));
export const exec = (sql) => db.exec(sql);

/** Placeholders for an `IN (…)` list: ph([a, b, c]) → "?,?,?". */
export const ph = (list) => list.map(() => '?').join(',');

let depth = 0;
// Runs fn inside a single transaction (nested calls join the outer one). fn must be synchronous.
export function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export function backupTo(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.rmSync(file);
  db.prepare('VACUUM INTO ?').run(file);
}
