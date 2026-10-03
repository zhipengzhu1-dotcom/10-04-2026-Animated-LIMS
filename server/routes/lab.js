// Samples and tests: the core laboratory workflow.
//
//   Sample received → tests requested → analyst assigned → results entered → submitted (e-signed)
//   → peer review (e-signed, different person) → QA approval (e-signed, third person) → CoA issued (e-signed)
//
// Controls enforced here: qualification on the method, instruments within calibration, standards/reagents
// within expiry, a reason for every change to a recorded result, and automatic OOS investigations.

import { all, get, run, tx } from '../db.js';
import { insert, update, nextCode, mustGet } from '../repo.js';
import { audit } from '../audit.js';
import { bad, forbidden } from '../http.js';
import { assertCan, can, verifySignature, applySignature } from '../auth.js';
import { getNumber, getSettings } from '../settings.js';
import {
  SAMPLE_TYPES, STORAGE_CONDITIONS, RECEIPT_CONDITIONS, PRIORITIES, CUSTODY_ACTIONS, METHOD_USABLE, TEST_OPEN, SAMPLE_OPEN,
} from '../lookups.js';
import {
  clean, nowIso, today, addBusinessDays, dateOf, idList, likeTerm, limitParam, round, sameValue, fixed, specText,
} from '../util.js';

const ph = (arr) => arr.map(() => '?').join(',');

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

export const TEST_SELECT = `
  SELECT t.*, s.code AS sample_code, s.description AS sample_description, s.batch_no, s.priority, s.client_id, s.project_id,
    c.code AS client_code, c.name AS client_name,
    m.code AS method_code, m.version AS method_version, m.title AS method_title, m.technique,
    a.full_name AS analyst_name, a.initials AS analyst_initials,
    rv.full_name AS reviewer_name, ap.full_name AS approver_name,
    i.code AS instrument_code, i.name AS instrument_name
  FROM tests t
  JOIN samples s ON s.id = t.sample_id
  JOIN clients c ON c.id = s.client_id
  JOIN methods m ON m.id = t.method_id
  LEFT JOIN users a ON a.id = t.analyst_id
  LEFT JOIN users rv ON rv.id = t.reviewed_by
  LEFT JOIN users ap ON ap.id = t.approved_by
  LEFT JOIN instruments i ON i.id = t.instrument_id`;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

export function isQualified(userId, methodCode) {
  return !!get(
    `SELECT 1 FROM qualifications WHERE user_id = ? AND method_code = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at >= ?)`,
    userId, methodCode, today(),
  );
}

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

export function evaluateNumeric(row, value) {
  if (value == null) return 'Pending';
  if (row.spec_min == null && row.spec_max == null) return 'Report';
  // Round to the reported precision before comparing with the limits (USP General Notices 7.20).
  const v = round(value, row.decimals ?? 2);
  if (row.spec_min != null && v < row.spec_min) return 'Fail';
  if (row.spec_max != null && v > row.spec_max) return 'Fail';
  return 'Pass';
}

function instrumentProblem(i) {
  if (!i) return 'Unknown instrument';
  if (['Out of Service', 'Maintenance', 'Retired'].includes(i.status)) return `${i.code} is ${i.status.toLowerCase()}`;
  if (i.calibration_due && i.calibration_due < today()) return `${i.code} calibration expired on ${i.calibration_due}`;
  return null;
}

function materialProblem(m) {
  if (!m) return 'Unknown material';
  if (m.status !== 'Active') return `${m.code} is ${m.status.toLowerCase()}`;
  if (m.expiry_date && m.expiry_date < today()) return `${m.code} (${m.name}) expired on ${m.expiry_date}`;
  return null;
}

