// Test actions offered on the Test page match what the server allows, and assignable people follow the permission.
// Starts a real server on a temporary database with the demo lab and drives Tests over HTTP.
// Run with:  npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4500 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'demo1234';
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-test-'));
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ALIQUOT_DATA: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/setup`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const setup = await new Client().post('/api/setup', { mode: 'demo' });
  assert.equal(setup.status, 200, `demo setup failed: ${JSON.stringify(setup.data)} ${log}`);
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Receives one Karl Fischer Sample and assigns its Test to the analyst.
async function kfTests(analystUsername) {
  const priya = await as('priya.raman');
  const clients = await priya.ok('GET', '/api/clients');
  const kf = (await priya.ok('GET', '/api/methods?usable=1')).find((m) => m.code === 'ATM-0002' && m.status === 'Effective');
  const res = await priya.ok('POST', '/api/samples/receive', { client_id: clients[0].id, samples: [{ description: 'Test actions' }], method_ids: [kf.id] });
  const sample = await priya.ok('GET', `/api/samples/${res.samples[0].id}`);
  const users = await priya.ok('GET', '/api/users');
  const testIds = sample.tests.map((t) => t.id);
  await priya.ok('POST', '/api/tests/assign', { test_ids: testIds, analyst_id: users.find((u) => u.username === analystUsername).id });
  return testIds;
}

async function enterInSpec(analyst, testId) {
  const d = await analyst.ok('GET', `/api/tests/${testId}`);
  await analyst.ok('PUT', `/api/tests/${testId}`, { instrument_id: d.instruments.find((i) => i.code === 'KF-01').id, results: [{ id: d.results[0].id, value: '0.21' }] });
}

test('an assigned analyst whose role no longer performs Tests is offered no start, edit or submit, and is refused', async () => {
  const admin = await as('admin');
  const priya = await as('priya.raman');
  const [pendingId] = await kfTests('tom.fletcher');
  const [inProgressId] = await kfTests('tom.fletcher');
  const tom = await as('tom.fletcher');
  await enterInSpec(tom, inProgressId);
  const tomId = (await tom.ok('GET', '/api/auth/me')).user.id;

  await admin.ok('PUT', `/api/users/${tomId}`, { role: 'qa' });
  try {
    const pending = await tom.ok('GET', `/api/tests/${pendingId}`);
    assert.equal(pending.can.start, false, 'no start offered');
    assert.equal(pending.can.edit, false, 'no edit offered');
    assert.equal((await tom.post(`/api/tests/${pendingId}/start`)).status, 403);
    const inProgress = await tom.ok('GET', `/api/tests/${inProgressId}`);
    assert.equal(inProgress.test.status, 'In Progress');
    assert.equal(inProgress.can.edit, false, 'no edit offered');
    assert.equal(inProgress.can.submit, false, 'no submit offered');
    assert.equal((await tom.put(`/api/tests/${inProgressId}`, { results: [] })).status, 403);
    assert.equal((await tom.post(`/api/tests/${inProgressId}/submit`, { password: PASSWORD })).status, 403);

    // Nobody lists or accepts them as an analyst any more.
    assert.ok(!(await priya.ok('GET', `/api/tests/${pendingId}`)).analysts.some((u) => u.id === tomId), 'not offered on the Test page');
    assert.ok(!(await priya.ok('GET', '/api/qualifications')).users.some((u) => u.id === tomId), 'not offered in the assign dialog');
    const assign = await priya.post('/api/tests/assign', { test_ids: [pendingId], analyst_id: tomId });
    assert.equal(assign.status, 400);
  } finally {
    await admin.ok('PUT', `/api/users/${tomId}`, { role: 'analyst' });
  }
  const restored = await tom.ok('GET', `/api/tests/${pendingId}`);
  assert.equal(restored.can.start, true, 'offered again once the role performs Tests');
  assert.ok((await priya.ok('GET', `/api/tests/${pendingId}`)).analysts.some((u) => u.id === tomId));
});

test('people who perform Tests are the assignable ones, whatever their role', async () => {
  const priya = await as('priya.raman');
  const [testId] = await kfTests('tom.fletcher');
  const d = await priya.ok('GET', `/api/tests/${testId}`);
  const roles = new Set(d.analysts.map((u) => u.role));
  assert.deepEqual([...roles].sort(), ['analyst', 'manager', 'scientist']);
  const quals = await priya.ok('GET', '/api/qualifications');
  assert.deepEqual([...new Set(quals.users.map((u) => u.role))].sort(), ['analyst', 'manager', 'scientist']);
  const daniel = (await priya.ok('GET', '/api/users')).find((u) => u.username === 'daniel.okafor');
  const refused = await priya.post('/api/tests/assign', { test_ids: [testId], analyst_id: daniel.id });
  assert.equal(refused.status, 400, 'QA does not perform Tests');
});

test('an open non-OOS investigation blocks accepting a reviewed Test but not returning it', async () => {
  const tom = await as('tom.fletcher');
  const [testId] = await kfTests('tom.fletcher');
  await enterInSpec(tom, testId);
  await tom.ok('POST', `/api/tests/${testId}/submit`, { password: PASSWORD });
  await (await as('sarah.lindqvist')).ok('POST', `/api/tests/${testId}/review`, { decision: 'approve', password: PASSWORD });
  await tom.ok('POST', '/api/investigations', { type: 'Deviation', title: 'Balance drift noticed', description: 'Drift seen after the run', test_id: testId });

  const daniel = await as('daniel.okafor');
  const d = await daniel.ok('GET', `/api/tests/${testId}`);
  assert.equal(d.test.status, 'Reviewed');
  assert.equal(d.can.accept, false, 'accept not offered while an investigation is open');
  assert.equal(d.can.return, true, 'return still offered');
  assert.ok(!('approve' in d.can), 'the single approve flag is gone');
  const accept = await daniel.post(`/api/tests/${testId}/approve`, { decision: 'approve', password: PASSWORD });
  assert.equal(accept.status, 400);
  assert.match(accept.data.error, /still open/);
  await daniel.ok('POST', `/api/tests/${testId}/approve`, { decision: 'reject', comment: 'Repeat after the deviation is closed', password: PASSWORD });
  assert.equal((await daniel.ok('GET', `/api/tests/${testId}`)).test.status, 'In Progress');
});

test('a reviewed Test with no open investigation offers both accept and return to an independent approver', async () => {
  const tom = await as('tom.fletcher');
  const [testId] = await kfTests('tom.fletcher');
  await enterInSpec(tom, testId);
  await tom.ok('POST', `/api/tests/${testId}/submit`, { password: PASSWORD });
  await (await as('sarah.lindqvist')).ok('POST', `/api/tests/${testId}/review`, { decision: 'approve', password: PASSWORD });
  const d = await (await as('daniel.okafor')).ok('GET', `/api/tests/${testId}`);
  assert.equal(d.can.accept, true);
  assert.equal(d.can.return, true);
  const self = await tom.ok('GET', `/api/tests/${testId}`);
  assert.equal(self.can.accept, false, 'the analyst cannot accept their own Test');
  assert.equal(self.can.return, false);
});

test('an analyst whose role no longer performs Tests has none counted in their My tests badge', async () => {
  const admin = await as('admin');
  const tom = await as('tom.fletcher');
  const tomId = (await tom.ok('GET', '/api/auth/me')).user.id;
  await kfTests('tom.fletcher');
  assert.ok((await tom.ok('GET', '/api/nav')).myTests > 0);

  await admin.ok('PUT', `/api/users/${tomId}`, { role: 'qa' });
  try {
    assert.equal((await tom.ok('GET', '/api/nav')).myTests, 0, 'nothing counted that start and edit are withheld on');
  } finally {
    await admin.ok('PUT', `/api/users/${tomId}`, { role: 'analyst' });
  }
});

test('the first result on a pending Test starts it as a status change and moves its Sample into testing', async () => {
  const priya = await as('priya.raman');
  const tom = await as('tom.fletcher');
  const [testId] = await kfTests('tom.fletcher');
  assert.equal((await tom.ok('GET', `/api/tests/${testId}`)).test.status, 'Pending');
  await enterInSpec(tom, testId);

  const { test: t } = await tom.ok('GET', `/api/tests/${testId}`);
  assert.equal(t.status, 'In Progress');
  assert.ok(t.started_at, 'start time recorded');
  const [latest] = await priya.ok('GET', `/api/history/tests/${testId}`);
  assert.equal(latest.action, 'STATUS', 'audited as a status change');
  assert.equal(latest.summary, 'Results recorded');
  assert.equal((await priya.ok('GET', `/api/samples/${t.sample_id}`)).sample.status, 'In Testing');
});

test('review, approval and cancel refuse with unchanged messages and codes, and are not offered when refused', async () => {
  const [priya, tom, daniel, helena] = await Promise.all(['priya.raman', 'tom.fletcher', 'daniel.okafor', 'helena.weiss'].map(as));
  const [testId] = await kfTests('priya.raman');
  const refused = async (c, action, body, status, error, flag) => {
    const r = await c.post(`/api/tests/${testId}/${action}`, body);
    assert.equal(r.status, status, `${action}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, error);
    if (flag) assert.equal((await c.ok('GET', `/api/tests/${testId}`)).can[flag], false, `${flag} not offered: ${error}`);
  };
  await refused(daniel, 'review', { decision: 'approve', password: PASSWORD }, 400, 'This test is not awaiting review', 'review');
  await refused(tom, 'cancel', { reason: 'Not needed' }, 403, 'You do not have permission to do that.', 'cancel');
  await refused(priya, 'cancel', {}, 400, 'A reason is required to cancel a test');

  await enterInSpec(priya, testId);
  await priya.ok('POST', `/api/tests/${testId}/submit`, { password: PASSWORD });
  await refused(priya, 'review', { decision: 'approve', password: PASSWORD }, 403, 'You performed this test — a different person must review it', 'review');
  await refused(daniel, 'review', { decision: 'return', password: PASSWORD }, 400, 'Explain why the test is being returned to the analyst');
  await refused(helena, 'approve', { decision: 'approve', password: PASSWORD }, 400, 'This test is not awaiting approval', 'accept');

  await daniel.ok('POST', `/api/tests/${testId}/review`, { decision: 'approve', password: PASSWORD });
  await refused(daniel, 'approve', { decision: 'reject', comment: 'Recheck', password: PASSWORD }, 403, 'You reviewed this test — approval must come from a different person', 'return');
  await refused(priya, 'approve', { decision: 'approve', password: PASSWORD }, 403, 'You performed this test — you cannot approve it', 'accept');
  await refused(helena, 'approve', { decision: 'reject', password: PASSWORD }, 400, 'Explain why the test is being returned');

  await helena.ok('POST', `/api/tests/${testId}/approve`, { decision: 'approve', password: PASSWORD });
  await refused(priya, 'cancel', { reason: 'Not needed' }, 400, "An approved test can't be cancelled", 'cancel');
});
