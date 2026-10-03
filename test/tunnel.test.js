// Tunnel tests: behind a Cloudflare Tunnel every connection comes from this computer, so the server must take the
// visitor's address from Cloudflare's header, never treat a tunnelled visitor as local, and ignore the header otherwise.
// Run with:  npm test

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VISITOR = '203.0.113.7';
const ADMIN = { lab_name: 'Tunnel Lab', full_name: 'Olive Operator', username: 'operator', password: 'Correct-Horse-9' };

async function startServer(env) {
  const port = 4200 + Math.floor(Math.random() * 700);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-tunnel-'));
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ALIQUOT_DATA: dataDir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  const stop = async () => {
    proc.kill();
    await exited;
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) break;
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/setup`)).ok) return { base: `http://127.0.0.1:${port}`, stop };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  await stop();
  throw new Error(`Server did not start:\n${log}`);
}

function client(base) {
  let cookie = '';
  return async (method, url, { body, visitor } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        'X-Requested-With': 'aliquot',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(visitor ? { 'CF-Connecting-IP': visitor } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

describe('behind the tunnel', () => {
  let server;
  let req;
  before(async () => {
    server = await startServer({ CLOUDFLARE_TUNNEL: '1' });
    req = client(server.base);
  });
  after(() => server?.stop());

  test('a tunnelled visitor is not local and is refused first-time setup', async () => {
    const info = await req('GET', '/api/setup', { visitor: VISITOR });
    assert.equal(info.data.needsSetup, true);
    assert.equal(info.data.local, false);
    const r = await req('POST', '/api/setup', { body: ADMIN, visitor: VISITOR });
    assert.equal(r.status, 403);
  });

  test('the demo-data option is refused, even on this computer', async () => {
    assert.equal((await req('GET', '/api/setup')).data.demoAllowed, false);
    const r = await req('POST', '/api/setup', { body: { mode: 'demo' } });
    assert.equal(r.status, 403);
    assert.equal((await req('GET', '/api/setup')).data.needsSetup, true, 'no demo lab was loaded');
  });

  test('the Operator on this computer can set up an empty lab', async () => {
    assert.equal((await req('GET', '/api/setup')).data.local, true);
    const r = await req('POST', '/api/setup', { body: ADMIN });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await req('GET', '/api/setup')).data.needsSetup, false);
  });

  test('a sign-in through the tunnel records the visitor address in the audit trail', async () => {
    const login = await req('POST', '/api/auth/login', { body: { username: ADMIN.username, password: ADMIN.password }, visitor: VISITOR });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const entries = (await req('GET', '/api/audit?action=LOGIN')).data;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ip, VISITOR);
  });
});

describe('not behind the tunnel', () => {
  let server;
  let req;
  before(async () => {
    server = await startServer({ CLOUDFLARE_TUNNEL: '' });
    req = client(server.base);
  });
  after(() => server?.stop());

  test('the visitor header is ignored: the socket address is used and setup from this computer works', async () => {
    const info = (await req('GET', '/api/setup', { visitor: VISITOR })).data;
    assert.equal(info.local, true);
    assert.equal(info.demoAllowed, true);
    const r = await req('POST', '/api/setup', { body: ADMIN, visitor: VISITOR });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await req('POST', '/api/auth/login', { body: { username: ADMIN.username, password: ADMIN.password }, visitor: VISITOR });
    const entries = (await req('GET', '/api/audit?action=LOGIN')).data;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ip, '127.0.0.1');
  });
});