export function refreshSampleStatus(ctx, sampleId) {
  const s = get('SELECT id, status FROM samples WHERE id = ?', sampleId);
  if (!s || ['Reported', 'Disposed', 'Cancelled'].includes(s.status)) return;
  const tests = all(`SELECT status FROM tests WHERE sample_id = ? AND status != 'Cancelled'`, sampleId);
  let status = 'Received';
  if (tests.length && tests.every((t) => t.status === 'Approved')) status = 'Approved';
  else if (tests.length && tests.every((t) => ['Submitted', 'Reviewed', 'Approved'].includes(t.status))) status = 'In Review';
  else if (tests.some((t) => t.status !== 'Pending')) status = 'In Testing';
  if (status !== s.status) update(ctx, 'samples', sampleId, { status }, { action: 'STATUS', summary: `Sample status → ${status}` });
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

function getTest(id) {
  return mustGet(`${TEST_SELECT} WHERE t.id = ?`, id, 'Test');
}

function openSampleInvestigation(sampleId) {
  return get(`SELECT code FROM investigations WHERE status != 'Closed' AND (sample_id = ? OR test_id IN (SELECT id FROM tests WHERE sample_id = ?)) LIMIT 1`, sampleId, sampleId);
}

function openInvestigation(testId) {
  return get(`SELECT id, code, status FROM investigations WHERE test_id = ? AND status != 'Closed' ORDER BY id DESC LIMIT 1`, testId);
}

// ---------------------------------------------------------------------------------------------
// Sample services
// ---------------------------------------------------------------------------------------------

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
  if (common.project_id) {
    const p = get('SELECT client_id, status FROM projects WHERE id = ?', common.project_id);
    if (p.client_id !== common.client_id) throw bad('That project belongs to a different client');
    if (['Completed', 'Cancelled'].includes(p.status)) throw bad(`That project is ${p.status.toLowerCase()} — reopen it before receiving samples`);
  }
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
  assertCan(ctx, 'samples.receive');
  const s = mustGet('SELECT * FROM samples WHERE id = ?', sampleId, 'Sample');
  if (!SAMPLE_OPEN.includes(s.status)) throw bad(`Sample is ${s.status.toLowerCase()} — tests can no longer be added`);
  const methods = loadUsableMethods(idList(methodIds));
  if (!methods.length) throw bad('Choose at least one method');
  return tx(() => {
    const ids = methods.map((m) => createTest(ctx, s, m, { due: s.due_date || defaultDueDate(today(), [m], s.priority), priority: s.priority }));
    refreshSampleStatus(ctx, s.id);
    return { ids };
  });
}

