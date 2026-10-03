// Upgrade tests: start the current code against a database from an earlier release and check that the migrations
// apply, no records are lost and the audit trail's hash chain still verifies. Run before every release.
//
// Sources, each upgraded in a throwaway copy (the original is never opened for writing):
//   - every test/fixtures/*.db
//   - UPGRADE_FROM=<backup .db file, or a backup folder containing aliquot.db and files/>
// Run with:  npm test            or   UPGRADE_FROM=D:\Backups\Aliquot npm run test:upgrade

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS } from '../server/schema.js';
import { openDb, closeDb } from '../server/db.js';
import { verifyChain } from '../server/audit.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
// Rows in these tables expire on their own, so their counts may legitimately drop.
const TRANSIENT = new Set(['sessions', 'document_edit_links']);

const sources = [];
if (fs.existsSync(FIXTURES)) {
  for (const f of fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.db')).sort()) sources.push(path.join(FIXTURES, f));
}
if (process.env.UPGRADE_FROM) sources.push(path.resolve(process.env.UPGRADE_FROM));

function snapshot(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    const counts = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
      counts[name] = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
    }
    return { version, counts };
  } finally {
    db.close();
  }
}

async function startServer(dataDir) {
  const port = 4100 + Math.floor(Math.random() * 90);
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ALIQUOT_DATA: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) break;
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/setup`)).ok) return { stop: async () => { proc.kill(); await exited; } };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  await exited;
  throw new Error(`Server did not start on the upgraded database:\n${log}`);
}

if (!sources.length) {
  test('upgrade from a previous release', { skip: 'no fixtures in test/fixtures/ and UPGRADE_FROM is not set' }, () => {});
}

for (const source of sources) {
  const isFolder = fs.statSync(source).isDirectory();
  const dbFile = isFolder ? path.join(source, 'aliquot.db') : source;

  test(`upgrade ${path.basename(source)} to schema v${MIGRATIONS.length} without losing records`, async () => {
    assert.ok(fs.existsSync(dbFile), `No database at ${dbFile}`);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-upgrade-'));
    try {
      const copy = path.join(dataDir, 'aliquot.db');
      const original = new DatabaseSync(dbFile, { readOnly: true });
      original.prepare('VACUUM INTO ?').run(copy);
      original.close();
      if (isFolder && fs.existsSync(path.join(source, 'files'))) fs.cpSync(path.join(source, 'files'), path.join(dataDir, 'files'), { recursive: true });

      const before = snapshot(copy);
      assert.ok(before.version <= MIGRATIONS.length, `Database is at schema v${before.version}, newer than this code (v${MIGRATIONS.length})`);

      // Start the real server, exactly as a lab would after installing the new release.
      const server = await startServer(dataDir);
      await server.stop();

      const after = snapshot(copy);
      assert.equal(after.version, MIGRATIONS.length, 'all migrations applied');
      for (const [table, n] of Object.entries(before.counts)) {
        assert.ok(table in after.counts, `Table ${table} is missing after the upgrade. If it was renamed on purpose, update this test.`);
        if (!TRANSIENT.has(table)) assert.ok(after.counts[table] >= n, `${table}: ${n} rows before the upgrade, ${after.counts[table]} after`);
      }

      openDb(copy);
      try {
        const chain = verifyChain();
        assert.ok(chain.ok, `Audit trail hash chain broken at entry #${chain.brokenAt} after the upgrade`);
        assert.ok(chain.count >= before.counts.audit_log, 'audit entries preserved');
      } finally {
        closeDb();
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
}
