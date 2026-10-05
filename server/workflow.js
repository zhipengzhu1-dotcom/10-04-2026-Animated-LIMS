// The Test workflow: what each person may do to a Test, and what follows from it.
//
//   assigned → started → results entered → submitted (e-signed) → peer review (e-signed, different person)
//   → QA approval (e-signed, third person) → CoA issued (e-signed)
//
// Controls enforced here: qualification on the method, instruments within calibration, standards/reagents
// within expiry, a reason for every change to a recorded result, and automatic OOS investigations.

import { all, get, run, tx } from './db.js';
import { update, mustGet } from './repo.js';
import { bad, forbidden } from './http.js';
import { assertCan, can, verifySignature, applySignature } from './auth.js';
import { clean, nowIso, today, idList, round, sameValue, fixed, specText } from './util.js';
import { openSampleInvestigation, openTestInvestigation, raiseInvestigation } from './routes/quality.js';

const ph = (arr) => arr.map(() => '?').join(',');

// Groups of Test statuses other areas need: results and attachments can still change; work not yet approved or
// cancelled; and submitted for review or beyond, which makes the Sample "In Review" once every Test is there.
export const TEST_EDITABLE = ['Pending', 'In Progress'];
export const TEST_OPEN = ['Pending', 'In Progress', 'Submitted', 'Reviewed'];
export const TEST_SUBMITTED = ['Submitted', 'Reviewed', 'Approved'];

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

export function isQualified(userId, methodCode) {
  return !!get(
    `SELECT 1 FROM qualifications WHERE user_id = ? AND method_code = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at >= ?)`,
    userId, methodCode, today(),
  );
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

export function instrumentProblem(i) {
  if (!i) return 'Unknown instrument';
  if (['Out of Service', 'Maintenance', 'Retired'].includes(i.status)) return `${i.code} is ${i.status.toLowerCase()}`;
  if (i.calibration_due && i.calibration_due < today()) return `${i.code} calibration expired on ${i.calibration_due}`;
  return null;
}

export function materialProblem(m) {
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
  else if (tests.length && tests.every((t) => TEST_SUBMITTED.includes(t.status))) status = 'In Review';
  else if (tests.some((t) => t.status !== 'Pending')) status = 'In Testing';
  if (status !== s.status) update(ctx, 'samples', sampleId, { status }, { action: 'STATUS', summary: `Sample status → ${status}` });
}

export function getTest(id) {
  return mustGet(`${TEST_SELECT} WHERE t.id = ?`, id, 'Test');
}

// ---------------------------------------------------------------------------------------------
// Sample actions
// ---------------------------------------------------------------------------------------------

export function issueReport(ctx, sampleId, body) {
  assertCan(ctx, 'reports.issue');
  const s = mustGet('SELECT * FROM samples WHERE id = ?', sampleId, 'Sample');
  if (s.status !== 'Approved') throw bad('Every test on this sample must be approved before the certificate can be issued');
  const inv = openSampleInvestigation(s.id);
  if (inv) throw bad(`${inv.code} is still open for this sample — close it before issuing the certificate`);
  verifySignature(ctx, body.password);
  tx(() => {
    applySignature(ctx, 'samples', s.id, 'sample.coa.issue', { comment: body.comment || null, code: s.code });
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
  if (body.analyst_id && (!analyst || !analyst.active || !can(analyst, 'tests.perform'))) throw bad('Choose an active analyst');
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
  const owner = get(`SELECT id FROM users WHERE role = 'manager' AND active = 1 ORDER BY id LIMIT 1`);
  const lines = fails.map((r) => `- **${r.analyte}**: ${r.result_type === 'numeric' ? `${fixed(r.value_num, r.decimals)} ${r.unit || ''}` : r.value_text} (specification ${specText(r)})`).join('\n');
  return raiseInvestigation(ctx, {
    type: 'OOS', severity: 'Major',
    title: `OOS — ${fails.map((f) => f.analyte).join(', ')} — ${t.sample_code}`.slice(0, 500),
    test_id: t.id, instrument_id: t.instrument_id, owner_id: owner?.id ?? null,
    description: `Out-of-specification result(s) for ${t.method_code} v${t.method_version} (${t.method_title}) on sample ${t.sample_code}${t.batch_no ? `, batch ${t.batch_no}` : ''}:\n\n${lines}\n\nPhase I laboratory investigation is required before this test can be approved.`,
  }, 'OOS investigation opened automatically when the result was submitted');
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
    applySignature(ctx, 'tests', id, 'test.submit', { comment: body.comment || null, code: t.code });
    update(ctx, 'tests', id, { status: 'Submitted', submitted_at: nowIso(), oos: fails.length ? 1 : 0 }, { action: 'STATUS', summary: 'Submitted for review' });
    const investigation = fails.length && !openTestInvestigation(id) ? raiseOos(ctx, t, fails) : null;
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
    applySignature(ctx, 'tests', id, accept ? 'test.review.accept' : 'test.review.return', { comment, code: t.code });
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
    const inv = openTestInvestigation(id);
    if (inv) throw bad(`${inv.code} is still open — close the investigation before approving this result`);
  }
  verifySignature(ctx, body.password);
  tx(() => {
    applySignature(ctx, 'tests', id, accept ? 'test.approve.accept' : 'test.approve.reject', { comment, code: t.code });
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
  const inv = openTestInvestigation(id);
  if (inv) throw bad(`${inv.code} is open on this test — it must be investigated and closed before the test can be cancelled`);
  if (!String(reason || '').trim()) throw bad('A reason is required to cancel a test', 'REASON_REQUIRED');
  tx(() => {
    update(ctx, 'tests', id, { status: 'Cancelled' }, { action: 'STATUS', summary: 'Test cancelled', reason });
    refreshSampleStatus(ctx, t.sample_id);
  });
  return { ok: true };
}

// Tests waiting on a user: assigned to them, awaiting their peer review, awaiting their QA approval.
// Each gives [SQL condition on tests aliased `t`, ...params]; the badges, the Reviews queue and the Samples work filters share them.
export const TEST_QUEUES = {
  assigned: (me) => [`t.analyst_id = ? AND t.status IN (${ph(TEST_EDITABLE)})`, me, ...TEST_EDITABLE],
  review: (me) => [`t.status = 'Submitted' AND t.analyst_id != ?`, me],
  approval: (me) => [`t.status = 'Reviewed' AND t.analyst_id != ? AND COALESCE(t.reviewed_by, 0) != ?`, me, me],
};