export function issueReport(ctx, sampleId, body) {
  assertCan(ctx, 'reports.issue');
  const s = mustGet('SELECT * FROM samples WHERE id = ?', sampleId, 'Sample');
  if (s.status !== 'Approved') throw bad('Every test on this sample must be approved before the certificate can be issued');
  const inv = openSampleInvestigation(s.id);
  if (inv) throw bad(`${inv.code} is still open for this sample — close it before issuing the certificate`);
  verifySignature(ctx, body.password);
  tx(() => {
    applySignature(ctx, 'samples', s.id, 'Certificate of Analysis issued', { comment: body.comment || null, code: s.code });
    update(ctx, 'samples', s.id, { status: 'Reported', reported_at: nowIso() }, { action: 'STATUS', summary: 'Certificate of Analysis issued' });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Test services
// ---------------------------------------------------------------------------------------------

export function assignTests(ctx, body) {
  assertCan(ctx, 'tests.assign');
  const ids = idList(body.test_ids);
  if (!ids.length) throw bad('Select at least one test');
  const analyst = body.analyst_id ? get('SELECT * FROM users WHERE id = ?', +body.analyst_id) : null;
  if (body.analyst_id && (!analyst || !analyst.active || !['analyst', 'scientist', 'manager'].includes(analyst.role))) throw bad('Choose an active analyst');
  const due = body.due_date ? clean(body, { due_date: { type: 'date' } }).due_date : undefined;
  tx(() => {
    for (const id of ids) {
      const t = getTest(id);
      if (!['Pending', 'In Progress'].includes(t.status)) throw bad(`${t.code} is ${t.status.toLowerCase()} and can't be reassigned`);
      if (t.analyst_id && t.analyst_id !== analyst?.id && get('SELECT 1 FROM results WHERE test_id = ? AND entered_at IS NOT NULL', id)) {
        throw bad(`${t.code} already has results entered by ${t.analyst_name} — it can't be ${analyst ? 'reassigned' : 'unassigned'}`);
      }
      if (analyst && !isQualified(analyst.id, t.method_code)) {
        throw bad(`${analyst.full_name} is not qualified on ${t.method_code}. Record their training under Team → Training first.`);
      }
      update(ctx, 'tests', id, { analyst_id: analyst?.id ?? null, due_date: due }, {
        summary: analyst ? `Assigned to ${analyst.full_name}` : 'Unassigned',
      });
    }
  });
  return { ok: true, count: ids.length };
}

export function claimTest(ctx, id) {
  assertCan(ctx, 'tests.perform');
  const t = getTest(id);
  if (t.analyst_id) throw bad(`${t.code} is already assigned to ${t.analyst_name}`);
  if (t.status !== 'Pending') throw bad('Only pending tests can be picked up');
  if (!isQualified(ctx.user.id, t.method_code)) throw forbidden(`You are not qualified on ${t.method_code}`);
  update(ctx, 'tests', id, { analyst_id: ctx.user.id }, { summary: `Picked up by ${ctx.user.full_name}` });
  return { ok: true };
}

export function startTest(ctx, id) {
  assertCan(ctx, 'tests.perform');
  const t = getTest(id);
  if (t.status !== 'Pending') throw bad('This test has already been started');
  if (t.analyst_id !== ctx.user.id) throw forbidden('Only the assigned analyst can start this test');
  if (!isQualified(ctx.user.id, t.method_code)) throw forbidden(`Your qualification on ${t.method_code} is not current`);
  tx(() => {
    update(ctx, 'tests', id, { status: 'In Progress', started_at: nowIso() }, { action: 'STATUS', summary: 'Testing started' });
    refreshSampleStatus(ctx, t.sample_id);
  });
  return { ok: true };
}

export function saveResults(ctx, id, body) {
  assertCan(ctx, 'tests.perform');
  const t = getTest(id);
  if (t.analyst_id !== ctx.user.id) throw forbidden('Only the assigned analyst can record results for this test');
  if (!['Pending', 'In Progress'].includes(t.status)) throw bad(`Results can't be changed while the test is ${t.status.toLowerCase()}`);
  if (!isQualified(ctx.user.id, t.method_code)) throw forbidden(`Your qualification on ${t.method_code} is not current`);

  const fields = clean(body, {
    instrument_id: { type: 'id' },
    raw_data_ref: { label: 'raw data reference' },
    comments: { type: 'text' },
  }, { partial: true });
  if (fields.instrument_id && fields.instrument_id !== t.instrument_id) {
    const problem = instrumentProblem(get('SELECT * FROM instruments WHERE id = ?', fields.instrument_id));
    if (problem) throw bad(`${problem} — it can't be used for testing`);
  }

  const extra = {};
  let newMaterials = null;
  if ('material_ids' in body) {
    newMaterials = idList(body.material_ids);
    const current = all('SELECT inventory_id FROM test_materials WHERE test_id = ?', id).map((r) => r.inventory_id);
    for (const mid of newMaterials) {
      if (current.includes(mid)) continue;
      const problem = materialProblem(get('SELECT * FROM inventory WHERE id = ?', mid));
      if (problem) throw bad(`${problem} — it can't be used`);
    }
    const codes = (list) => list.length ? all(`SELECT code FROM inventory WHERE id IN (${ph(list)}) ORDER BY code`, ...list).map((r) => r.code).join(', ') : null;
    if ([...current].sort().join() !== [...newMaterials].sort().join()) extra['Standards & reagents'] = [codes(current), codes(newMaterials)];
    else newMaterials = null;
  }

  const rows = new Map(all('SELECT * FROM results WHERE test_id = ?', id).map((r) => [r.id, r]));
  const updates = [];
  let modifiesRecorded = false;
  for (const input of Array.isArray(body.results) ? body.results : []) {
    const row = rows.get(Number(input.id));
    if (!row) throw bad('Unknown result line');
    let valueNum = null;
    let valueText = null;
    let outcome;
    if (row.result_type === 'numeric') {
      const raw = String(input.value ?? '').trim().replace(',', '.');
      if (raw !== '') {
        valueNum = Number(raw);
        if (!Number.isFinite(valueNum)) throw bad(`${row.analyte}: enter a number`);
      }
      outcome = evaluateNumeric(row, valueNum);
    } else {
      valueText = String(input.value ?? '').trim() || null;
      if (valueText == null) outcome = 'Pending';
      else if (!row.spec_text) outcome = 'Report';
      else outcome = ['Pass', 'Fail'].includes(input.outcome) ? input.outcome : 'Pending';
    }
    const before = row.result_type === 'numeric' ? row.value_num : row.value_text;
    const after = row.result_type === 'numeric' ? valueNum : valueText;
    if (sameValue(before, after) && outcome === row.outcome) continue;
    if (before != null) modifiesRecorded = true;
    if (!sameValue(before, after)) extra[row.analyte] = [before, after];
    else extra[`${row.analyte} (conformance)`] = [row.outcome, outcome];
    updates.push({ row, valueNum, valueText, outcome });
  }

  const reason = String(body.reason || '').trim();
  if (modifiesRecorded && !reason) throw bad('You are changing a result that was already recorded — give a reason for the change', 'REASON_REQUIRED');

  tx(() => {
    for (const u of updates) {
      run(
        'UPDATE results SET value_num = ?, value_text = ?, outcome = ?, entered_by = ?, entered_at = ? WHERE id = ?',
        u.valueNum, u.valueText, u.outcome, ctx.user.id, nowIso(), u.row.id,
      );
    }
    if (newMaterials) {
      run('DELETE FROM test_materials WHERE test_id = ?', id);
      for (const mid of newMaterials) run('INSERT INTO test_materials (test_id, inventory_id) VALUES (?, ?)', id, mid);
    }
    const patch = { ...fields };
    if (t.status === 'Pending') Object.assign(patch, { status: 'In Progress', started_at: nowIso() });
    update(ctx, 'tests', id, patch, {
      summary: updates.length ? 'Results recorded' : 'Test details updated',
      reason: modifiesRecorded ? reason : null,
      extraChanges: extra,
    });
    if (t.status === 'Pending') refreshSampleStatus(ctx, t.sample_id);
  });
  return { ok: true };
}

function raiseOos(ctx, t, fails) {
  const s = get('SELECT * FROM samples WHERE id = ?', t.sample_id);
  const owner = get(`SELECT id FROM users WHERE role = 'manager' AND active = 1 ORDER BY id LIMIT 1`);
  const lines = fails.map((r) => `- **${r.analyte}**: ${r.result_type === 'numeric' ? `${fixed(r.value_num, r.decimals)} ${r.unit || ''}` : r.value_text} (specification ${specText(r)})`).join('\n');
  const code = nextCode('OOS', { pad: 3 });
  const id = insert(ctx, 'investigations', {
    code, type: 'OOS', severity: 'Major', status: 'Open',
    title: `OOS — ${fails.map((f) => f.analyte).join(', ')} — ${s.code}`,
    test_id: t.id, sample_id: s.id, project_id: s.project_id, instrument_id: t.instrument_id,
    owner_id: owner?.id ?? null, raised_by: ctx.user.id, raised_at: nowIso(), due_date: addBusinessDays(today(), 20),
    description: `Out-of-specification result(s) for ${t.method_code} v${t.method_version} (${t.method_title}) on sample ${s.code}${s.batch_no ? `, batch ${s.batch_no}` : ''}:\n\n${lines}\n\nPhase I laboratory investigation is required before this test can be approved.`,
  }, { summary: 'OOS investigation opened automatically when the result was submitted' });
  return { id, code };
}

export function submitTest(ctx, id, body) {
  assertCan(ctx, 'tests.perform');
  const t = getTest(id);
  if (t.analyst_id !== ctx.user.id) throw forbidden('Only the assigned analyst can submit this test');
  if (t.status !== 'In Progress') throw bad('Only tests in progress can be submitted');
  if (!isQualified(ctx.user.id, t.method_code)) throw forbidden(`Your qualification on ${t.method_code} is not current — you can't sign this test`);
  const results = all('SELECT * FROM results WHERE test_id = ? ORDER BY sort_order, id', id);
  const pending = results.filter((r) => r.outcome === 'Pending');
  if (pending.length) throw bad(`Complete every result before submitting: ${pending.map((r) => r.analyte).join(', ')}`);
  for (const m of all('SELECT i.* FROM test_materials tm JOIN inventory i ON i.id = tm.inventory_id WHERE tm.test_id = ?', id)) {
    const problem = materialProblem(m);
    if (problem) throw bad(`${problem} — replace it in the materials list before submitting`);
  }
  if (!t.instrument_id && !['Physical / Visual', 'Gravimetric'].includes(t.technique)) throw bad('Record the instrument used before submitting');
  if (t.instrument_id) {
    const problem = instrumentProblem(get('SELECT * FROM instruments WHERE id = ?', t.instrument_id));
    if (problem) throw bad(`${problem} — choose another instrument or recalibrate before submitting`);
  }
  verifySignature(ctx, body.password);
  const fails = results.filter((r) => r.outcome === 'Fail');
  return tx(() => {
    applySignature(ctx, 'tests', id, 'Performed', { comment: body.comment || null, code: t.code });
    update(ctx, 'tests', id, { status: 'Submitted', submitted_at: nowIso(), oos: fails.length ? 1 : 0 }, { action: 'STATUS', summary: 'Submitted for review' });
    const investigation = fails.length && !openInvestigation(id) ? raiseOos(ctx, t, fails) : null;
    refreshSampleStatus(ctx, t.sample_id);
    return { ok: true, investigation };
  });
}

export function reviewTest(ctx, id, body) {
  assertCan(ctx, 'tests.review');
  const t = getTest(id);
  if (t.status !== 'Submitted') throw bad('This test is not awaiting review');
  if (t.analyst_id === ctx.user.id) throw forbidden('You performed this test — a different person must review it');
  const accept = body.decision === 'approve';
  const comment = String(body.comment || '').trim() || null;
  if (!accept && !comment) throw bad('Explain why the test is being returned to the analyst', 'REASON_REQUIRED');
  verifySignature(ctx, body.password);
  tx(() => {
    applySignature(ctx, 'tests', id, accept ? 'Reviewed' : 'Returned by reviewer', { comment, code: t.code });
    if (accept) update(ctx, 'tests', id, { status: 'Reviewed', reviewed_by: ctx.user.id, reviewed_at: nowIso() }, { action: 'STATUS', summary: 'Peer review passed' });
    else update(ctx, 'tests', id, { status: 'In Progress', submitted_at: null }, { action: 'STATUS', summary: 'Returned to analyst by reviewer', reason: comment });
    refreshSampleStatus(ctx, t.sample_id);
  });
  return { ok: true };
}

export function approveTest(ctx, id, body) {
  assertCan(ctx, 'tests.approve');
  const t = getTest(id);
  if (t.status !== 'Reviewed') throw bad('This test is not awaiting approval');
  if (t.analyst_id === ctx.user.id) throw forbidden('You performed this test — you cannot approve it');
  if (t.reviewed_by === ctx.user.id) throw forbidden('You reviewed this test — approval must come from a different person');
  const accept = body.decision === 'approve';
  const comment = String(body.comment || '').trim() || null;
  if (!accept && !comment) throw bad('Explain why the test is being returned', 'REASON_REQUIRED');
  if (accept) {
    const inv = openInvestigation(id);
    if (inv) throw bad(`${inv.code} is still open — close the investigation before approving this result`);
  }
  verifySignature(ctx, body.password);
  tx(() => {
    applySignature(ctx, 'tests', id, accept ? 'Approved' : 'Rejected at approval', { comment, code: t.code });
    if (accept) update(ctx, 'tests', id, { status: 'Approved', approved_by: ctx.user.id, approved_at: nowIso() }, { action: 'STATUS', summary: 'Result approved' });
    else update(ctx, 'tests', id, { status: 'In Progress', submitted_at: null, reviewed_by: null, reviewed_at: null }, { action: 'STATUS', summary: 'Returned to analyst at approval', reason: comment });
    refreshSampleStatus(ctx, t.sample_id);
  });
  return { ok: true };
}

export function cancelTest(ctx, id, reason) {
  assertCan(ctx, 'tests.cancel');
  const t = getTest(id);
  if (['Approved', 'Cancelled'].includes(t.status)) throw bad(`An ${t.status.toLowerCase()} test can't be cancelled`);
  // An out-of-specification result can never be made to disappear by cancelling and retesting.
  const inv = openInvestigation(id);
  if (inv) throw bad(`${inv.code} is open on this test — it must be investigated and closed before the test can be cancelled`);
  if (!String(reason || '').trim()) throw bad('A reason is required to cancel a test', 'REASON_REQUIRED');
  tx(() => {
    update(ctx, 'tests', id, { status: 'Cancelled' }, { action: 'STATUS', summary: 'Test cancelled', reason });
    refreshSampleStatus(ctx, t.sample_id);
  });
  return { ok: true };
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
      custody: all(`SELECT ce.*, u.full_name FROM custody_events ce LEFT JOIN users u ON u.id = ce.user_id WHERE ce.sample_id = ? ORDER BY ce.at DESC, ce.id DESC`, id),
      notebook: all(`SELECT n.id, n.code, n.title, n.status, u.full_name AS author_name, n.created_at FROM notebook_entries n JOIN users u ON u.id = n.author_id WHERE n.sample_id = ? ORDER BY n.id DESC`, id),
      investigations: all(`SELECT id, code, type, title, status, severity FROM investigations WHERE sample_id = ? ORDER BY id DESC`, id),
      signatures: all(`SELECT * FROM signatures WHERE entity = 'samples' AND entity_id = ? ORDER BY id`, id),
      can: {
        edit: can(ctx.user, 'samples.edit') && SAMPLE_OPEN.includes(sample.status),
        addTests: can(ctx.user, 'samples.receive') && SAMPLE_OPEN.includes(sample.status),
        assign: can(ctx.user, 'tests.assign'),
        issue: can(ctx.user, 'reports.issue') && sample.status === 'Approved',
        dispose: can(ctx.user, 'samples.dispose'),
        cancel: can(ctx.user, 'tests.cancel') && SAMPLE_OPEN.includes(sample.status),
        custody: can(ctx.user, 'samples.edit') && !['Disposed', 'Cancelled'].includes(sample.status),
      },
    };
  });

  r.put('/api/samples/:id', (ctx) => {
    assertCan(ctx, 'samples.edit');
    const id = +ctx.params.id;
    const s = mustGet('SELECT * FROM samples WHERE id = ?', id, 'Sample');
    if (!SAMPLE_OPEN.includes(s.status)) throw bad(`This sample is ${s.status.toLowerCase()} and can no longer be edited`);
    const b = clean(ctx.body, {
      description: { required: true }, sample_type: { type: 'enum', values: SAMPLE_TYPES }, batch_no: {}, client_ref: {},
      quantity: {}, container: {}, storage: { type: 'enum', values: STORAGE_CONDITIONS }, priority: { type: 'enum', values: PRIORITIES },
      due_date: { type: 'date' }, notes: { type: 'text' }, project_id: { type: 'id', ref: 'projects' },
    }, { partial: true });
    if (b.project_id && get('SELECT client_id FROM projects WHERE id = ?', b.project_id).client_id !== s.client_id) throw bad('That project belongs to a different client');
    const reason = String(ctx.body.reason || '').trim();
    if (s.status !== 'Received' && !reason) throw bad('Testing has started on this sample — give a reason for the change', 'REASON_REQUIRED');
    update(ctx, 'samples', id, b, { summary: 'Sample details edited', reason: reason || null });
    return { ok: true };
  });

  r.post('/api/samples/:id/custody', (ctx) => {
    const id = +ctx.params.id;
    const s = mustGet('SELECT * FROM samples WHERE id = ?', id, 'Sample');
    const b = clean(ctx.body, { action: { type: 'enum', values: CUSTODY_ACTIONS, required: true }, location: {}, note: { type: 'text' } });
    if (b.action === 'Disposed') {
      assertCan(ctx, 'samples.dispose');
      if (get(`SELECT 1 FROM tests WHERE sample_id = ? AND status IN (${ph(TEST_OPEN)})`, id, ...TEST_OPEN)) throw bad('This sample still has open tests');
    } else {
      assertCan(ctx, 'samples.edit');
    }
    if (['Disposed', 'Cancelled'].includes(s.status) && b.action !== 'Disposed') throw bad(`Sample is ${s.status.toLowerCase()}`);
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

  r.post('/api/samples/:id/cancel', (ctx) => {
    assertCan(ctx, 'tests.cancel');
    const id = +ctx.params.id;
    const s = mustGet('SELECT * FROM samples WHERE id = ?', id, 'Sample');
    const reason = String(ctx.body.reason || '').trim();
    if (!reason) throw bad('A reason is required', 'REASON_REQUIRED');
    if (!SAMPLE_OPEN.includes(s.status)) throw bad(`Sample is already ${s.status.toLowerCase()}`);
    tx(() => {
      for (const t of all(`SELECT id FROM tests WHERE sample_id = ? AND status IN (${ph(TEST_OPEN)})`, id, ...TEST_OPEN)) {
        update(ctx, 'tests', t.id, { status: 'Cancelled' }, { action: 'STATUS', summary: 'Test cancelled with sample', reason });
      }
      update(ctx, 'samples', id, { status: 'Cancelled' }, { action: 'STATUS', summary: 'Sample cancelled', reason });
    });
    return { ok: true };
  });

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
    if (q.mine) { where.push('t.analyst_id = ?'); params.push(ctx.user.id); }
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
    const mine = test.analyst_id === me.id;
    const qualifiedMe = isQualified(me.id, test.method_code);
    const method = get('SELECT id, code, version, title, technique, procedure, reference, scope, status FROM methods WHERE id = ?', test.method_id);
    return {
      test,
      method,
      results: all('SELECT r.*, u.full_name AS entered_by_name FROM results r LEFT JOIN users u ON u.id = r.entered_by WHERE r.test_id = ? ORDER BY r.sort_order, r.id', id),
      materials: all('SELECT i.* FROM test_materials tm JOIN inventory i ON i.id = tm.inventory_id WHERE tm.test_id = ? ORDER BY i.code', id),
      signatures: all(`SELECT * FROM signatures WHERE entity = 'tests' AND entity_id = ? ORDER BY id`, id),
      investigations: all('SELECT id, code, title, status, conclusion FROM investigations WHERE test_id = ? ORDER BY id DESC', id),
      instruments: all(`SELECT id, code, name, type, status, calibration_due FROM instruments WHERE status != 'Retired' OR id = ? ORDER BY code`, test.instrument_id).map((i) => ({ ...i, problem: instrumentProblem(i) })),
      // Materials used before with this method are suggested first.
      inventory: all(`SELECT i.id, i.code, i.name, i.category, i.lot_no, i.potency, i.expiry_date, i.status,
          (SELECT COUNT(*) FROM test_materials tm JOIN tests x ON x.id = tm.test_id JOIN methods mm ON mm.id = x.method_id
           WHERE tm.inventory_id = i.id AND mm.code = ?) AS used_with_method
        FROM inventory i WHERE i.status = 'Active' OR i.id IN (SELECT inventory_id FROM test_materials WHERE test_id = ?)
        ORDER BY used_with_method DESC, i.category, i.name`, test.method_code, id).map((m) => ({ ...m, problem: materialProblem(m) })),
      analysts: all(`SELECT id, full_name, initials, role FROM users WHERE active = 1 AND role IN ('analyst','scientist','manager') ORDER BY full_name`)
        .map((u) => ({ ...u, qualified: isQualified(u.id, test.method_code) })),
      can: {
        assign: can(me, 'tests.assign') && ['Pending', 'In Progress'].includes(test.status),
        claim: can(me, 'tests.perform') && !test.analyst_id && test.status === 'Pending' && qualifiedMe,
        start: mine && test.status === 'Pending' && qualifiedMe,
        edit: mine && ['Pending', 'In Progress'].includes(test.status) && qualifiedMe,
        submit: mine && test.status === 'In Progress',
        review: can(me, 'tests.review') && test.status === 'Submitted' && !mine,
        approve: can(me, 'tests.approve') && test.status === 'Reviewed' && !mine && test.reviewed_by !== me.id,
        cancel: can(me, 'tests.cancel') && !['Approved', 'Cancelled'].includes(test.status),
        raise: can(me, 'investigations.raise'),
      },
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
    const me = ctx.user.id;
    const out = { toReview: [], toApprove: [], toWitness: [], toIssue: [] };
    if (can(ctx.user, 'tests.review')) out.toReview = all(`${TEST_SELECT} WHERE t.status = 'Submitted' AND t.analyst_id != ? ORDER BY t.submitted_at`, me);
    if (can(ctx.user, 'tests.approve')) out.toApprove = all(`${TEST_SELECT} WHERE t.status = 'Reviewed' AND t.analyst_id != ? AND COALESCE(t.reviewed_by, 0) != ? ORDER BY t.reviewed_at`, me, me);
    if (can(ctx.user, 'notebook.witness')) {
      out.toWitness = all(`SELECT n.id, n.code, n.title, n.signed_at, u.full_name AS author_name, p.code AS project_code
        FROM notebook_entries n JOIN users u ON u.id = n.author_id LEFT JOIN projects p ON p.id = n.project_id
        WHERE n.status = 'Signed' AND n.author_id != ? ORDER BY n.signed_at`, me);
    }
    if (can(ctx.user, 'reports.issue')) out.toIssue = all(`${SAMPLE_SELECT} WHERE s.status = 'Approved' ORDER BY s.due_date`);
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
