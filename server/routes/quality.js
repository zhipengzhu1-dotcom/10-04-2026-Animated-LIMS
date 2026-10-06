// Electronic lab notebook and investigations (OOS / deviations / CAPA).

import { all, get, run, tx, ph } from '../db.js';
import { insert, update, nextCode, mustGet } from '../repo.js';
import { audit } from '../audit.js';
import { bad, guard, flags, workQueue } from '../http.js';
import { assertCan, can, verifySignature, applySignature } from '../auth.js';
import { INVESTIGATION_STATUSES, SEVERITIES } from '../lookups.js';
import { clean, nowIso, likeTerm } from '../util.js';
import { listDocuments, freezeDocuments } from './documents.js';
import { SAMPLE_RULES, TEST_RULES } from '../workflow.js';
import { INVESTIGATION_OPEN, INVESTIGATION_RULES, raiseInvestigation } from '../investigations.js';
import { ENTRY_QUEUES, ENTRY_RULES } from '../notebook.js';

// ---------------------------------------------------------------------------------------------
// Notebook
// ---------------------------------------------------------------------------------------------

const NOTEBOOK_SELECT = `
  SELECT n.*, u.full_name AS author_name, u.initials AS author_initials, w.full_name AS witness_name,
    p.code AS project_code, p.title AS project_title, s.code AS sample_code, m.code AS method_code, m.version AS method_version
  FROM notebook_entries n
  JOIN users u ON u.id = n.author_id
  LEFT JOIN users w ON w.id = n.witness_id
  LEFT JOIN projects p ON p.id = n.project_id
  LEFT JOIN samples s ON s.id = n.sample_id
  LEFT JOIN methods m ON m.id = n.method_id`;

const notebookSchema = {
  title: { required: true },
  project_id: { type: 'id', ref: 'projects', label: 'project' },
  sample_id: { type: 'id', ref: 'samples', label: 'sample' },
  method_id: { type: 'id', ref: 'methods', label: 'method' },
  body: { type: 'text', default: '' },
  tags: { max: 200 },
};

export function createEntry(ctx, body) {
  assertCan(ctx, 'notebook.write');
  const b = clean(body, notebookSchema);
  return tx(() => {
    const code = nextCode('ELN');
    const t = nowIso();
    return { id: insert(ctx, 'notebook_entries', { code, ...b, body: b.body ?? '', author_id: ctx.user.id, status: 'Draft', created_at: t, updated_at: t }, { summary: 'Notebook entry started' }), code };
  });
}

export function signEntry(ctx, id, body) {
  const n = mustGet('SELECT * FROM notebook_entries WHERE id = ?', id, 'Entry');
  guard(ENTRY_RULES.sign(n, ctx.user));
  if (!n.body.trim()) throw bad('The entry is empty');
  verifySignature(ctx, body.password);
  tx(() => {
    applySignature(ctx, 'notebook_entries', id, 'notebook.author', { comment: body.comment || null, code: n.code });
    freezeDocuments(ctx, n);
    update(ctx, 'notebook_entries', id, { status: 'Signed', signed_at: nowIso() }, { action: 'STATUS', summary: 'Signed by author — entry locked' });
  });
  return { ok: true };
}

