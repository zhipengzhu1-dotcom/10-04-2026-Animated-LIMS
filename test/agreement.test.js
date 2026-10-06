// The agreement sweep: an action offered on a record is accepted, one withheld is refused, and a record sits in a
// person's Queue, on every surface and badge showing it, exactly when they are offered the Queue's rule. Every rules and
// Queue table the server exports is swept: the last tests fail if any rule was never seen both offered and withheld, or
// any Queue names a rule its table lacks or was never seen both listing and not listing a record.
// Starts a real server on a temporary database with the demo lab and drives it over HTTP.
// Run with:  npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './server.js';
import { ATTACHABLE } from '../server/routes/attachments.js';

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
  async upload(url, text) {
    const res = await fetch(BASE + url, {
      method: 'POST',
      headers: { 'X-Requested-With': 'aliquot', 'Content-Type': 'text/plain', 'X-Filename': 'trace.txt', Cookie: this.cookie },
      body: text,
    });
    return { status: res.status, data: await res.json() };
  }
  async ok(method, url, body) {
    const r = await this.req(method, url, body);
    assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
}

const sessions = {};
async function as(username) {
  if (!sessions[username]) {
    const c = new Client();
    await c.ok('POST', '/api/auth/login', { username, password: PASSWORD });
    sessions[username] = c;
  }
  return sessions[username];
}

const lab = {};
const TABLES = await exportedTables('_RULES');

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-test-'));
  server = await startServer(dataDir);
  BASE = server.base;
  const setup = await new Client().post('/api/setup', { mode: 'demo' });
  assert.equal(setup.status, 200, `demo setup failed: ${JSON.stringify(setup.data)} ${server.log()}`);

  const priya = await as('priya.raman');
  lab.client = (await priya.ok('GET', '/api/clients'))[0].id;
  lab.kf = (await priya.ok('GET', '/api/methods?usable=1')).find((m) => m.code === 'ATM-0002' && m.status === 'Effective').id;
  const users = await priya.ok('GET', '/api/users');
  lab.users = Object.fromEntries(users.map((u) => [u.username, u.id]));
  lab.roles = Object.fromEntries(users.map((u) => [u.username, u.role]));
});

