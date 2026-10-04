// Public demo: the demo lab is loaded offline by scripts/seed-demo.js, then served behind the tunnel.
// Visitors sign in with the one-click demo accounts on both sign-in screens.
// Run with:  npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const VISITOR = '203.0.113.21';

let server;
let dataDir;

const seed = () => spawnSync(process.execPath, ['scripts/seed-demo.js'], { cwd: ROOT, env: { ...process.env, ALIQUOT_DATA: dataDir }, encoding: 'utf8' });

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(BASE + url, {
      method,
      headers: {
        'X-Requested-With': 'aliquot',
        'CF-Connecting-IP': VISITOR,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-demo-'));
  const first = seed();
  assert.equal(first.status, 0, first.stderr);
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ALIQUOT_DATA: dataDir, CLOUDFLARE_TUNNEL: '1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/setup`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the demo loader refuses a data folder that already has a lab', () => {
  const again = seed();
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already has a lab/);
});

test('behind the tunnel the demo lab is set up and offers its demo accounts', async () => {
  const req = client();
  const setup = await req('GET', '/api/setup');
  assert.equal(setup.data.needsSetup, false);
  assert.equal(setup.data.demo, true);
  assert.equal(setup.data.local, false);
});

test('a visitor signs in to the Staff app with a demo account', async () => {
  const req = client();
  const login = await req('POST', '/api/auth/login', { username: 'tom.fletcher', password: 'demo1234' });
  assert.equal(login.status, 200);
  const me = await req('GET', '/api/auth/me');
  assert.equal(me.data.user.username, 'tom.fletcher');
  for (const url of ['/api/dashboard', '/api/samples']) assert.equal((await req('GET', url)).status, 200, url);
});

test('a visitor signs in to the Client portal with a listed demo account', async () => {
  const req = client();
  const info = await req('GET', '/api/portal/info');
  assert.ok(info.data.demo_accounts.length > 0);
  const login = await req('POST', '/api/portal/login', { email: info.data.demo_accounts[0].email, password: 'demo1234' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.email, info.data.demo_accounts[0].email);
});
