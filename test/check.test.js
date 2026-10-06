// npm run check refuses a Queue table away from its rules table. Runs the check on a copy of the server, so the real
// tree is never touched.
// Run with:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Runs scripts/check.js on a copy of the server, after `change` edits the copy at its root. */
function checkCopy(change) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-check-'));
  try {
    for (const entry of ['server', 'scripts', 'server.js']) fs.cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true });
    change(dir);
    return spawnSync(process.execPath, [path.join(dir, 'scripts', 'check.js')], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the check passes the server as it is', () => {
  const r = checkCopy(() => {});
  assert.equal(r.status, 0, r.stderr);
});

test('the check refuses a Queue table outside the module exporting its rules table', () => {
  const r = checkCopy((dir) => fs.appendFileSync(path.join(dir, 'server', 'routes', 'lab.js'), '\nexport const PROJECT_QUEUES = {};\n'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /server\/routes\/lab\.js: PROJECT_QUEUES is not beside PROJECT_RULES in server\/routes\/business\.js/);
});
