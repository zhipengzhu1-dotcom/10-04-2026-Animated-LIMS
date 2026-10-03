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

class Client {
  constructor(base = BASE) { this.base = base; this.cookie = ''; }
  async req(method, url, body) {
    const res = await fetch(this.base + url, {
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

async function as(username, base = BASE) {
  const c = new Client(base);
  await c.ok('POST', '/api/auth/login', { username, password: PASSWORD });
  return c;
}

/** Starts a server with the demo lab and the given Shipped modules on `port`. */
async function startServer(port, modules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-pilot-test-'));
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ALIQUOT_DATA: dir, SHIPPED_MODULES: modules.join(',') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/setup`)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const setup = await new Client(base).post('/api/setup', { mode: 'demo' });
  assert.equal(setup.status, 200, `demo setup failed: ${JSON.stringify(setup.data)} ${log}`);
  return { base, proc, dir };
}

const stopServer = ({ proc, dir }) => {
  proc.kill();
  fs.rmSync(dir, { recursive: true, force: true });
};

/** Runs `fn(base)` against a second server that ships only `modules`. */
async function withModules(modules, fn) {
  const s = await startServer(PORT + 200 + Math.floor(Math.random() * 90), modules);
  try { await fn(s.base); } finally { stopServer(s); }
}

before(async () => {
  server = await startServer(PORT, PILOT_MODULES);
});

after(() => {
  if (server) stopServer(server);
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

// #7
// Drives a fresh Karl Fischer Test to an out-of-spec submission and through peer review.
async function pilotOosTest(analystUsername) {
  const priya = await as('priya.raman');
  const clients = await priya.ok('GET', '/api/clients');
  const method = (await priya.ok('GET', '/api/methods?usable=1')).find((m) => m.code === 'ATM-0002' && m.status === 'Effective');
  const received = await priya.ok('POST', '/api/samples/receive', { client_id: clients[0].id, samples: [{ description: 'Pilot OOS' }], method_ids: [method.id] });
  const sampleId = received.samples[0].id;
  const testId = (await priya.ok('GET', `/api/samples/${sampleId}`)).tests[0].id;
  const users = await priya.ok('GET', '/api/users');
  await priya.ok('POST', '/api/tests/assign', { test_ids: [testId], analyst_id: users.find((u) => u.username === analystUsername).id });
  const analyst = await as(analystUsername);
  const d = await analyst.ok('GET', `/api/tests/${testId}`);
  await analyst.ok('PUT', `/api/tests/${testId}`, { instrument_id: d.instruments.find((i) => i.code === 'KF-01').id, results: [{ id: d.results[0].id, value: '0.9' }] });
  const { investigation } = await analyst.ok('POST', `/api/tests/${testId}/submit`, { password: PASSWORD });
  await (await as('sarah.lindqvist')).ok('POST', `/api/tests/${testId}/review`, { decision: 'approve', password: PASSWORD });
  return { sampleId, testId, investigation };
}

test('Withheld Investigations APIs answer like routes that do not exist', async () => {
  const nowhere = await new Client().get('/api/no-such-route');
  const qa = await as('daniel.okafor'); // QA can raise and close investigations when the module ships
  const calls = [
    ['GET', '/api/investigations'], ['GET', '/api/investigations?status=open'], ['GET', '/api/investigations/1'],
    ['POST', '/api/investigations', { type: 'Deviation', title: 'Pilot deviation' }],
    ['PUT', '/api/investigations/1', { title: 'Renamed' }],
    ['POST', '/api/investigations/1/close', { password: PASSWORD }],
  ];
  for (const [method, url, body] of calls) {
    for (const [who, c] of [['QA', qa], ['anonymous', new Client()]]) {
      const r = await c.req(method, url, body);
      assert.equal(r.status, 404, `${who} ${method} ${url}`);
      assert.deepEqual(r.data, nowhere.data, `${who} ${method} ${url} looks like a missing route`);
    }
  }
});

test('an out-of-spec submission still opens an OOS investigation that blocks approval and the CoA until closed on the Test page', async () => {
  const daniel = await as('daniel.okafor');
  const { sampleId, testId, investigation } = await pilotOosTest('priya.raman');
  assert.match(investigation?.code ?? '', /^OOS-/, 'the OOS investigation opens automatically');

  const d = await daniel.ok('GET', `/api/tests/${testId}`);
  assert.deepEqual(d.investigations.map((v) => [v.code, v.status]), [[investigation.code, 'Open']], 'the Test page still shows its OOS investigation');
  assert.equal(d.can.raise, false, 'no manual raising while Investigations is withheld');
  assert.equal(d.can.closeInvestigation, true);
  const blocked = await daniel.post(`/api/tests/${testId}/approve`, { decision: 'approve', password: PASSWORD });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /still open/);
  assert.equal((await daniel.post(`/api/samples/${sampleId}/report`, { password: PASSWORD })).status, 400, 'no CoA while it is open');

  await daniel.ok('POST', `/api/tests/${testId}/investigation/close`, { root_cause: 'Moisture uptake', conclusion: 'Confirmed OOS — result valid', password: PASSWORD });
  await daniel.ok('POST', `/api/tests/${testId}/approve`, { decision: 'approve', password: PASSWORD });
  await daniel.ok('POST', `/api/samples/${sampleId}/report`, { password: PASSWORD });
  assert.equal((await daniel.ok('GET', `/api/samples/${sampleId}`)).sample.status, 'Reported');
});

test('search, badges, record files and history leave out Investigations', async () => {
  const c = await as('daniel.okafor');
  const { investigation } = await pilotOosTest('tom.fletcher');
  for (const q of [investigation.code, 'OOS', 'DEV']) {
    const found = await c.ok('GET', `/api/search?q=${encodeURIComponent(q)}`);
    assert.ok(!found.results.some((x) => x.type === 'Investigation'), `no Investigation results for "${q}"`);
    assert.ok(!found.results.some((x) => x.href.startsWith('/investigations')), `no links into Investigations for "${q}"`);
  }
  assert.equal((await c.ok('GET', `/api/search?q=${investigation.code}`)).exact, null);
  const nav = await c.ok('GET', '/api/nav');
  assert.ok(!('investigations' in nav), 'no investigations badge count');
  assert.ok('portal' in nav, 'Shipped badges are still counted');
  assert.equal((await c.get(`/api/attachments?entity=investigations&id=${investigation.id}`)).status, 404);
  assert.equal((await c.get(`/api/history/investigations/${investigation.id}`)).status, 404);
});

test('sample, project and instrument details carry no investigation lists', async () => {
  const c = await as('daniel.okafor');
  const { sampleId } = await pilotOosTest('tom.fletcher');
  const sample = await c.ok('GET', `/api/samples/${sampleId}`);
  assert.ok(!('investigations' in sample), 'sample detail has no investigations');
  assert.ok(sample.tests.length, 'the rest of the sample detail is intact');
  const [project] = await c.ok('GET', '/api/projects');
  assert.ok(!('investigations' in await c.ok('GET', `/api/projects/${project.id}`)), 'project detail has no investigations');
  for (const i of await c.ok('GET', '/api/instruments')) {
    assert.ok(!('investigations' in await c.ok('GET', `/api/instruments/${i.id}`)), `instrument ${i.code} detail has no investigations`);
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

// #9
test('Withheld Reviews & approvals queue answers like a route that does not exist, signed in or not', async () => {
  const nowhere = await new Client().get('/api/no-such-route');
  for (const [who, c] of [['QA', await as('daniel.okafor')], ['anonymous', new Client()]]) {
    const r = await c.get('/api/reviews');
    assert.equal(r.status, 404, `${who} GET /api/reviews`);
    assert.deepEqual(r.data, nowhere.data, `${who} GET /api/reviews looks like a missing route`);
  }
});

test('badge counts carry no Worklist or Reviews queue', async () => {
  for (const username of ['tom.fletcher', 'sarah.lindqvist', 'daniel.okafor']) {
    const nav = await (await as(username)).ok('GET', '/api/nav');
    assert.ok(!('myTests' in nav), `${username}: no Worklist count`);
    assert.ok(!('reviews' in nav), `${username}: no Reviews count`);
  }
});

test('starting from a sample, a Test is assigned, performed, reviewed, approved and certified without the Worklist or Reviews', async () => {
  const priya = await as('priya.raman');
  const tom = await as('tom.fletcher');
  const sarah = await as('sarah.lindqvist');
  const daniel = await as('daniel.okafor');
  const [client] = await priya.ok('GET', '/api/clients');
  const methods = await priya.ok('GET', '/api/methods?usable=1');
  const kf = methods.find((m) => m.code === 'ATM-0002' && m.status === 'Effective');
  const ftir = methods.find((m) => m.code === 'ATM-0006' && m.status === 'Effective');
  const received = await priya.ok('POST', '/api/samples/receive', { client_id: client.id, samples: [{ description: 'Pilot walk' }], method_ids: [kf.id, ftir.id] });
  const sampleId = received.samples[0].id;
  const { tests } = await priya.ok('GET', `/api/samples/${sampleId}`);
  const kfTest = tests.find((t) => t.method_code === 'ATM-0002');
  const irTest = tests.find((t) => t.method_code === 'ATM-0006');

  // The assign dialog lists the sample's tests and assigns one; the analyst picks up the other.
  const listed = await priya.ok('GET', `/api/tests?sample_id=${sampleId}`);
  assert.deepEqual(listed.map((t) => t.id).sort(), [kfTest.id, irTest.id].sort());
  const tomUser = (await priya.ok('GET', '/api/users')).find((u) => u.username === 'tom.fletcher');
  await priya.ok('POST', '/api/tests/assign', { test_ids: [kfTest.id], analyst_id: tomUser.id });
  await tom.ok('POST', `/api/tests/${irTest.id}/claim`);

  for (const id of [kfTest.id, irTest.id]) await tom.ok('POST', `/api/tests/${id}/start`);
  const kfDetail = await tom.ok('GET', `/api/tests/${kfTest.id}`);
  await tom.ok('PUT', `/api/tests/${kfTest.id}`, { instrument_id: kfDetail.instruments.find((i) => i.code === 'KF-01').id, results: [{ id: kfDetail.results[0].id, value: '0.21' }] });
  const irDetail = await tom.ok('GET', `/api/tests/${irTest.id}`);
  await tom.ok('PUT', `/api/tests/${irTest.id}`, { instrument_id: irDetail.instruments.find((i) => i.code === 'FTIR-01').id, results: [{ id: irDetail.results[0].id, value: 'Conforms to reference', outcome: 'Pass' }] });

  for (const id of [kfTest.id, irTest.id]) {
    const submitted = await tom.ok('POST', `/api/tests/${id}/submit`, { password: PASSWORD });
    assert.ok(!submitted.investigation, 'in-spec results open no investigation');
    assert.equal((await tom.post(`/api/tests/${id}/review`, { decision: 'approve', password: PASSWORD })).status, 403, 'no self-review');
    assert.ok((await sarah.ok('GET', `/api/tests/${id}`)).can.review);
    await sarah.ok('POST', `/api/tests/${id}/review`, { decision: 'approve', password: PASSWORD });
    assert.equal((await sarah.post(`/api/tests/${id}/approve`, { decision: 'approve', password: PASSWORD })).status, 403, 'the reviewer cannot also approve');
    assert.ok((await daniel.ok('GET', `/api/tests/${id}`)).can.approve);
    await daniel.ok('POST', `/api/tests/${id}/approve`, { decision: 'approve', password: PASSWORD });
  }

  assert.equal((await daniel.ok('GET', `/api/samples/${sampleId}`)).sample.status, 'Approved');
  await daniel.ok('POST', `/api/samples/${sampleId}/report`, { password: PASSWORD });
  assert.equal((await daniel.ok('GET', `/api/samples/${sampleId}`)).sample.status, 'Reported');
});

// #6
test('Withheld Lab notebook APIs, including Word/Excel documents, answer like routes that do not exist', async () => {
  const nowhere = await new Client().get('/api/no-such-route');
  const tom = await as('tom.fletcher'); // an analyst who keeps notebook entries when the notebook ships
  const gets = ['/api/notebook', '/api/notebook?mine=1', '/api/notebook/1', '/api/notebook/1/documents', '/api/notebook-documents/1/versions', '/api/notebook-documents/1/file', '/api/notebook-documents/1/preview'];
  const posts = ['/api/notebook', '/api/notebook/1/sign', '/api/notebook/1/witness', '/api/notebook/1/addenda', '/api/notebook/1/documents', '/api/notebook-documents/1/edit-link', '/api/notebook-documents/1/remove'];
  for (const [who, c] of [['analyst', tom], ['anonymous', new Client()]]) {
    for (const url of gets) {
      const r = await c.get(url);
      assert.equal(r.status, 404, `${who} GET ${url}`);
      assert.deepEqual(r.data, nowhere.data, `${who} GET ${url} looks like a missing route`);
    }
    for (const url of posts) assert.equal((await c.post(url, { title: 'x', password: PASSWORD })).status, 404, `${who} POST ${url}`);
    assert.equal((await c.put('/api/notebook/1', { body: 'x' })).status, 404, `${who} PUT /api/notebook/1`);
  }
});

test('Office documents are not served over WebDAV with the Lab notebook withheld', async () => {
  for (const method of ['OPTIONS', 'PROPFIND', 'GET', 'PUT', 'LOCK']) {
    const r = await fetch(`${BASE}/dav/any-token/Linearity.xlsx`, { method });
    assert.equal(r.status, 404, `${method} /dav/…`);
    assert.equal(r.headers.get('dav'), null, `${method} /dav/… does not advertise WebDAV`);
  }
});

test('global search returns no Notebook results with the Lab notebook withheld', async () => {
  const c = await as('kenji.watanabe');
  for (const q of ['peptide map', 'ELN-', 'Linearity']) {
    const { results } = await c.ok('GET', `/api/search?q=${encodeURIComponent(q)}`);
    assert.deepEqual(results.filter((x) => x.type === 'Notebook' || x.href.startsWith('/notebook')), [], `search "${q}"`);
  }
  const { results } = await c.ok('GET', '/api/search?q=ATM-0009');
  assert.ok(results.some((x) => x.type === 'Method'), 'Shipped result types still come back');
});

test('sample, project, method and user details carry no notebook data', async () => {
  const c = await as('kenji.watanabe');
  const [sample] = await c.ok('GET', '/api/samples?status=');
  const s = await c.ok('GET', `/api/samples/${sample.id}`);
  assert.ok(s.sample, 'the sample detail still answers');
  assert.ok(!('notebook' in s), 'no notebook list on the sample');
  for (const p of await c.ok('GET', '/api/projects?status=all')) {
    const d = await c.ok('GET', `/api/projects/${p.id}`);
    assert.ok(!('notebook' in d), `no notebook list on project ${p.code}`);
  }
  const method = (await c.ok('GET', '/api/methods')).find((m) => m.code === 'ATM-0009');
  const m = await c.ok('GET', `/api/methods/${method.id}`);
  assert.ok(!('notebook' in m), 'no notebook list on the method');
  const me = await c.ok('GET', '/api/auth/me');
  const u = await c.ok('GET', `/api/users/${me.user.id}`);
  assert.ok(u.stats.approved_90d >= 0, 'user stats still answer');
  assert.ok(!('notebook_entries' in u.stats), 'no notebook count in user stats');
});

test('attachments on Shipped records still work with the Lab notebook withheld; notebook ones do not', async () => {
  const tom = await as('tom.fletcher');
  const [s] = await tom.ok('GET', '/api/samples?status=open');
  const res = await fetch(`${BASE}/api/attachments?entity=samples&id=${s.id}`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'aliquot', Cookie: tom.cookie, 'Content-Type': 'text/plain', 'X-Filename': encodeURIComponent('chain of custody.txt') },
    body: 'Courier: XYZ, logger 4.2 °C',
  });
  assert.equal(res.status, 200);
  const { id } = await res.json();
  const list = await tom.ok('GET', `/api/attachments?entity=samples&id=${s.id}`);
  assert.ok(list.some((a) => a.id === id && a.filename === 'chain of custody.txt'), 'the upload is listed on the sample');
  const file = await fetch(`${BASE}/api/attachments/${id}/file`, { headers: { Cookie: tom.cookie } });
  assert.equal(await file.text(), 'Courier: XYZ, logger 4.2 °C');

  assert.equal((await tom.get('/api/attachments?entity=notebook_entries&id=1')).status, 404, 'notebook entry files are not listed');
  const upload = await fetch(`${BASE}/api/attachments?entity=notebook_entries&id=1`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'aliquot', Cookie: tom.cookie, 'Content-Type': 'text/plain', 'X-Filename': 'x.txt' },
    body: 'x',
  });
  assert.equal(upload.status, 404, 'nothing can be attached to a notebook entry');
  assert.equal((await tom.get('/api/history/notebook_entries/1')).status, 404, 'notebook entry history is not served');
});

// Review fixes
// The APIs that belong to a single module. No route uses DELETE, so DELETE on the same address shows what a missing route answers.
const MODULE_APIS = {
  methods: [['GET', '/api/methods/1'], ['POST', '/api/methods'], ['PUT', '/api/methods/1'], ['POST', '/api/methods/1/status'], ['POST', '/api/methods/1/new-version']],
  instruments: [['GET', '/api/instruments/1'], ['POST', '/api/instruments'], ['PUT', '/api/instruments/1'], ['POST', '/api/instruments/1/logs']],
  inventory: [['GET', '/api/inventory'], ['GET', '/api/inventory/1'], ['POST', '/api/inventory'], ['PUT', '/api/inventory/1'], ['POST', '/api/inventory/1/adjust']],
  clients: [['GET', '/api/clients/1'], ['POST', '/api/clients'], ['PUT', '/api/clients/1']],
  projects: [['GET', '/api/projects/1'], ['POST', '/api/projects'], ['PUT', '/api/projects/1']],
  invoices: [['GET', '/api/invoices'], ['GET', '/api/invoices/unbilled'], ['GET', '/api/invoices/1'], ['POST', '/api/invoices'], ['PUT', '/api/invoices/1'], ['POST', '/api/invoices/1/add-unbilled'], ['POST', '/api/invoices/1/issue'], ['POST', '/api/invoices/1/paid'], ['POST', '/api/invoices/1/void']],
  portal: [['GET', '/api/portal-admin/summary'], ['GET', '/api/portal-admin/threads'], ['GET', '/api/portal-admin/submissions/1'], ['POST', '/api/portal-admin/accounts'], ['GET', '/api/portal/info'], ['POST', '/api/portal/login'], ['GET', '/api/portal/me'], ['GET', '/api/portal/samples']],
  insights: [['GET', '/api/insights']],
  team: [['GET', '/api/users'], ['GET', '/api/users/1'], ['POST', '/api/users'], ['PUT', '/api/users/1'], ['POST', '/api/users/1/reset-password'], ['POST', '/api/qualifications'], ['POST', '/api/qualifications/1/revoke']],
  settings: [['PUT', '/api/settings']],
  samples: [['GET', '/api/samples'], ['POST', '/api/samples/receive'], ['GET', '/api/samples/labels?ids=1'], ['GET', '/api/samples/1'], ['PUT', '/api/samples/1'], ['POST', '/api/samples/1/custody'], ['POST', '/api/samples/1/tests'], ['POST', '/api/samples/1/cancel'], ['POST', '/api/samples/1/report'], ['GET', '/api/samples/1/coa'], ['POST', '/api/samples/1/coa-printed']],
};

async function assertWithheld(base, modules) {
  for (const [who, c] of [['Administrator', await as('admin', base)], ['anonymous', new Client(base)]]) {
    for (const module of modules) {
      for (const [method, url] of MODULE_APIS[module]) {
        const r = await c.req(method, url, method === 'GET' ? undefined : {});
        const missing = await c.req('DELETE', url);
        assert.ok([404, 405].includes(r.status), `${who} ${method} ${url} (${module}) → ${r.status}`);
        assert.deepEqual([r.status, r.data], [missing.status, missing.data], `${who} ${method} ${url} (${module}) looks like a missing route`);
      }
    }
  }
}

test('the Test page shows who signed an OOS investigation’s closure while Investigations is withheld', async () => {
  const daniel = await as('daniel.okafor');
  const { testId } = await pilotOosTest('tom.fletcher');
  const [open] = (await daniel.ok('GET', `/api/tests/${testId}`)).investigations;
  assert.deepEqual(open.signatures, [], 'an open investigation carries no closure signature');
  await daniel.ok('POST', `/api/tests/${testId}/investigation/close`, { root_cause: 'Moisture uptake', conclusion: 'Confirmed OOS — result valid', password: PASSWORD });
  const [closed] = (await daniel.ok('GET', `/api/tests/${testId}`)).investigations;
  assert.deepEqual(closed.signatures.map((s) => [s.full_name, s.meaning]), [['Daniel Okafor', 'OOS investigation closed']]);
  assert.ok(closed.signatures[0].signed_at, 'with the time it was signed');
});

test('WebDAV option probes on the document folder find nothing with the Lab notebook withheld', async () => {
  for (const url of ['/dav', '/dav/', '/dav/any-token/', '/dav/any-token']) {
    const r = await fetch(`${BASE}${url}`, { method: 'OPTIONS' });
    assert.equal(r.status, 404, `OPTIONS ${url}`);
    assert.equal(r.headers.get('dav'), null, `OPTIONS ${url} does not advertise WebDAV`);
  }
});

// Each detail page's own module, and the lists it embeds from other modules.
const EMBEDDED = {
  client: ['clients', { projects: 'projects', samples: 'samples', methods: 'methods', invoices: 'invoices' }],
  project: ['projects', { samples: 'samples', invoices: 'invoices' }],
  method: ['methods', { recentTests: 'samples', qualified: 'team' }],
  instrument: ['instruments', { recentTests: 'samples' }],
  item: ['inventory', { tests: 'samples' }],
  user: ['team', { openTests: 'samples' }],
};

async function detailKeys(c) {
  const first = async (list) => (await c.get(list)).data[0];
  const keys = {};
  const client = await first('/api/clients');
  if (client) keys.client = (await c.get(`/api/clients/${client.id}`)).data;
  const project = await first('/api/projects?status=all');
  if (project) keys.project = (await c.get(`/api/projects/${project.id}`)).data;
  const method = await first('/api/methods');
  if (method) keys.method = (await c.get(`/api/methods/${method.id}`)).data;
  const instrument = await first('/api/instruments');
  if (instrument) keys.instrument = (await c.get(`/api/instruments/${instrument.id}`)).data;
  keys.item = (await c.get('/api/inventory/1')).data;
  keys.user = (await c.get('/api/users/2')).data;
  return keys;
}

test('detail pages embed lists from other modules only while those modules ship', async () => {
  const shippedEverywhere = await detailKeys(await as('oliver.grant'));
  for (const [page, [, lists]] of Object.entries(EMBEDDED)) {
    for (const key of Object.keys(lists)) assert.ok(key in shippedEverywhere[page], `${page} detail has ${key} while its module ships`);
  }
  for (const modules of [['clients', 'instruments', 'inventory', 'team'], ['projects', 'methods']]) {
    await withModules(modules, async (base) => {
      const details = await detailKeys(await as('oliver.grant', base));
      for (const [page, [own, lists]] of Object.entries(EMBEDDED)) {
        if (!modules.includes(own)) continue;
        for (const [key, module] of Object.entries(lists)) {
          assert.equal(key in details[page], modules.includes(module), `${page} detail ${modules.includes(module) ? 'has' : 'omits'} ${key} with ${module} ${modules.includes(module) ? 'shipped' : 'withheld'}`);
        }
      }
    });
  }
});

test('the Client portal inbox cannot create samples or projects while those modules are withheld', async () => {
  await withModules(['portal'], async (base) => {
    const priya = await as('priya.raman', base);
    await priya.ok('GET', '/api/portal-admin/summary');
    const [submission] = await priya.ok('GET', '/api/portal-admin/submissions?status=all');
    const [request] = await priya.ok('GET', '/api/portal-admin/requests?status=all');
    assert.equal((await priya.post(`/api/portal-admin/submissions/${submission.id}/receive`, {})).status, 404, 'no receiving into Samples');
    assert.equal((await priya.post(`/api/portal-admin/requests/${request.id}/project`, {})).status, 404, 'no opening a Project');
  });
});

// Searches broadly enough to hit every result type, and returns the types that came back.
async function searchTypes(c) {
  const types = new Set();
  for (const q of ['ATM', 'S-', 'T-', 'P-', 'INV', 'KF', 'HPLC', 'Pharma', 'an', 'er']) {
    for (const x of (await c.ok('GET', `/api/search?q=${encodeURIComponent(q)}`)).results) types.add(x.type);
  }
  return types;
}

test('with only Samples shipped, every other module’s APIs answer like missing routes while the shared core still answers', async () => {
  await withModules(['samples'], async (base) => {
    await assertWithheld(base, ['methods', 'instruments', 'inventory', 'clients', 'projects', 'invoices', 'portal', 'insights', 'team', 'settings']);
    const admin = await as('admin', base);
    for (const url of ['/api/clients', '/api/projects', '/api/methods?usable=1', '/api/instruments', '/api/qualifications', '/api/lookups', '/api/settings', '/api/tests', '/api/samples']) await admin.ok('GET', url);
    const nav = await admin.ok('GET', '/api/nav');
    assert.ok(!('portal' in nav), 'no Client portal badge count');
    for (const entity of ['clients', 'projects', 'methods', 'instruments', 'inventory', 'invoices']) {
      assert.equal((await admin.get(`/api/history/${entity}/1`)).status, 404, `no ${entity} history`);
      assert.equal((await admin.get(`/api/attachments?entity=${entity}&id=1`)).status, 404, `no ${entity} files`);
    }
    await admin.ok('GET', '/api/history/samples/1');
    await admin.ok('GET', '/api/attachments?entity=tests&id=1');
    assert.deepEqual([...await searchTypes(admin)].sort(), ['Sample', 'Test'], 'search returns only Samples and Tests');
  });
});

test('with Samples withheld, the Samples APIs answer like missing routes while the Test page endpoints stay', async () => {
  await withModules(['projects', 'methods'], async (base) => {
    await assertWithheld(base, ['samples', 'clients', 'invoices', 'team']);
    const admin = await as('admin', base);
    const [t] = await admin.ok('GET', '/api/tests?limit=1');
    await admin.ok('GET', `/api/tests/${t.id}`);
    assert.deepEqual([...await searchTypes(admin)].sort(), ['Method', 'Project'], 'search returns only Projects and Methods');
    assert.equal((await admin.ok('GET', `/api/search?q=${t.code}`)).exact, null, 'a Test code scan opens nothing');
  });
});