after(async () => {
  await server?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ----- Preparing records -----

const ANALYST = 'tom.fletcher';

// Each step moves a Test one stage on, done by the person who would do it in the lab. Results are in specification
// and the instrument is in calibration, so only rules — never readiness — can refuse what follows.
const STEPS = {
  assign: async (t) => (await as('priya.raman')).ok('POST', '/api/tests/assign', { test_ids: [t.testId], analyst_id: lab.users[ANALYST] }),
  enter: async (t) => (await as(ANALYST)).ok('PUT', `/api/tests/${t.testId}`, await readyResults(t)),
  submit: async (t) => (await as(ANALYST)).ok('POST', `/api/tests/${t.testId}/submit`, { password: PASSWORD }),
  review: async (t) => (await as('daniel.okafor')).ok('POST', `/api/tests/${t.testId}/review`, { decision: 'approve', password: PASSWORD }),
  approve: async (t) => (await as('helena.weiss')).ok('POST', `/api/tests/${t.testId}/approve`, { decision: 'approve', password: PASSWORD }),
  cancel: async (t) => (await as('priya.raman')).ok('POST', `/api/tests/${t.testId}/cancel`, { reason: 'Not needed' }),
  investigate: async (t) => (await as('priya.raman')).ok('POST', '/api/investigations', { type: 'Deviation', title: 'Balance drift', description: 'Drift seen after the run', test_id: t.testId }),
};

const PERFORMED = ['assign', 'enter', 'submit', 'review', 'approve'];

async function readyResults(t) {
  const d = await (await as('priya.raman')).ok('GET', `/api/tests/${t.testId}`);
  return { instrument_id: d.instruments.find((i) => i.code === 'KF-01').id, results: d.results.map((r) => ({ id: r.id, value: '0.21' })) };
}

async function receiveSample() {
  const res = await (await as('priya.raman')).ok('POST', '/api/samples/receive', { client_id: lab.client, samples: [{ description: 'Agreement sweep' }], method_ids: [lab.kf] });
  return res.samples[0].id;
}

/** A Karl Fischer Test taken through `steps`, on a new Sample or added to `sampleId`. */
async function prepareTest(steps, sampleId) {
  const priya = await as('priya.raman');
  if (sampleId) await priya.ok('POST', `/api/samples/${sampleId}/tests`, { method_ids: [lab.kf] });
  else sampleId = await receiveSample();
  const tests = (await priya.ok('GET', `/api/samples/${sampleId}`)).tests;
  const t = { sampleId, testId: tests.at(-1).id };
  for (const step of steps) await STEPS[step](t);
  return t;
}

const sampleStatus = async (sampleId) => (await (await as('priya.raman')).ok('GET', `/api/samples/${sampleId}`)).sample.status;

// ----- People -----

// Each person signs in as `username`. The analyst after a role change, and after their qualification lapses, is the
// Test's own analyst, changed once their Tests were assigned and worked and changed back so the next Test can be prepared.
const PEOPLE = {
  'the analyst': { username: ANALYST },
  'a reviewer who is not the analyst': { username: 'daniel.okafor' },
  'an approver who is neither': { username: 'helena.weiss' },
  'a manager who is neither': { username: 'priya.raman' },
  'a scientist not qualified on the Method': { username: 'sarah.lindqvist' },
  'a person with none of the permissions': { username: 'grace.holloway' },
  'the analyst after a role change': { username: ANALYST, role: 'qa' },
  'the analyst after their qualification lapses': { username: ANALYST, lapsed: 'ATM-0002' },
};

async function within(person, fn) {
  const c = await as(person.username);
  const userId = lab.users[person.username];
  if (person.role) {
    const admin = await as('admin');
    await admin.ok('PUT', `/api/users/${userId}`, { role: person.role });
    try {
      return await fn(c);
    } finally {
      await admin.ok('PUT', `/api/users/${userId}`, { role: lab.roles[person.username] });
    }
  }
  if (person.lapsed) {
    const priya = await as('priya.raman');
    const q = (await priya.ok('GET', '/api/qualifications')).qualifications.find((x) => x.user_id === userId && x.method_code === person.lapsed);
    await priya.ok('POST', `/api/qualifications/${q.id}/revoke`, { reason: 'Retraining required' });
    try {
      return await fn(c);
    } finally {
      await priya.ok('POST', '/api/qualifications', { user_id: userId, method_code: person.lapsed });
    }
  }
  return fn(c);
}

const refused = (r) => [400, 403].includes(r.status);
const describe = (r) => `${r.status} ${JSON.stringify(r.data)}`;
// Whether each rule of each table was seen offered and withheld, keyed by the table's exported name.
const seen = {};
const note = (table, rule, offered) => { ((seen[table] ??= {})[rule] ??= new Set()).add(offered); };

// ----- Test sweep -----

const TEST_STATES = {
  'pending and unassigned': [],
  pending: ['assign'],
  'in progress': ['assign', 'enter'],
  submitted: ['assign', 'enter', 'submit'],
  reviewed: ['assign', 'enter', 'submit', 'review'],
  'reviewed under Investigation': ['assign', 'enter', 'submit', 'review', 'investigate'],
  approved: PERFORMED,
  cancelled: ['assign', 'cancel'],
};

const TEST_ACTIONS = {
  assign: (c, t) => c.post('/api/tests/assign', { test_ids: [t.testId], analyst_id: lab.users[ANALYST] }),
  claim: (c, t) => c.post(`/api/tests/${t.testId}/claim`),
  start: (c, t) => c.post(`/api/tests/${t.testId}/start`),
  edit: async (c, t) => c.put(`/api/tests/${t.testId}`, await readyResults(t)),
  submit: (c, t) => c.post(`/api/tests/${t.testId}/submit`, { password: PASSWORD }),
  review: (c, t) => c.post(`/api/tests/${t.testId}/review`, { decision: 'approve', password: PASSWORD }),
  accept: (c, t) => c.post(`/api/tests/${t.testId}/approve`, { decision: 'approve', password: PASSWORD }),
  return: (c, t) => c.post(`/api/tests/${t.testId}/approve`, { decision: 'reject', comment: 'Repeat the titration', password: PASSWORD }),
  cancel: (c, t) => c.post(`/api/tests/${t.testId}/cancel`, { reason: 'Client withdrew the request' }),
  raise: (c, t) => c.post('/api/investigations', { type: 'Deviation', title: 'Balance drift', description: 'Drift seen after the run', test_id: t.testId, sample_id: t.sampleId }),
};

const badges = (c) => c.ok('GET', '/api/nav');

// ----- Queues -----

// Every Queue in the registry is swept: on each surface showing it, a record is listed exactly when the person is
// offered the Queue's rule on it, and each badge moves by the number of the person's Queues the record entered.
const QUEUES = await exportedTables('_QUEUES');
// Whether each Queue was seen listing and not listing a record, keyed by its table's exported name.
const sighted = {};

const listed = async (c, url, id) => (await c.ok('GET', url)).some((x) => x.id === id);
const onReviews = async (c, list, id) => (await c.ok('GET', '/api/reviews'))[list].some((x) => x.id === id);
const inMyDrafts = async (c, e) => (await c.ok('GET', '/api/dashboard')).myDrafts.some((n) => n.id === e.id);
const workFilters = (work) => ({
  'Samples work filter': (c, t) => listed(c, `/api/samples?limit=2000&work=${work}`, t.sampleId),
  'Tests work filter': (c, t) => listed(c, `/api/tests?limit=3000&work=${work}`, t.testId),
});

// The surfaces showing each Queue, by Queue table. Each reads whether the signed-in person sees the record there.
const SURFACES = {
  TEST_QUEUES: {
    assigned: { ...workFilters('assigned'), 'Worklist My tests': (c, t) => listed(c, '/api/tests?scope=open&limit=3000&work=assigned', t.testId) },
    review: { ...workFilters('review'), 'Reviews page review list': (c, t) => onReviews(c, 'toReview', t.testId) },
    approval: { ...workFilters('approval'), 'Reviews page approval list': (c, t) => onReviews(c, 'toApprove', t.testId) },
  },
  SAMPLE_QUEUES: {
    certificate: { 'Reviews page certificate list': (c, s) => onReviews(c, 'toIssue', s) },
  },
  ENTRY_QUEUES: {
    witness: { 'Reviews page witness list': (c, e) => onReviews(c, 'toWitness', e.id) },
    // A new draft is its author's most recent, so it is among the Dashboard's first five.
    drafts: { 'Dashboard My drafts': inMyDrafts },
  },
};

// The Queues each sidebar badge counts, as [Queue table, Queue].
const BADGES = {
  myTests: [['TEST_QUEUES', 'assigned']],
  reviews: [['TEST_QUEUES', 'review'], ['TEST_QUEUES', 'approval'], ['SAMPLE_QUEUES', 'certificate'], ['ENTRY_QUEUES', 'witness']],
};

/** Whether each surface of each Queue lists the record, for `records` keyed by Queue table, as `c` sees them. */
async function queueViews(c, records) {
  const views = {};
  for (const [table, record] of Object.entries(records)) {
    for (const name of Object.keys(QUEUES[table])) {
      const surfaces = SURFACES[table]?.[name];
      assert.ok(surfaces, `${table}.${name} has no surfaces in the agreement sweep`);
      for (const [surface, shows] of Object.entries(surfaces)) ((views[table] ??= {})[name] ??= {})[surface] = await shows(c, record);
    }
  }
  return views;
}

/**
 * Each surface in `views` agrees with its record's `can`, and each badge moved by the Queues entered. `flags` is keyed by
 * Queue table, one `can` or a list: a record whose surfaces are swept elsewhere still moves the badges.
 */
function assertQueues(label, flags, views, before, after) {
  for (const [table, byQueue] of Object.entries(views)) {
    const can = flags[table];
    for (const [name, queue] of Object.entries(QUEUES[table])) {
      assert.equal(typeof can[queue.rule], 'boolean', `${label}: ${table}.${name} names ${queue.rule}, which has no flag`);
      for (const [surface, shown] of Object.entries(byQueue[name])) {
        assert.equal(shown, can[queue.rule], `${label}: ${surface} (${name} Queue) vs can.${queue.rule}`);
        ((sighted[table] ??= {})[name] ??= new Set()).add(shown);
      }
    }
  }
  for (const [badge, queues] of Object.entries(BADGES)) {
    const entered = queues.reduce((n, [table, name]) => n + [flags[table] ?? []].flat().filter((can) => can[QUEUES[table][name].rule]).length, 0);
    assert.equal(after[badge] - before[badge], entered, `${label}: ${badge} badge vs the Queues it counts`);
  }
}

// The Dashboard shows the first dozen of My tests.
async function dashboardAgrees(c, label) {
  const mine = (await c.ok('GET', '/api/tests?scope=open&limit=3000&work=assigned')).map((x) => x.id);
  const dashboard = (await c.ok('GET', '/api/dashboard')).myTests.map((x) => x.id);
  assert.deepEqual(dashboard.filter((id) => !mine.includes(id)), [], `${label}: Dashboard My tests outside the Worklist`);
  assert.equal(dashboard.length, Math.min(12, mine.length), `${label}: Dashboard My tests vs Worklist`);
}

for (const [state, steps] of Object.entries(TEST_STATES)) {
  test(`a Test ${state}: offers, refusals, queues and badges agree for everyone`, async () => {
    for (const [who, person] of Object.entries(PEOPLE)) {
      const label = `Test ${state}, ${who}`;
      const before = await within(person, badges);
      const t = await prepareTest(steps);
      const { can, sampleCan, views, after } = await within(person, async (c) => {
        await dashboardAgrees(c, label);
        return {
          can: (await c.ok('GET', `/api/tests/${t.testId}`)).can,
          // An approved Test approves its Sample, which then enters the certificate Queue.
          sampleCan: (await c.ok('GET', `/api/samples/${t.sampleId}`)).can,
          views: await queueViews(c, { TEST_QUEUES: t, SAMPLE_QUEUES: t.sampleId }),
          after: await badges(c),
        };
      });
      assertQueues(label, { TEST_QUEUES: can, SAMPLE_QUEUES: sampleCan }, views, before, after);

      const actions = Object.keys(TEST_ACTIONS);
      assert.deepEqual(actions.filter((a) => typeof can[a] !== 'boolean'), [], `${label}: every action has a flag`);
      await within(person, async (c) => {
        for (const action of actions.filter((a) => !can[a])) {
          const r = await TEST_ACTIONS[action](c, t);
          assert.ok(refused(r), `${label}: ${action} is not offered but was accepted (${describe(r)})`);
        }
      });
      for (const action of actions) {
        note('TEST_RULES', action, can[action]);
        if (!can[action]) continue;
        const fresh = await prepareTest(steps);
        const r = await within(person, (c) => TEST_ACTIONS[action](c, fresh));
        assert.ok(r.status < 300, `${label}: ${action} is offered but was refused (${describe(r)})`);
      }
    }
  });
}

// ----- Sample sweep -----

// Each state builds a Sample from Tests prepared as above, then optionally does something to the Sample itself.
const SAMPLE_STATES = {
  'with a Test nobody is assigned to': { tests: [[]] },
  'with every Test approved': { tests: [PERFORMED] },
  'with an open Test beside an approved one': { tests: [PERFORMED, ['assign', 'enter']] },
  'with every Test cancelled': { tests: [['cancel']] },
  'with an Investigation open on an approved Test': { tests: [[...PERFORMED, 'investigate']] },
  'with an Investigation open on an open Test': { tests: [['assign', 'enter', 'submit', 'investigate']] },
  'with an Investigation open on the Sample itself': { tests: [PERFORMED], then: (c, s) => c.ok('POST', '/api/investigations', { type: 'Deviation', title: 'Storage excursion', description: 'Fridge alarm overnight', sample_id: s }) },
  'reported': { tests: [PERFORMED], then: (c, s) => c.ok('POST', `/api/samples/${s}/report`, { password: PASSWORD }) },
  'cancelled': { tests: [['assign']], then: (c, s) => c.ok('POST', `/api/samples/${s}/cancel`, { reason: 'Client withdrew the batch' }) },
};

const SAMPLE_ACTIONS = {
  assign: async (c, s) => c.post('/api/tests/assign', { test_ids: (await c.ok('GET', `/api/samples/${s}`)).tests.filter((t) => !t.analyst_id).map((t) => t.id), analyst_id: lab.users[ANALYST] }),
  issue: (c, s) => c.post(`/api/samples/${s}/report`, { password: PASSWORD }),
  cancel: (c, s) => c.post(`/api/samples/${s}/cancel`, { reason: 'Client withdrew the batch' }),
  dispose: (c, s) => c.post(`/api/samples/${s}/custody`, { action: 'Disposed', note: 'Retention period over' }),
  edit: (c, s) => c.put(`/api/samples/${s}`, { description: 'Agreement sweep, relabelled', reason: 'Label corrected' }),
  addTests: (c, s) => c.post(`/api/samples/${s}/tests`, { method_ids: [lab.kf] }),
  custody: (c, s) => c.post(`/api/samples/${s}/custody`, { action: 'Moved', location: 'Shelf 3' }),
  raise: (c, s) => c.post('/api/investigations', { type: 'Deviation', title: 'Label smudged', description: 'Batch number unreadable', sample_id: s }),
};

const SAMPLE_PEOPLE = ['priya.raman', 'daniel.okafor', 'admin', ANALYST];

async function prepareSample({ tests, then }) {
  let sampleId;
  for (const steps of tests) sampleId = (await prepareTest(steps, sampleId)).sampleId;
  if (then) await then(await as('priya.raman'), sampleId);
  return sampleId;
}

for (const [state, spec] of Object.entries(SAMPLE_STATES)) {
  test(`a Sample ${state}: offers, refusals, queues and badges agree for everyone`, async () => {
    for (const username of SAMPLE_PEOPLE) {
      const label = `Sample ${state}, ${username}`;
      const c = await as(username);
      const before = await badges(c);
      const s = await prepareSample(spec);
      const { can, tests } = await c.ok('GET', `/api/samples/${s}`);
      // The Test sweep compares the Tests with their Queues; here they only move the badges they count in.
      const testCans = [];
      for (const t of tests) testCans.push((await c.ok('GET', `/api/tests/${t.id}`)).can);
      const views = await queueViews(c, { SAMPLE_QUEUES: s });
      assertQueues(label, { SAMPLE_QUEUES: can, TEST_QUEUES: testCans }, views, before, await badges(c));

      const actions = Object.keys(SAMPLE_ACTIONS);
      for (const action of actions.filter((a) => !can[a])) {
        const r = await SAMPLE_ACTIONS[action](c, s);
        assert.ok(refused(r), `${label}: ${action} is not offered but was accepted (${describe(r)})`);
      }
      for (const action of actions) {
        note('SAMPLE_RULES', action, can[action]);
        if (!can[action]) continue;
        const r = await SAMPLE_ACTIONS[action](c, await prepareSample(spec));
        assert.ok(r.status < 300, `${label}: ${action} is offered but was refused (${describe(r)})`);
      }
    }
  });
}

// ----- Investigation sweep -----

// A manager performs the Test, so the performer holds `investigations.close` and only independence can refuse them.
const PERFORMER = 'priya.raman';

async function investigationOnTest() {
  const priya = await as(PERFORMER);
  const t = await prepareTest([]);
  await priya.ok('POST', '/api/tests/assign', { test_ids: [t.testId], analyst_id: lab.users[PERFORMER] });
  const { id } = await (await as('daniel.okafor')).ok('POST', '/api/investigations', { type: 'Deviation', title: 'Balance drift', description: 'Drift seen after the run', test_id: t.testId });
  return { id, testId: t.testId };
}

const FINDINGS = { root_cause: 'Draught from the open door', conclusion: 'No impact on the reported result' };

const INVESTIGATION_STATES = {
  'open on a Test': investigationOnTest,
  standalone: async () => ({ id: (await (await as(ANALYST)).ok('POST', '/api/investigations', { type: 'Lab Incident', title: 'Spilled reagent', description: 'Spill at bench 3' })).id }),
  closed: async () => {
    const v = await investigationOnTest();
    await (await as('daniel.okafor')).ok('POST', `/api/investigations/${v.id}/close`, { ...FINDINGS, password: PASSWORD });
    return v;
  },
};

const INVESTIGATION_ACTIONS = {
  edit: (c, v) => c.put(`/api/investigations/${v.id}`, { title: 'Balance drift after door left open' }),
  close: (c, v) => c.post(`/api/investigations/${v.id}/close`, { ...FINDINGS, password: PASSWORD }),
};

const INVESTIGATION_PEOPLE = {
  'the manager who performed the Test': PERFORMER,
  'someone independent': 'helena.weiss',
  'an analyst who may raise but not close': ANALYST,
  'someone without the permission': 'grace.holloway',
};

for (const [state, prepare] of Object.entries(INVESTIGATION_STATES)) {
  test(`an Investigation ${state}: offers and refusals agree on its page and its Test's page`, async () => {
    for (const [who, username] of Object.entries(INVESTIGATION_PEOPLE)) {
      const label = `Investigation ${state}, ${who}`;
      const c = await as(username);
      const v = await prepare();
      const { can } = await c.ok('GET', `/api/investigations/${v.id}`);
      if (v.testId) {
        const page = await c.get(`/api/tests/${v.testId}`);
        if (page.status === 200) assert.deepEqual(page.data.investigations.find((x) => x.id === v.id).can, can, `${label}: Test page card vs Investigation page`);
      }

      const actions = Object.keys(INVESTIGATION_ACTIONS);
      for (const action of actions.filter((a) => !can[a])) {
        const r = await INVESTIGATION_ACTIONS[action](c, v);
        assert.ok(refused(r), `${label}: ${action} is not offered but was accepted (${describe(r)})`);
      }
      for (const action of actions) {
        note('INVESTIGATION_RULES', action, can[action]);
        if (!can[action]) continue;
        const r = await INVESTIGATION_ACTIONS[action](c, await prepare());
        assert.ok(r.status < 300, `${label}: ${action} is offered but was refused (${describe(r)})`);
      }
    }
  });
}

// ----- Method sweep -----

// The manager owns each Method, so only ownership can refuse them making it effective. QA approves it; a scientist
// moves it on before approval.
const METHOD_OWNER = 'priya.raman';
const approveMethod = (status, comment) => async (id) => (await as('daniel.okafor')).ok('POST', `/api/methods/${id}/status`, { status, comment, password: PASSWORD });
const moveMethod = (status) => async (id) => (await as('sarah.lindqvist')).ok('POST', `/api/methods/${id}/status`, { status });

const METHOD_STATES = {
  draft: [],
  'in development': [moveMethod('In Development')],
  'in validation': [moveMethod('In Validation')],
  effective: [approveMethod('Effective')],
  retired: [approveMethod('Effective'), approveMethod('Retired', 'Superseded by a coulometric method')],
  'effective, with a newer version drafted': [approveMethod('Effective'), async (id) => (await as('sarah.lindqvist')).ok('POST', `/api/methods/${id}/new-version`)],
};

async function prepareMethod(steps) {
  const { id } = await (await as('sarah.lindqvist')).ok('POST', '/api/methods', {
    title: 'Assay by UV', technique: 'UV-Vis', price: 100, tat_days: 3, owner_id: lab.users[METHOD_OWNER],
    analytes: [{ name: 'Assay', unit: '%', spec_min: 95, spec_max: 105 }],
  });
  for (const step of steps) await step(id);
  return id;
}

const methodStatus = (status) => (c, id) => c.post(`/api/methods/${id}/status`, { status, comment: 'Agreement sweep', password: PASSWORD });

const METHOD_ACTIONS = {
  edit: (c, id) => c.put(`/api/methods/${id}`, { title: 'Assay by UV, revised' }),
  newVersion: (c, id) => c.post(`/api/methods/${id}/new-version`),
  backToDraft: methodStatus('Draft'),
  develop: methodStatus('In Development'),
  validate: methodStatus('In Validation'),
  makeEffective: methodStatus('Effective'),
  retire: methodStatus('Retired'),
};

const METHOD_PEOPLE = {
  'the manager who owns it': METHOD_OWNER,
  'QA, who approves but does not edit': 'daniel.okafor',
  'a scientist, who edits but does not approve': 'sarah.lindqvist',
  'an analyst, who does neither': ANALYST,
};

for (const [state, steps] of Object.entries(METHOD_STATES)) {
  test(`a Method ${state}: offers and refusals agree for everyone`, async () => {
    for (const [who, username] of Object.entries(METHOD_PEOPLE)) {
      const label = `Method ${state}, ${who}`;
      const c = await as(username);
      const id = await prepareMethod(steps);
      const { can } = await c.ok('GET', `/api/methods/${id}`);

      const actions = Object.keys(METHOD_ACTIONS);
      assert.deepEqual(actions.filter((a) => typeof can[a] !== 'boolean'), [], `${label}: every action has a flag`);
      for (const action of actions.filter((a) => !can[a])) {
        const r = await METHOD_ACTIONS[action](c, id);
        assert.ok(refused(r), `${label}: ${action} is not offered but was accepted (${describe(r)})`);
      }
      for (const action of actions) {
        note('METHOD_RULES', action, can[action]);
        if (!can[action]) continue;
        const r = await METHOD_ACTIONS[action](c, await prepareMethod(steps));
        assert.ok(r.status < 300, `${label}: ${action} is offered but was refused (${describe(r)})`);
      }
    }
  });
}

test('the owner of a Method is not offered Make effective and is refused it, while another manager succeeds', async () => {
  const id = await prepareMethod([]);
  await within({ username: 'helena.weiss', role: 'manager' }, async () => {
    const [owner, other] = await Promise.all(['priya.raman', 'helena.weiss'].map(as));
    assert.equal((await owner.ok('GET', `/api/methods/${id}`)).can.makeEffective, false);
    const r = await owner.post(`/api/methods/${id}/status`, { status: 'Effective', password: PASSWORD });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'The method owner cannot approve their own method — another manager or QA must sign');
    assert.equal((await owner.ok('GET', `/api/methods/${id}`)).method.status, 'Draft');

    assert.equal((await other.ok('GET', `/api/methods/${id}`)).can.makeEffective, true);
    await other.ok('POST', `/api/methods/${id}/status`, { status: 'Effective', password: PASSWORD });
    assert.equal((await owner.ok('GET', `/api/methods/${id}`)).method.status, 'Effective');
  });
});

// ----- Invoice sweep -----

// Each invoice bills a Project of its own and has a line, so issuing and pulling in completed work are always ready.
async function prepareInvoice(steps) {
  const oliver = await as('oliver.grant');
  const { id: project_id } = await oliver.ok('POST', '/api/projects', { client_id: lab.client, title: 'Invoice sweep', type: 'Other' });
  const { id } = await oliver.ok('POST', '/api/invoices', { project_id });
  await oliver.ok('PUT', `/api/invoices/${id}`, { lines: [{ description: 'Stability pull', quantity: 1, unit_price: 100 }] });
  for (const step of steps) await oliver.ok('POST', `/api/invoices/${id}/${step}`, { reason: 'Billed to the wrong PO' });
  return id;
}

const INVOICE_STATES = {
  draft: [],
  sent: ['issue'],
  paid: ['issue', 'paid'],
  void: ['void'],
};

// Editing covers pulling in completed work, so both requests must get the same answer.
async function editInvoice(c, id) {
  const put = await c.put(`/api/invoices/${id}`, { notes: 'Agreement sweep' });
  const pull = await c.post(`/api/invoices/${id}/add-unbilled`);
  return (put.status < 300) === (pull.status < 300) ? put : { status: 500, data: `edit → ${describe(put)}, add-unbilled → ${describe(pull)}` };
}

const INVOICE_ACTIONS = {
  edit: editInvoice,
  issue: (c, id) => c.post(`/api/invoices/${id}/issue`),
  paid: (c, id) => c.post(`/api/invoices/${id}/paid`),
  void: (c, id) => c.post(`/api/invoices/${id}/void`, { reason: 'Billed to the wrong PO' }),
};

// Every role that can read an invoice can also bill, so a person without the permission cannot read the invoice and
// is offered nothing; their refusals are still attempted.
const INVOICE_PEOPLE = {
  'the business person': { username: 'oliver.grant' },
  'a manager': { username: 'priya.raman' },
  'the business person after a role change': { username: 'oliver.grant', role: 'analyst' },
};

for (const [state, steps] of Object.entries(INVOICE_STATES)) {
  test(`an invoice ${state}: offers and refusals agree for everyone`, async () => {
    for (const [who, person] of Object.entries(INVOICE_PEOPLE)) {
      const label = `Invoice ${state}, ${who}`;
      const id = await prepareInvoice(steps);
      const actions = Object.keys(INVOICE_ACTIONS);
      const can = await within(person, async (c) => {
        const r = await c.get(`/api/invoices/${id}`);
        assert.ok([200, 403].includes(r.status), `${label}: invoice → ${describe(r)}`);
        const offered = r.status === 200 ? r.data.can : {};
        if (r.status === 200) assert.deepEqual(actions.filter((a) => typeof offered[a] !== 'boolean'), [], `${label}: every action has a flag`);
        for (const action of actions.filter((a) => !offered[a])) {
          const refusal = await INVOICE_ACTIONS[action](c, id);
          assert.ok(refused(refusal), `${label}: ${action} is not offered but was accepted (${describe(refusal)})`);
        }
        return Object.fromEntries(actions.map((a) => [a, offered[a] === true]));
      });
      for (const action of actions) {
        note('INVOICE_RULES', action, can[action]);
        if (!can[action]) continue;
        const fresh = await prepareInvoice(steps);
        const r = await within(person, (c) => INVOICE_ACTIONS[action](c, fresh));
        assert.ok(r.status < 300, `${label}: ${action} is offered but was refused (${describe(r)})`);
      }
    }
  });
}

// ----- Project sweep -----

// A Project starts Quoted and is moved on by the business person, through the same actions the sweep tries.
async function prepareProject(steps) {
  const grace = await as('grace.holloway');
  const { id } = await grace.ok('POST', '/api/projects', { client_id: lab.client, title: 'Project sweep', type: 'Other', status: 'Quoted' });
  for (const step of steps) await grace.ok('POST', `/api/projects/${id}/${step}`, { reason: 'Client paused the programme' });
  return id;
}

const PROJECT_STATES = {
  quoted: [],
  active: ['activate'],
  'on hold': ['activate', 'hold'],
  completed: ['activate', 'complete'],
  cancelled: ['cancel'],
};

const moveProject = (action) => (c, id) => c.post(`/api/projects/${id}/${action}`, { reason: 'Client paused the programme' });

const PROJECT_ACTIONS = {
  edit: (c, id) => c.put(`/api/projects/${id}`, { title: 'Project sweep, renamed' }),
  activate: moveProject('activate'),
  hold: moveProject('hold'),
  complete: moveProject('complete'),
  cancel: moveProject('cancel'),
  reopen: moveProject('reopen'),
  receive: (c, id) => c.post('/api/samples/receive', { client_id: lab.client, project_id: id, samples: [{ description: 'Project sweep' }] }),
};

const PROJECT_PEOPLE = {
  'a business person, who edits but does not receive': 'grace.holloway',
  'a scientist, who does both': 'sarah.lindqvist',
  'an analyst, who receives but does not edit': ANALYST,
  'QA, who does neither': 'daniel.okafor',
};

for (const [state, steps] of Object.entries(PROJECT_STATES)) {
  test(`a Project ${state}: offers and refusals agree for everyone`, async () => {
    for (const [who, username] of Object.entries(PROJECT_PEOPLE)) {
      const label = `Project ${state}, ${who}`;
      const c = await as(username);
      const id = await prepareProject(steps);
      const { can } = await c.ok('GET', `/api/projects/${id}`);

      const actions = Object.keys(PROJECT_ACTIONS);
      assert.deepEqual(actions.filter((a) => typeof can[a] !== 'boolean'), [], `${label}: every action has a flag`);
      for (const action of actions.filter((a) => !can[a])) {
        const r = await PROJECT_ACTIONS[action](c, id);
        assert.ok(refused(r), `${label}: ${action} is not offered but was accepted (${describe(r)})`);
      }
      for (const action of actions) {
        note('PROJECT_RULES', action, can[action]);
        if (!can[action]) continue;
        const r = await PROJECT_ACTIONS[action](c, await prepareProject(steps));
        assert.ok(r.status < 300, `${label}: ${action} is offered but was refused (${describe(r)})`);
      }
    }
  });
}

test('editing a Completed Project is refused', async () => {
  const grace = await as('grace.holloway');
  const id = await prepareProject(['activate', 'complete']);
  assert.equal((await grace.ok('GET', `/api/projects/${id}`)).can.edit, false);
  const r = await grace.put(`/api/projects/${id}`, { title: 'Renamed after completion' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'The project is completed — reopen it to make changes');
  assert.equal((await grace.ok('GET', `/api/projects/${id}`)).project.title, 'Project sweep');
});

test('a Cancelled Project cannot be moved back to Active', async () => {
  const grace = await as('grace.holloway');
  const id = await prepareProject(['activate', 'cancel']);
  const { can } = await grace.ok('GET', `/api/projects/${id}`);
  assert.deepEqual([can.activate, can.reopen, can.edit], [false, false, false]);
  for (const [action, error] of [['activate', 'The project is cancelled — it can\'t be made active'], ['reopen', 'The project is cancelled — it can\'t be reopened']]) {
    const r = await grace.post(`/api/projects/${id}/${action}`);
    assert.equal(r.status, 400, action);
    assert.equal(r.data.error, error);
  }
  assert.equal((await grace.put(`/api/projects/${id}`, { status: 'Active' })).status, 400, 'nor through an edit');
  assert.equal((await grace.ok('GET', `/api/projects/${id}`)).project.status, 'Cancelled');
});

test('a new Project starts Quoted or Active, never already closed', async () => {
  const grace = await as('grace.holloway');
  for (const status of ['On Hold', 'Completed', 'Cancelled']) {
    const r = await grace.post('/api/projects', { client_id: lab.client, title: 'Born closed', type: 'Other', status });
    assert.equal(r.status, 400, status);
  }
});

test('reopening a Completed Project makes it Active, editable and able to receive again', async () => {
  const [grace, sarah] = await Promise.all(['grace.holloway', 'sarah.lindqvist'].map(as));
  const id = await prepareProject(['activate', 'complete']);
  assert.equal((await grace.ok('GET', `/api/projects/${id}`)).can.reopen, true);
  await grace.ok('POST', `/api/projects/${id}/reopen`);
  const { project, can } = await sarah.ok('GET', `/api/projects/${id}`);
  assert.equal(project.status, 'Active');
  assert.deepEqual([can.edit, can.receive, can.reopen], [true, true, false]);
  await sarah.ok('PUT', `/api/projects/${id}`, { title: 'Extended programme' });
  await sarah.ok('POST', '/api/samples/receive', { client_id: lab.client, project_id: id, samples: [{ description: 'Extra lot' }] });
});

// ----- File sweep -----

// Each attachable record type, in states that lock its files and states that don't. A state creates a fresh record;
// the uploader attaches a file while it is open, then `then` moves it on, so removal can be tried once it is locked.
let unique = 0;
const code = (prefix) => `${prefix}${process.pid % 1000}-${++unique}`;
const signedAs = (username, url, body = {}) => async (id) => (await as(username)).ok('POST', url(id), { ...body, password: PASSWORD });
const newMethod = async () => (await (await as('sarah.lindqvist')).ok('POST', '/api/methods', { title: 'Water by coulometric KF', technique: 'Karl Fischer', analytes: [{ name: 'Water', unit: '%', spec_max: 0.5 }] })).id;
const makeEffective = signedAs('daniel.okafor', (id) => `/api/methods/${id}/status`, { status: 'Effective' });
const newProject = async () => (await (await as('marco.bianchi')).ok('POST', '/api/projects', { client_id: lab.client, title: 'File sweep', type: 'Other' })).id;
const projectStatus = (action) => async (id) => (await as('priya.raman')).ok('POST', `/api/projects/${id}/${action}`);

const FILE_RECORDS = {
  samples: {
    uploader: ANALYST,
    people: [ANALYST, 'sarah.lindqvist', 'priya.raman', 'daniel.okafor'],
    states: {
      open: {},
      reported: { create: () => prepareSample({ tests: [PERFORMED] }), then: signedAs('priya.raman', (id) => `/api/samples/${id}/report`) },
      cancelled: { then: async (id) => (await as('priya.raman')).ok('POST', `/api/samples/${id}/cancel`, { reason: 'Client withdrew the batch' }) },
      disposed: {
        then: async (id) => {
          const priya = await as('priya.raman');
          await priya.ok('POST', `/api/samples/${id}/cancel`, { reason: 'Client withdrew the batch' });
          await priya.ok('POST', `/api/samples/${id}/custody`, { action: 'Disposed', note: 'Retention period over' });
        },
      },
    },
    create: receiveSample,
  },
  tests: {
    uploader: ANALYST,
    people: [ANALYST, 'lucia.fernandez', 'sarah.lindqvist', 'priya.raman', 'grace.holloway'],
    create: async () => (await prepareTest(['assign', 'enter'])).testId,
    states: {
      'in progress': {},
      submitted: { then: signedAs(ANALYST, (id) => `/api/tests/${id}/submit`) },
    },
  },
  methods: {
    uploader: 'sarah.lindqvist',
    people: ['sarah.lindqvist', 'marco.bianchi', 'priya.raman', 'daniel.okafor'],
    create: newMethod,
    states: {
      draft: {},
      effective: { then: makeEffective },
      retired: { then: async (id) => { await makeEffective(id); await signedAs('daniel.okafor', (x) => `/api/methods/${x}/status`, { status: 'Retired' })(id); } },
    },
  },
  notebook_entries: {
    uploader: ANALYST,
    people: [ANALYST, 'lucia.fernandez', 'priya.raman', 'grace.holloway'],
    create: async () => (await (await as(ANALYST)).ok('POST', '/api/notebook', { title: 'KF titre check', body: 'Titre 4.98 mg/mL' })).id,
    states: {
      draft: {},
      signed: { then: signedAs(ANALYST, (id) => `/api/notebook/${id}/sign`) },
    },
  },
  investigations: {
    uploader: ANALYST,
    people: [ANALYST, 'lucia.fernandez', 'priya.raman', 'grace.holloway'],
    create: async () => (await (await as(ANALYST)).ok('POST', '/api/investigations', { type: 'Lab Incident', title: 'Spilled reagent', description: 'Spill at bench 3' })).id,
    states: {
      open: {},
      closed: { then: signedAs('daniel.okafor', (id) => `/api/investigations/${id}/close`, { root_cause: 'Loose cap', conclusion: 'No impact on results' }) },
    },
  },
  instruments: {
    uploader: ANALYST,
    people: [ANALYST, 'lucia.fernandez', 'priya.raman', 'grace.holloway'],
    create: async () => (await (await as('priya.raman')).ok('POST', '/api/instruments', { code: code('BAL-'), name: 'Balance', type: 'Analytical Balance' })).id,
    states: { 'in service': {} },
  },
  inventory: {
    uploader: ANALYST,
    people: [ANALYST, 'lucia.fernandez', 'priya.raman', 'daniel.okafor'],
    create: async () => (await (await as(ANALYST)).ok('POST', '/api/inventory', { name: 'Methanol', category: 'Solvent' })).id,
    states: { active: {} },
  },
  projects: {
    uploader: 'marco.bianchi',
    people: ['marco.bianchi', 'sarah.lindqvist', 'priya.raman', ANALYST],
    create: newProject,
    states: {
      active: {},
      completed: { then: projectStatus('complete') },
      cancelled: { then: projectStatus('cancel') },
    },
  },
  clients: {
    uploader: 'grace.holloway',
    people: ['grace.holloway', 'oliver.grant', 'priya.raman', ANALYST],
    create: async () => (await (await as('grace.holloway')).ok('POST', '/api/clients', { code: code('C'), name: 'Sweep Pharma' })).id,
    states: { active: {} },
  },
  invoices: {
    uploader: 'oliver.grant',
    people: ['oliver.grant', 'grace.holloway', 'priya.raman', ANALYST],
    create: async () => (await (await as('oliver.grant')).ok('POST', '/api/invoices', { client_id: lab.client })).id,
    states: {
      draft: {},
      sent: {
        then: async (id) => {
          const oliver = await as('oliver.grant');
          await oliver.ok('PUT', `/api/invoices/${id}`, { lines: [{ description: 'Stability pull', quantity: 1, unit_price: 100 }] });
          await oliver.ok('POST', `/api/invoices/${id}/issue`);
        },
      },
    },
  },
};

const tableOf = (entity) => Object.entries(TABLES).find(([, rules]) => rules === ATTACHABLE[entity])[0];

/** A record of `entity` in `state`, with one file its uploader attached while it was open. */
async function prepareFiled(entity, state) {
  const record = FILE_RECORDS[entity];
  const spec = record.states[state];
  const id = await (spec.create ?? record.create)();
  const url = `/api/attachments?entity=${entity}&id=${id}`;
  const up = await (await as(record.uploader)).upload(url, 'trace');
  assert.ok(up.status < 300, `${entity} ${state}: the uploader could not attach a file (${describe(up)})`);
  if (spec.then) await spec.then(id);
  return { id, url, fileId: up.data.id };
}

/** What `c` is offered on the record's files; someone who cannot see them is offered nothing. */
async function fileOffers(c, f, label) {
  const r = await c.get(f.url);
  assert.ok([200, 403].includes(r.status), `${label}: file list → ${describe(r)}`);
  if (r.status === 403) return { attach: false, remove: false };
  assert.equal(r.data.locks.attach === null, r.data.can.attach, `${label}: a lock reason exactly when files are locked`);
  return { attach: r.data.can.attach, remove: r.data.files.find((x) => x.id === f.fileId).can.remove };
}

const FILE_ACTIONS = {
  attach: (c, f) => c.upload(f.url, 'more trace'),
  remove: (c, f) => c.post(`/api/attachments/${f.fileId}/remove`, { reason: 'Attached to the wrong record' }),
};

test('every attachable record type has a file sweep', () => {
  assert.deepEqual(Object.keys(FILE_RECORDS).sort(), Object.keys(ATTACHABLE).sort());
});

for (const [entity, record] of Object.entries(FILE_RECORDS)) {
  for (const state of Object.keys(record.states)) {
    test(`files on ${entity} ${state}: offers and refusals agree for everyone`, async () => {
      const f = await prepareFiled(entity, state);
      for (const username of record.people) {
        const label = `${entity} ${state}, ${username}`;
        const c = await as(username);
        const can = await fileOffers(c, f, label);
        for (const action of Object.keys(FILE_ACTIONS).filter((a) => !can[a])) {
          const r = await FILE_ACTIONS[action](c, f);
          assert.ok(refused(r), `${label}: ${action} is not offered but was accepted (${describe(r)})`);
        }
        note(tableOf(entity), 'attach', can.attach);
        note('ATTACHMENT_RULES', 'remove', can.remove);
        for (const action of Object.keys(FILE_ACTIONS).filter((a) => can[a])) {
          const r = await FILE_ACTIONS[action](c, await prepareFiled(entity, state));
          assert.ok(r.status < 300, `${label}: ${action} is offered but was refused (${describe(r)})`);
        }
      }
    });
  }
}

// ----- Notebook entry sweep -----

// The analyst writes each entry, with one workbook, and signs it; a scientist witnesses it.
async function prepareEntry(steps) {
  const tom = await as(ANALYST);
  const { id } = await tom.ok('POST', '/api/notebook', { title: 'KF titre check', body: 'Titre 4.98 mg/mL' });
  const { id: docId } = await tom.ok('POST', `/api/notebook/${id}/documents`, { template: 'xlsx', name: 'Titre workbook' });
  for (const step of steps) await step(id);
  return { id, docId };
}

const signEntry = signedAs(ANALYST, (id) => `/api/notebook/${id}/sign`);

const ENTRY_STATES = {
  draft: [],
  signed: [signEntry],
  witnessed: [signEntry, signedAs('sarah.lindqvist', (id) => `/api/notebook/${id}/witness`)],
};

const ENTRY_ACTIONS = {
  edit: (c, e) => c.put(`/api/notebook/${e.id}`, { body: 'Titre 4.97 mg/mL' }),
  sign: (c, e) => c.post(`/api/notebook/${e.id}/sign`, { password: PASSWORD }),
  witness: (c, e) => c.post(`/api/notebook/${e.id}/witness`, { password: PASSWORD }),
  addendum: (c, e) => c.post(`/api/notebook/${e.id}/addenda`, { body: 'Burette recalibrated since' }),
};

// A notebook document changes exactly when its entry may be edited.
const DOCUMENT_ACTIONS = {
  'add a document': (c, e) => c.post(`/api/notebook/${e.id}/documents`, { template: 'docx', name: 'Prep record' }),
  'open a document in Office': (c, e) => c.post(`/api/notebook-documents/${e.docId}/edit-link`),
  'remove a document': (c, e) => c.post(`/api/notebook-documents/${e.docId}/remove`, { reason: 'Started in the wrong entry' }),
};

const ENTRY_PEOPLE = {
  'the author': { username: ANALYST },
  'the author without notebook.write': { username: ANALYST, role: 'business' },
  'the author as a scientist, who may witness others': { username: ANALYST, role: 'scientist' },
  'a witness who is not the author': { username: 'sarah.lindqvist' },
  'someone without the permissions': { username: 'grace.holloway' },
};

for (const [state, steps] of Object.entries(ENTRY_STATES)) {
  test(`a notebook entry ${state}: offers, refusals, queues and badges agree for everyone`, async () => {
    for (const [who, person] of Object.entries(ENTRY_PEOPLE)) {
      const label = `Entry ${state}, ${who}`;
      const before = await within(person, badges);
      const e = await prepareEntry(steps);
      const { can, views, after } = await within(person, async (c) => ({
        can: (await c.ok('GET', `/api/notebook/${e.id}`)).can,
        views: await queueViews(c, { ENTRY_QUEUES: e }),
        after: await badges(c),
      }));
      assertQueues(label, { ENTRY_QUEUES: can }, views, before, after);

      const actions = Object.keys(ENTRY_ACTIONS);
      assert.deepEqual(actions.filter((a) => typeof can[a] !== 'boolean'), [], `${label}: every action has a flag`);
      for (const action of actions) note('ENTRY_RULES', action, can[action]);
      // [what is tried, the flag that offers it, how]
      const attempts = [
        ...Object.entries(ENTRY_ACTIONS).map(([action, attempt]) => [action, action, attempt]),
        ...Object.entries(DOCUMENT_ACTIONS).map(([what, attempt]) => [what, 'edit', attempt]),
      ];
      await within(person, async (c) => {
        for (const [what, , attempt] of attempts.filter(([, flag]) => !can[flag])) {
          const r = await attempt(c, e);
          assert.ok(refused(r), `${label}: ${what} is not offered but was accepted (${describe(r)})`);
        }
      });
      for (const [what, , attempt] of attempts.filter(([, flag]) => can[flag])) {
        const fresh = await prepareEntry(steps);
        const r = await within(person, (c) => attempt(c, fresh));
        assert.ok(r.status < 300, `${label}: ${what} is offered but was refused (${describe(r)})`);
      }
    }
  });
}

test('an author whose role lost notebook.write is refused editing and signing their draft', async () => {
  const e = await prepareEntry([]);
  await within({ username: ANALYST, role: 'business' }, async (tom) => {
    const { can } = await tom.ok('GET', `/api/notebook/${e.id}`);
    assert.deepEqual([can.edit, can.sign], [false, false]);
    for (const r of [await ENTRY_ACTIONS.edit(tom, e), await ENTRY_ACTIONS.sign(tom, e)]) {
      assert.equal(r.status, 403);
      assert.equal(r.data.error, 'You do not have permission to do that.');
    }
  });
  const { entry } = await (await as(ANALYST)).ok('GET', `/api/notebook/${e.id}`);
  assert.deepEqual([entry.status, entry.body], ['Draft', 'Titre 4.98 mg/mL']);
});

test('a draft whose author lost notebook.write leaves My drafts', async () => {
  const e = await prepareEntry([]);
  assert.ok(await inMyDrafts(await as(ANALYST), e), 'the author sees their draft');
  await within({ username: ANALYST, role: 'business' }, async (tom) => assert.ok(!(await inMyDrafts(tom, e)), 'nor does the author once they may no longer edit it'));
});

// Desktop Office reaches a notebook document over WebDAV through a link the author opened from the entry.
const LOCK_INFO = '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>Tom</D:owner></D:lockinfo>';
const dav = async (link, method, body) => {
  const res = await fetch(BASE + link.path, { method, headers: { Timeout: 'Second-600' }, body });
  return { status: res.status, text: await res.text() };
};

test('signing an entry expires its documents\' Office links, and no new one can be opened', async () => {
  const tom = await as(ANALYST);
  const e = await prepareEntry([]);
  const link = await tom.ok('POST', `/api/notebook-documents/${e.docId}/edit-link`);
  await signEntry(e.id);
  assert.deepEqual(await dav(link, 'LOCK', LOCK_INFO), { status: 404, text: 'This link has expired. Open the document again from Aliquot.' });
  const again = await tom.post(`/api/notebook-documents/${e.docId}/edit-link`);
  assert.equal(again.status, 400, 'nor can a new link be opened');
  assert.equal(again.data.error, 'Signed entries are locked — add an addendum instead');
});

test('a WebDAV lock or save by an author whose role lost notebook.write is refused', async () => {
  const tom = await as(ANALYST);
  const e = await prepareEntry([]);
  const link = await tom.ok('POST', `/api/notebook-documents/${e.docId}/edit-link`);
  await within({ username: ANALYST, role: 'business' }, async () => {
    assert.deepEqual(await dav(link, 'LOCK', LOCK_INFO), { status: 403, text: 'You do not have permission to do that.' });
    assert.deepEqual(await dav(link, 'PUT', 'a changed workbook'), { status: 403, text: 'You do not have permission to do that.' });
  });
  const versions = await tom.ok('GET', `/api/notebook-documents/${e.docId}/versions`);
  assert.deepEqual(versions.map((v) => v.version), [1]);
  assert.equal((await dav(link, 'LOCK', LOCK_INFO)).status, 200, 'the same link works once the role allows writing again');
});

// ----- Sample status on the happy path -----

test('the Sample status follows each transition, return and cancel of its Tests', async () => {
  const [tom, daniel, helena, priya] = await Promise.all([ANALYST, 'daniel.okafor', 'helena.weiss', 'priya.raman'].map(as));
  const t = await prepareTest(['assign']);
  const s = t.sampleId;
  const expect = async (status, after) => assert.equal(await sampleStatus(s), status, `after ${after}`);
  const url = (action) => `/api/tests/${t.testId}/${action}`;

  await expect('Received', 'receipt and assignment');
  await tom.ok('POST', url('start'));
  await expect('In Testing', 'start');
  await STEPS.enter(t);
  await expect('In Testing', 'results');
  await tom.ok('POST', url('submit'), { password: PASSWORD });
  await expect('In Review', 'submit');
  await daniel.ok('POST', url('review'), { decision: 'return', comment: 'Recheck the drift', password: PASSWORD });
  await expect('In Testing', 'return at review');
  await tom.ok('POST', url('submit'), { password: PASSWORD });
  await daniel.ok('POST', url('review'), { decision: 'approve', password: PASSWORD });
  await expect('In Review', 'review');
  await helena.ok('POST', url('approve'), { decision: 'reject', comment: 'Wrong standard', password: PASSWORD });
  await expect('In Testing', 'return at approval');
  await tom.ok('POST', url('submit'), { password: PASSWORD });
  await daniel.ok('POST', url('review'), { decision: 'approve', password: PASSWORD });
  await helena.ok('POST', url('approve'), { decision: 'approve', password: PASSWORD });
  await expect('Approved', 'approval');

  const second = await prepareTest(['assign'], s);
  await expect('In Testing', 'adding a pending Test to an approved Sample');
  await priya.ok('POST', `/api/tests/${second.testId}/cancel`, { reason: 'Not needed' });
  await expect('Approved', 'cancelling the only open Test');

  const third = await prepareTest(['assign', 'enter', 'submit'], s);
  await expect('In Review', 'a submitted Test beside an approved one');
  await prepareTest(['assign'], s);
  await expect('In Testing', 'adding a pending Test');
  await priya.ok('POST', `/api/tests/${third.testId}/cancel`, { reason: 'Not needed' });
  await expect('In Testing', 'cancelling the submitted Test while a pending one remains');

  await priya.ok('POST', `/api/samples/${s}/cancel`, { reason: 'Client withdrew the batch' });
  await expect('Cancelled', 'cancelling the Sample');
});

// ----- Client portal sweeps -----

const LAURA = 'customer@example.com'; // a contact at the Sample's client
const FELIX = 'felix.romero@bluestone-bio.example'; // a contact at another client

const contacts = {};
async function asContact(email) {
  if (!contacts[email]) {
    const c = new Client();
    await c.ok('POST', '/api/portal/login', { email, password: PASSWORD });
    contacts[email] = c;
  }
  return contacts[email];
}

// Laura announces a shipment of one sample for Karl Fischer; the lab and Laura move it on.
async function prepareSubmission(steps) {
  const { id } = await (await asContact(LAURA)).ok('POST', '/api/portal/submissions', { samples: [{ description: 'Submission sweep' }], method_ids: [lab.kf] });
  for (const step of steps) await step(id);
  return id;
}

const SUBMISSION_ACTIONS = {
  acknowledge: (c, id) => c.post(`/api/portal-admin/submissions/${id}/acknowledge`, { note: 'Expecting it Tuesday' }),
  decline: (c, id) => c.post(`/api/portal-admin/submissions/${id}/decline`, { reason: 'We do not run that test' }),
  receive: (c, id) => c.post(`/api/portal-admin/submissions/${id}/receive`, {}),
};

const CLIENT_SUBMISSION_ACTIONS = {
  withdraw: (c, id) => c.post(`/api/portal/submissions/${id}/withdraw`),
};

const staffDoes = (username, action) => async (id) => assert.ok((await SUBMISSION_ACTIONS[action](await as(username), id)).status < 300, `${username} ${action}`);

const SUBMISSION_STATES = {
  submitted: [],
  acknowledged: [staffDoes('priya.raman', 'acknowledge')],
  received: [staffDoes('priya.raman', 'acknowledge'), staffDoes('priya.raman', 'receive')],
  declined: [staffDoes('priya.raman', 'decline')],
  withdrawn: [async (id) => (await asContact(LAURA)).ok('POST', `/api/portal/submissions/${id}/withdraw`)],
};

const SUBMISSION_PEOPLE = {
  'a manager, who responds and receives': 'priya.raman',
  'QA, who responds but does not receive': 'daniel.okafor',
  'an analyst, who receives but does not respond': ANALYST,
  'the administrator, who does neither': 'admin',
};

/** Reads `can` as `c`, tries every withheld action on the record and every offered one on a fresh record. */
async function sweepRecord({ label, c, table, actions, can, id, prepare }) {
  const names = Object.keys(actions);
  assert.deepEqual(names.filter((a) => typeof can?.[a] !== 'boolean'), [], `${label}: every action has a flag`);
  for (const action of names.filter((a) => !can[a])) {
    const r = await actions[action](c, id);
    assert.ok(refused(r), `${label}: ${action} is not offered but was accepted (${describe(r)})`);
  }
  for (const action of names) {
    note(table, action, can[action]);
    if (!can[action]) continue;
    const r = await actions[action](c, await prepare());
    assert.ok(r.status < 300, `${label}: ${action} is offered but was refused (${describe(r)})`);
  }
}

for (const [state, steps] of Object.entries(SUBMISSION_STATES)) {
  test(`a client submission ${state}: offers and refusals agree for lab staff and client contacts`, async () => {
    const prepare = () => prepareSubmission(steps);
    for (const [who, username] of Object.entries(SUBMISSION_PEOPLE)) {
      const c = await as(username);
      const id = await prepare();
      const { can } = await c.ok('GET', `/api/portal-admin/submissions/${id}`);
      await sweepRecord({ label: `Submission ${state}, ${who}`, c, table: 'SUBMISSION_RULES', actions: SUBMISSION_ACTIONS, can, id, prepare });
    }

    const laura = await asContact(LAURA);
    const id = await prepare();
    const { can } = await laura.ok('GET', `/api/portal/submissions/${id}`);
    await sweepRecord({ label: `Submission ${state}, a contact of its client`, c: laura, table: 'CLIENT_SUBMISSION_RULES', actions: CLIENT_SUBMISSION_ACTIONS, can, id, prepare });

    // Another client's contact is told the submission does not exist, so learns nothing about it.
    const felix = await asContact(FELIX);
    const theirs = await prepare();
    assert.equal((await felix.get(`/api/portal/submissions/${theirs}`)).status, 404, `Submission ${state}, a contact of another client: read`);
    const r = await CLIENT_SUBMISSION_ACTIONS.withdraw(felix, theirs);
    assert.equal(r.status, 404, `Submission ${state}, a contact of another client: withdraw (${describe(r)})`);
    assert.equal(r.data.error, 'Submission not found');
  });
}

// Laura asks for method work; the manager moves the request on through the same actions the sweep tries.
async function prepareRequest(steps) {
  const { id } = await (await asContact(LAURA)).ok('POST', '/api/portal/requests', { type: 'Method validation', title: 'Request sweep' });
  for (const step of steps) {
    const r = await REQUEST_ACTIONS[step](await as('priya.raman'), id);
    assert.ok(r.status < 300, `priya.raman ${step} → ${describe(r)}`);
  }
  return id;
}

const requestStatus = (status) => Object.assign((c, id) => c.post(`/api/portal-admin/requests/${id}/status`, { status, response: `${status}: details by email` }), { to: status });

const REQUEST_ACTIONS = {
  review: requestStatus('Under review'),
  propose: requestStatus('Proposal sent'),
  accept: requestStatus('Accepted'),
  decline: requestStatus('Declined'),
  reply: (c, id) => c.post(`/api/portal-admin/requests/${id}/status`, { response: 'Can you send the current procedure?' }),
  openProject: (c, id) => c.post(`/api/portal-admin/requests/${id}/project`, { status: 'Quoted' }),
};

const REQUEST_STATES = {
  submitted: [],
  'under review': ['review'],
  'proposal sent': ['propose'],
  accepted: ['propose', 'accept'],
  'accepted with a Project': ['propose', 'accept', 'openProject'],
  declined: ['decline'],
};

const REQUEST_PEOPLE = {
  'a manager, who responds and opens Projects': 'priya.raman',
  'QA, who responds but does not open Projects': 'daniel.okafor',
  'the administrator, who opens Projects but does not respond': 'admin',
  'an analyst, who does neither': ANALYST,
};

for (const [state, steps] of Object.entries(REQUEST_STATES)) {
  test(`a client request ${state}: offers and refusals agree for lab staff`, async () => {
    const prepare = () => prepareRequest(steps);
    for (const [who, username] of Object.entries(REQUEST_PEOPLE)) {
      const c = await as(username);
      const id = await prepare();
      const { can, request } = await c.ok('GET', `/api/portal-admin/requests/${id}`);
      const label = `Request ${state}, ${who}`;
      // Posting the status the request already has changes nothing, so it is a reply rather than the move to that status.
      const stay = Object.values(REQUEST_ACTIONS).find((act) => act.to === request.status);
      const moves = Object.fromEntries(Object.entries(REQUEST_ACTIONS).filter(([, act]) => act !== stay));
      await sweepRecord({ label, c, table: 'REQUEST_RULES', actions: moves, can, id, prepare });
      if (stay) assert.equal((await stay(c, id)).status < 300, can.reply, `${label}: posting its own status is a reply`);
    }
  });
}

// ----- Coverage -----

/** Every rules or Queue table exported by a server module, by name, as `suffix` picks. Importing them opens no database. */
async function exportedTables(suffix) {
  const tables = {};
  for (const dir of ['../server/', '../server/routes/']) {
    const url = new URL(dir, import.meta.url);
    for (const file of fs.readdirSync(url).filter((f) => f.endsWith('.js'))) {
      for (const [name, value] of Object.entries(await import(new URL(file, url)))) if (name.endsWith(suffix)) tables[name] = value;
    }
  }
  return tables;
}

test('the sweep saw every rule of every rules table both offered and withheld', () => {
  for (const [table, rules] of Object.entries(TABLES)) {
    for (const rule of Object.keys(rules)) {
      assert.ok(seen[table]?.[rule], `${table}.${rule} has no entry in the agreement sweep`);
      assert.deepEqual([...seen[table][rule]].sort(), [false, true], `${table}.${rule} was not seen both offered and withheld`);
    }
  }
  for (const [table, rules] of Object.entries(seen)) {
    for (const rule of Object.keys(rules)) assert.ok(TABLES[table]?.[rule], `${table}.${rule} is swept but has no rule behind its flag`);
  }
});

test('the sweep saw every Queue of every Queue table both listing and not listing a record', () => {
  const queues = Object.entries(QUEUES).flatMap(([table, byName]) => Object.entries(byName).map(([name, queue]) => ({ table, name, queue })));
  for (const { table, name, queue } of queues) {
    const rules = table.replace(/_QUEUES$/, '_RULES');
    assert.ok(TABLES[rules] && Object.hasOwn(TABLES[rules], queue.rule), `${table}.${name} names ${queue.rule}, which ${rules} lacks`);
  }
  for (const { table, name } of queues) {
    assert.deepEqual([...(sighted[table]?.[name] ?? [])].sort(), [false, true], `${table}.${name} was not seen both listing and not listing a record`);
  }
});
