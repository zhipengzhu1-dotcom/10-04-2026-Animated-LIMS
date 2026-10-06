// Workload: per-analyst test counts and the projects each analyst is on, cross-checked against the Tests list.
// Starts a real server on a temporary database with the demo lab and drives Tests and Projects over HTTP.
// Run with:  npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './server.js';

let BASE;
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
  server = await startServer(dataDir);
  BASE = server.base;
  const setup = await new Client().req('POST', '/api/setup', { mode: 'demo' });
  assert.equal(setup.status, 200, `demo setup failed: ${JSON.stringify(setup.data)} ${server.log()}`);
});

after(async () => {
  await server?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const lab = {};

async function setupLab() {
  if (lab.ready) return lab;
  lab.priya = await as('priya.raman');
  lab.acme = (await lab.priya.ok('GET', '/api/clients')).find((c) => c.code === 'ACME');
  lab.hplc = (await lab.priya.ok('GET', '/api/methods?usable=1')).find((m) => m.code === 'ATM-0001' && m.status === 'Effective');
  lab.users = Object.fromEntries((await lab.priya.ok('GET', '/api/users')).map((u) => [u.username, u]));
  lab.ready = true;
  return lab;
}

const workload = () => lab.priya.ok('GET', '/api/workload');
const row = (w, username) => w.analysts.find((a) => a.id === lab.users[username].id);

const newProject = (fields = {}) => lab.priya.ok('POST', '/api/projects', { client_id: lab.acme.id, title: 'Workload project', type: 'Other', ...fields });

async function receive(projectId, dueDate) {
  const { samples } = await lab.priya.ok('POST', '/api/samples/receive', {
    client_id: lab.acme.id, project_id: projectId, due_date: dueDate, sample_type: 'Drug Product', storage: 'Ambient (15–25 °C)', priority: 'Standard',
    samples: [{ description: 'Workload sample' }], method_ids: [lab.hplc.id],
  });
  return (await lab.priya.ok('GET', `/api/samples/${samples[0].id}`)).tests[0].id;
}

const assign = (testId, username) => lab.priya.ok('POST', '/api/tests/assign', { test_ids: [testId], analyst_id: lab.users[username].id });

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const countBy = (tests) => tests.reduce((m, t) => m.set(t.analyst_id, (m.get(t.analyst_id) || 0) + 1), new Map());

test('each analyst row agrees with the Tests list', async () => {
  await setupLab();
  const days = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d); };
  await assign(await receive(undefined, days(-1)), 'tom.fletcher');
  await assign(await receive(undefined, days(0)), 'tom.fletcher');
  await assign(await receive(undefined, days(7)), 'lucia.fernandez');
  await assign(await receive(undefined, days(8)), 'lucia.fernandez');
  const w = await workload();
  const open = await lab.priya.ok('GET', '/api/tests?scope=open&limit=3000');
  const editable = open.filter((t) => ['Pending', 'In Progress'].includes(t.status));
  const openBy = countBy(editable);
  const pendingBy = countBy(editable.filter((t) => t.status === 'Pending'));
  const today = days(0);
  const overdueBy = countBy(editable.filter((t) => t.due_date && t.due_date < today));
  const dueWeekBy = countBy(editable.filter((t) => t.due_date >= today && t.due_date <= days(7)));
  const awaitingBy = countBy(await lab.priya.ok('GET', '/api/tests?status=Submitted,Reviewed&limit=3000'));

  assert.ok(w.analysts.length > 1, 'several analysts');
  assert.ok(new Set(w.analysts.map((a) => a.open)).size > 1, 'demo analysts carry different loads, so a swapped count would show');
  for (const a of w.analysts) {
    assert.equal(a.open, openBy.get(a.id) || 0, `${a.full_name}: open`);
    assert.equal(a.pending, pendingBy.get(a.id) || 0, `${a.full_name}: pending`);
    assert.equal(a.in_progress, a.open - a.pending, `${a.full_name}: in progress`);
    assert.equal(a.awaiting_review, awaitingBy.get(a.id) || 0, `${a.full_name}: awaiting review`);
    assert.equal(a.overdue, overdueBy.get(a.id) || 0, `${a.full_name}: overdue`);
    assert.equal(a.due_week, dueWeekBy.get(a.id) || 0, `${a.full_name}: due in 7 days`);
  }
  assert.ok(w.analysts.some((a) => a.overdue > 0) && w.analysts.some((a) => a.due_week > 0), 'the demo lab has overdue and due-soon work to compare');
  assert.equal(w.unassigned, open.filter((t) => t.analyst_id == null && t.status === 'Pending').length, 'unassigned');

  const performers = (await lab.priya.ok('GET', '/api/lookups')).testPerformerRoles;
  const expected = Object.values(lab.users).filter((u) => u.active && performers.includes(u.role)).map((u) => u.id).sort((x, y) => x - y);
  assert.deepEqual(w.analysts.map((a) => a.id).sort((x, y) => x - y), expected, 'every active person who can perform tests, and no one else');
  assert.ok(!row(w, 'daniel.okafor'), 'QA never performs tests');
});

