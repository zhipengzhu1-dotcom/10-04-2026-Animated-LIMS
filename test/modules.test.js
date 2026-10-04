// The browser module graph: starts a real server and follows every import the staff app and the client portal would
// load, from each page's entry script, the way a browser does. Every module must be served as JavaScript, the lock
// screen must reach the helix and its vendored three.js, and nothing may still load the retired ribbon sculpture.
// Run with:  npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4300 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-test-'));
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ALIQUOT_DATA: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/setup`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const IMPORT = /(?:^|;)\s*(?:import|export)\s*(?:[\w$\s{},*]*?\bfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm;
const LINK = /<(?:script[^>]*\bsrc|link[^>]*\brel="stylesheet"[^>]*\bhref)="([^"]+)"/g;

/** Every script and stylesheet a page loads, following static and dynamic imports. Map of path → served text. */
async function loadPage(page) {
  const res = await fetch(BASE + page);
  assert.equal(res.status, 200, `${page} → ${res.status}`);
  const queue = [...(await res.text()).matchAll(LINK)].map((m) => new URL(m[1], BASE + page).pathname);
  const seen = new Map();
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    const r = await fetch(BASE + url);
    assert.equal(r.status, 200, `${url} (loaded by ${page}) → ${r.status}`);
    const body = await r.text();
    seen.set(url, body);
    if (!url.endsWith('.js')) continue;
    assert.match(r.headers.get('content-type'), /^text\/javascript/, `${url} must be served as JavaScript`);
    for (const m of body.matchAll(IMPORT)) queue.push(new URL(m[1] ?? m[2], BASE + url).pathname);
  }
  return seen;
}

for (const page of ['/', '/portal/']) {
  test(`${page} loads the helix and its vendored three.js from this server`, async () => {
    const loaded = await loadPage(page);
    for (const url of ['/js/core/helix.js', '/vendor/three/three.module.min.js', '/vendor/three/three.core.js']) {
      assert.ok(loaded.has(url), `${page} never reaches ${url}`);
    }
  });

  test(`${page} no longer loads or styles the ribbon sculpture`, async () => {
    const loaded = await loadPage(page);
    const stale = [...loaded].filter(([url, body]) => /ribbon/i.test(url) || /ribbon/i.test(body)).map(([url]) => url);
    assert.deepEqual(stale, []);
  });
}

test('the retired ribbon module is gone', async () => {
  assert.equal((await fetch(`${BASE}/js/core/ribbon.js`)).status, 404);
});
