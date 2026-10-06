// Samples list work filters: "assigned", "review" and "approval", evaluated for the signed-in user.
// Starts a real server on a temporary database with the demo lab and drives Tests into each state over HTTP.
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
  server = await startServer(dataDir);
  BASE = server.base;
  const setup = await new Client().post('/api/setup', { mode: 'demo' });
  assert.equal(setup.status, 200, `demo setup failed: ${JSON.stringify(setup.data)} ${server.log()}`);
});

after(async () => {
  await server?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// One HPLC assay sample per scenario, so each sample's single Test is the only thing that can make it match.
const lab = {};

async function setupLab() {
  if (lab.ready) return lab;
  const priya = await as('priya.raman');
  const clients = await priya.ok('GET', '/api/clients');
  lab.acme = clients.find((c) => c.code === 'ACME');
  lab.other = clients.find((c) => c.code !== 'ACME');
  lab.hplc = (await priya.ok('GET', '/api/methods?usable=1')).find((m) => m.code === 'ATM-0001' && m.status === 'Effective');
  lab.users = Object.fromEntries((await priya.ok('GET', '/api/users')).map((u) => [u.username, u]));
  lab.ready = true;
  return lab;
}

async function receive(client = lab.acme) {
  const priya = await as('priya.raman');
  const { samples } = await priya.ok('POST', '/api/samples/receive', {
    client_id: client.id, sample_type: 'Drug Product', storage: 'Ambient (15–25 °C)', priority: 'Standard',
    samples: [{ description: 'Work filter sample' }], method_ids: [lab.hplc.id],
  });
  const detail = await priya.ok('GET', `/api/samples/${samples[0].id}`);
  return { id: samples[0].id, testId: detail.tests[0].id };
}

async function assign(s, username) {
  const priya = await as('priya.raman');
  await priya.ok('POST', '/api/tests/assign', { test_ids: [s.testId], analyst_id: lab.users[username].id });
}

const inSpec = (r) => (r.spec_min != null && r.spec_max != null ? (r.spec_min + r.spec_max) / 2 : r.spec_max != null ? r.spec_max / 2 : (r.spec_min ?? 0) + 1);

async function perform(s, username) {
  await assign(s, username);
  const analyst = await as(username);
  const d = await analyst.ok('GET', `/api/tests/${s.testId}`);
  const instrument = d.instruments.find((i) => !i.problem && i.code.startsWith('HPLC'));
  await analyst.ok('PUT', `/api/tests/${s.testId}`, { instrument_id: instrument.id, results: d.results.map((r) => ({ id: r.id, value: String(inSpec(r)) })) });
  await analyst.ok('POST', `/api/tests/${s.testId}/submit`, { password: PASSWORD });
}

async function review(s, username) {
  await (await as(username)).ok('POST', `/api/tests/${s.testId}/review`, { decision: 'approve', password: PASSWORD });
}

const ids = async (c, query) => new Set((await c.ok('GET', `/api/samples?limit=2000&${query}`)).map((s) => s.id));

test('analyst "assigned" lists samples with their unfinished Tests only', async () => {
  await setupLab();
  const pending = await receive();
  await assign(pending, 'tom.fletcher');
  const started = await receive();
  await assign(started, 'tom.fletcher');
  const tom = await as('tom.fletcher');
  const d = await tom.ok('GET', `/api/tests/${started.testId}`);
  await tom.ok('PUT', `/api/tests/${started.testId}`, { results: [{ id: d.results[0].id, value: String(inSpec(d.results[0])) }] });
  assert.equal((await tom.ok('GET', `/api/tests/${started.testId}`)).test.status, 'In Progress');
  const others = await receive();
  await assign(others, 'lucia.fernandez');
  const unassigned = await receive();
  const submitted = await receive();
  await perform(submitted, 'tom.fletcher');

  const mine = await ids(tom, 'work=assigned');
  assert.ok(mine.has(pending.id), 'Pending Test assigned to me');
  assert.ok(mine.has(started.id), 'In Progress Test assigned to me');
  assert.ok(!mine.has(others.id), 'Test assigned to someone else');
  assert.ok(!mine.has(unassigned.id), 'unassigned Test');
  assert.ok(!mine.has(submitted.id), 'Test I already submitted');
});

test('senior scientist "review" lists Submitted Tests by other people, not their own', async () => {
  await setupLab();
  const byTom = await receive();
  await perform(byTom, 'tom.fletcher');
  const bySarah = await receive();
  await perform(bySarah, 'sarah.lindqvist');
  const notSubmitted = await receive();
  await assign(notSubmitted, 'tom.fletcher');
  const reviewed = await receive();
  await perform(reviewed, 'tom.fletcher');
  await review(reviewed, 'priya.raman');

  const sarah = await as('sarah.lindqvist');
  const toReview = await ids(sarah, 'work=review');
  assert.ok(toReview.has(byTom.id), 'Submitted by someone else');
  assert.ok(!toReview.has(bySarah.id), 'my own submission');
  assert.ok(!toReview.has(notSubmitted.id), 'not yet submitted');
  assert.ok(!toReview.has(reviewed.id), 'already reviewed');

  // Same rule as the Reviews queue.
  const queue = await sarah.ok('GET', '/api/reviews');
  assert.deepEqual(toReview, new Set(queue.toReview.map((t) => t.sample_id)));
});

test('QA "approval" lists Reviewed Tests they neither performed nor reviewed', async () => {
  await setupLab();
  const reviewedBySarah = await receive();
  await perform(reviewedBySarah, 'tom.fletcher');
  await review(reviewedBySarah, 'sarah.lindqvist');
  const reviewedByDaniel = await receive();
  await perform(reviewedByDaniel, 'tom.fletcher');
  await review(reviewedByDaniel, 'daniel.okafor');
  const submitted = await receive();
  await perform(submitted, 'tom.fletcher');

  const daniel = await as('daniel.okafor');
  const toApprove = await ids(daniel, 'work=approval');
  assert.ok(toApprove.has(reviewedBySarah.id), 'Reviewed by someone else');
  assert.ok(!toApprove.has(reviewedByDaniel.id), 'Test I reviewed');
  assert.ok(!toApprove.has(submitted.id), 'not yet reviewed');
  assert.deepEqual(toApprove, new Set((await daniel.ok('GET', '/api/reviews')).toApprove.map((t) => t.sample_id)));

  // A Lab Manager can perform and approve, but never approve their own Test.
  const performedByPriya = await receive();
  await perform(performedByPriya, 'priya.raman');
  await review(performedByPriya, 'sarah.lindqvist');
  const priya = await as('priya.raman');
  assert.ok(!(await ids(priya, 'work=approval')).has(performedByPriya.id), 'Test I performed');
  assert.ok((await ids(daniel, 'work=approval')).has(performedByPriya.id), 'performed by someone else');
});

test('a work filter asked for without its permission returns 200 and an empty list', async () => {
  await setupLab();
  // Work waits at every stage, so an empty answer is the person's Queue, not an empty lab.
  await perform(await receive(), 'tom.fletcher');
  const reviewed = await receive();
  await perform(reviewed, 'tom.fletcher');
  await review(reviewed, 'sarah.lindqvist');
  await assign(await receive(), 'lucia.fernandez');

  const none = {
    'tom.fletcher': ['review', 'approval'],
    'sarah.lindqvist': ['approval'],
    'daniel.okafor': ['assigned'],
    'oliver.grant': ['assigned', 'review', 'approval'],
  };
  for (const [username, filters] of Object.entries(none)) {
    const c = await as(username);
    for (const work of filters) {
      for (const list of ['samples', 'tests']) {
        const r = await c.get(`/api/${list}?work=${work}`);
        assert.equal(r.status, 200, `${username}: ${list} work=${work}`);
        assert.deepEqual(r.data, [], `${username}: ${list} work=${work} is none of their work`);
      }
    }
  }
  assert.equal((await (await as('tom.fletcher')).get('/api/samples?work=everything')).status, 400, 'unknown work filter');
});

test('the work filter combines with the existing filters', async () => {
  await setupLab();
  const acme = await receive(lab.acme);
  await assign(acme, 'tom.fletcher');
  const other = await receive(lab.other);
  await assign(other, 'tom.fletcher');
  const tom = await as('tom.fletcher');

  const acmeOnly = await ids(tom, `work=assigned&client_id=${lab.acme.id}`);
  assert.ok(acmeOnly.has(acme.id));
  assert.ok(!acmeOnly.has(other.id), 'other client filtered out');
  const allClients = await ids(tom, 'work=assigned');
  assert.ok(allClients.has(other.id));
  const byText = await ids(tom, `work=assigned&q=${encodeURIComponent((await tom.ok('GET', `/api/samples/${acme.id}`)).sample.code)}`);
  assert.deepEqual(byText, new Set([acme.id]));
});
