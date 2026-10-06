// Client portal tests: starts a real server on a temporary database with the demo lab, then proves that
// client contacts are confined to their own organisation's data, that portal and staff sessions can never
// stand in for each other, and that the submission → receipt and request → project workflows work end to end.
// Run with:  node --test test/portal.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './server.js';

let BASE;
const PASSWORD = 'demo1234';
const LAURA = 'customer@example.com'; // Acme
const FELIX = 'felix.romero@bluestone-bio.example'; // Bluestone
let server;
let dataDir;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, { csrf = true } = {}) {
    const res = await fetch(BASE + url, {
      method,
      headers: { ...(csrf ? { 'X-Requested-With': 'aliquot' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    this.lastSetCookie = set;
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  get(url) { return this.req('GET', url); }
  post(url, body = {}) { return this.req('POST', url, body); }
  async ok(method, url, body) {
    const r = await this.req(method, url, body);
    assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
}

async function staff(username) {
  const c = new Client();
  await c.ok('POST', '/api/auth/login', { username, password: PASSWORD });
  return c;
}
async function portal(email, password = PASSWORD) {
  const c = new Client();
  await c.ok('POST', '/api/portal/login', { email, password });
  return c;
}

let manager; // priya.raman — staff with every portal permission
let ids; // ids belonging to clients other than Acme, for ID-guessing attacks

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-portal-test-'));
  server = await startServer(dataDir);
  BASE = server.base;
  const setup = await new Client().post('/api/setup', { mode: 'demo' });
  assert.equal(setup.status, 200, `demo setup failed: ${JSON.stringify(setup.data)} ${server.log()}`);

  manager = await staff('priya.raman');
  const clients = await manager.ok('GET', '/api/clients');
  const acme = clients.find((c) => c.code === 'ACME');
  const other = clients.filter((c) => c.id !== acme.id).map((c) => c.id);
  const samples = await manager.ok('GET', '/api/samples?status=all');
  const foreign = samples.filter((s) => other.includes(s.client_id));
  const threads = await manager.ok('GET', '/api/portal-admin/threads');
  const subs = await manager.ok('GET', '/api/portal-admin/submissions?status=all');
  const reqs = await manager.ok('GET', '/api/portal-admin/requests?status=all');
  ids = {
    acme: acme.id,
    other: other[0],
    foreignSample: foreign.find((s) => s.status === 'Reported') || foreign[0],
    foreignThread: threads.find((t) => t.client_id !== acme.id),
    foreignSubmission: subs.find((s) => s.client_id !== acme.id),
    foreignRequest: reqs.find((q) => q.client_id !== acme.id),
    acmeSamples: samples.filter((s) => s.client_id === acme.id),
  };
  for (const k of ['foreignSample', 'foreignThread', 'foreignSubmission', 'foreignRequest']) assert.ok(ids[k], `demo data should contain a ${k}`);
});

after(async () => {
  await server?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('portal sign-in uses its own HttpOnly, SameSite=Strict cookie and never leaks the password hash', async () => {
  const c = new Client();
  assert.equal((await c.post('/api/portal/login', { email: LAURA, password: 'nope' })).status, 401);
  assert.equal((await c.post('/api/portal/login', { email: 'nobody@example.com', password: PASSWORD })).status, 401);
  const r = await c.post('/api/portal/login', { email: LAURA, password: PASSWORD });
  assert.equal(r.status, 200);
  assert.match(c.lastSetCookie, /^aq_portal=/);
  assert.match(c.lastSetCookie, /HttpOnly/);
  assert.match(c.lastSetCookie, /SameSite=Strict/);
  assert.match(c.lastSetCookie, /Path=\/api\/portal/);
  assert.ok(!('password_hash' in r.data.user));
  const me = await c.ok('GET', '/api/portal/me');
  assert.equal(me.client.code, 'ACME');
  // Public info exposes the lab's name, not internal data.
  const info = await new Client().ok('GET', '/api/portal/info');
  assert.ok(info.lab_name);
  assert.ok(!('users' in info) && !('settings' in info));
});

test('portal sessions cannot reach staff endpoints and staff sessions cannot reach portal endpoints', async () => {
  const laura = await portal(LAURA);
  for (const url of ['/api/samples', '/api/auth/me', '/api/clients', '/api/portal-admin/threads', '/api/nav']) {
    assert.equal((await laura.get(url)).status, 401, `portal cookie must be refused on ${url}`);
  }
  assert.equal((await laura.post('/api/portal-admin/threads/1/messages', { body: 'x' })).status, 401);
  for (const url of ['/api/portal/me', '/api/portal/overview', '/api/portal/samples', '/api/portal/threads']) {
    assert.equal((await manager.get(url)).status, 401, `staff cookie must be refused on ${url}`);
  }
  assert.equal((await manager.post('/api/portal/threads', { subject: 'x', body: 'y' })).status, 401);
  assert.equal((await new Client().get('/api/portal/overview')).status, 401);
});

test('mutating portal requests require the CSRF header', async () => {
  const laura = await portal(LAURA);
  const r = await laura.req('POST', '/api/portal/threads', { subject: 'Hello', body: 'World' }, { csrf: false });
  assert.equal(r.status, 403);
  const login = await new Client().req('POST', '/api/portal/login', { email: LAURA, password: PASSWORD }, { csrf: false });
  assert.equal(login.status, 403);
});

test('a client sees only its own samples, and ID-guessing other clients’ records is refused', async () => {
  const laura = await portal(LAURA);
  const mine = await laura.ok('GET', '/api/portal/samples?status=all');
  assert.ok(mine.length > 0);
  const acmeCodes = new Set(ids.acmeSamples.map((s) => s.code));
  assert.ok(mine.every((s) => acmeCodes.has(s.code)), 'every listed sample belongs to the client');
  assert.ok(mine.every((s) => !('price' in s) && !('analyst_id' in s) && !('client_id' in s)), 'internal fields are not exposed');

  const s = ids.foreignSample;
  assert.equal((await laura.get(`/api/portal/samples/${s.id}`)).status, 404);
  assert.equal((await laura.get(`/api/portal/samples/${s.id}/coa`)).status, 404);
  assert.equal((await laura.get(`/api/portal/threads/${ids.foreignThread.id}`)).status, 404);
  assert.equal((await laura.post(`/api/portal/threads/${ids.foreignThread.id}/messages`, { body: 'sneaky' })).status, 404);
  assert.equal((await laura.get(`/api/portal/submissions/${ids.foreignSubmission.id}`)).status, 404);
  assert.equal((await laura.post(`/api/portal/submissions/${ids.foreignSubmission.id}/withdraw`)).status, 404);
  assert.equal((await laura.get(`/api/portal/requests/${ids.foreignRequest.id}`)).status, 404);
  // Attaching another client's sample to a new conversation is refused as well.
  assert.equal((await laura.post('/api/portal/threads', { subject: 'x', body: 'y', sample_id: s.id })).status, 400);

  const threads = await laura.ok('GET', '/api/portal/threads');
  assert.ok(!threads.some((t) => t.id === ids.foreignThread.id));
  const reqs = await laura.ok('GET', '/api/portal/requests');
  assert.ok(!reqs.some((q) => q.id === ids.foreignRequest.id));
});

test('certificates are only available once issued, with client-safe fields', async () => {
  const laura = await portal(LAURA);
  const open = (await laura.ok('GET', '/api/portal/samples?status=open'))[0];
  assert.ok(open, 'Acme has samples in progress');
  const r = await laura.get(`/api/portal/samples/${open.id}/coa`);
  assert.equal(r.status, 403, 'an unissued certificate cannot be downloaded');
  const reported = (await laura.ok('GET', '/api/portal/samples?status=reported'))[0];
  const coa = await laura.ok('GET', `/api/portal/samples/${reported.id}/coa`);
  assert.equal(coa.sample.code, reported.code);
  assert.ok(coa.tests.length > 0 && coa.tests[0].results.length > 0);
  const raw = JSON.stringify(coa);
  for (const leak of ['"price"', '"oos"', '"analyst_id"', '"instrument', '"password', '"raw_data_ref"', '"comments"']) assert.ok(!raw.includes(leak), `CoA must not include ${leak}`);
});

test('forced password change for invited contacts, and lockout after five failures', async () => {
  const invited = await manager.ok('POST', '/api/portal-admin/accounts', { client_id: ids.acme, email: 'new.contact@acme-pharma.example', full_name: 'New Contact' });
  assert.ok(invited.temp_password);
  const c = await portal('new.contact@acme-pharma.example', invited.temp_password);
  const blocked = await c.get('/api/portal/overview');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await c.post('/api/portal/password', { current: invited.temp_password, next: 'short' })).status, 400);
  await c.ok('POST', '/api/portal/password', { current: invited.temp_password, next: 'BetterPass42' });
  await c.ok('GET', '/api/portal/overview');

  const attacker = new Client();
  for (let i = 0; i < 5; i++) assert.equal((await attacker.post('/api/portal/login', { email: 'new.contact@acme-pharma.example', password: `guess${i}` })).status, 401);
  assert.equal((await attacker.post('/api/portal/login', { email: 'new.contact@acme-pharma.example', password: 'BetterPass42' })).status, 423, 'locked even with the right password');
  const accounts = await manager.ok('GET', '/api/portal-admin/accounts');
  assert.ok(accounts.find((a) => a.email === 'new.contact@acme-pharma.example').locked);
  // Staff reset unlocks and forces another change.
  const reset = await manager.ok('POST', `/api/portal-admin/accounts/${invited.id}/reset`);
  const again = await portal('new.contact@acme-pharma.example', reset.temp_password);
  assert.equal((await again.get('/api/portal/overview')).data.code, 'PASSWORD_CHANGE_REQUIRED');
  // Deactivation ends sessions at once.
  await again.ok('POST', '/api/portal/password', { current: reset.temp_password, next: 'AnotherPass77' });
  await manager.ok('POST', `/api/portal-admin/accounts/${invited.id}/active`, { active: false });
  assert.equal((await again.get('/api/portal/overview')).status, 401);
  assert.equal((await new Client().post('/api/portal/login', { email: 'new.contact@acme-pharma.example', password: 'AnotherPass77' })).status, 401);
});

test('only portal.manage roles create accounts; only portal.respond roles reply', async () => {
  const tom = await staff('tom.fletcher'); // analyst
  assert.equal((await tom.post('/api/portal-admin/accounts', { client_id: ids.acme, email: 'x@acme-pharma.example', full_name: 'X' })).status, 403);
  assert.equal((await tom.post(`/api/portal-admin/threads/${ids.foreignThread.id}/messages`, { body: 'hi' })).status, 403);
  await tom.ok('GET', '/api/portal-admin/threads'); // but may read
});

test('sample submission: client submits → lab acknowledges → receives into real samples', async () => {
  const laura = await portal(LAURA);
  const lk = await laura.ok('GET', '/api/portal/lookups');
  assert.ok(lk.methods.length > 0);
  assert.ok(lk.methods.every((m) => !('price' in m)), 'no prices in the portal');
  const method = lk.methods.find((m) => m.code === 'ATM-0002') || lk.methods[0];
  // A client_id in the body is ignored — submissions always belong to the signed-in contact's client.
  const sub = await laura.ok('POST', '/api/portal/submissions', {
    client_id: ids.other, priority: 'Rush', courier: 'FedEx', tracking_no: '123', notes: 'Line one\n<script>alert(1)</script>',
    samples: [{ description: 'Test tablets', batch_no: 'T-1', client_ref: 'R-1' }, { description: 'Test tablets', batch_no: 'T-2' }],
    method_ids: [method.id],
  });
  assert.match(sub.code, /^SUB-/);
  const detail = await manager.ok('GET', `/api/portal-admin/submissions/${sub.id}`);
  assert.equal(detail.submission.client_id, ids.acme);
  assert.equal(detail.submission.notes, 'Line one\n<script>alert(1)</script>', 'stored verbatim; the UI escapes on output');

  const nav = await manager.ok('GET', '/api/nav');
  assert.ok(nav.portal > 0, 'staff nav badge counts new submissions');

  // Tests the client may not order (e.g. another client's method) are refused.
  const allMethods = await manager.ok('GET', '/api/methods?usable=1');
  const foreignMethod = allMethods.find((m) => m.client_id && m.client_id !== ids.acme);
  if (foreignMethod) assert.equal((await laura.post('/api/portal/submissions', { samples: [{ description: 'x' }], method_ids: [foreignMethod.id] })).status, 400);

  await manager.ok('POST', `/api/portal-admin/submissions/${sub.id}/acknowledge`, { note: 'See you tomorrow' });
  const nadia = await staff('nadia.rossi');
  const rec = await nadia.ok('POST', `/api/portal-admin/submissions/${sub.id}/receive`, { condition: 'Acceptable', location: 'Store A', storage: 'Ambient (15–25 °C)' });
  assert.equal(rec.samples.length, 2);
  assert.equal((await nadia.post(`/api/portal-admin/submissions/${sub.id}/receive`, {})).status, 400, 'cannot receive twice');

  const mine = await laura.ok('GET', `/api/portal/submissions/${sub.id}`);
  assert.equal(mine.submission.status, 'Received');
  assert.deepEqual(mine.submission.received_samples.map((s) => s.code).sort(), rec.samples.map((s) => s.code).sort());
  assert.ok(!('received_by' in mine.submission), 'staff ids are not exposed to clients');
  const sample = await manager.ok('GET', `/api/samples/${rec.samples[0].id}`);
  assert.equal(sample.sample.client_id, ids.acme);
  const thread = await laura.ok('GET', `/api/portal/threads/${mine.thread_id}`);
  assert.ok(thread.messages.some((m) => m.side === 'lab' && m.body === 'See you tomorrow'));
  assert.ok(thread.messages.some((m) => m.side === 'system' && m.body.includes(rec.samples[0].code)));
});

test('messages: unread tracking on both sides; replies are plain text', async () => {
  const laura = await portal(LAURA);
  const { id } = await laura.ok('POST', '/api/portal/threads', { subject: 'Question about MF-2614', body: 'Hi,\n<b>bold?</b>' });
  let staffThreads = await manager.ok('GET', '/api/portal-admin/threads?unread=1');
  assert.ok(staffThreads.some((t) => t.id === id && t.unread), 'unread for the lab');
  const t = await manager.ok('GET', `/api/portal-admin/threads/${id}`);
  assert.equal(t.messages[0].body, 'Hi,\n<b>bold?</b>');
  staffThreads = await manager.ok('GET', '/api/portal-admin/threads?unread=1');
  assert.ok(!staffThreads.some((x) => x.id === id), 'read once opened');
  await manager.ok('POST', `/api/portal-admin/threads/${id}/messages`, { body: 'Hello Laura' });
  let mine = await laura.ok('GET', '/api/portal/threads');
  assert.ok(mine.find((x) => x.id === id).unread);
  await laura.ok('GET', `/api/portal/threads/${id}`);
  mine = await laura.ok('GET', '/api/portal/threads');
  assert.ok(!mine.find((x) => x.id === id).unread);
  assert.equal((await laura.post(`/api/portal/threads/${id}/messages`, { body: '   ' })).status, 400);
  // Felix (another client) cannot see it.
  const felix = await portal(FELIX);
  assert.equal((await felix.get(`/api/portal/threads/${id}`)).status, 404);
});

test('method request: client asks → lab sends proposal → project opened for the right client', async () => {
  const laura = await portal(LAURA);
  const q = await laura.ok('POST', '/api/portal/requests', {
    type: 'Method validation', title: 'Validate KF method', product: 'Metformin', technique: 'Karl Fischer',
    parameters: ['Accuracy', 'Repeatability', 'Not a parameter'], scope: 'Water 0.1–1 %', regulatory: 'GMP release',
  });
  const mine = await laura.ok('GET', `/api/portal/requests/${q.id}`);
  assert.deepEqual(mine.request.parameters, ['Accuracy', 'Repeatability']);
  assert.equal((await manager.post(`/api/portal-admin/requests/${q.id}/status`, { status: 'Proposal sent' })).status, 400, 'a proposal needs a message');
  await manager.ok('POST', `/api/portal-admin/requests/${q.id}/status`, { status: 'Proposal sent', response: 'Quote attached by email.' });
  await manager.ok('POST', `/api/portal-admin/requests/${q.id}/status`, { status: 'Accepted' });
  const p = await manager.ok('POST', `/api/portal-admin/requests/${q.id}/project`, { status: 'Active' });
  const project = await manager.ok('GET', `/api/projects/${p.id}`);
  assert.equal(project.project.client_id, ids.acme);
  assert.equal(project.project.type, 'Method Validation');
  const after = await laura.ok('GET', `/api/portal/requests/${q.id}`);
  assert.equal(after.request.status, 'Accepted');
  assert.equal(after.request.project_code, p.code);
  const projects = await laura.ok('GET', '/api/portal/projects');
  assert.ok(projects.some((x) => x.code === p.code));
});

const newRequest = async () => (await (await portal(LAURA)).ok('POST', '/api/portal/requests', { type: 'Method validation', title: 'Validate HPLC assay' })).id;

test('a request the lab has responded to is never moved back to Submitted', async () => {
  const id = await newRequest();
  await manager.ok('POST', `/api/portal-admin/requests/${id}/status`, { status: 'Under review', response: 'Looking at the scope now.' });
  const r = await manager.post(`/api/portal-admin/requests/${id}/status`, { status: 'Submitted' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'A request never goes back to Submitted');
  assert.equal((await manager.ok('GET', `/api/portal-admin/requests/${id}`)).request.status, 'Under review');
});

test('a request is accepted only after a proposal was sent', async () => {
  const id = await newRequest();
  for (const step of [null, 'Under review']) {
    if (step) await manager.ok('POST', `/api/portal-admin/requests/${id}/status`, { status: step });
    const r = await manager.post(`/api/portal-admin/requests/${id}/status`, { status: 'Accepted' });
    assert.equal(r.status, 400, `from ${step || 'Submitted'}`);
    assert.equal(r.data.error, 'A request is accepted only after a proposal has been sent');
  }
  assert.equal((await manager.ok('GET', `/api/portal-admin/requests/${id}`)).request.status, 'Under review');
});

test('portal actions are written to the audit trail under the contact’s identity', async () => {
  const qa = await staff('daniel.okafor');
  const who = `portal:${LAURA}`;
  const logins = await qa.ok('GET', '/api/audit?entity=portal_users&action=LOGIN&limit=2000');
  assert.ok(logins.some((r) => r.username === who && r.user_id == null), 'portal sign-ins are audited under the contact, never a staff id');
  const list = await qa.ok('GET', '/api/audit?entity=portal_submissions&limit=2000');
  assert.ok(list.some((r) => r.username === who && r.action === 'CREATE'), 'submissions are audited');
  assert.ok(list.some((r) => r.username === 'nadia.rossi' && r.action === 'STATUS'), 'staff receipt is audited');
});
