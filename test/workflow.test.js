// End-to-end tests: starts a real server on a temporary database, loads the demo lab and walks the
// complete sample → certificate → invoice workflow over HTTP, including the GxP controls that must say "no".
// Run with:  npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
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

test('sign-in, sessions and CSRF protection', async () => {
  const anon = new Client();
  assert.equal((await anon.get('/api/auth/me')).status, 401);
  assert.equal((await anon.post('/api/auth/login', { username: 'tom.fletcher', password: 'wrong' })).status, 401);
  const tom = await as('tom.fletcher');
  const me = await tom.ok('GET', '/api/auth/me');
  assert.equal(me.user.username, 'tom.fletcher');
  assert.ok(!('password_hash' in me.user), 'password hash must never be sent to the browser');
  // A mutating request without the custom header (as a cross-site form would send) is refused.
  const res = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Cookie: tom.cookie } });
  assert.equal(res.status, 403);
});

test('every list and dashboard endpoint responds for every role', async () => {
  for (const user of ['admin', 'priya.raman', 'daniel.okafor', 'sarah.lindqvist', 'tom.fletcher', 'grace.holloway']) {
    const c = await as(user);
    for (const url of ['/api/dashboard', '/api/samples', '/api/tests?scope=open', '/api/methods', '/api/instruments', '/api/inventory', '/api/notebook', '/api/investigations', '/api/clients', '/api/projects', '/api/reviews', '/api/nav', '/api/lookups', '/api/qualifications', '/api/search?q=MF5']) {
      const r = await c.get(url);
      assert.equal(r.status, 200, `${user} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    }
  }
  const finance = await as('oliver.grant');
  await finance.ok('GET', '/api/invoices');
  await finance.ok('GET', '/api/insights');
  const tom = await as('tom.fletcher');
  assert.equal((await tom.get('/api/invoices')).status, 403, 'analysts cannot see invoices');
  assert.equal((await tom.get('/api/audit')).status, 403, 'analysts cannot browse the audit trail');
});

test('detail pages load for real records', async () => {
  const c = await as('priya.raman');
  const samples = await c.ok('GET', '/api/samples?status=');
  for (const s of samples.slice(0, 8)) {
    const d = await c.ok('GET', `/api/samples/${s.id}`);
    for (const t of d.tests.slice(0, 2)) await c.ok('GET', `/api/tests/${t.id}`);
    await c.ok('GET', `/api/samples/${s.id}/coa`);
    await c.ok('GET', `/api/history/samples/${s.id}`);
  }
  for (const [list, detail] of [['/api/methods', '/api/methods/'], ['/api/instruments', '/api/instruments/'], ['/api/inventory', '/api/inventory/'], ['/api/notebook', '/api/notebook/'], ['/api/investigations', '/api/investigations/'], ['/api/clients', '/api/clients/'], ['/api/projects?status=all', '/api/projects/'], ['/api/invoices', '/api/invoices/'], ['/api/users', '/api/users/']]) {
    const rows = await c.ok('GET', list);
    assert.ok(rows.length > 0, `${list} has demo data`);
    for (const r of rows.slice(0, 3)) await c.ok('GET', detail + r.id);
  }
});

test('full workflow: receive → assign → results → review → approval → certificate → invoice', async () => {
  const nadia = await as('nadia.rossi');
  const priya = await as('priya.raman');
  const tom = await as('tom.fletcher');
  const sarah = await as('sarah.lindqvist');
  const daniel = await as('daniel.okafor');
  const oliver = await as('oliver.grant');

  const clients = await nadia.ok('GET', '/api/clients');
  const acme = clients.find((c) => c.code === 'ACME');
  const projects = await nadia.ok('GET', `/api/projects?client_id=${acme.id}&status=open`);
  const project = projects.find((p) => p.title.includes('Release'));
  const methods = await nadia.ok('GET', '/api/methods?usable=1');
  const kf = methods.find((m) => m.code === 'ATM-0002' && m.status === 'Effective');
  const ftir = methods.find((m) => m.code === 'ATM-0006');

  // 1. Receive two samples with two tests each.
  const received = await nadia.ok('POST', '/api/samples/receive', {
    client_id: acme.id, project_id: project.id, sample_type: 'Drug Product', storage: 'Ambient (15–25 °C)', priority: 'Rush',
    samples: [{ description: 'Test tablets A', batch_no: 'TB-001' }, { description: 'Test tablets B', batch_no: 'TB-002' }],
    method_ids: [kf.id, ftir.id],
  });
  assert.equal(received.samples.length, 2);
  const sample = await nadia.ok('GET', `/api/samples/${received.samples[0].id}`);
  assert.equal(sample.tests.length, 2);
  assert.equal(sample.sample.status, 'Received');
  const kfTest = sample.tests.find((t) => t.method_code === 'ATM-0002');
  const irTest = sample.tests.find((t) => t.method_code === 'ATM-0006');
  assert.equal(kfTest.price, kf.price * 1.5, 'rush surcharge applied');

  // 2. Assignment respects training records.
  const ben = (await priya.ok('GET', '/api/users')).find((u) => u.username === 'ben.carter');
  const tomUser = (await priya.ok('GET', '/api/users')).find((u) => u.username === 'tom.fletcher');
  const refused = await priya.post('/api/tests/assign', { test_ids: [kfTest.id], analyst_id: ben.id });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /not qualified/);
  await priya.ok('POST', '/api/tests/assign', { test_ids: [kfTest.id, irTest.id], analyst_id: tomUser.id });

  // 3. Only the assigned analyst may record results.
  assert.equal((await sarah.put(`/api/tests/${kfTest.id}`, { results: [] })).status, 403);

  // 4. Results: instruments out of calibration and expired standards are refused.
  const detail = await tom.ok('GET', `/api/tests/${kfTest.id}`);
  const badInstrument = detail.instruments.find((i) => i.problem);
  if (badInstrument) {
    const r = await tom.put(`/api/tests/${kfTest.id}`, { instrument_id: badInstrument.id });
    assert.equal(r.status, 400, 'instrument with expired calibration is refused');
  }
  const kfInstrument = detail.instruments.find((i) => i.code === 'KF-01');
  const water = detail.results[0];
  await tom.ok('PUT', `/api/tests/${kfTest.id}`, { instrument_id: kfInstrument.id, raw_data_ref: 'KF-01 printout 77', results: [{ id: water.id, value: '0.21' }] });

  // 5. Changing a recorded value needs a reason; the old and new values land in the audit trail.
  const noReason = await tom.put(`/api/tests/${kfTest.id}`, { results: [{ id: water.id, value: '0.23' }] });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.data.code, 'REASON_REQUIRED');
  await tom.ok('PUT', `/api/tests/${kfTest.id}`, { results: [{ id: water.id, value: '0.23' }], reason: 'Transcription error corrected' });
  const hist = await tom.ok('GET', `/api/history/tests/${kfTest.id}`);
  const change = hist.find((h) => h.reason === 'Transcription error corrected');
  assert.ok(change, 'reason recorded');
  assert.deepEqual(JSON.parse(change.changes)['Water content'], [0.21, 0.23]);

  // 6. Submission is an electronic signature: a wrong password is rejected.
  assert.equal((await tom.post(`/api/tests/${kfTest.id}/submit`, { password: 'nope' })).data.code, 'SIGNATURE');
  await tom.ok('POST', `/api/tests/${kfTest.id}/submit`, { password: PASSWORD });

  // 7. Four-eyes: the analyst cannot review their own work; the reviewer cannot also approve.
  assert.equal((await tom.post(`/api/tests/${kfTest.id}/review`, { decision: 'approve', password: PASSWORD })).status, 403);
  await sarah.ok('POST', `/api/tests/${kfTest.id}/review`, { decision: 'approve', password: PASSWORD });
  const sarahUser = (await priya.ok('GET', '/api/users')).find((u) => u.username === 'sarah.lindqvist');
  assert.ok(sarahUser);
  assert.equal((await tom.post(`/api/tests/${kfTest.id}/approve`, { decision: 'approve', password: PASSWORD })).status, 403);
  await daniel.ok('POST', `/api/tests/${kfTest.id}/approve`, { decision: 'approve', password: PASSWORD });

  // 8. Second test is an OOS (text result marked "does not conform") → investigation opens and blocks approval.
  const ir = await tom.ok('GET', `/api/tests/${irTest.id}`);
  await tom.ok('PUT', `/api/tests/${irTest.id}`, { instrument_id: ir.instruments.find((i) => i.code === 'FTIR-01').id, results: [{ id: ir.results[0].id, value: 'Extra band at 1720 cm-1', outcome: 'Fail' }] });
  const submitted = await tom.ok('POST', `/api/tests/${irTest.id}/submit`, { password: PASSWORD });
  assert.ok(submitted.investigation?.code?.startsWith('OOS-'), 'OOS investigation opened automatically');
  await sarah.ok('POST', `/api/tests/${irTest.id}/review`, { decision: 'approve', password: PASSWORD });
  const blocked = await daniel.post(`/api/tests/${irTest.id}/approve`, { decision: 'approve', password: PASSWORD });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /still open/);

  // Close the investigation (needs root cause + conclusion), then approval goes through.
  const invId = submitted.investigation.id;
  assert.equal((await daniel.post(`/api/investigations/${invId}/close`, { password: PASSWORD })).status, 400);
  await priya.ok('PUT', `/api/investigations/${invId}`, { title: 'OOS identity', root_cause: 'Wrong material supplied by client', conclusion: 'Confirmed OOS — result valid' });
  await daniel.ok('POST', `/api/investigations/${invId}/close`, { password: PASSWORD });
  await daniel.ok('POST', `/api/tests/${irTest.id}/approve`, { decision: 'approve', password: PASSWORD });

  // 9. Certificate.
  const approvedSample = await daniel.ok('GET', `/api/samples/${sample.sample.id}`);
  assert.equal(approvedSample.sample.status, 'Approved');
  const coa = await daniel.ok('GET', `/api/samples/${sample.sample.id}/coa`);
  assert.equal(coa.complies, false, 'CoA reflects the OOS result');
  await daniel.ok('POST', `/api/samples/${sample.sample.id}/report`, { password: PASSWORD });
  assert.equal((await daniel.ok('GET', `/api/samples/${sample.sample.id}`)).sample.status, 'Reported');

  // 10. Invoice picks up the approved work exactly once.
  const inv = await oliver.ok('POST', '/api/invoices', { project_id: project.id, include_unbilled: true });
  const invoice = await oliver.ok('GET', `/api/invoices/${inv.id}`);
  assert.ok(invoice.tests.some((t) => t.id === kfTest.id), 'approved test is on the invoice');
  assert.ok(invoice.totals.total > 0);
  const again = await oliver.ok('GET', '/api/invoices/unbilled');
  assert.ok(!again.some((p) => p.id === project.id), 'nothing left to bill on the project');
  await oliver.ok('POST', `/api/invoices/${inv.id}/issue`);
  assert.equal((await oliver.put(`/api/invoices/${inv.id}`, { notes: 'x' })).status, 403, 'issued invoices are locked');
});

test('notebook: sign locks the entry, a different person witnesses', async () => {
  const tom = await as('tom.fletcher');
  const sarah = await as('sarah.lindqvist');
  const { id } = await tom.ok('POST', '/api/notebook', { title: 'Buffer preparation', body: '## Buffer\n| a | b |\n|---|---|\n| 1 | 2 |' });
  await tom.ok('PUT', `/api/notebook/${id}`, { body: '## Buffer pH 3.0\nDone.' });
  await tom.ok('POST', `/api/notebook/${id}/sign`, { password: PASSWORD });
  assert.equal((await tom.put(`/api/notebook/${id}`, { body: 'tamper' })).status, 400, 'signed entries are read-only');
  assert.equal((await tom.post(`/api/notebook/${id}/witness`, { password: PASSWORD })).status, 403, 'no self-witnessing');
  await sarah.ok('POST', `/api/notebook/${id}/witness`, { password: PASSWORD });
  await tom.ok('POST', `/api/notebook/${id}/addenda`, { body: 'Correction: pH 3.05' });
  const n = await tom.ok('GET', `/api/notebook/${id}`);
  assert.equal(n.entry.status, 'Witnessed');
  assert.equal(n.addenda.length, 1);
});

test('notebook documents: Word/Excel versions, desktop Office save-back over WebDAV, frozen at signing', async () => {
  const { makeXlsx, makeDocx, zip } = await import('../server/ooxml.js');
  const tom = await as('tom.fletcher');
  const sarah = await as('sarah.lindqvist');
  const upload = (client, url, filename, body) => fetch(BASE + url, {
    method: 'POST',
    headers: { 'X-Requested-With': 'aliquot', Cookie: client.cookie, 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(filename) },
    body,
  }).then(async (r) => ({ status: r.status, data: await r.json() }));

  const { id: entryId } = await tom.ok('POST', '/api/notebook', { title: 'Linearity check', body: 'See workbook.' });
  const { id: docId } = await tom.ok('POST', `/api/notebook/${entryId}/documents`, { template: 'replicates' });
  const word = await tom.ok('POST', `/api/notebook/${entryId}/documents`, { template: 'docx', name: 'Prep record' });
  let docs = await tom.ok('GET', `/api/notebook/${entryId}/documents`);
  assert.deepEqual(docs.map((d) => [d.filename, d.version]), [['Replicate statistics.xlsx', 1], ['Prep record.docx', 1]]);
  assert.equal((await tom.post(`/api/notebook/${entryId}/documents`, { template: 'docx', name: 'prep RECORD' })).status, 400, 'duplicate names are refused');

  const sheet = await tom.ok('GET', `/api/notebook-documents/${docId}/preview`);
  assert.equal(sheet.sheets[0].name, 'Replicates');
  assert.ok(sheet.sheets[0].rows.some((r) => r[0] === 'Mean'));
  const doc = await sarah.ok('GET', `/api/notebook-documents/${word.id}/preview`);
  assert.equal(doc.blocks[0].text, 'Linearity check', 'anyone who can see the entry can preview it');

  // A new version uploaded from the browser; identical content is not a new version.
  const v2 = makeXlsx({ sheets: [{ name: 'Replicates', rows: [['Replicate', 'Result'], [1, 99.8], [2, 100.1]] }] });
  assert.equal((await upload(tom, `/api/notebook-documents/${docId}/versions`, 'Replicate statistics.xlsx', v2)).data.version, 2);
  assert.equal((await upload(tom, `/api/notebook-documents/${docId}/versions`, 'copy.xlsx', v2)).data.unchanged, true);
  assert.equal((await upload(tom, `/api/notebook-documents/${docId}/versions`, 'x.docx', makeDocx({ blocks: [] }))).status, 400, 'kind must match');
  assert.equal((await upload(tom, `/api/notebook-documents/${docId}/versions`, 'x.xlsx', Buffer.from('not a zip'))).status, 400, 'garbage is refused');
  const macro = zip([['[Content_Types].xml', '<Types/>'], ['xl/workbook.xml', '<workbook/>'], ['xl/vbaProject.bin', 'x']]);
  assert.equal((await upload(tom, `/api/notebook/${entryId}/documents/upload`, 'macro.xlsx', macro)).status, 400, 'macros are refused');
  assert.equal((await upload(sarah, `/api/notebook-documents/${docId}/versions`, 'r.xlsx', v2)).status, 403, 'only the author edits');
  assert.equal((await sarah.post(`/api/notebook-documents/${docId}/edit-link`)).status, 403);

  // Desktop Excel: the one-time link works without a session cookie and speaks enough WebDAV for Office.
  const link = await tom.ok('POST', `/api/notebook-documents/${docId}/edit-link`);
  assert.equal(link.scheme, 'ms-excel');
  const dav = (method, headers = {}, body) => fetch(BASE + link.path, { method, headers, body });
  const opts = await dav('OPTIONS');
  assert.equal(opts.headers.get('dav'), '1,2');
  const pf = await dav('PROPFIND', { Depth: '0' });
  assert.equal(pf.status, 207);
  assert.match(await pf.text(), /getetag/);
  assert.deepEqual(Buffer.from(await (await dav('GET')).arrayBuffer()), v2);
  const lock = await dav('LOCK', { Timeout: 'Second-600' }, '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>Tom</D:owner></D:lockinfo>');
  assert.equal(lock.status, 200);
  const lockToken = lock.headers.get('lock-token');
  assert.match(lockToken, /opaquelocktoken/);
  const v3 = makeXlsx({ sheets: [{ name: 'Replicates', rows: [['Replicate', 'Result'], [1, 99.8], [2, 100.1], [3, 99.9]] }] });
  const put = await dav('PUT', { If: `(${lockToken})` }, v3);
  assert.equal(put.status, 204);
  assert.equal(put.headers.get('x-aliquot-version'), '3');
  assert.equal((await fetch(BASE + link.path.replace(/[^/]+$/, 'other.xlsx'), { method: 'PUT', body: v3 })).status, 403, 'no stray files');
  assert.equal((await fetch(`${BASE}/dav/not-a-token/x.xlsx`)).status, 404);
  assert.equal((await dav('UNLOCK', { 'Lock-Token': lockToken })).status, 204);
  const versions = await tom.ok('GET', `/api/notebook-documents/${docId}/versions`);
  assert.deepEqual(versions.map((v) => [v.version, v.source]), [[3, 'office'], [2, 'upload'], [1, 'template']]);
  const old = await fetch(`${BASE}/api/notebook-documents/${docId}/file?version=2`, { headers: { Cookie: tom.cookie } });
  assert.deepEqual(Buffer.from(await old.arrayBuffer()), v2, 'every version stays downloadable');
  assert.match(old.headers.get('content-disposition'), /\(v2\)\.xlsx/);

  assert.equal((await tom.post(`/api/notebook-documents/${word.id}/remove`, {})).data.code, 'REASON_REQUIRED');
  await tom.ok('POST', `/api/notebook-documents/${word.id}/remove`, { reason: 'Started in the wrong entry' });

  // Signing records the exact versions and ends editing everywhere.
  const link2 = await tom.ok('POST', `/api/notebook-documents/${docId}/edit-link`);
  await tom.ok('POST', `/api/notebook/${entryId}/sign`, { password: PASSWORD });
  const history = await tom.ok('GET', `/api/history/notebook_entries/${entryId}`);
  const frozen = history.find((h) => /Documents signed with the entry/.test(h.summary));
  assert.ok(frozen, 'signed versions are recorded');
  assert.match(frozen.changes, /v3 · SHA-256 [0-9a-f]{64}/);
  assert.doesNotMatch(frozen.summary, /Prep record/, 'removed documents are not part of the signed record');
  assert.equal((await fetch(BASE + link2.path, { method: 'PUT', body: v2 })).status, 404, 'edit links die at signing');
  assert.equal((await upload(tom, `/api/notebook-documents/${docId}/versions`, 'r.xlsx', v2)).status, 400);
  assert.equal((await tom.post(`/api/notebook/${entryId}/documents`, { template: 'xlsx' })).status, 400);
  assert.equal((await tom.post(`/api/notebook-documents/${docId}/edit-link`)).status, 400);
  docs = (await tom.ok('GET', `/api/notebook/${entryId}`)).documents;
  assert.equal(docs.find((d) => d.id === docId).version, 3);
  const list = await tom.ok('GET', '/api/notebook?mine=1');
  assert.equal(list.find((e) => e.id === entryId).doc_count, 1);
});

test('audit trail is append-only and its hash chain verifies', async () => {
  const daniel = await as('daniel.okafor');
  const v = await daniel.ok('GET', '/api/audit/verify');
  assert.equal(v.ok, true);
  assert.ok(v.count > 1000);
  const rows = await daniel.ok('GET', '/api/audit?limit=5');
  assert.equal(rows.length, 5);
  const found = await daniel.ok('GET', '/api/audit?q=sarah&limit=5');
  assert.equal(found.length, 5, 'text search covers people and does not error');
});

test('attachments upload, download and removal keeps the file', async () => {
  const tom = await as('tom.fletcher');
  const samples = await tom.ok('GET', '/api/samples?status=open');
  const s = samples[0];
  const res = await fetch(`${BASE}/api/attachments?entity=samples&id=${s.id}`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'aliquot', Cookie: tom.cookie, 'Content-Type': 'text/plain', 'X-Filename': encodeURIComponent('chain of custody.txt') },
    body: 'Courier: XYZ, logger 4.2 °C',
  });
  assert.equal(res.status, 200);
  const { id } = await res.json();
  const file = await fetch(`${BASE}/api/attachments/${id}/file`, { headers: { Cookie: tom.cookie } });
  assert.equal(await file.text(), 'Courier: XYZ, logger 4.2 °C');
  assert.equal((await tom.post(`/api/attachments/${id}/remove`, {})).data.code, 'REASON_REQUIRED');
  await tom.ok('POST', `/api/attachments/${id}/remove`, { reason: 'Uploaded to wrong sample' });
  const list = await tom.ok('GET', `/api/attachments?entity=samples&id=${s.id}`);
  assert.equal(list.find((a) => a.id === id).removed, 1);
});

test('lockout after repeated wrong passwords', async () => {
  const c = new Client();
  for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { username: 'ingrid.larsen', password: 'bad' });
  const r = await c.post('/api/auth/login', { username: 'ingrid.larsen', password: PASSWORD });
  assert.equal(r.status, 423, 'account locked even with the right password');
});

// ---------------------------------------------------------------------------------------------
// Regression tests for issues found in the independent code review
// ---------------------------------------------------------------------------------------------

async function freshTest(methodCode, analystUsername) {
  const priya = await as('priya.raman');
  const clients = await priya.ok('GET', '/api/clients');
  const methods = await priya.ok('GET', '/api/methods?usable=1');
  const m = methods.find((x) => x.code === methodCode && x.status === 'Effective');
  const res = await priya.ok('POST', '/api/samples/receive', { client_id: clients[0].id, samples: [{ description: `Regression ${methodCode}` }], method_ids: [m.id] });
  const sample = await priya.ok('GET', `/api/samples/${res.samples[0].id}`);
  const t = sample.tests[0];
  const users = await priya.ok('GET', '/api/users');
  await priya.ok('POST', '/api/tests/assign', { test_ids: [t.id], analyst_id: users.find((u) => u.username === analystUsername).id });
  return { sampleId: sample.sample.id, testId: t.id };
}

test('an OOS cannot be hidden by cancelling the test, and blocks the certificate while open', async () => {
  const tom = await as('tom.fletcher');
  const priya = await as('priya.raman');
  const { sampleId, testId } = await freshTest('ATM-0002', 'tom.fletcher');
  const d = await tom.ok('GET', `/api/tests/${testId}`);
  await tom.ok('PUT', `/api/tests/${testId}`, { instrument_id: d.instruments.find((i) => i.code === 'KF-01').id, results: [{ id: d.results[0].id, value: '0.9' }] });
  const sub = await tom.ok('POST', `/api/tests/${testId}/submit`, { password: PASSWORD });
  assert.ok(sub.investigation);
  const cancel = await priya.post(`/api/tests/${testId}/cancel`, { reason: 'retest' });
  assert.equal(cancel.status, 400);
  assert.match(cancel.data.error, /open on this test/);
  assert.equal((await priya.ok('GET', `/api/tests/${testId}`)).can.cancel, false, 'the Test page offers no cancel the server would refuse');
  const report = await priya.post(`/api/samples/${sampleId}/report`, { password: PASSWORD });
  assert.equal(report.status, 400);
});

// Receives one Sample with two Tests, one of them started, so cancelling has more than one open Test to touch.
async function twoTestSample() {
  const priya = await as('priya.raman');
  const clients = await priya.ok('GET', '/api/clients');
  const methods = await priya.ok('GET', '/api/methods?usable=1');
  const ids = ['ATM-0001', 'ATM-0002'].map((code) => methods.find((x) => x.code === code && x.status === 'Effective').id);
  const res = await priya.ok('POST', '/api/samples/receive', { client_id: clients[0].id, samples: [{ description: 'Cancel under investigation' }], method_ids: ids });
  const sampleId = res.samples[0].id;
  const [first] = (await priya.ok('GET', `/api/samples/${sampleId}`)).tests;
  await priya.ok('POST', `/api/tests/${first.id}/claim`);
  await priya.ok('POST', `/api/tests/${first.id}/start`);
  return { sampleId, testIds: (await priya.ok('GET', `/api/samples/${sampleId}`)).tests.map((t) => t.id) };
}

for (const on of ['Test', 'Sample']) {
  test(`a Sample is not cancelled while an Investigation is open on its ${on}, and is once it closes`, async () => {
    const priya = await as('priya.raman');
    const daniel = await as('daniel.okafor');
    const { sampleId, testIds } = await twoTestSample();
    const before = await priya.ok('GET', `/api/samples/${sampleId}`);
    assert.equal(before.can.cancel, true);

    const target = on === 'Test' ? { test_id: testIds[1] } : { sample_id: sampleId };
    const inv = await daniel.ok('POST', '/api/investigations', { type: 'Deviation', title: 'Pipette out of calibration', description: 'Found during daily check', ...target });

    const refused = await priya.post(`/api/samples/${sampleId}/cancel`, { reason: 'Client withdrew the order' });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, new RegExp(inv.code));
    const after = await priya.ok('GET', `/api/samples/${sampleId}`);
    assert.equal(after.sample.status, before.sample.status, 'the Sample is unchanged');
    assert.deepEqual(after.tests.map((t) => t.status), before.tests.map((t) => t.status), 'every Test is unchanged');
    assert.deepEqual(after.tests.map((t) => t.status), ['In Progress', 'Pending']);
    assert.equal(after.can.cancel, false, 'the Sample page offers no cancel the server would refuse');

    await daniel.ok('POST', `/api/investigations/${inv.id}/close`, { root_cause: 'Calibration lapsed', conclusion: 'No impact on this sample', password: PASSWORD });
    assert.equal((await priya.ok('GET', `/api/samples/${sampleId}`)).can.cancel, true);
    await priya.ok('POST', `/api/samples/${sampleId}/cancel`, { reason: 'Client withdrew the order' });
    const cancelled = await priya.ok('GET', `/api/samples/${sampleId}`);
    assert.equal(cancelled.sample.status, 'Cancelled');
    assert.deepEqual(cancelled.tests.map((t) => t.status), ['Cancelled', 'Cancelled']);
  });
}

test('the certificate is offered and queued only while no investigation is open on the Sample or its Tests', async () => {
  const tom = await as('tom.fletcher');
  const daniel = await as('daniel.okafor');
  const { sampleId, testId } = await freshTest('ATM-0002', 'tom.fletcher');
  const d = await tom.ok('GET', `/api/tests/${testId}`);
  await tom.ok('PUT', `/api/tests/${testId}`, { instrument_id: d.instruments.find((i) => i.code === 'KF-01').id, results: [{ id: d.results[0].id, value: '0.21' }] });
  await tom.ok('POST', `/api/tests/${testId}/submit`, { password: PASSWORD });
  await (await as('sarah.lindqvist')).ok('POST', `/api/tests/${testId}/review`, { decision: 'approve', password: PASSWORD });
  await daniel.ok('POST', `/api/tests/${testId}/approve`, { decision: 'approve', password: PASSWORD });

  const offered = async () => (await daniel.ok('GET', `/api/samples/${sampleId}`)).can.issue;
  const queued = async () => (await daniel.ok('GET', '/api/reviews')).toIssue.some((s) => s.id === sampleId);
  assert.equal(await offered(), true);
  assert.equal(await queued(), true);

  const onSample = await daniel.ok('POST', '/api/investigations', { type: 'Deviation', title: 'Storage excursion', description: 'Fridge at 9 °C overnight', sample_id: sampleId });
  const onTest = await daniel.ok('POST', '/api/investigations', { type: 'Deviation', title: 'Balance drift', description: 'Daily check out of tolerance', test_id: testId });
  const close = (id) => daniel.ok('POST', `/api/investigations/${id}/close`, { root_cause: 'Door left ajar', conclusion: 'No product impact', password: PASSWORD });
  for (const open of [onSample, onTest]) {
    assert.equal((await daniel.ok('GET', `/api/samples/${sampleId}`)).sample.status, 'Approved', 'the Sample is otherwise ready');
    assert.equal(await offered(), false, `issue is not offered while ${open.code} is open`);
    assert.equal(await queued(), false, `the certificate queue omits the Sample while ${open.code} is open`);
    const refused = await daniel.post(`/api/samples/${sampleId}/report`, { password: PASSWORD });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, new RegExp(`${open.code} is still open`));
    await close(open.id);
  }

  assert.equal(await offered(), true);
  assert.equal(await queued(), true);
  await daniel.ok('POST', `/api/samples/${sampleId}/report`, { password: PASSWORD });
  assert.equal((await daniel.ok('GET', `/api/samples/${sampleId}`)).sample.status, 'Reported');
});

// Drives a fresh Karl Fischer test to an out-of-spec submission and through peer review.
async function oosTest(analystUsername) {
  const analyst = await as(analystUsername);
  const { sampleId, testId } = await freshTest('ATM-0002', analystUsername);
  const d = await analyst.ok('GET', `/api/tests/${testId}`);
  await analyst.ok('PUT', `/api/tests/${testId}`, { instrument_id: d.instruments.find((i) => i.code === 'KF-01').id, results: [{ id: d.results[0].id, value: '0.9' }] });
  const { investigation } = await analyst.ok('POST', `/api/tests/${testId}/submit`, { password: PASSWORD });
  await (await as('sarah.lindqvist')).ok('POST', `/api/tests/${testId}/review`, { decision: 'approve', password: PASSWORD });
  return { sampleId, testId, investigation };
}

test('an OOS investigation is closed from the Test page with an e-signature', async () => {
  const daniel = await as('daniel.okafor');
  const { sampleId, testId, investigation } = await oosTest('priya.raman');

  const open = (await daniel.ok('GET', `/api/tests/${testId}`)).investigations;
  assert.equal(open.length, 1);
  assert.equal(open[0].code, investigation.code);
  assert.equal(open[0].status, 'Open');
  assert.match(open[0].description, /Out-of-specification/);
  assert.deepEqual(open[0].signatures, [], 'an open investigation carries no closure signature');
  assert.ok(open[0].raised_at);
  const blocked = await daniel.post(`/api/tests/${testId}/approve`, { decision: 'approve', password: PASSWORD });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /still open/);

  assert.equal(open[0].can.close, true, 'an independent closer is offered Close on the card');
  const priya = await as('priya.raman');
  const tom = await as('tom.fletcher');
  assert.equal((await priya.ok('GET', `/api/tests/${testId}`)).investigations[0].can.close, false, 'the analyst who performed the test is not offered Close');
  assert.equal((await tom.ok('GET', `/api/tests/${testId}`)).investigations[0].can.close, false, 'nor is someone without the close permission');
  assert.equal((await priya.ok('GET', `/api/investigations/${investigation.id}`)).can.close, false, 'the Investigations screen answers the same');

  const close = `/api/investigations/${investigation.id}/close`;
  assert.equal((await daniel.post(`/api/tests/${testId}/investigation/close`, {})).status, 404, 'the Test-scoped close endpoint is gone');
  const full = { root_cause: 'Sample absorbed moisture after opening', conclusion: 'Confirmed OOS — result valid', password: PASSWORD };
  assert.equal((await tom.post(close, full)).status, 403, 'analysts lack the close permission');
  const own = await priya.post(close, full);
  assert.equal(own.status, 403, 'the analyst who performed the test cannot close its investigation');
  assert.match(own.data.error, /performed/);
  assert.equal((await daniel.post(close, { ...full, root_cause: '  ' })).status, 400, 'root cause required');
  assert.equal((await daniel.post(close, { ...full, conclusion: undefined })).status, 400, 'conclusion required');
  const wrong = await daniel.post(close, { ...full, password: 'nope' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.code, 'SIGNATURE');
  assert.equal((await daniel.ok('GET', `/api/tests/${testId}`)).investigations[0].status, 'Open', 'refusals leave it open');

  await daniel.ok('POST', close, full);
  const [closed] = (await daniel.ok('GET', `/api/tests/${testId}`)).investigations;
  assert.equal(closed.status, 'Closed');
  assert.equal(closed.root_cause, full.root_cause);
  assert.equal(closed.conclusion, full.conclusion);
  assert.equal(closed.closed_by_name, 'Daniel Okafor');
  assert.ok(closed.closed_at);
  assert.deepEqual(closed.signatures.map((x) => [x.full_name, x.meaning]), [['Daniel Okafor', 'OOS investigation closed']], 'the Test page shows who signed the closure');
  assert.ok(closed.signatures[0].signed_at);
  assert.equal(closed.can.close, false, 'a closed investigation offers no Close');
  const signed = (await daniel.ok('GET', `/api/investigations/${investigation.id}`)).signatures;
  assert.ok(signed.some((s) => s.meaning === 'OOS investigation closed' && s.full_name === 'Daniel Okafor'), 'closing is e-signed');
  const history = await daniel.ok('GET', `/api/history/investigations/${investigation.id}`);
  const entry = history.find((h) => h.action === 'STATUS' && h.username === 'daniel.okafor');
  assert.ok(entry, 'closing is audited');
  assert.deepEqual(JSON.parse(entry.changes).root_cause, [null, full.root_cause]);
  assert.equal((await daniel.post(close, full)).status, 400, 'nothing left to close');

  await daniel.ok('POST', `/api/tests/${testId}/approve`, { decision: 'approve', password: PASSWORD });
  await daniel.ok('POST', `/api/samples/${sampleId}/report`, { password: PASSWORD });
  assert.equal((await daniel.ok('GET', `/api/samples/${sampleId}`)).sample.status, 'Reported');
});

test('closing an investigation needs the right password, and wrong ones count toward lock-out', async () => {
  const daniel = await as('daniel.okafor');
  const helena = await as('helena.weiss');
  const { investigation } = await oosTest('tom.fletcher');
  const close = `/api/investigations/${investigation.id}/close`;
  await daniel.ok('PUT', `/api/investigations/${investigation.id}`, { title: 'OOS water', root_cause: 'Hygroscopic sample', conclusion: 'Confirmed OOS' });
  for (const password of [undefined, 'nope']) {
    const r = await daniel.post(close, { password });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'SIGNATURE');
  }
  for (let i = 0; i < 5; i++) await helena.post(close, { password: 'bad' });
  const locked = await helena.post(close, { password: PASSWORD });
  assert.equal(locked.status, 423, 'locked even with the right password');
});

test('each Investigation card on a Test closes its own Investigation, whatever its type', async () => {
  const daniel = await as('daniel.okafor');
  const { testId, investigation } = await oosTest('tom.fletcher');
  const deviation = await daniel.ok('POST', '/api/investigations', { type: 'Deviation', test_id: testId, title: 'Balance out of level', description: 'Bubble off-centre during the run' });
  const cards = (await daniel.ok('GET', `/api/tests/${testId}`)).investigations;
  assert.deepEqual(cards.map((v) => [v.code, v.can.close]), [[deviation.code, true], [investigation.code, true]], 'both open cards offer Close');
  assert.equal((await (await as('tom.fletcher')).ok('GET', `/api/tests/${testId}`)).investigations.some((v) => v.can.close), false);

  await daniel.ok('POST', `/api/investigations/${deviation.id}/close`, { root_cause: 'Bench knocked', conclusion: 'Relevelled; no impact on the result', password: PASSWORD });
  const after = Object.fromEntries((await daniel.ok('GET', `/api/tests/${testId}`)).investigations.map((v) => [v.code, v]));
  assert.equal(after[deviation.code].status, 'Closed', 'the pressed card is closed');
  assert.deepEqual(after[deviation.code].signatures.map((s) => [s.full_name, s.meaning]), [['Daniel Okafor', 'Closed']]);
  assert.equal(after[investigation.code].status, 'Open', 'the other card stays open');
  assert.equal(after[investigation.code].can.close, true);
});

test('closing a deviation from Investigations is still signed "Closed"', async () => {
  const daniel = await as('daniel.okafor');
  const { id } = await daniel.ok('POST', '/api/investigations', { type: 'Deviation', title: 'Fridge excursion', description: 'Logged 9 °C overnight' });
  await daniel.ok('POST', `/api/investigations/${id}/close`, { root_cause: 'Door left ajar', conclusion: 'No product impact', password: PASSWORD });
  const d = await daniel.ok('GET', `/api/investigations/${id}`);
  assert.deepEqual(d.signatures.map((s) => s.meaning), ['Closed']);
});

test('every signed action stores exactly the meaning the lookups serve for it', async () => {
  const tom = await as('tom.fletcher');
  const sarah = await as('sarah.lindqvist');
  const daniel = await as('daniel.okafor');
  const priya = await as('priya.raman');
  const { signatureMeanings } = await tom.ok('GET', '/api/lookups');
  // The stored strings predate the table; anything that reads meanings by exact string relies on them.
  assert.deepEqual(Object.fromEntries(Object.entries(signatureMeanings).map(([key, m]) => [key, m.meaning])), {
    'test.submit': 'Performed',
    'test.review.accept': 'Reviewed',
    'test.review.return': 'Returned by reviewer',
    'test.approve.accept': 'Approved',
    'test.approve.reject': 'Rejected at approval',
    'sample.coa.issue': 'Certificate of Analysis issued',
    'notebook.author': 'Authored',
    'notebook.witness': 'Witnessed',
    'method.approve': 'Approved for use',
    'method.retire': 'Retired',
    'investigation.close.oos': 'OOS investigation closed',
    'investigation.close': 'Closed',
  });
  for (const m of Object.values(signatureMeanings)) assert.ok(m.explanation?.trim(), `${m.meaning} has an explanation`);

  const stored = {};
  const lastMeaning = async (client, url) => (await client.ok('GET', url)).signatures.at(-1).meaning;
  const sign = async (key, client, url, body, readBack) => {
    await client.ok('POST', url, { password: PASSWORD, ...body });
    stored[key] = await lastMeaning(daniel, readBack);
  };

  const { sampleId, testId } = await freshTest('ATM-0002', 'tom.fletcher');
  const d = await tom.ok('GET', `/api/tests/${testId}`);
  await tom.ok('PUT', `/api/tests/${testId}`, { instrument_id: d.instruments.find((i) => i.code === 'KF-01').id, results: [{ id: d.results[0].id, value: '0.21' }] });
  const testUrl = `/api/tests/${testId}`;
  await sign('test.submit', tom, `${testUrl}/submit`, {}, testUrl);
  const before = (await daniel.ok('GET', testUrl)).signatures.length;
  assert.equal((await sarah.post(`${testUrl}/review`, { decision: 'reject', comment: 'Recheck', password: 'wrong' })).data.code, 'SIGNATURE');
  assert.equal((await daniel.ok('GET', testUrl)).signatures.length, before, 'a refused signature stores no meaning');
  await sign('test.review.return', sarah, `${testUrl}/review`, { decision: 'reject', comment: 'Recheck the drift' }, testUrl);
  await tom.ok('POST', `${testUrl}/submit`, { password: PASSWORD });
  await sign('test.review.accept', sarah, `${testUrl}/review`, { decision: 'approve' }, testUrl);
  await sign('test.approve.reject', daniel, `${testUrl}/approve`, { decision: 'reject', comment: 'Wrong balance' }, testUrl);
  await tom.ok('POST', `${testUrl}/submit`, { password: PASSWORD });
  await sarah.ok('POST', `${testUrl}/review`, { decision: 'approve', password: PASSWORD });
  await sign('test.approve.accept', daniel, `${testUrl}/approve`, { decision: 'approve' }, testUrl);
  await sign('sample.coa.issue', daniel, `/api/samples/${sampleId}/report`, {}, `/api/samples/${sampleId}`);

  const oos = await oosTest('priya.raman');
  await sign('investigation.close.oos', daniel, `/api/investigations/${oos.investigation.id}/close`, { root_cause: 'Moisture uptake', conclusion: 'Confirmed OOS — result valid' }, `/api/investigations/${oos.investigation.id}`);
  const deviation = await daniel.ok('POST', '/api/investigations', { type: 'Deviation', title: 'Balance drift', description: 'Daily check out of tolerance' });
  await sign('investigation.close', daniel, `/api/investigations/${deviation.id}/close`, { root_cause: 'Draught from door', conclusion: 'No product impact' }, `/api/investigations/${deviation.id}`);

  const entry = await tom.ok('POST', '/api/notebook', { title: 'Mobile phase prep', body: 'Done.' });
  await sign('notebook.author', tom, `/api/notebook/${entry.id}/sign`, {}, `/api/notebook/${entry.id}`);
  await sign('notebook.witness', sarah, `/api/notebook/${entry.id}/witness`, {}, `/api/notebook/${entry.id}`);

  const me = (await priya.ok('GET', '/api/auth/me')).user;
  const method = await priya.ok('POST', '/api/methods', { title: 'Meanings check', technique: 'UV-Vis', price: 100, tat_days: 3, owner_id: me.id, analytes: [{ name: 'Assay', spec_min: 95, spec_max: 105 }] });
  await sign('method.approve', daniel, `/api/methods/${method.id}/status`, { status: 'Effective' }, `/api/methods/${method.id}`);
  await sign('method.retire', daniel, `/api/methods/${method.id}/status`, { status: 'Retired', comment: 'Superseded' }, `/api/methods/${method.id}`);

  assert.deepEqual(stored, Object.fromEntries(Object.keys(signatureMeanings).map((key) => [key, signatureMeanings[key].meaning])));
});

test('non-text reasons cannot break the audit hash chain', async () => {
  const tom = await as('tom.fletcher');
  const items = await tom.ok('GET', '/api/inventory');
  await tom.ok('PUT', `/api/inventory/${items[0].id}`, { notes: 'regression', reason: 42 });
  const daniel = await as('daniel.okafor');
  assert.equal((await daniel.ok('GET', '/api/audit/verify')).ok, true);
});

test('attachments and history follow the record\'s permissions', async () => {
  const tom = await as('tom.fletcher');
  const grace = await as('grace.holloway');
  const oliver = await as('oliver.grant');
  const invoices = await oliver.ok('GET', '/api/invoices');
  assert.equal((await tom.get(`/api/attachments?entity=invoices&id=${invoices[0].id}`)).status, 403);
  assert.equal((await tom.get(`/api/history/invoices/${invoices[0].id}`)).status, 403);
  assert.equal((await tom.get('/api/history/users/1')).status, 403);
  const tests = await grace.ok('GET', '/api/tests?scope=open');
  const up = await fetch(`${BASE}/api/attachments?entity=tests&id=${tests[0].id}`, { method: 'POST', headers: { 'X-Requested-With': 'aliquot', Cookie: grace.cookie, 'X-Filename': '%E0%A4%A' }, body: 'x' });
  assert.equal(up.status, 403, 'business users cannot attach to tests');
  const projects = await tom.ok('GET', '/api/projects?status=all');
  const hist = await tom.ok('GET', `/api/history/projects/${projects[0].id}`);
  assert.ok(hist.every((h) => !h.changes || !JSON.parse(h.changes).budget), 'budget hidden from analysts');
});

test('analysts cannot change instrument status or release quarantined material', async () => {
  const tom = await as('tom.fletcher');
  const instruments = await tom.ok('GET', '/api/instruments');
  const diss = instruments.find((i) => i.code === 'DISS-02');
  const r = await tom.post(`/api/instruments/${diss.id}/logs`, { kind: 'Note', description: 'x', status: 'Available' });
  assert.equal(r.status, 403);
  const items = await tom.ok('GET', '/api/inventory');
  const item = items.find((i) => i.status === 'Active');
  assert.equal((await tom.put(`/api/inventory/${item.id}`, { status: 'Quarantine' })).data.code, 'REASON_REQUIRED');
  await tom.ok('PUT', `/api/inventory/${item.id}`, { status: 'Quarantine', reason: 'Container cracked' });
  assert.equal((await tom.put(`/api/inventory/${item.id}`, { status: 'Active', reason: 'looks fine' })).status, 403);
  const daniel = await as('daniel.okafor');
  await daniel.ok('PUT', `/api/inventory/${item.id}`, { status: 'Active', reason: 'Inspected, container replaced' });
});

test('submission re-checks training and materials', async () => {
  const tom = await as('tom.fletcher');
  const priya = await as('priya.raman');
  const daniel = await as('daniel.okafor');
  const { testId } = await freshTest('ATM-0006', 'tom.fletcher');
  const d = await tom.ok('GET', `/api/tests/${testId}`);
  const mat = d.inventory.find((m) => !m.problem);
  await tom.ok('PUT', `/api/tests/${testId}`, { instrument_id: d.instruments.find((i) => i.code === 'FTIR-01').id, material_ids: [mat.id], results: [{ id: d.results[0].id, value: 'Conforms to reference spectrum', outcome: 'Pass' }] });
  await priya.ok('PUT', `/api/inventory/${mat.id}`, { status: 'Quarantine', reason: 'Suspected contamination' });
  const again = await tom.ok('GET', `/api/tests/${testId}`);
  assert.ok(again.inventory.some((m) => m.id === mat.id), 'linked material still listed, so saving does not drop it');
  const blocked = await tom.post(`/api/tests/${testId}/submit`, { password: PASSWORD });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /quarantine/);
  await daniel.ok('PUT', `/api/inventory/${mat.id}`, { status: 'Active', reason: 'Released after investigation' });
  const q = (await priya.ok('GET', '/api/qualifications')).qualifications.find((x) => x.method_code === 'ATM-0006' && x.user_id === again.test.analyst_id);
  await priya.ok('POST', `/api/qualifications/${q.id}/revoke`, { reason: 'Retraining required' });
  assert.equal((await tom.ok('GET', `/api/tests/${testId}`)).can.submit, false, 'the Test page offers no submit the server would refuse');
  assert.equal((await tom.post(`/api/tests/${testId}/submit`, { password: PASSWORD })).status, 403);
  await priya.ok('POST', '/api/qualifications', { user_id: again.test.analyst_id, method_code: 'ATM-0006' });
});

test('segregation of duties: no self-training, no approving your own method', async () => {
  const priya = await as('priya.raman');
  const me = (await priya.ok('GET', '/api/auth/me')).user;
  assert.equal((await priya.post('/api/qualifications', { user_id: me.id, method_code: 'ATM-0003' })).status, 403);
  const created = await priya.ok('POST', '/api/methods', { title: 'Own method', technique: 'UV-Vis', price: 100, tat_days: 3, owner_id: me.id, analytes: [{ name: 'Assay', spec_min: 95, spec_max: 105 }] });
  assert.equal((await priya.post(`/api/methods/${created.id}/status`, { status: 'Effective', password: PASSWORD })).status, 403);
});

test('removing an invoice line releases its tests for billing; nothing is lost', async () => {
  const oliver = await as('oliver.grant');
  const unbilled = await oliver.ok('GET', '/api/invoices/unbilled');
  if (!unbilled.length) return;
  const project = unbilled[0];
  const inv = await oliver.ok('POST', '/api/invoices', { project_id: project.id, include_unbilled: true });
  const d = await oliver.ok('GET', `/api/invoices/${inv.id}`);
  assert.ok(d.lines.every((l) => l.test_ids));
  const res = await oliver.ok('PUT', `/api/invoices/${inv.id}`, { lines: [{ description: 'Consulting', quantity: 1, unit_price: 1 }] });
  assert.equal(res.released, d.tests.length);
  const after = await oliver.ok('GET', '/api/invoices/unbilled');
  assert.ok(after.some((p) => p.id === project.id), 'the work is ready to bill again');
});

test('a Test\'s history shows it invoiced, released and voided; analysts see the invoice link removed', async () => {
  const priya = await as('priya.raman');
  const tom = await as('tom.fletcher');
  const sarah = await as('sarah.lindqvist');
  const daniel = await as('daniel.okafor');
  const oliver = await as('oliver.grant');
  const clients = await oliver.ok('GET', '/api/clients');
  const project = await oliver.ok('POST', '/api/projects', { client_id: clients[0].id, title: 'Billing history', type: 'Routine / Release Testing' });
  const kf = (await priya.ok('GET', '/api/methods?usable=1')).find((m) => m.code === 'ATM-0002' && m.status === 'Effective');
  const received = await priya.ok('POST', '/api/samples/receive', { client_id: clients[0].id, project_id: project.id, samples: [{ description: 'Billing history' }], method_ids: [kf.id] });
  const testId = (await priya.ok('GET', `/api/samples/${received.samples[0].id}`)).tests[0].id;
  const tomUser = (await priya.ok('GET', '/api/users')).find((u) => u.username === 'tom.fletcher');
  await priya.ok('POST', '/api/tests/assign', { test_ids: [testId], analyst_id: tomUser.id });
  const d = await tom.ok('GET', `/api/tests/${testId}`);
  await tom.ok('PUT', `/api/tests/${testId}`, { instrument_id: d.instruments.find((i) => i.code === 'KF-01').id, results: [{ id: d.results[0].id, value: '0.21' }] });
  await tom.ok('POST', `/api/tests/${testId}/submit`, { password: PASSWORD });
  await sarah.ok('POST', `/api/tests/${testId}/review`, { decision: 'approve', password: PASSWORD });
  await daniel.ok('POST', `/api/tests/${testId}/approve`, { decision: 'approve', password: PASSWORD });

  const links = async (c) => (await c.ok('GET', `/api/history/tests/${testId}`)).reverse()
    .filter((h) => h.changes && 'invoice_id' in JSON.parse(h.changes)).map((h) => JSON.parse(h.changes).invoice_id);

  const first = await oliver.ok('POST', '/api/invoices', { project_id: project.id, include_unbilled: true });
  assert.deepEqual(await links(oliver), [[null, first.id]], 'creating the invoice links the Test');
  await oliver.ok('PUT', `/api/invoices/${first.id}`, { lines: [{ description: 'Consulting', quantity: 1, unit_price: 1 }] });
  assert.deepEqual((await links(oliver)).at(-1), [first.id, null], 'removing the line releases it');
  await oliver.ok('POST', `/api/invoices/${first.id}/add-unbilled`);
  assert.deepEqual((await links(oliver)).at(-1), [null, first.id], 'adding unbilled work links it again');
  await oliver.ok('POST', `/api/invoices/${first.id}/issue`);
  await oliver.ok('POST', `/api/invoices/${first.id}/void`, { reason: 'Wrong PO' });
  assert.deepEqual(await links(oliver), [[null, first.id], [first.id, null], [null, first.id], [first.id, null]], 'voiding releases it');

  const hidden = await tom.ok('GET', `/api/history/tests/${testId}`);
  assert.ok(hidden.length >= 4, 'the analyst still sees the Test\'s history');
  assert.deepEqual(await links(tom), [], 'the invoice link is removed for people without billing access');
  assert.equal((await daniel.ok('GET', '/api/audit/verify')).ok, true, 'the audit trail\'s hash chain still verifies');
});

test('password change counts wrong attempts and bad input gets 400s, not 500s', async () => {
  const c = await as('jonas.becker');
  for (let i = 0; i < 5; i++) await c.post('/api/auth/password', { current: 'wrong', next: 'whatever123' });
  assert.equal((await new Client().post('/api/auth/login', { username: 'jonas.becker', password: PASSWORD })).status, 423);
  const daniel = await as('daniel.okafor');
  for (const url of ['/api/audit?limit=0.5', '/api/audit?limit=-5', '/api/samples?limit=-1']) assert.equal((await daniel.get(url)).status, 200, url);
  assert.equal((await daniel.get('/api/audit?from=xyz')).status, 400);
  const priya = await as('priya.raman');
  const clients = await priya.ok('GET', '/api/clients');
  assert.equal((await priya.post('/api/samples/receive', { client_id: clients[0].id, samples: ['abc'] })).status, 400);
  assert.equal((await priya.post('/api/methods', { title: 'x', technique: 'UV-Vis', price: '', tat_days: '' })).status, 400);
});