export function witnessEntry(ctx, id, body) {
  const n = mustGet('SELECT * FROM notebook_entries WHERE id = ?', id, 'Entry');
  guard(ENTRY_RULES.witness(n, ctx.user));
  verifySignature(ctx, body.password);
  tx(() => {
    applySignature(ctx, 'notebook_entries', id, 'notebook.witness', { comment: body.comment || null, code: n.code });
    update(ctx, 'notebook_entries', id, { status: 'Witnessed', witness_id: ctx.user.id, witnessed_at: nowIso() }, { action: 'STATUS', summary: 'Witnessed' });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Investigations
// ---------------------------------------------------------------------------------------------

const INV_SELECT = `
  SELECT v.*, o.full_name AS owner_name, rb.full_name AS raised_by_name, cb.full_name AS closed_by_name,
    t.code AS test_code, s.code AS sample_code, p.code AS project_code, i.code AS instrument_code
  FROM investigations v
  LEFT JOIN users o ON o.id = v.owner_id
  LEFT JOIN users rb ON rb.id = v.raised_by
  LEFT JOIN users cb ON cb.id = v.closed_by
  LEFT JOIN tests t ON t.id = v.test_id
  LEFT JOIN samples s ON s.id = v.sample_id
  LEFT JOIN projects p ON p.id = v.project_id
  LEFT JOIN instruments i ON i.id = v.instrument_id`;

export function createInvestigation(ctx, body) {
  const test = body.test_id && get('SELECT * FROM tests WHERE id = ?', +body.test_id);
  const sample = body.sample_id && get('SELECT * FROM samples WHERE id = ?', +body.sample_id);
  if (test) guard(TEST_RULES.raise(test, ctx.user));
  else if (sample) guard(SAMPLE_RULES.raise(sample, ctx.user));
  else assertCan(ctx, 'investigations.raise');
  return raiseInvestigation(ctx, body);
}

export function updateInvestigation(ctx, id, body) {
  guard(INVESTIGATION_RULES.edit(mustGet('SELECT * FROM investigations WHERE id = ?', id, 'Investigation'), ctx.user));
  const b = clean(body, {
    title: { required: true }, severity: { type: 'enum', values: SEVERITIES },
    status: { type: 'enum', values: INVESTIGATION_STATUSES.filter((s) => s !== 'Closed') },
    owner_id: { type: 'id', ref: 'users' }, due_date: { type: 'date' },
    description: { type: 'text' }, root_cause: { type: 'text' }, impact: { type: 'text' }, capa: { type: 'text', label: 'CAPA' }, conclusion: {},
  }, { partial: true });
  update(ctx, 'investigations', id, b, { summary: 'Investigation updated' });
  return { ok: true };
}

/**
 * Closes an investigation with an e-signature, from the Investigations screen or its card on the Test page. A root
 * cause and conclusion given here are recorded with the closure; otherwise the ones already recorded must be filled in.
 */
export function closeInvestigation(ctx, id, body) {
  const v = mustGet('SELECT * FROM investigations WHERE id = ?', id, 'Investigation');
  guard(INVESTIGATION_RULES.close(v, ctx.user));
  const given = clean(body, { root_cause: { type: 'text' }, conclusion: { type: 'text' } }, { partial: true });
  const findings = Object.fromEntries(Object.entries(given).filter(([, text]) => text));
  if (!(findings.root_cause ?? v.root_cause)?.trim()) throw bad('Record the root cause before closing');
  if (!(findings.conclusion ?? v.conclusion)?.trim()) throw bad('Record a conclusion before closing');
  verifySignature(ctx, body.password);
  tx(() => {
    update(ctx, 'investigations', id, { ...findings, status: 'Closed', closed_by: ctx.user.id, closed_at: nowIso() }, { action: 'STATUS', summary: 'Investigation closed' });
    applySignature(ctx, 'investigations', id, v.type === 'OOS' ? 'investigation.close.oos' : 'investigation.close', { comment: body.comment || null, code: v.code });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

export default function routes(r) {
  // ----- Notebook -----
  r.get('/api/notebook', (ctx) => {
    const q = ctx.query;
    const where = [];
    const params = [];
    if (q.mine) { where.push('n.author_id = ?'); params.push(ctx.user.id); }
    if (q.status && q.status !== 'all') { where.push('n.status = ?'); params.push(q.status); }
    if (q.project_id) { where.push('n.project_id = ?'); params.push(+q.project_id); }
    if (q.work) { const ids = workQueue(ENTRY_RULES, ENTRY_QUEUES, q.work, ctx.user).map((n) => n.id); where.push(`n.id IN (${ph(ids)})`); params.push(...ids); }
    if (q.q) { const t = likeTerm(q.q); where.push(`(n.code LIKE ? ESCAPE '\\' OR n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\' OR n.tags LIKE ? ESCAPE '\\')`); params.push(t, t, t, t); }
    return all(`${NOTEBOOK_SELECT.replace('SELECT n.*', 'SELECT n.id, n.code, n.title, n.status, n.tags, n.project_id, n.sample_id, n.method_id, n.author_id, n.signed_at, n.witnessed_at, n.created_at, n.updated_at, substr(n.body, 1, 220) AS excerpt, (SELECT COUNT(*) FROM notebook_documents d WHERE d.entry_id = n.id AND d.removed = 0) AS doc_count')}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY n.updated_at DESC LIMIT 500`, ...params);
  });

  r.get('/api/notebook/:id', (ctx) => {
    const id = +ctx.params.id;
    const entry = mustGet(`${NOTEBOOK_SELECT} WHERE n.id = ?`, id, 'Notebook entry');
    return {
      entry,
      addenda: all('SELECT a.*, u.full_name AS author_name FROM notebook_addenda a JOIN users u ON u.id = a.author_id WHERE a.entry_id = ? ORDER BY a.id', id),
      signatures: all(`SELECT * FROM signatures WHERE entity = 'notebook_entries' AND entity_id = ? ORDER BY id`, id),
      documents: listDocuments(id),
      can: flags(ENTRY_RULES, entry, ctx.user),
    };
  });

  r.post('/api/notebook', (ctx) => createEntry(ctx, ctx.body));

  r.put('/api/notebook/:id', (ctx) => {
    const id = +ctx.params.id;
    const n = mustGet('SELECT * FROM notebook_entries WHERE id = ?', id, 'Entry');
    guard(ENTRY_RULES.edit(n, ctx.user));
    const b = clean(ctx.body, notebookSchema, { partial: true });
    // Draft autosaves would flood the audit trail with full-text diffs; log that the body changed, with its new length.
    const extra = {};
    if ('body' in b && b.body !== n.body) extra.body = [`${n.body.length} chars`, `${(b.body ?? '').length} chars`];
    const { body: text, ...rest } = b;
    tx(() => {
      if ('body' in b) run('UPDATE notebook_entries SET body = ? WHERE id = ?', text ?? '', id);
      update(ctx, 'notebook_entries', id, { ...rest, updated_at: nowIso() }, { summary: 'Draft edited', extraChanges: extra, audit: Object.keys(extra).length > 0 || Object.keys(rest).length > 0 });
    });
    return { ok: true, updated_at: nowIso() };
  });

  r.post('/api/notebook/:id/sign', (ctx) => signEntry(ctx, +ctx.params.id, ctx.body));
  r.post('/api/notebook/:id/witness', (ctx) => witnessEntry(ctx, +ctx.params.id, ctx.body));

  r.post('/api/notebook/:id/addenda', (ctx) => {
    const id = +ctx.params.id;
    const n = mustGet('SELECT * FROM notebook_entries WHERE id = ?', id, 'Entry');
    guard(ENTRY_RULES.addendum(n, ctx.user));
    const text = String(ctx.body.body || '').trim();
    if (!text) throw bad('The addendum is empty');
    insert(ctx, 'notebook_addenda', { entry_id: id, author_id: ctx.user.id, body: text, created_at: nowIso() }, { code: n.code, summary: 'Addendum added' });
    return { ok: true };
  });

  // ----- Investigations -----
  r.get('/api/investigations', (ctx) => {
    const q = ctx.query;
    const where = [];
    const params = [];
    if (q.status === 'open') where.push(INVESTIGATION_OPEN);
    else if (q.status && q.status !== 'all') { where.push('v.status = ?'); params.push(q.status); }
    if (q.type) { where.push('v.type = ?'); params.push(q.type); }
    return all(`${INV_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY v.status = 'Closed', v.id DESC`, ...params);
  });

  r.get('/api/investigations/:id', (ctx) => {
    const id = +ctx.params.id;
    const investigation = mustGet(`${INV_SELECT} WHERE v.id = ?`, id, 'Investigation');
    return {
      investigation,
      results: investigation.test_id ? all('SELECT * FROM results WHERE test_id = ? ORDER BY sort_order, id', investigation.test_id) : [],
      signatures: all(`SELECT * FROM signatures WHERE entity = 'investigations' AND entity_id = ? ORDER BY id`, id),
      can: flags(INVESTIGATION_RULES, investigation, ctx.user),
    };
  });

  r.post('/api/investigations', (ctx) => createInvestigation(ctx, ctx.body));
  r.put('/api/investigations/:id', (ctx) => updateInvestigation(ctx, +ctx.params.id, ctx.body));
  r.post('/api/investigations/:id/close', (ctx) => closeInvestigation(ctx, +ctx.params.id, ctx.body));
}
