// Samples and tests: receipt, Sample editing, custody, and the screens and lists over them.
// The Test workflow itself (assign → results → submit → review → approve → CoA) lives in ../workflow.js.

import { all, get, run, ph, tx } from '../db.js';
import { insert, update, nextCode, mustGet } from '../repo.js';
import { audit } from '../audit.js';
import { bad, guard, flags, queued } from '../http.js';
import { assertCan, can } from '../auth.js';
import { getNumber, getSettings } from '../settings.js';
import {
  SAMPLE_TYPES, STORAGE_CONDITIONS, RECEIPT_CONDITIONS, PRIORITIES, CUSTODY_ACTIONS, METHOD_USABLE, SAMPLE_OPEN, rolesWith,
} from '../lookups.js';
import { clean, nowIso, today, addBusinessDays, dateOf, idList, likeTerm, limitParam, round } from '../util.js';
import {
  TEST_SELECT, TEST_QUEUES, TEST_RULES, SAMPLE_RULES, TEST_OPEN, getTest, isQualified, instrumentProblem, materialProblem, refreshSampleStatus,
  unassignedTests, assignTests, claimTest, startTest, saveResults, submitTest, reviewTest, approveTest, cancelTest, issueReport, cancelSample,
} from '../workflow.js';
import { OPEN_ON_SAMPLE, INVESTIGATION_RULES } from '../investigations.js';
import { PROJECT_RULES } from './business.js';
import { ENTRY_QUEUES, ENTRY_RULES } from '../notebook.js';

const SAMPLE_SELECT = `
  SELECT s.*, c.name AS client_name, c.code AS client_code, p.code AS project_code, p.title AS project_title,
    u.full_name AS received_by_name,
    (SELECT COUNT(*) FROM tests t WHERE t.sample_id = s.id AND t.status != 'Cancelled') AS test_count,
    (SELECT COUNT(*) FROM tests t WHERE t.sample_id = s.id AND t.status = 'Approved') AS tests_approved,
    (SELECT COALESCE(MAX(t.oos), 0) FROM tests t WHERE t.sample_id = s.id AND t.status != 'Cancelled') AS has_oos
  FROM samples s
  JOIN clients c ON c.id = s.client_id
  LEFT JOIN projects p ON p.id = s.project_id
  LEFT JOIN users u ON u.id = s.received_by`;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function loadUsableMethods(ids) {
  return ids.map((id) => {
    const m = get('SELECT * FROM methods WHERE id = ?', id);
    if (!m) throw bad('Unknown method selected');
    if (!METHOD_USABLE.includes(m.status)) throw bad(`${m.code} v${m.version} is ${m.status.toLowerCase()} and cannot be used for testing`);
    if (!get('SELECT 1 FROM method_analytes WHERE method_id = ?', m.id)) throw bad(`${m.code} has no result parameters defined yet`);
    return m;
  });
}

function surchargePct(priority) {
  if (priority === 'Rush') return getNumber('rush_surcharge_pct');
  if (priority === 'Urgent') return getNumber('urgent_surcharge_pct');
  return 0;
}

const priceFor = (method, priority) => round(method.price * (1 + surchargePct(priority) / 100), 2);

export function defaultDueDate(fromDate, methods, priority) {
  const tat = methods.length ? Math.max(...methods.map((m) => m.tat_days || 5)) : 10;
  const days = priority === 'Urgent' ? Math.min(2, tat) : priority === 'Rush' ? Math.ceil(tat / 2) : tat;
  return addBusinessDays(fromDate, days);
}