test('assigning a project test raises that analyst\'s load and lists the project', async () => {
  await setupLab();
  const project = await newProject();
  const testId = await receive(project.id);
  const before = await workload();
  assert.ok(!row(before, 'lucia.fernandez').projects.some((p) => p.id === project.id), 'not on the project yet');

  await assign(testId, 'lucia.fernandez');
  const after = await workload();
  const lucia = row(after, 'lucia.fernandez');
  assert.equal(lucia.open, row(before, 'lucia.fernandez').open + 1);
  assert.equal(lucia.pending, row(before, 'lucia.fernandez').pending + 1);
  assert.equal(row(after, 'tom.fletcher').open, row(before, 'tom.fletcher').open, 'other analysts unchanged');
  assert.equal(after.unassigned, before.unassigned - 1);
  const onProject = lucia.projects.find((p) => p.id === project.id);
  assert.deepEqual(onProject, { id: project.id, code: project.code, title: 'Workload project', client_code: 'ACME', status: 'Active', due_date: null, lead: false, open_tests: 1, test_count: 1, tests_done: 0 });
  const { project: stats } = await lab.priya.ok('GET', `/api/projects/${project.id}`);
  assert.deepEqual([onProject.test_count, onProject.tests_done], [stats.test_count, stats.tests_done], 'progress agrees with the project page');
  assert.ok(!row(after, 'tom.fletcher').projects.some((p) => p.id === project.id), 'only the assignee is on it');
});

test('a project lead sees their open led projects, merged with their tests on it', async () => {
  await setupLab();
  const tomId = lab.users['tom.fletcher'].id;
  const led = await newProject({ lead_id: tomId, due_date: '2099-01-01' });
  const done = await newProject({ lead_id: tomId });
  await lab.priya.ok('POST', `/api/projects/${done.id}/complete`);
  let tom = row(await workload(), 'tom.fletcher');
  assert.deepEqual(tom.projects.find((p) => p.id === led.id), { id: led.id, code: led.code, title: 'Workload project', client_code: 'ACME', status: 'Active', due_date: '2099-01-01', lead: true, open_tests: 0, test_count: 0, tests_done: 0 });
  assert.ok(!tom.projects.some((p) => p.id === done.id), 'completed projects drop off');
  const leads = tom.projects.map((p) => p.lead);
  assert.deepEqual(leads, [...leads].sort((x, y) => y - x), 'led projects first');

  await assign(await receive(led.id), 'tom.fletcher');
  tom = row(await workload(), 'tom.fletcher');
  const entries = tom.projects.filter((p) => p.id === led.id);
  assert.equal(entries.length, 1, 'one entry per project');
  assert.equal(entries[0].lead, true);
  assert.equal(entries[0].open_tests, 1);
});

test('a returned test counts against its analyst', async () => {
  await setupLab();
  const testId = await receive();
  await assign(testId, 'tom.fletcher');
  const tom = await as('tom.fletcher');
  const d = await tom.ok('GET', `/api/tests/${testId}`);
  const instrument = d.instruments.find((i) => !i.problem && i.code.startsWith('HPLC'));
  const mid = (r) => (r.spec_min != null && r.spec_max != null ? (r.spec_min + r.spec_max) / 2 : r.spec_max != null ? r.spec_max / 2 : (r.spec_min ?? 0) + 1);
  await tom.ok('PUT', `/api/tests/${testId}`, { instrument_id: instrument.id, results: d.results.map((r) => ({ id: r.id, value: String(mid(r)) })) });
  await tom.ok('POST', `/api/tests/${testId}/submit`, { password: PASSWORD });
  const submitted = row(await workload(), 'tom.fletcher');

  await (await as('sarah.lindqvist')).ok('POST', `/api/tests/${testId}/review`, { decision: 'return', comment: 'Recheck the integration', password: PASSWORD });
  const returned = row(await workload(), 'tom.fletcher');
  assert.equal(returned.returned, submitted.returned + 1);
  assert.equal(returned.awaiting_review, submitted.awaiting_review - 1);
  assert.equal(returned.in_progress, submitted.in_progress + 1);
  assert.ok((await tom.ok('GET', '/api/dashboard')).myReturned.includes(testId), 'the dashboard flags the same test as returned');
});

