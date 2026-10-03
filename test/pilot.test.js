// Pilot release tests: starts a real server with the Pilot's Shipped-module list and the demo lab, then proves
// over HTTP that Withheld modules do not exist for the lab while the Shipped ones and the shared core still work.
// Run with:  node --test test/pilot.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4200 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'demo1234';
const PILOT_MODULES = ['samples', 'methods', 'instruments', 'inventory', 'clients', 'projects', 'invoices', 'portal', 'insights', 'team', 'settings'];
const MODULES_ALL = 'dashboard,samples,worklist,reviews,notebook,methods,instruments,inventory,investigations,audit,clients,projects,invoices,portal,insights,team,settings';
let server;
let dataDir;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body) {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'X-Requested-With': 'aliquot', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  get(url) { return this.req('GET', url); }
  post(url, body = {}) { return this.req('POST', url, body); }
  put(url, body = {}) { return this.req('PUT', url, body); }
  async ok(method, url, body) {
    const r = await this.req(method, url, body);
    assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
}

async function as(username) {
  const c = new Client();
  await c.ok('POST', '/api/auth/login', { username, password: PASSWORD });
  return c;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-pilot-test-'));
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ALIQUOT_DATA: dataDir, SHIPPED_MODULES: PILOT_MODULES.join(',') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/setup`)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const setup = await new Client().post('/api/setup', { mode: 'demo' });
  assert.equal(setup.status, 200, `demo setup failed: ${JSON.stringify(setup.data)} ${log}`);
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the current-user response lists exactly the Shipped modules', async () => {
  const me = await (await as('tom.fletcher')).ok('GET', '/api/auth/me');
  assert.deepEqual([...me.modules].sort(), [...PILOT_MODULES].sort());
});

test('Withheld Audit trail APIs answer like routes that do not exist, signed in or not', async () => {
  const nowhere = await new Client().get('/api/no-such-route');
  const qa = await as('daniel.okafor'); // QA can browse the audit trail when it ships
  for (const url of ['/api/audit', '/api/audit?limit=1000', '/api/audit/verify']) {
    for (const [who, c] of [['QA', qa], ['anonymous', new Client()]]) {
      const r = await c.get(url);
      assert.equal(r.status, 404, `${who} GET ${url}`);
      assert.deepEqual(r.data, nowhere.data, `${who} GET ${url} looks like a missing route`);
    }
  }
  assert.equal((await qa.post('/api/audit/verify')).status, 404, 'no method-not-allowed hint either');
});

test('record history still works with the Audit trail withheld', async () => {
  const c = await as('priya.raman');
  const [sample] = await c.ok('GET', '/api/samples?status=');
  const history = await c.ok('GET', `/api/history/samples/${sample.id}`);
  assert.ok(history.length > 0, 'the sample has history entries');
  assert.ok(history.some((h) => h.action === 'CREATE'), 'history includes the sample’s creation');
});

test('Lab Administrators cannot ship a Withheld module from Settings', async () => {
  const admin = await as('admin');
  const settings = await admin.ok('GET', '/api/settings');
  assert.ok(!Object.keys(settings).some((k) => /module/i.test(k)), 'Settings offer no module control');
  await admin.ok('PUT', '/api/settings', { shipped_modules: MODULES_ALL, modules: MODULES_ALL, SHIPPED_MODULES: MODULES_ALL });
  const me = await admin.ok('GET', '/api/auth/me');
  assert.deepEqual([...me.modules].sort(), [...PILOT_MODULES].sort());
  assert.equal((await admin.get('/api/audit')).status, 404);
});

test('an unknown module key stops start-up with a message naming it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-pilot-typo-'));
  try {
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT + 100), HOST: '127.0.0.1', ALIQUOT_DATA: dir, SHIPPED_MODULES: 'samples,invoice' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    proc.stdout.on('data', (d) => { log += d; });
    proc.stderr.on('data', (d) => { log += d; });
    const timer = setTimeout(() => proc.kill(), 5000);
    const code = await new Promise((resolve) => proc.once('exit', resolve));
    clearTimeout(timer);
    assert.ok(code > 0, `server started despite an unknown module key:\n${log}`);
    assert.match(log, /\binvoice\b/, 'the message names the unknown key');
    assert.doesNotMatch(log, /Aliquot is running/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
// #8
test('the Withheld Dashboard API answers like a route that does not exist, while Insights still works', async () => {
  const nowhere = await new Client().get('/api/no-such-route');
  for (const [who, c] of [['Analyst', await as('tom.fletcher')], ['anonymous', new Client()]]) {
    const r = await c.get('/api/dashboard');
    assert.equal(r.status, 404, `${who} GET /api/dashboard`);
    assert.deepEqual(r.data, nowhere.data, `${who} GET /api/dashboard looks like a missing route`);
  }
  const insights = await (await as('oliver.grant')).ok('GET', '/api/insights');
  assert.equal(insights.months.length, 12);
  assert.ok(Array.isArray(insights.revenueByMonth), 'Business & Finance see revenue figures');
});
