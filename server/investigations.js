// Investigations: what each person may do to one, which records an open one holds back, and raising one.
// The Test workflow asks this module; this module asks nothing of the Test workflow.

import { get, tx } from './db.js';
import { insert, nextCode } from './repo.js';
import { bad, forbidden } from './http.js';
import { can } from './auth.js';
import { INVESTIGATION_TYPES, SEVERITIES } from './lookups.js';
import { clean, nowIso, today, addBusinessDays } from './util.js';

// [SQL condition]: Investigation `v` is not closed.
export const INVESTIGATION_OPEN = `v.status != 'Closed'`;

// [SQL condition]: an Investigation `v` open on Sample `s` or any of its Tests.
export const OPEN_ON_SAMPLE = `${INVESTIGATION_OPEN} AND (v.sample_id = s.id OR v.test_id IN (SELECT id FROM tests WHERE sample_id = s.id))`;

/** The newest open Investigation of any type raised on Test `testId`. */
export const openTestInvestigation = (testId) =>
  get(`SELECT v.id, v.code, v.status FROM investigations v WHERE v.test_id = ? AND ${INVESTIGATION_OPEN} ORDER BY v.id DESC LIMIT 1`, testId);

/** An open Investigation of any type on Sample `sampleId` or one of its Tests. */
export const openSampleInvestigation = (sampleId) =>
  get(`SELECT v.code FROM investigations v JOIN samples s ON s.id = ? WHERE ${OPEN_ON_SAMPLE} LIMIT 1`, sampleId);

const performedTestUnder = (v, me) => !!v.test_id && get('SELECT analyst_id FROM tests WHERE id = ?', v.test_id)?.analyst_id === me.id;

function openToInvestigators(v, me) {
  if (!can(me, 'investigations.raise') && !can(me, 'investigations.close')) return forbidden();
  if (v.status === 'Closed') return bad('Closed investigations are locked');
}

// Each rule takes an Investigation row with at least `status` and `test_id`.
export const INVESTIGATION_RULES = {
  edit: openToInvestigators,
  close(v, me) {
    if (!can(me, 'investigations.close')) return forbidden();
    if (v.status === 'Closed') return bad('Already closed');
    if (performedTestUnder(v, me)) return forbidden('You performed the test under investigation — someone independent must close it');
  },
  attach: openToInvestigators,
};

const investigationSchema = {
  type: { type: 'enum', values: Object.keys(INVESTIGATION_TYPES), required: true },
  title: { required: true },
  severity: { type: 'enum', values: SEVERITIES, default: 'Minor' },
  test_id: { type: 'id', ref: 'tests', label: 'test' },
  sample_id: { type: 'id', ref: 'samples', label: 'sample' },
  project_id: { type: 'id', ref: 'projects', label: 'project' },
  instrument_id: { type: 'id', ref: 'instruments', label: 'instrument' },
  owner_id: { type: 'id', ref: 'users', label: 'owner' },
  due_date: { type: 'date' },
  description: { type: 'text', required: true },
};

/** Opens an Investigation without asking for `investigations.raise`: the path for one the system raises itself. */
export function raiseInvestigation(ctx, body, summary) {
  const b = clean(body, investigationSchema);
  if (b.test_id && !b.sample_id) b.sample_id = get('SELECT sample_id FROM tests WHERE id = ?', b.test_id).sample_id;
  if (b.sample_id && !b.project_id) b.project_id = get('SELECT project_id FROM samples WHERE id = ?', b.sample_id).project_id;
  return tx(() => {
    const code = nextCode(INVESTIGATION_TYPES[b.type], { pad: 3 });
    const id = insert(ctx, 'investigations', {
      code, ...b, status: 'Open', raised_by: ctx.user.id, raised_at: nowIso(),
      due_date: b.due_date ?? addBusinessDays(today(), b.severity === 'Critical' ? 5 : 20),
    }, { summary: summary ?? `${b.type} raised` });
    return { id, code };
  });
}