test('the administrator oversees every work queue but cannot act on it', async () => {
  const admin = await as('admin');
  assert.equal((await admin.get('/api/workload')).status, 200, 'workload');
  assert.ok((await admin.ok('GET', '/api/auth/me')).permissions.includes('work.oversee'));

  const reviews = await admin.ok('GET', '/api/reviews?scope=lab');
  assert.equal((await admin.ok('GET', '/api/reviews')).toReview.length, 0, 'nothing is queued for the administrator to sign');
  assert.equal((await lab.priya.get('/api/reviews?scope=lab')).status, 403, 'the lab-wide view is for overseers');
  const submitted = await admin.ok('GET', '/api/tests?status=Submitted');
  const reviewed = await admin.ok('GET', '/api/tests?status=Reviewed');
  assert.ok(submitted.length && reviewed.length, 'the demo lab has tests waiting at both stages');
  assert.deepEqual(reviews.toReview.map((t) => t.id).sort(), submitted.map((t) => t.id).sort(), 'every test waiting for peer review');
  assert.deepEqual(reviews.toApprove.map((t) => t.id).sort(), reviewed.map((t) => t.id).sort(), 'every test waiting for approval');

  const blocked = await admin.req('POST', `/api/tests/${submitted[0].id}/review`, { decision: 'approve', password: PASSWORD });
  assert.equal(blocked.status, 403, 'seeing the queue is not signing it');
  assert.equal((await admin.ok('GET', `/api/tests/${submitted[0].id}`)).test.status, 'Submitted');
  const [unassigned] = await admin.ok('GET', '/api/tests?scope=open&unassigned=1');
  assert.equal((await admin.req('POST', '/api/tests/assign', { test_ids: [unassigned.id], analyst_id: lab.users['tom.fletcher'].id })).status, 403, 'nor assigning work');
});

/** Priya performs Test `testId` with in-specification results and submits it. */
async function submit(testId) {
  await assign(testId, 'priya.raman');
  const d = await lab.priya.ok('GET', `/api/tests/${testId}`);
  const instrument = d.instruments.find((i) => !i.problem && i.code.startsWith('HPLC'));
  const mid = (r) => (r.spec_min != null && r.spec_max != null ? (r.spec_min + r.spec_max) / 2 : r.spec_max != null ? r.spec_max / 2 : (r.spec_min ?? 0) + 1);
  await lab.priya.ok('PUT', `/api/tests/${testId}`, { instrument_id: instrument.id, results: d.results.map((r) => ({ id: r.id, value: String(mid(r)) })) });
  await lab.priya.ok('POST', `/api/tests/${testId}/submit`, { password: PASSWORD });
}

test('oversight lists a Test awaiting review that nobody but its analyst could review', async () => {
  await setupLab();
  const testId = await receive();
  await submit(testId);

  // Every other reviewer becomes an analyst, so the only person holding tests.review is the one who performed the Test.
  const admin = await as('admin');
  const reviewers = Object.values(lab.users).filter((u) => u.active && ['manager', 'scientist', 'qa'].includes(u.role) && u.username !== 'priya.raman');
  try {
    for (const u of reviewers) await admin.ok('PUT', `/api/users/${u.id}`, { role: 'analyst' });
    for (const u of [...reviewers, lab.users['priya.raman']]) {
      const queue = (await (await as(u.username)).ok('GET', '/api/reviews')).toReview;
      assert.ok(!queue.some((t) => t.id === testId), `${u.username} could not review it`);
    }
    assert.ok((await admin.ok('GET', '/api/reviews?scope=lab')).toReview.some((t) => t.id === testId), 'oversight still shows it waiting for review');
  } finally {
    for (const u of reviewers) await admin.ok('PUT', `/api/users/${u.id}`, { role: u.role });
  }
});

test('oversight lists an Approved Sample held by an open Investigation, which QA\'s certificate Queue does not', async () => {
  await setupLab();
  const testId = await receive();
  await submit(testId);
  await (await as('daniel.okafor')).ok('POST', `/api/tests/${testId}/review`, { decision: 'approve', password: PASSWORD });
  await (await as('helena.weiss')).ok('POST', `/api/tests/${testId}/approve`, { decision: 'approve', password: PASSWORD });
  const sampleId = (await lab.priya.ok('GET', `/api/tests/${testId}`)).test.sample_id;
  await lab.priya.ok('POST', '/api/investigations', { type: 'Deviation', title: 'Storage excursion', description: 'Fridge alarm overnight', sample_id: sampleId });

  const qa = await as('daniel.okafor');
  assert.equal((await qa.ok('GET', `/api/samples/${sampleId}`)).sample.status, 'Approved');
  assert.ok(!(await qa.ok('GET', '/api/reviews')).toIssue.some((s) => s.id === sampleId), 'QA may not issue its certificate yet');
  const oversight = await (await as('admin')).ok('GET', '/api/reviews?scope=lab');
  assert.ok(oversight.toIssue.some((s) => s.id === sampleId), 'oversight shows it waiting for its certificate');
});

test('only people who assign work see the workload', async () => {
  assert.equal((await (await as('sarah.lindqvist')).get('/api/workload')).status, 200, 'senior scientists assign work');
  assert.equal((await (await as('tom.fletcher')).get('/api/workload')).status, 403, 'analyst');
  assert.equal((await (await as('oliver.grant')).get('/api/workload')).status, 403, 'business');
  assert.equal((await (await as('daniel.okafor')).get('/api/workload')).status, 403, 'QA');
  assert.equal((await new Client().get('/api/workload')).status, 401, 'signed out');
});