export function createTest(ctx, sample, method, { due, priority }) {
  const code = nextCode('T', { pad: 5 });
  const id = insert(ctx, 'tests', {
    code, sample_id: sample.id, method_id: method.id, status: 'Pending', due_date: due, price: priceFor(method, priority), created_at: nowIso(),
  }, { summary: `${method.code} v${method.version} requested on ${sample.code}` });
  for (const a of all('SELECT * FROM method_analytes WHERE method_id = ? ORDER BY sort_order, id', method.id)) {
    run(
      'INSERT INTO results (test_id, analyte, unit, result_type, spec_min, spec_max, spec_text, decimals, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, a.name, a.unit, a.result_type, a.spec_min, a.spec_max, a.spec_text, a.decimals, a.sort_order,
    );
  }
  return id;
}

// ---------------------------------------------------------------------------------------------
// Sample services
// ---------------------------------------------------------------------------------------------

/** Refuses filing a Sample of client `clientId` under Project `projectId` unless it is that client's and the Project's receive rule allows it. */
function assertProjectTakes(ctx, projectId, clientId) {
  const p = get('SELECT * FROM projects WHERE id = ?', projectId);
  if (p.client_id !== clientId) throw bad('That project belongs to a different client');
  guard(PROJECT_RULES.receive(p, ctx.user));
}

export function receiveSamples(ctx, body) {
  assertCan(ctx, 'samples.receive');
  const common = clean(body, {
    client_id: { type: 'id', ref: 'clients', required: true },
    project_id: { type: 'id', ref: 'projects' },
    sample_type: { type: 'enum', values: SAMPLE_TYPES },
    storage: { type: 'enum', values: STORAGE_CONDITIONS },
    location: { label: 'storage location' },
    condition: { type: 'enum', values: RECEIPT_CONDITIONS, default: 'Acceptable' },
    priority: { type: 'enum', values: PRIORITIES, default: 'Standard' },
    received_at: { type: 'datetime', default: nowIso },
    due_date: { type: 'date' },
    notes: { type: 'text' },
  });
  if (common.project_id) assertProjectTakes(ctx, common.project_id, common.client_id);
  const rows = (Array.isArray(body.samples) ? body.samples : [])
    .filter((s) => s && typeof s === 'object' && Object.values(s).some((v) => String(v ?? '').trim()))
    .map((s, i) => clean(s, {
      description: { required: true, label: `sample ${i + 1} description` },
      batch_no: {}, client_ref: {}, quantity: {}, container: {},
    }));
  if (!rows.length) throw bad('Add at least one sample');
  if (rows.length > 200) throw bad('Receive at most 200 samples at a time');
  const methods = loadUsableMethods(idList(body.method_ids));
  const due = common.due_date || defaultDueDate(dateOf(common.received_at), methods, common.priority);

  const created = tx(() => rows.map((row) => {
    const code = nextCode('S');
    const id = insert(ctx, 'samples', {
      code, ...common, ...row, due_date: due, status: 'Received', received_by: ctx.user.id, created_at: nowIso(),
    }, { summary: 'Sample received' });
    run(
      'INSERT INTO custody_events (sample_id, action, location, note, user_id, at) VALUES (?, ?, ?, ?, ?, ?)',
      id, 'Received', common.location, common.condition !== 'Acceptable' ? `Condition on receipt: ${common.condition}` : null, ctx.user.id, common.received_at,
    );
    for (const m of methods) createTest(ctx, { id, code }, m, { due, priority: common.priority });
    return { id, code };
  }));
  return { samples: created, due_date: due };
}

export function addTestsToSample(ctx, sampleId, methodIds) {
  const s = mustGet('SELECT * FROM samples WHERE id = ?', sampleId, 'Sample');
  guard(SAMPLE_RULES.addTests(s, ctx.user));
  const methods = loadUsableMethods(idList(methodIds));
  if (!methods.length) throw bad('Choose at least one method');
  return tx(() => {
    const ids = methods.map((m) => createTest(ctx, s, m, { due: s.due_date || defaultDueDate(today(), [m], s.priority), priority: s.priority }));
    refreshSampleStatus(ctx, s.id);
    return { ids };
  });
}

