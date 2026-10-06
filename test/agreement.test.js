// The agreement sweep: an action offered on a record is accepted, one withheld is refused, and a Test sits in a
// person's queue and badge exactly when they are offered the matching action. Every rules table the server exports is
// swept: the last test fails if any rule was never seen both offered and withheld.
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
const TABLES = await rulesTables();

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aliquot-test-'));
  server = await startServer(dataDir);
  BASE = server.base;
  const setup = await new Client().post('/api/setup', { mode: 'demo' });
  assert.equal(setup.status, 200, `demo setup failed: ${JSON.stringify(setup.data)} ${server.log()}`);

  const priya = await as('priya.raman');
  lab.client = (await priya.ok('GET', '/api/clients'))[0].id;
  lab.kf = (await priya.ok('GET', '/api/methods?usable=1')).find((m) => m.code === 'ATM-0002' && m.status === 'Effective').id;
  lab.users = Object.fromEntries((await priya.ok('GET', '/api/users')).map((u) => [u.username, u.id]));
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
      await admin.ok('PUT', `/api/users/${userId}`, { role: 'analyst' });
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
};

// Each queue lists a Test exactly when its person is offered this action on it. Approval lists a Test under
// Investigation too, because the approver can still return it.
const QUEUE_FLAG = { assigned: 'edit', review: 'review', approval: 'return' };

const badges = (c) => c.ok('GET', '/api/nav');

async function queues(c, t) {
  const inWork = async (name) => {
    const r = await c.get(`/api/samples?work=${name}`);
    assert.ok([200, 403].includes(r.status), `work=${name} → ${describe(r)}`);
    return r.status === 200 && r.data.some((s) => s.id === t.sampleId);
  };
  const reviews = await c.ok('GET', '/api/reviews');
  const worklist = await c.get('/api/tests?work=assigned');
  assert.ok([200, 403].includes(worklist.status), `Worklist My tests → ${describe(worklist)}`);
  return {
    assigned: await inWork('assigned'),
    worklist: worklist.status === 200 && worklist.data.some((x) => x.id === t.testId),
    worklistIds: worklist.status === 200 ? worklist.data.map((x) => x.id) : [],
    dashboardIds: (await c.ok('GET', '/api/dashboard')).myTests.map((x) => x.id),
    review: await inWork('review'),
    approval: await inWork('approval'),
    toReview: reviews.toReview.some((x) => x.id === t.testId),
    toApprove: reviews.toApprove.some((x) => x.id === t.testId),
  };
}

for (const [state, steps] of Object.entries(TEST_STATES)) {
  test(`a Test ${state}: offers, refusals, queues and badges agree for everyone`, async () => {
    for (const [who, person] of Object.entries(PEOPLE)) {
      const label = `Test ${state}, ${who}`;
      const before = await within(person, badges);
      const t = await prepareTest(steps);
      const { can, queued, after } = await within(person, async (c) => ({
        can: (await c.ok('GET', `/api/tests/${t.testId}`)).can,
        queued: await queues(c, t),
        after: await badges(c),
      }));

      for (const [queue, flag] of Object.entries(QUEUE_FLAG)) assert.equal(queued[queue], can[flag], `${label}: ${queue} queue vs can.${flag}`);
      assert.equal(queued.worklist, can.edit, `${label}: Worklist My tests vs can.edit`);
      // The Dashboard shows the first dozen of the same list.
      assert.deepEqual(queued.dashboardIds.filter((id) => !queued.worklistIds.includes(id)), [], `${label}: Dashboard My tests outside the Worklist`);
      assert.equal(queued.dashboardIds.length, Math.min(12, queued.worklistIds.length), `${label}: Dashboard My tests vs Worklist`);
      assert.equal(queued.toReview, can.review, `${label}: Reviews page review list vs can.review`);
      assert.equal(queued.toApprove, can.return, `${label}: Reviews page approval list vs can.return`);
      assert.equal(after.myTests - before.myTests, can.edit ? 1 : 0, `${label}: My tests badge vs can.edit`);
      assert.equal(after.reviews - before.reviews, can.review || can.return ? 1 : 0, `${label}: Reviews badge vs can.review / can.return`);

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
  test(`a Sample ${state}: offers, refusals and the certificate queue agree for everyone`, async () => {
    for (const username of SAMPLE_PEOPLE) {
      const label = `Sample ${state}, ${username}`;
      const c = await as(username);
      const s = await prepareSample(spec);
      const { can } = await c.ok('GET', `/api/samples/${s}`);
      const toIssue = (await c.ok('GET', '/api/reviews')).toIssue.some((x) => x.id === s);
      assert.equal(toIssue, can.issue, `${label}: certificate queue vs can.issue`);

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

// ----- File sweep -----

// Each attachable record type, in states that lock its files and states that don't. A state creates a fresh record;
// the uploader attaches a file while it is open, then `then` moves it on, so removal can be tried once it is locked.
let unique = 0;
const code = (prefix) => `${prefix}${process.pid % 1000}${++unique}`;
const signedAs = (username, url, body = {}) => async (id) => (await as(username)).ok('POST', url(id), { ...body, password: PASSWORD });
const newMethod = async () => (await (await as('sarah.lindqvist')).ok('POST', '/api/methods', { title: 'Water by coulometric KF', technique: 'Karl Fischer', analytes: [{ name: 'Water', unit: '%', spec_max: 0.5 }] })).id;
const makeEffective = signedAs('daniel.okafor', (id) => `/api/methods/${id}/status`, { status: 'Effective' });
const newProject = async () => (await (await as('marco.bianchi')).ok('POST', '/api/projects', { client_id: lab.client, title: 'File sweep', type: 'Other' })).id;
const projectStatus = (status) => async (id) => (await as('priya.raman')).ok('PUT', `/api/projects/${id}`, { status });

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
      completed: { then: projectStatus('Completed') },
      cancelled: { then: projectStatus('Cancelled') },
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

// ----- Coverage -----

/** Every rules table exported by a server module, by name. Importing them opens no database. */
async function rulesTables() {
  const tables = {};
  for (const dir of ['../server/', '../server/routes/']) {
    const url = new URL(dir, import.meta.url);
    for (const file of fs.readdirSync(url).filter((f) => f.endsWith('.js'))) {
      for (const [name, value] of Object.entries(await import(new URL(file, url)))) if (name.endsWith('_RULES')) tables[name] = value;
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
});