/** The Tests in the signed-in person's Test Queue `name`: none for someone without its permission, never a refusal. */
function workFilter(ctx, name) {
  if (!Object.hasOwn(TEST_QUEUES, name)) throw bad(`Work filter must be one of: ${Object.keys(TEST_QUEUES).join(', ')}`);
  return queued(TEST_RULES, TEST_QUEUES[name], ctx.user);
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

export default function routes(r) {
  // ----- Samples -----
  r.get('/api/samples', (ctx) => {
    const q = ctx.query;
    const where = [];
    const params = [];
    if (q.status === 'open') { where.push(`s.status IN (${ph(SAMPLE_OPEN)})`); params.push(...SAMPLE_OPEN); }
    else if (q.status && q.status !== 'all') { where.push('s.status = ?'); params.push(q.status); }
    if (q.client_id) { where.push('s.client_id = ?'); params.push(+q.client_id); }
    if (q.project_id) { where.push('s.project_id = ?'); params.push(+q.project_id); }
    if (q.priority) { where.push('s.priority = ?'); params.push(q.priority); }
    if (q.overdue) { where.push(`s.due_date < ? AND s.status IN (${ph(SAMPLE_OPEN)})`); params.push(today(), ...SAMPLE_OPEN); }
    if (q.work) {
      const ids = [...new Set(workFilter(ctx, q.work).map((t) => t.sample_id))];
      where.push(`s.id IN (${ph(ids)})`);
      params.push(...ids);
    }
    if (q.q) {
      const t = likeTerm(q.q);
      where.push(`(s.code LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\' OR s.batch_no LIKE ? ESCAPE '\\' OR s.client_ref LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')`);
      params.push(t, t, t, t, t);
    }
    const limit = limitParam(q.limit, 500, 2000);
    return all(`${SAMPLE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.id DESC LIMIT ${limit}`, ...params);
  });

  r.post('/api/samples/receive', (ctx) => receiveSamples(ctx, ctx.body));

  r.get('/api/samples/labels', (ctx) => {
    const ids = idList(ctx.query.ids);
    if (!ids.length) return [];
    return all(`SELECT s.id, s.code, s.description, s.batch_no, s.storage, s.received_at, s.due_date, s.priority, s.location, c.code AS client_code, c.name AS client_name
      FROM samples s JOIN clients c ON c.id = s.client_id WHERE s.id IN (${ph(ids)}) ORDER BY s.id`, ...ids);
  });

  r.get('/api/samples/:id', (ctx) => {
    const id = +ctx.params.id;
    const sample = mustGet(`${SAMPLE_SELECT} WHERE s.id = ?`, id, 'Sample');
    const tests = all(`${TEST_SELECT} WHERE t.sample_id = ? ORDER BY t.id`, id);
    const results = tests.length ? all(`SELECT * FROM results WHERE test_id IN (${ph(tests)}) ORDER BY sort_order, id`, ...tests.map((t) => t.id)) : [];
    for (const t of tests) t.results = results.filter((x) => x.test_id === t.id);
    return {
      sample,
      tests,
      assignable: unassignedTests(id, ctx.user).map((t) => t.id),
      custody: all(`SELECT ce.*, u.full_name FROM custody_events ce LEFT JOIN users u ON u.id = ce.user_id WHERE ce.sample_id = ? ORDER BY ce.at DESC, ce.id DESC`, id),
      notebook: all(`SELECT n.id, n.code, n.title, n.status, u.full_name AS author_name, n.created_at FROM notebook_entries n JOIN users u ON u.id = n.author_id WHERE n.sample_id = ? ORDER BY n.id DESC`, id),
      investigations: all(`SELECT id, code, type, title, status, severity FROM investigations WHERE sample_id = ? ORDER BY id DESC`, id),
      signatures: all(`SELECT * FROM signatures WHERE entity = 'samples' AND entity_id = ? ORDER BY id`, id),
      can: flags(SAMPLE_RULES, sample, ctx.user),
    };
  });

  r.put('/api/samples/:id', (ctx) => {
    const id = +ctx.params.id;
    const s = mustGet('SELECT * FROM samples WHERE id = ?', id, 'Sample');
    guard(SAMPLE_RULES.edit(s, ctx.user));
    const b = clean(ctx.body, {
      description: { required: true }, sample_type: { type: 'enum', values: SAMPLE_TYPES }, batch_no: {}, client_ref: {},
      quantity: {}, container: {}, storage: { type: 'enum', values: STORAGE_CONDITIONS }, priority: { type: 'enum', values: PRIORITIES },
      due_date: { type: 'date' }, notes: { type: 'text' }, project_id: { type: 'id', ref: 'projects' },
    }, { partial: true });
    if (b.project_id && b.project_id !== s.project_id) assertProjectTakes(ctx, b.project_id, s.client_id);
    const reason = String(ctx.body.reason || '').trim();
    if (s.status !== 'Received' && !reason) throw bad('Testing has started on this sample — give a reason for the change', 'REASON_REQUIRED');
    update(ctx, 'samples', id, b, { summary: 'Sample details edited', reason: reason || null });
    return { ok: true };
  });

  r.post('/api/samples/:id/custody', (ctx) => {
    const id = +ctx.params.id;
    const s = mustGet('SELECT * FROM samples WHERE id = ?', id, 'Sample');
    const b = clean(ctx.body, { action: { type: 'enum', values: CUSTODY_ACTIONS, required: true }, location: {}, note: { type: 'text' } });
    guard(SAMPLE_RULES[b.action === 'Disposed' ? 'dispose' : 'custody'](s, ctx.user));
    tx(() => {
      run('INSERT INTO custody_events (sample_id, action, location, note, user_id, at) VALUES (?, ?, ?, ?, ?, ?)', id, b.action, b.location, b.note, ctx.user.id, nowIso());
      const patch = {};
      if (b.location) patch.location = b.location;
      if (b.action === 'Disposed') patch.status = 'Disposed';
      update(ctx, 'samples', id, patch, { action: 'CUSTODY', summary: `Custody: ${b.action}${b.location ? ` → ${b.location}` : ''}`, reason: b.note, extraChanges: { custody: [null, b.action] } });
    });
    return { ok: true };
  });

  r.post('/api/samples/:id/tests', (ctx) => addTestsToSample(ctx, +ctx.params.id, ctx.body.method_ids));

  r.post('/api/samples/:id/cancel', (ctx) => cancelSample(ctx, +ctx.params.id, ctx.body));

  r.post('/api/samples/:id/report', (ctx) => issueReport(ctx, +ctx.params.id, ctx.body));

  r.get('/api/samples/:id/coa', (ctx) => {
    const id = +ctx.params.id;
    const sample = mustGet(`
      SELECT s.*, c.name AS client_name, c.code AS client_code, c.address AS client_address, c.contact_name,
        p.code AS project_code, p.title AS project_title, p.po_number, u.full_name AS received_by_name
      FROM samples s JOIN clients c ON c.id = s.client_id LEFT JOIN projects p ON p.id = s.project_id
      LEFT JOIN users u ON u.id = s.received_by WHERE s.id = ?`, id, 'Sample');
    const tests = all(`${TEST_SELECT} WHERE t.sample_id = ? AND t.status != 'Cancelled' ORDER BY t.id`, id);
    for (const t of tests) {
      t.results = all('SELECT * FROM results WHERE test_id = ? ORDER BY sort_order, id', t.id);
      t.signatures = all(`SELECT * FROM signatures WHERE entity = 'tests' AND entity_id = ? AND meaning IN ('Performed','Reviewed','Approved') ORDER BY id`, t.id);
      t.reference = get('SELECT reference FROM methods WHERE id = ?', t.method_id)?.reference;
    }
    const all_results = tests.flatMap((t) => t.results);
    return {
      sample,
      tests,
      signatures: all(`SELECT * FROM signatures WHERE entity = 'samples' AND entity_id = ? ORDER BY id`, id),
      lab: getSettings(),
      complies: all_results.length > 0 && all_results.every((x) => ['Pass', 'Report'].includes(x.outcome)),
      final: sample.status === 'Reported',
    };
  });

  // ----- Tests -----
  r.get('/api/tests', (ctx) => {
    const q = ctx.query;
    const where = [];
    const params = [];
    if (q.scope === 'open') { where.push(`t.status IN (${ph(TEST_OPEN)})`); params.push(...TEST_OPEN); }
    if (q.status) { const list = String(q.status).split(','); where.push(`t.status IN (${ph(list)})`); params.push(...list); }
    if (q.work) { const ids = workFilter(ctx, q.work).map((t) => t.id); where.push(`t.id IN (${ph(ids)})`); params.push(...ids); }
    if (q.analyst_id) { where.push('t.analyst_id = ?'); params.push(+q.analyst_id); }
    if (q.unassigned) where.push('t.analyst_id IS NULL');
    if (q.method_id) { where.push('t.method_id = ?'); params.push(+q.method_id); }
    if (q.sample_id) { where.push('t.sample_id = ?'); params.push(+q.sample_id); }
    if (q.instrument_id) { where.push('t.instrument_id = ?'); params.push(+q.instrument_id); }
    if (q.overdue) { where.push(`t.due_date < ? AND t.status IN (${ph(TEST_OPEN)})`); params.push(today(), ...TEST_OPEN); }
    if (q.q) {
      const t = likeTerm(q.q);
      where.push(`(t.code LIKE ? ESCAPE '\\' OR s.code LIKE ? ESCAPE '\\' OR m.code LIKE ? ESCAPE '\\' OR m.title LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\')`);
      params.push(t, t, t, t, t);
    }
    const limit = limitParam(q.limit, 1000, 3000);
    const order = q.scope === 'open' ? `CASE s.priority WHEN 'Urgent' THEN 0 WHEN 'Rush' THEN 1 ELSE 2 END, t.due_date, t.id` : 't.id DESC';
    return all(`${TEST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ${limit}`, ...params);
  });

  r.post('/api/tests/assign', (ctx) => assignTests(ctx, ctx.body));

  r.get('/api/tests/:id', (ctx) => {
    const id = +ctx.params.id;
    const test = getTest(id);
    const me = ctx.user;
    const qualifiedMe = isQualified(me.id, test.method_code);
    const method = get('SELECT id, code, version, title, technique, procedure, reference, scope, status FROM methods WHERE id = ?', test.method_id);
    const investigations = all(`SELECT v.id, v.test_id, v.code, v.type, v.title, v.status, v.description, v.raised_at, v.root_cause, v.conclusion, v.closed_at, cb.full_name AS closed_by_name
      FROM investigations v LEFT JOIN users cb ON cb.id = v.closed_by WHERE v.test_id = ? ORDER BY v.id DESC`, id);
    // Each Investigation can be closed from its card on the Test page, so its closure signature is shown here too.
    for (const v of investigations) {
      v.signatures = all(`SELECT full_name, meaning, signed_at FROM signatures WHERE entity = 'investigations' AND entity_id = ? ORDER BY id`, v.id);
      v.can = flags(INVESTIGATION_RULES, v, me);
    }
    const performers = rolesWith('tests.perform');
    return {
      test,
      method,
      results: all('SELECT r.*, u.full_name AS entered_by_name FROM results r LEFT JOIN users u ON u.id = r.entered_by WHERE r.test_id = ? ORDER BY r.sort_order, r.id', id),
      materials: all('SELECT i.* FROM test_materials tm JOIN inventory i ON i.id = tm.inventory_id WHERE tm.test_id = ? ORDER BY i.code', id),
      signatures: all(`SELECT * FROM signatures WHERE entity = 'tests' AND entity_id = ? ORDER BY id`, id),
      investigations,
      instruments: all(`SELECT id, code, name, type, status, calibration_due FROM instruments WHERE status != 'Retired' OR id = ? ORDER BY code`, test.instrument_id).map((i) => ({ ...i, problem: instrumentProblem(i) })),
      // Materials used before with this method are suggested first.
      inventory: all(`SELECT i.id, i.code, i.name, i.category, i.lot_no, i.potency, i.expiry_date, i.status,
          (SELECT COUNT(*) FROM test_materials tm JOIN tests x ON x.id = tm.test_id JOIN methods mm ON mm.id = x.method_id
           WHERE tm.inventory_id = i.id AND mm.code = ?) AS used_with_method
        FROM inventory i WHERE i.status = 'Active' OR i.id IN (SELECT inventory_id FROM test_materials WHERE test_id = ?)
        ORDER BY used_with_method DESC, i.category, i.name`, test.method_code, id).map((m) => ({ ...m, problem: materialProblem(m) })),
      analysts: all(`SELECT id, full_name, initials, role FROM users WHERE active = 1 AND role IN (${ph(performers)}) ORDER BY full_name`, ...performers)
        .map((u) => ({ ...u, qualified: isQualified(u.id, test.method_code) })),
      can: flags(TEST_RULES, test, me),
      qualifiedMe,
    };
  });

  r.put('/api/tests/:id', (ctx) => saveResults(ctx, +ctx.params.id, ctx.body));
  r.post('/api/tests/:id/claim', (ctx) => claimTest(ctx, +ctx.params.id));
  r.post('/api/tests/:id/start', (ctx) => startTest(ctx, +ctx.params.id));
  r.post('/api/tests/:id/submit', (ctx) => submitTest(ctx, +ctx.params.id, ctx.body));
  r.post('/api/tests/:id/review', (ctx) => reviewTest(ctx, +ctx.params.id, ctx.body));
  r.post('/api/tests/:id/approve', (ctx) => approveTest(ctx, +ctx.params.id, ctx.body));
  r.post('/api/tests/:id/cancel', (ctx) => cancelTest(ctx, +ctx.params.id, ctx.body.reason));

  // ----- Review queue -----
  r.get('/api/reviews', (ctx) => {
    const lab = ctx.query.scope === 'lab';
    if (lab) assertCan(ctx, 'work.oversee');
    // Oversight shows each stage whoever could act on it; it is nobody's Queue.
    const tests = (name) => (lab ? TEST_QUEUES[name].stage() : queued(TEST_RULES, TEST_QUEUES[name], ctx.user));
    const entries = (name) => (lab ? ENTRY_QUEUES[name].stage() : queued(ENTRY_RULES, ENTRY_QUEUES[name], ctx.user));
    const out = { toReview: tests('review'), toApprove: tests('approval'), toWitness: entries('witness'), toIssue: [] };
    const sees = (perm) => lab || can(ctx.user, perm);
    if (sees('reports.issue')) out.toIssue = all(`${SAMPLE_SELECT} WHERE s.status = 'Approved' AND NOT EXISTS (SELECT 1 FROM investigations v WHERE ${OPEN_ON_SAMPLE}) ORDER BY s.due_date`);
    for (const list of [out.toReview, out.toApprove]) {
      for (const t of list) t.results = all('SELECT analyte, unit, result_type, value_num, value_text, outcome, decimals, spec_min, spec_max, spec_text FROM results WHERE test_id = ? ORDER BY sort_order, id', t.id);
    }
    return out;
  });

  // Audit helper for reads of sensitive printouts (CoA prints are logged so copies are traceable).
  r.post('/api/samples/:id/coa-printed', (ctx) => {
    const s = mustGet('SELECT id, code FROM samples WHERE id = ?', +ctx.params.id, 'Sample');
    audit(ctx, { action: 'PRINT', entity: 'samples', entity_id: s.id, entity_code: s.code, summary: 'Certificate of Analysis printed / exported' });
    return { ok: true };
  });
}
