// Client portal. Two halves:
//   /api/portal/*        — used by client contacts (separate accounts and cookie, see portal-auth.js).
//                          Every query is scoped by the signed-in contact's client_id, and only
//                          client-appropriate fields are returned (no analysts, prices, OOS flags or audit data).
//   /api/portal-admin/*  — used by lab staff to answer messages, acknowledge and receive sample submissions,
//                          progress method-work requests and manage client portal accounts.

import crypto from 'node:crypto';
import { all, get, run, ph, tx } from '../db.js';
import { insert, update, nextCode, mustGet } from '../repo.js';
import { audit } from '../audit.js';
import { HttpError, bad, forbidden, notFound } from '../http.js';
import { assertCan, can, checkPasswordPolicy, hashPassword, verifyPassword } from '../auth.js';
import { portalAuth, portalLogin, portalLogout, portalCtx, publicPortalUser, portalDestroyOtherSessions } from '../portal-auth.js';
import { getSettings } from '../settings.js';
import { SAMPLE_TYPES, STORAGE_CONDITIONS, PRIORITIES, TECHNIQUES, SAMPLE_OPEN } from '../lookups.js';
import { clean, nowIso, idList, addDays, today, specText, fixed } from '../util.js';
import { receiveSamples } from './lab.js';
import { createProject } from './business.js';

export const SUBMISSION_STATUSES = ['Submitted', 'Acknowledged', 'Received', 'Declined', 'Withdrawn'];
export const SUBMISSION_OPEN = ['Submitted', 'Acknowledged'];
export const REQUEST_TYPES = ['Method development', 'Method validation', 'Method transfer', 'Other'];
export const REQUEST_STATUSES = ['Submitted', 'Under review', 'Proposal sent', 'Accepted', 'Declined'];
export const REQUEST_OPEN = ['Submitted', 'Under review', 'Proposal sent'];
export const VALIDATION_PARAMETERS = ['Specificity', 'Linearity', 'Range', 'Accuracy', 'Repeatability', 'Intermediate precision', 'Detection limit (LOD)', 'Quantitation limit (LOQ)', 'Robustness', 'Solution stability', 'System suitability'];
export const REGULATORY_CONTEXTS = ['GMP release', 'Clinical (IND / IMPD)', 'Registration (NDA / MAA)', 'Development / non-GMP', 'Other'];
const PROJECT_TYPE_FOR = { 'Method development': 'Method Development', 'Method validation': 'Method Validation', 'Method transfer': 'Method Transfer', Other: 'Other' };

const json = (v, fallback) => { try { return JSON.parse(v) ?? fallback; } catch { return fallback; } };

/** Readable one-time password that satisfies the password policy, e.g. "kq7m-x4pt-9wza". */
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  for (;;) {
    const bytes = crypto.randomBytes(12);
    const s = [...bytes].map((b) => abc[b % abc.length]).join('');
    const pw = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
    if (/[a-z]/.test(pw) && /\d/.test(pw)) return pw;
  }
}

// ---------------------------------------------------------------------------------------------
// Threads & messages (shared by both sides)
// ---------------------------------------------------------------------------------------------

export function createThread({ client_id, subject, submission_id = null, request_id = null, sample_id = null }) {
  const t = nowIso();
  return Number(run(
    'INSERT INTO portal_threads (client_id, subject, submission_id, request_id, sample_id, created_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    client_id, subject, submission_id, request_id, sample_id, t, t,
  ).lastInsertRowid);
}

export function postMessage(threadId, { portalUser = null, user = null, body, kind = 'message' }) {
  const text = String(body ?? '').trim();
  if (!text) throw bad('Write a message first');
  if (text.length > 10000) throw bad('That message is too long (max 10 000 characters)');
  const t = nowIso();
  const author = portalUser ? portalUser.full_name : user ? user.full_name : getSettings().lab_name;
  run('INSERT INTO portal_messages (thread_id, portal_user_id, user_id, author_name, body, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    threadId, portalUser?.id ?? null, user?.id ?? null, author, text, kind, t);
  // Whoever writes has, by definition, read the thread up to now.
  if (portalUser) run('UPDATE portal_threads SET last_message_at = ?, client_read_at = ?, status = ? WHERE id = ?', t, t, 'Open', threadId);
  else if (user) run('UPDATE portal_threads SET last_message_at = ?, lab_read_at = ? WHERE id = ?', t, t, threadId);
  else run('UPDATE portal_threads SET last_message_at = ? WHERE id = ?', t, threadId);
}

/** System notice (status changes) posted into the thread linked to a submission or request. */
function notice(where, body) {
  const thread = get(`SELECT id FROM portal_threads WHERE ${where.submission_id ? 'submission_id' : 'request_id'} = ?`, where.submission_id || where.request_id);
  if (thread) postMessage(thread.id, { body, kind: 'event' });
}

const CLIENT_UNREAD = `EXISTS (SELECT 1 FROM portal_messages m WHERE m.thread_id = t.id AND m.portal_user_id IS NULL AND m.created_at > COALESCE(t.client_read_at, ''))`;
const LAB_UNREAD = `EXISTS (SELECT 1 FROM portal_messages m WHERE m.thread_id = t.id AND m.portal_user_id IS NOT NULL AND m.created_at > COALESCE(t.lab_read_at, ''))`;
const LAST_MESSAGE = `(SELECT substr(m.body, 1, 160) FROM portal_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS excerpt,
  (SELECT m.author_name FROM portal_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_author,
  (SELECT COUNT(*) FROM portal_messages m WHERE m.thread_id = t.id) AS message_count`;

const threadMessages = (id, { forClient }) => all(`
  SELECT m.id, m.author_name, m.body, m.kind, m.created_at,
    CASE WHEN m.portal_user_id IS NOT NULL THEN 'client' WHEN m.user_id IS NOT NULL THEN 'lab' ELSE 'system' END AS side
    ${forClient ? '' : ', m.portal_user_id, m.user_id'}
  FROM portal_messages m WHERE m.thread_id = ? ORDER BY m.id`, id);

// ---------------------------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------------------------

const submissionSchema = {
  project_id: { type: 'id', ref: 'projects', label: 'project' },
  sample_type: { type: 'enum', values: SAMPLE_TYPES },
  priority: { type: 'enum', values: PRIORITIES, default: 'Standard' },
  storage: { type: 'enum', values: STORAGE_CONDITIONS },
  courier: { max: 120 },
  tracking_no: { max: 120, label: 'tracking number' },
  ship_date: { type: 'date', label: 'ship date' },
  notes: { type: 'text', max: 5000 },
};

const requestSchema = {
  type: { type: 'enum', values: REQUEST_TYPES, required: true },
  title: { required: true, max: 200 },
  product: { max: 200, label: 'product / molecule' },
  technique: { max: 120 },
  scope: { type: 'text', max: 8000 },
  regulatory: { max: 200, label: 'regulatory context' },
  target_date: { type: 'date', label: 'target date' },
};

/** Methods a client may request: effective, ready to use (has parameters), general or theirs. No prices. */
const clientMethods = (clientId) => all(`
  SELECT m.id, m.code, m.version, m.title, m.technique, m.tat_days
  FROM methods m
  WHERE m.status = 'Effective' AND (m.client_id IS NULL OR m.client_id = ?)
    AND EXISTS (SELECT 1 FROM method_analytes a WHERE a.method_id = m.id)
  ORDER BY m.code`, clientId);

function cleanSampleRows(rows) {
  const out = (Array.isArray(rows) ? rows : [])
    .filter((s) => s && typeof s === 'object' && Object.values(s).some((v) => String(v ?? '').trim()))
    .map((s, i) => clean(s, {
      description: { required: true, label: `sample ${i + 1} description` },
      batch_no: { max: 120 }, client_ref: { max: 120 }, quantity: { max: 120 }, container: { max: 120 },
    }));
  if (!out.length) throw bad('Add at least one sample');
  if (out.length > 200) throw bad('Submit at most 200 samples at a time');
  return out;
}

// Client-facing views of lab records — explicit column lists, never SELECT *.
const CLIENT_SAMPLE = `
  SELECT s.id, s.code, s.description, s.batch_no, s.client_ref, s.sample_type, s.priority, s.status,
    s.received_at, s.due_date, s.reported_at, p.code AS project_code, p.title AS project_title,
    (SELECT COUNT(*) FROM tests t WHERE t.sample_id = s.id AND t.status != 'Cancelled') AS test_count,
    (SELECT COUNT(*) FROM tests t WHERE t.sample_id = s.id AND t.status = 'Approved') AS tests_done
  FROM samples s LEFT JOIN projects p ON p.id = s.project_id`;

function submissionView(sub, { forClient }) {
  const methodIds = json(sub.method_ids, []);
  const methods = methodIds.length ? all(`SELECT id, code, version, title, technique FROM methods WHERE id IN (${ph(methodIds)})`, ...methodIds) : [];
  const sampleIds = json(sub.sample_ids, []);
  const samples = sampleIds.length ? all(`SELECT id, code, status, description FROM samples WHERE id IN (${ph(sampleIds)}) AND client_id = ? ORDER BY id`, ...sampleIds, sub.client_id) : [];
  const out = { ...sub, samples: json(sub.samples, []), method_ids: methodIds, methods, received_samples: samples };
  delete out.sample_ids;
  if (forClient) {
    delete out.acknowledged_by;
    delete out.received_by;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Services (also used by the demo seed)
// ---------------------------------------------------------------------------------------------

const openSubmission = (id) => {
  const sub = mustGet('SELECT * FROM portal_submissions WHERE id = ?', id, 'Submission');
  if (!SUBMISSION_OPEN.includes(sub.status)) throw bad(`This submission is ${sub.status.toLowerCase()}`);
  return sub;
};

/** Invites a client contact. Returns a one-time temporary password (shown once to staff, never stored in clear). */
export function createPortalAccount(ctx, input, presetPassword = null) {
  assertCan(ctx, 'portal.manage');
  const b = clean(input, { client_id: { type: 'id', ref: 'clients', required: true }, email: { type: 'email', required: true }, full_name: { required: true, label: 'full name' }, job_title: { max: 120 } });
  if (!get('SELECT 1 FROM clients WHERE id = ? AND active = 1', b.client_id)) throw bad('That client is not active');
  if (get('SELECT 1 FROM portal_users WHERE email = ?', b.email)) throw bad('A portal account with that email already exists');
  const password = presetPassword || tempPassword();
  const id = insert(ctx, 'portal_users', {
    ...b, password_hash: hashPassword(password), must_change_password: presetPassword ? 0 : 1, active: 1, created_by: ctx.user.id, created_at: nowIso(),
  }, { code: b.email, summary: `Client portal account created for ${b.full_name}` });
  return { id, email: b.email, temp_password: password };
}

/** A client contact announces a shipment. ctx is a portal audit context (see portalCtx). */
export function submitSamples(ctx, pu, input) {
  const b = clean(input, submissionSchema);
  if (b.project_id && !get(`SELECT 1 FROM projects WHERE id = ? AND client_id = ? AND status IN ('Quoted','Active','On Hold')`, b.project_id, pu.client_id)) throw bad('Project not found');
  const rows = cleanSampleRows(input.samples);
  const allowed = new Set(clientMethods(pu.client_id).map((m) => m.id));
  const methodIds = idList(input.method_ids);
  if (methodIds.some((id) => !allowed.has(id))) throw bad('One of the selected tests is not available');
  return tx(() => {
    const code = nextCode('SUB');
    const t = nowIso();
    const id = insert(ctx, 'portal_submissions', {
      code, client_id: pu.client_id, portal_user_id: pu.id, ...b, samples: JSON.stringify(rows), method_ids: JSON.stringify(methodIds),
      status: 'Submitted', created_at: t, updated_at: t,
    }, { summary: `Sample submission from ${pu.full_name} (${rows.length} sample${rows.length === 1 ? '' : 's'})` });
    const thread = createThread({ client_id: pu.client_id, subject: `Sample submission ${code}`, submission_id: id });
    postMessage(thread, { body: `Submission ${code} received: ${rows.length} sample${rows.length === 1 ? '' : 's'}${methodIds.length ? `, ${methodIds.length} test${methodIds.length === 1 ? '' : 's'} requested` : ''}. We'll confirm as soon as it has been reviewed.`, kind: 'event' });
    if (b.notes) postMessage(thread, { portalUser: pu, body: b.notes });
    return { id, code };
  });
}

/** A client contact asks for method development / validation / transfer work. */
export function submitRequest(ctx, pu, input) {
  const b = clean(input, requestSchema);
  const params = (Array.isArray(input.parameters) ? input.parameters : []).filter((p) => VALIDATION_PARAMETERS.includes(p));
  return tx(() => {
    const code = nextCode('REQ');
    const t = nowIso();
    const id = insert(ctx, 'portal_requests', {
      code, client_id: pu.client_id, portal_user_id: pu.id, ...b, parameters: JSON.stringify(params), status: 'Submitted', created_at: t, updated_at: t,
    }, { summary: `${b.type} request from ${pu.full_name}` });
    const thread = createThread({ client_id: pu.client_id, subject: `${b.type}: ${b.title}`, request_id: id });
    postMessage(thread, { body: `Request ${code} received. A scientist will review the scope and come back to you, usually within two working days.`, kind: 'event' });
    return { id, code };
  });
}

export function acknowledgeSubmission(ctx, id, rawNote) {
  assertCan(ctx, 'portal.respond');
  const sub = openSubmission(id);
  if (sub.status !== 'Submitted') throw bad('Already acknowledged');
  const note = String(rawNote || '').trim();
  tx(() => {
    update(ctx, 'portal_submissions', sub.id, { status: 'Acknowledged', status_note: note || null, acknowledged_by: ctx.user.id, acknowledged_at: nowIso(), updated_at: nowIso() }, { action: 'STATUS', summary: 'Submission acknowledged' });
    notice({ submission_id: sub.id }, `Submission acknowledged by ${ctx.user.full_name} — we're expecting your shipment.`);
    const thread = get('SELECT id FROM portal_threads WHERE submission_id = ?', sub.id);
    if (note && thread) postMessage(thread.id, { user: ctx.user, body: note });
  });
}

/** Physical receipt: creates real samples (codes, custody, tests) through the normal receiving workflow. */
export function receiveSubmission(ctx, id, input = {}) {
  assertCan(ctx, 'samples.receive');
  const sub = openSubmission(id);
  const rows = json(sub.samples, []);
  const methodIds = input.method_ids !== undefined ? idList(input.method_ids) : json(sub.method_ids, []);
  return tx(() => {
    const res = receiveSamples(ctx, {
      client_id: sub.client_id,
      project_id: input.project_id === undefined ? sub.project_id : input.project_id,
      sample_type: input.sample_type ?? sub.sample_type,
      storage: input.storage ?? sub.storage,
      location: input.location,
      condition: input.condition,
      priority: input.priority ?? sub.priority,
      received_at: input.received_at || nowIso(),
      due_date: input.due_date,
      notes: [input.notes, `Client submission ${sub.code}`].filter(Boolean).join('\n'),
      samples: rows,
      method_ids: methodIds,
    });
    const ids = res.samples.map((s) => s.id);
    update(ctx, 'portal_submissions', sub.id, { status: 'Received', received_by: ctx.user.id, received_at: nowIso(), sample_ids: JSON.stringify(ids), updated_at: nowIso() }, { action: 'STATUS', summary: `Samples received: ${res.samples.map((s) => s.code).join(', ')}` });
    const condition = input.condition && input.condition !== 'Acceptable' ? ` Condition on receipt: ${input.condition}.` : '';
    notice({ submission_id: sub.id }, `Your samples have arrived and are logged as ${res.samples.map((s) => s.code).join(', ')}.${condition} Expected completion ${new Date(`${res.due_date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.`);
    return res;
  });
}

export function respondToRequest(ctx, id, input) {
  assertCan(ctx, 'portal.respond');
  const q = mustGet('SELECT * FROM portal_requests WHERE id = ?', id, 'Request');
  const b = clean(input, { status: { type: 'enum', values: REQUEST_STATUSES, required: true }, response: { type: 'text', max: 10000 } });
  if (!REQUEST_OPEN.includes(q.status)) throw bad(`This request is already ${q.status.toLowerCase()}`);
  if (b.status === 'Submitted' && q.status !== 'Submitted') throw bad('A request never goes back to Submitted');
  if (b.status === 'Accepted' && q.status !== 'Proposal sent') throw bad('A request is accepted only after a proposal has been sent');
  if (b.status === q.status && !b.response) throw bad('Nothing to update');
  if (['Proposal sent', 'Declined'].includes(b.status) && !b.response) throw bad(b.status === 'Declined' ? 'Give the client a reason' : 'Summarise the proposal for the client');
  tx(() => {
    update(ctx, 'portal_requests', q.id, {
      status: b.status, response: b.response ?? q.response, responded_by: b.response ? ctx.user.id : q.responded_by, responded_at: b.response ? nowIso() : q.responded_at, updated_at: nowIso(),
    }, { action: 'STATUS', summary: `Request ${b.status.toLowerCase()}` });
    if (b.status !== q.status) notice({ request_id: q.id }, `Status: ${b.status}`);
    const thread = get('SELECT id FROM portal_threads WHERE request_id = ?', q.id);
    if (b.response && thread) postMessage(thread.id, { user: ctx.user, body: b.response });
  });
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

export default function routes(r) {
  const open = { auth: false };

  // ===== Public =====
  r.get('/api/portal/info', () => {
    const s = getSettings();
    return {
      lab_name: s.lab_name, lab_email: s.lab_email, lab_phone: s.lab_phone, lab_accreditation: s.lab_accreditation,
      demo: s.demo_mode === '1',
      // In demo mode the sign-in page offers one-click client accounts.
      demo_accounts: s.demo_mode === '1' ? all(`SELECT u.email, u.full_name, c.name AS client_name FROM portal_users u JOIN clients c ON c.id = u.client_id WHERE u.active = 1 AND u.must_change_password = 0 ORDER BY c.name LIMIT 6`) : [],
    };
  }, open);

  r.post('/api/portal/login', (ctx) => ({ user: publicPortalUser(portalLogin(ctx, ctx.body.email, ctx.body.password)) }), open);
  r.post('/api/portal/logout', (ctx) => { portalLogout(ctx); return { ok: true }; }, open);

  // ===== Client contact =====
  r.get('/api/portal/me', (ctx) => {
    const pu = portalAuth(ctx, { allowPasswordChange: true });
    const client = get('SELECT name, code FROM clients WHERE id = ?', pu.client_id);
    const s = getSettings();
    return { user: publicPortalUser(pu), client, lab: { lab_name: s.lab_name, lab_email: s.lab_email, lab_phone: s.lab_phone }, session_idle_minutes: Number(s.session_idle_minutes) || 60 };
  }, open);

  r.post('/api/portal/password', (ctx) => {
    const pu = portalAuth(ctx, { allowPasswordChange: true });
    if (pu.locked_until && pu.locked_until > nowIso()) throw new HttpError(423, 'Account locked after repeated wrong passwords. Try again later.');
    if (!verifyPassword(ctx.body.current, pu.password_hash)) {
      const failed = (pu.failed_logins || 0) + 1;
      run('UPDATE portal_users SET failed_logins = ?, locked_until = CASE WHEN ? >= 5 THEN ? ELSE locked_until END WHERE id = ?', failed, failed, new Date(Date.now() + 15 * 60_000).toISOString(), pu.id);
      audit(portalCtx(ctx, pu), { action: 'PASSWORD_CHANGE_FAILED', entity: 'portal_users', entity_id: pu.id, entity_code: pu.email, summary: 'Client portal: wrong current password' });
      throw bad('Your current password is incorrect');
    }
    checkPasswordPolicy(ctx.body.next);
    if (verifyPassword(ctx.body.next, pu.password_hash)) throw bad('Choose a password different from your current one');
    update(portalCtx(ctx, pu), 'portal_users', pu.id, { password_hash: hashPassword(String(ctx.body.next)), must_change_password: 0, password_changed_at: nowIso(), failed_logins: 0 }, { summary: 'Client portal password changed' });
    portalDestroyOtherSessions(ctx, pu.id);
    return { ok: true };
  }, open);

  r.get('/api/portal/lookups', (ctx) => {
    const pu = portalAuth(ctx);
    return {
      sampleTypes: SAMPLE_TYPES, storageConditions: STORAGE_CONDITIONS, priorities: PRIORITIES, techniques: TECHNIQUES,
      requestTypes: REQUEST_TYPES, validationParameters: VALIDATION_PARAMETERS, regulatoryContexts: REGULATORY_CONTEXTS,
      methods: clientMethods(pu.client_id),
      projects: all(`SELECT id, code, title FROM projects WHERE client_id = ? AND status IN ('Quoted','Active','On Hold') ORDER BY code DESC`, pu.client_id),
    };
  }, open);

  r.get('/api/portal/overview', (ctx) => {
    const pu = portalAuth(ctx);
    const c = pu.client_id;
    return {
      counts: {
        in_lab: get(`SELECT COUNT(*) n FROM samples WHERE client_id = ? AND status IN (${ph(SAMPLE_OPEN)})`, c, ...SAMPLE_OPEN).n,
        reported_90d: get(`SELECT COUNT(*) n FROM samples WHERE client_id = ? AND status = 'Reported' AND reported_at >= ?`, c, addDays(today(), -90)).n,
        submissions_open: get(`SELECT COUNT(*) n FROM portal_submissions WHERE client_id = ? AND status IN (${ph(SUBMISSION_OPEN)})`, c, ...SUBMISSION_OPEN).n,
        requests_open: get(`SELECT COUNT(*) n FROM portal_requests WHERE client_id = ? AND status IN (${ph(REQUEST_OPEN)})`, c, ...REQUEST_OPEN).n,
        unread: get(`SELECT COUNT(*) n FROM portal_threads t WHERE t.client_id = ? AND ${CLIENT_UNREAD}`, c).n,
      },
      inProgress: all(`${CLIENT_SAMPLE} WHERE s.client_id = ? AND s.status IN (${ph(SAMPLE_OPEN)}) ORDER BY s.due_date, s.id LIMIT 8`, c, ...SAMPLE_OPEN),
      recentCoas: all(`${CLIENT_SAMPLE} WHERE s.client_id = ? AND s.status = 'Reported' ORDER BY s.reported_at DESC LIMIT 5`, c),
      submissions: all(`SELECT id, code, status, priority, created_at, json_array_length(samples) AS sample_count FROM portal_submissions WHERE client_id = ? AND status IN (${ph(SUBMISSION_OPEN)}) ORDER BY id DESC LIMIT 5`, c, ...SUBMISSION_OPEN),
      requests: all(`SELECT id, code, type, title, status, created_at FROM portal_requests WHERE client_id = ? AND status IN (${ph(REQUEST_OPEN)}) ORDER BY id DESC LIMIT 5`, c, ...REQUEST_OPEN),
      threads: all(`SELECT t.id, t.subject, t.last_message_at, ${CLIENT_UNREAD} AS unread, ${LAST_MESSAGE} FROM portal_threads t WHERE t.client_id = ? ORDER BY t.last_message_at DESC LIMIT 4`, c),
    };
  }, open);

  // ----- Samples & certificates -----
  r.get('/api/portal/samples', (ctx) => {
    const pu = portalAuth(ctx);
    const scope = ctx.query.status || 'open';
    const where = ['s.client_id = ?'];
    const params = [pu.client_id];
    if (scope === 'open') { where.push(`s.status IN (${ph(SAMPLE_OPEN)})`); params.push(...SAMPLE_OPEN); }
    else if (scope === 'reported') where.push(`s.status = 'Reported'`);
    return all(`${CLIENT_SAMPLE} WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 500`, ...params);
  }, open);

  const clientSample = (pu, id) => {
    const s = get(`${CLIENT_SAMPLE} WHERE s.id = ? AND s.client_id = ?`, id, pu.client_id);
    if (!s) throw notFound('Sample'); // same answer whether it doesn't exist or belongs to someone else
    return s;
  };

  r.get('/api/portal/samples/:id', (ctx) => {
    const pu = portalAuth(ctx);
    const s = clientSample(pu, +ctx.params.id);
    return {
      sample: s,
      tests: all(`SELECT t.id, t.status, m.code AS method_code, m.version AS method_version, m.title AS method_title, m.technique, t.approved_at
        FROM tests t JOIN methods m ON m.id = t.method_id WHERE t.sample_id = ? AND t.status != 'Cancelled' ORDER BY t.id`, s.id),
      submission: get(`SELECT id, code FROM portal_submissions WHERE client_id = ? AND EXISTS (SELECT 1 FROM json_each(sample_ids) j WHERE j.value = ?)`, pu.client_id, s.id) || null,
    };
  }, open);

  r.get('/api/portal/samples/:id/coa', (ctx) => {
    const pu = portalAuth(ctx);
    const id = +ctx.params.id;
    clientSample(pu, id);
    const s = get(`SELECT s.id, s.code, s.description, s.batch_no, s.client_ref, s.sample_type, s.quantity, s.container, s.storage, s.condition,
        s.received_at, s.reported_at, s.status, c.name AS client_name, c.address AS client_address, p.code AS project_code, p.po_number
      FROM samples s JOIN clients c ON c.id = s.client_id LEFT JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND s.client_id = ?`, id, pu.client_id);
    if (s.status !== 'Reported') throw forbidden('The certificate for this sample has not been issued yet');
    const tests = all(`SELECT t.id, t.approved_at, m.code AS method_code, m.version AS method_version, m.title AS method_title, m.reference
      FROM tests t JOIN methods m ON m.id = t.method_id WHERE t.sample_id = ? AND t.status = 'Approved' ORDER BY t.id`, id);
    const names = (meaning) => [...new Set(all(`SELECT g.full_name FROM signatures g JOIN tests t ON t.id = g.entity_id WHERE g.entity = 'tests' AND t.sample_id = ? AND g.meaning = ? ORDER BY g.id`, id, meaning).map((x) => x.full_name))];
    for (const t of tests) {
      t.results = all('SELECT analyte, unit, result_type, spec_min, spec_max, spec_text, decimals, value_num, value_text, outcome FROM results WHERE test_id = ? ORDER BY sort_order, id', t.id)
        .map((x) => ({
          analyte: x.analyte, outcome: x.outcome, spec: specText(x),
          result: x.result_type === 'numeric' ? (x.value_num == null ? '—' : `${fixed(x.value_num, x.decimals ?? 2)}${x.unit ? ` ${x.unit}` : ''}`) : x.value_text || '—',
        }));
    }
    const issued = get(`SELECT full_name, signed_at FROM signatures WHERE entity = 'samples' AND entity_id = ? AND meaning = 'Certificate of Analysis issued' ORDER BY id DESC LIMIT 1`, id);
    const results = tests.flatMap((t) => t.results);
    const lab = getSettings();
    audit(portalCtx(ctx, pu), { action: 'VIEW', entity: 'samples', entity_id: id, entity_code: s.code, summary: 'Certificate of Analysis viewed in the client portal' });
    return {
      sample: s, tests, issued, performed_by: names('Performed'), reviewed_by: names('Reviewed'),
      complies: results.length > 0 && results.every((x) => ['Pass', 'Report'].includes(x.outcome)),
      lab: { lab_name: lab.lab_name, lab_address: lab.lab_address, lab_phone: lab.lab_phone, lab_email: lab.lab_email, lab_accreditation: lab.lab_accreditation, coa_statement: lab.coa_statement },
    };
  }, open);

  r.get('/api/portal/projects', (ctx) => {
    const pu = portalAuth(ctx);
    return all(`SELECT p.id, p.code, p.title, p.type, p.status, p.start_date, p.due_date,
      (SELECT COUNT(*) FROM samples s WHERE s.project_id = p.id) AS sample_count
      FROM projects p WHERE p.client_id = ? ORDER BY p.id DESC`, pu.client_id);
  }, open);

  // ----- Sample submissions -----
  r.get('/api/portal/submissions', (ctx) => {
    const pu = portalAuth(ctx);
    return all(`SELECT id, code, status, priority, sample_type, courier, tracking_no, ship_date, created_at, updated_at, json_array_length(samples) AS sample_count, json_array_length(method_ids) AS method_count
      FROM portal_submissions WHERE client_id = ? ORDER BY id DESC LIMIT 500`, pu.client_id);
  }, open);

  r.get('/api/portal/submissions/:id', (ctx) => {
    const pu = portalAuth(ctx);
    const sub = get('SELECT * FROM portal_submissions WHERE id = ? AND client_id = ?', +ctx.params.id, pu.client_id);
    if (!sub) throw notFound('Submission');
    const thread = get('SELECT id FROM portal_threads WHERE submission_id = ? AND client_id = ?', sub.id, pu.client_id);
    return { submission: submissionView(sub, { forClient: true }), thread_id: thread?.id ?? null };
  }, open);

  r.post('/api/portal/submissions', (ctx) => submitSamples(portalCtx(ctx, portalAuth(ctx)), ctx.portal, ctx.body), open);

  r.post('/api/portal/submissions/:id/withdraw', (ctx) => {
    const pu = portalAuth(ctx);
    const sub = get('SELECT * FROM portal_submissions WHERE id = ? AND client_id = ?', +ctx.params.id, pu.client_id);
    if (!sub) throw notFound('Submission');
    if (sub.status !== 'Submitted') throw bad(`This submission is ${sub.status.toLowerCase()} — contact the laboratory to change it`);
    tx(() => {
      update(portalCtx(ctx, pu), 'portal_submissions', sub.id, { status: 'Withdrawn', updated_at: nowIso() }, { action: 'STATUS', summary: 'Withdrawn by the client' });
      notice({ submission_id: sub.id }, `${pu.full_name} withdrew this submission.`);
    });
    return { ok: true };
  }, open);

  // ----- Method development / validation requests -----
  r.get('/api/portal/requests', (ctx) => {
    const pu = portalAuth(ctx);
    return all('SELECT id, code, type, title, product, technique, status, target_date, created_at, updated_at FROM portal_requests WHERE client_id = ? ORDER BY id DESC LIMIT 500', pu.client_id);
  }, open);

  r.get('/api/portal/requests/:id', (ctx) => {
    const pu = portalAuth(ctx);
    const req = get(`SELECT q.id, q.code, q.type, q.title, q.product, q.technique, q.parameters, q.scope, q.regulatory, q.target_date, q.status,
        q.response, q.responded_at, q.created_at, q.updated_at, p.code AS project_code, p.title AS project_title
      FROM portal_requests q LEFT JOIN projects p ON p.id = q.project_id WHERE q.id = ? AND q.client_id = ?`, +ctx.params.id, pu.client_id);
    if (!req) throw notFound('Request');
    req.parameters = json(req.parameters, []);
    const thread = get('SELECT id FROM portal_threads WHERE request_id = ? AND client_id = ?', req.id, pu.client_id);
    return { request: req, thread_id: thread?.id ?? null };
  }, open);

  r.post('/api/portal/requests', (ctx) => submitRequest(portalCtx(ctx, portalAuth(ctx)), ctx.portal, ctx.body), open);

  // ----- Messages -----
  r.get('/api/portal/threads', (ctx) => {
    const pu = portalAuth(ctx);
    return all(`SELECT t.id, t.subject, t.status, t.submission_id, t.request_id, t.sample_id, t.created_at, t.last_message_at, ${CLIENT_UNREAD} AS unread, ${LAST_MESSAGE}
      FROM portal_threads t WHERE t.client_id = ? ORDER BY t.last_message_at DESC LIMIT 500`, pu.client_id);
  }, open);

  r.get('/api/portal/threads/:id', (ctx) => {
    const pu = portalAuth(ctx);
    const t = get(`SELECT t.id, t.subject, t.status, t.submission_id, t.request_id, t.sample_id, t.created_at, t.last_message_at,
        su.code AS submission_code, rq.code AS request_code, s.code AS sample_code
      FROM portal_threads t LEFT JOIN portal_submissions su ON su.id = t.submission_id LEFT JOIN portal_requests rq ON rq.id = t.request_id
      LEFT JOIN samples s ON s.id = t.sample_id WHERE t.id = ? AND t.client_id = ?`, +ctx.params.id, pu.client_id);
    if (!t) throw notFound('Conversation');
    run('UPDATE portal_threads SET client_read_at = ? WHERE id = ?', nowIso(), t.id);
    return { thread: t, messages: threadMessages(t.id, { forClient: true }) };
  }, open);

  r.post('/api/portal/threads', (ctx) => {
    const pu = portalAuth(ctx);
    const b = clean(ctx.body, { subject: { required: true, max: 200 }, body: { type: 'text', required: true, max: 10000, label: 'message' }, sample_id: { type: 'id', label: 'sample' } });
    if (b.sample_id && !get('SELECT 1 FROM samples WHERE id = ? AND client_id = ?', b.sample_id, pu.client_id)) throw bad('Sample not found');
    return tx(() => {
      const id = createThread({ client_id: pu.client_id, subject: b.subject, sample_id: b.sample_id });
      postMessage(id, { portalUser: pu, body: b.body });
      audit(portalCtx(ctx, pu), { action: 'CREATE', entity: 'portal_threads', entity_id: id, summary: `Client message: ${b.subject}` });
      return { id };
    });
  }, open);

  r.post('/api/portal/threads/:id/messages', (ctx) => {
    const pu = portalAuth(ctx);
    const t = get('SELECT id FROM portal_threads WHERE id = ? AND client_id = ?', +ctx.params.id, pu.client_id);
    if (!t) throw notFound('Conversation');
    tx(() => postMessage(t.id, { portalUser: pu, body: ctx.body.body }));
    return { ok: true };
  }, open);

  // ===================================================================================
  // Staff side
  // ===================================================================================
  const staff = { perm: 'portal.view' };

  r.get('/api/portal-admin/summary', () => ({
    unread: get(`SELECT COUNT(*) n FROM portal_threads t WHERE ${LAB_UNREAD}`).n,
    submissions: get(`SELECT COUNT(*) n FROM portal_submissions WHERE status IN (${ph(SUBMISSION_OPEN)})`, ...SUBMISSION_OPEN).n,
    requests: get(`SELECT COUNT(*) n FROM portal_requests WHERE status IN (${ph(REQUEST_OPEN)})`, ...REQUEST_OPEN).n,
    accounts: get('SELECT COUNT(*) n FROM portal_users WHERE active = 1').n,
  }), staff);

  // ----- Threads -----
  r.get('/api/portal-admin/threads', (ctx) => {
    const where = [];
    const params = [];
    if (ctx.query.client_id) { where.push('t.client_id = ?'); params.push(+ctx.query.client_id); }
    if (ctx.query.unread) where.push(LAB_UNREAD);
    return all(`SELECT t.id, t.subject, t.status, t.client_id, c.name AS client_name, c.code AS client_code, t.submission_id, t.request_id, t.sample_id,
        t.created_at, t.last_message_at, ${LAB_UNREAD} AS unread, ${LAST_MESSAGE}
      FROM portal_threads t JOIN clients c ON c.id = t.client_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.last_message_at DESC LIMIT 500`, ...params);
  }, staff);

  r.get('/api/portal-admin/threads/:id', (ctx) => {
    const t = mustGet(`SELECT t.*, c.name AS client_name, c.code AS client_code, su.code AS submission_code, rq.code AS request_code, s.code AS sample_code
      FROM portal_threads t JOIN clients c ON c.id = t.client_id LEFT JOIN portal_submissions su ON su.id = t.submission_id
      LEFT JOIN portal_requests rq ON rq.id = t.request_id LEFT JOIN samples s ON s.id = t.sample_id WHERE t.id = ?`, +ctx.params.id, 'Conversation');
    run('UPDATE portal_threads SET lab_read_at = ? WHERE id = ?', nowIso(), t.id);
    return { thread: t, messages: threadMessages(t.id, { forClient: false }) };
  }, staff);

  r.post('/api/portal-admin/threads', (ctx) => {
    assertCan(ctx, 'portal.respond');
    const b = clean(ctx.body, { client_id: { type: 'id', ref: 'clients', required: true }, subject: { required: true, max: 200 }, body: { type: 'text', required: true, max: 10000, label: 'message' }, sample_id: { type: 'id', label: 'sample' } });
    if (b.sample_id && !get('SELECT 1 FROM samples WHERE id = ? AND client_id = ?', b.sample_id, b.client_id)) throw bad('That sample belongs to a different client');
    return tx(() => {
      const id = createThread({ client_id: b.client_id, subject: b.subject, sample_id: b.sample_id });
      postMessage(id, { user: ctx.user, body: b.body });
      audit(ctx, { action: 'CREATE', entity: 'portal_threads', entity_id: id, summary: `Message to client: ${b.subject}` });
      return { id };
    });
  }, staff);

  r.post('/api/portal-admin/threads/:id/messages', (ctx) => {
    assertCan(ctx, 'portal.respond');
    const t = mustGet('SELECT * FROM portal_threads WHERE id = ?', +ctx.params.id, 'Conversation');
    tx(() => postMessage(t.id, { user: ctx.user, body: ctx.body.body }));
    return { ok: true };
  }, staff);

  // ----- Submissions -----
  r.get('/api/portal-admin/submissions', (ctx) => {
    const status = ctx.query.status || 'open';
    const where = [];
    const params = [];
    if (status === 'open') { where.push(`su.status IN (${ph(SUBMISSION_OPEN)})`); params.push(...SUBMISSION_OPEN); }
    else if (status !== 'all') { where.push('su.status = ?'); params.push(status); }
    return all(`SELECT su.id, su.code, su.status, su.priority, su.sample_type, su.courier, su.tracking_no, su.ship_date, su.created_at, su.updated_at,
        json_array_length(su.samples) AS sample_count, json_array_length(su.method_ids) AS method_count,
        c.id AS client_id, c.name AS client_name, c.code AS client_code, pu.full_name AS submitted_by
      FROM portal_submissions su JOIN clients c ON c.id = su.client_id LEFT JOIN portal_users pu ON pu.id = su.portal_user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY su.id DESC LIMIT 500`, ...params);
  }, staff);

  r.get('/api/portal-admin/submissions/:id', (ctx) => {
    const sub = mustGet(`SELECT su.*, c.name AS client_name, c.code AS client_code, pu.full_name AS submitted_by, pu.email AS submitted_by_email,
        p.code AS project_code, p.title AS project_title, ak.full_name AS acknowledged_by_name, rb.full_name AS received_by_name
      FROM portal_submissions su JOIN clients c ON c.id = su.client_id LEFT JOIN portal_users pu ON pu.id = su.portal_user_id
      LEFT JOIN projects p ON p.id = su.project_id LEFT JOIN users ak ON ak.id = su.acknowledged_by LEFT JOIN users rb ON rb.id = su.received_by
      WHERE su.id = ?`, +ctx.params.id, 'Submission');
    const thread = get('SELECT id FROM portal_threads WHERE submission_id = ?', sub.id);
    return {
      submission: submissionView(sub, { forClient: false }),
      thread_id: thread?.id ?? null,
      projects: all(`SELECT id, code, title FROM projects WHERE client_id = ? AND status IN ('Quoted','Active','On Hold') ORDER BY code DESC`, sub.client_id),
    };
  }, staff);

  r.post('/api/portal-admin/submissions/:id/acknowledge', (ctx) => { acknowledgeSubmission(ctx, +ctx.params.id, ctx.body.note); return { ok: true }; }, staff);

  r.post('/api/portal-admin/submissions/:id/decline', (ctx) => {
    assertCan(ctx, 'portal.respond');
    const sub = openSubmission(+ctx.params.id);
    const reason = String(ctx.body.reason || '').trim();
    if (!reason) throw bad('Give the client a reason', 'REASON_REQUIRED');
    tx(() => {
      update(ctx, 'portal_submissions', sub.id, { status: 'Declined', status_note: reason, updated_at: nowIso() }, { action: 'STATUS', summary: 'Submission declined', reason });
      notice({ submission_id: sub.id }, `Submission declined by ${ctx.user.full_name}: ${reason}`);
    });
    return { ok: true };
  }, staff);

  r.post('/api/portal-admin/submissions/:id/receive', (ctx) => receiveSubmission(ctx, +ctx.params.id, ctx.body), staff);

  // ----- Method requests -----
  r.get('/api/portal-admin/requests', (ctx) => {
    const status = ctx.query.status || 'open';
    const where = [];
    const params = [];
    if (status === 'open') { where.push(`q.status IN (${ph(REQUEST_OPEN)})`); params.push(...REQUEST_OPEN); }
    else if (status !== 'all') { where.push('q.status = ?'); params.push(status); }
    return all(`SELECT q.id, q.code, q.type, q.title, q.product, q.technique, q.status, q.target_date, q.created_at, q.updated_at, q.project_id,
        c.id AS client_id, c.name AS client_name, c.code AS client_code, pu.full_name AS submitted_by, p.code AS project_code
      FROM portal_requests q JOIN clients c ON c.id = q.client_id LEFT JOIN portal_users pu ON pu.id = q.portal_user_id LEFT JOIN projects p ON p.id = q.project_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY q.id DESC LIMIT 500`, ...params);
  }, staff);

  r.get('/api/portal-admin/requests/:id', (ctx) => {
    const q = mustGet(`SELECT q.*, c.name AS client_name, c.code AS client_code, pu.full_name AS submitted_by, pu.email AS submitted_by_email,
        rb.full_name AS responded_by_name, p.code AS project_code, p.title AS project_title
      FROM portal_requests q JOIN clients c ON c.id = q.client_id LEFT JOIN portal_users pu ON pu.id = q.portal_user_id
      LEFT JOIN users rb ON rb.id = q.responded_by LEFT JOIN projects p ON p.id = q.project_id WHERE q.id = ?`, +ctx.params.id, 'Request');
    q.parameters = json(q.parameters, []);
    const thread = get('SELECT id FROM portal_threads WHERE request_id = ?', q.id);
    return { request: q, thread_id: thread?.id ?? null };
  }, staff);

  r.post('/api/portal-admin/requests/:id/status', (ctx) => { respondToRequest(ctx, +ctx.params.id, ctx.body); return { ok: true }; }, staff);

  r.post('/api/portal-admin/requests/:id/project', (ctx) => {
    const q = mustGet('SELECT * FROM portal_requests WHERE id = ?', +ctx.params.id, 'Request');
    if (q.project_id) throw bad('A project already exists for this request');
    if (q.status === 'Declined') throw bad('This request was declined');
    return tx(() => {
      const p = createProject(ctx, {
        client_id: q.client_id, title: ctx.body.title || q.title, type: PROJECT_TYPE_FOR[q.type] || 'Other', status: ctx.body.status || 'Quoted',
        lead_id: ctx.body.lead_id || null, due_date: q.target_date, description: [q.product && `Product: ${q.product}`, q.technique && `Technique: ${q.technique}`, q.scope].filter(Boolean).join('\n'),
      });
      update(ctx, 'portal_requests', q.id, { project_id: p.id, updated_at: nowIso() }, { summary: `Project ${p.code} opened from request` });
      notice({ request_id: q.id }, `Project ${p.code} opened for this work.`);
      return p;
    });
  }, staff);

  // ----- Portal accounts -----
  r.get('/api/portal-admin/accounts', (ctx) => {
    const where = ctx.query.client_id ? 'WHERE u.client_id = ?' : '';
    return all(`SELECT u.id, u.client_id, u.email, u.full_name, u.job_title, u.active, u.must_change_password, u.last_login_at, u.created_at,
        (u.locked_until IS NOT NULL AND u.locked_until > ?) AS locked, c.name AS client_name, c.code AS client_code, cb.full_name AS created_by_name
      FROM portal_users u JOIN clients c ON c.id = u.client_id LEFT JOIN users cb ON cb.id = u.created_by ${where} ORDER BY c.name, u.full_name`,
    nowIso(), ...(ctx.query.client_id ? [+ctx.query.client_id] : []));
  }, staff);

  r.post('/api/portal-admin/accounts', (ctx) => createPortalAccount(ctx, ctx.body), staff);

  r.post('/api/portal-admin/accounts/:id/reset', (ctx) => {
    assertCan(ctx, 'portal.manage');
    const pu = mustGet('SELECT * FROM portal_users WHERE id = ?', +ctx.params.id, 'Account');
    const password = tempPassword();
    tx(() => {
      update(ctx, 'portal_users', pu.id, { password_hash: hashPassword(password), must_change_password: 1, failed_logins: 0, locked_until: null }, { summary: 'Client portal password reset by the laboratory' });
      run('DELETE FROM portal_sessions WHERE portal_user_id = ?', pu.id);
    });
    return { email: pu.email, temp_password: password };
  }, staff);

  r.post('/api/portal-admin/accounts/:id/active', (ctx) => {
    assertCan(ctx, 'portal.manage');
    const pu = mustGet('SELECT * FROM portal_users WHERE id = ?', +ctx.params.id, 'Account');
    const active = ctx.body.active ? 1 : 0;
    tx(() => {
      update(ctx, 'portal_users', pu.id, { active }, { summary: active ? 'Client portal account reactivated' : 'Client portal account deactivated' });
      if (!active) run('DELETE FROM portal_sessions WHERE portal_user_id = ?', pu.id);
    });
    return { ok: true };
  }, staff);
}

/** Counts for the staff sidebar badge. */
export function portalBadge(user) {
  if (!can(user, 'portal.view')) return 0;
  return get(`SELECT
      (SELECT COUNT(*) FROM portal_threads t WHERE ${LAB_UNREAD})
    + (SELECT COUNT(*) FROM portal_submissions WHERE status = 'Submitted')
    + (SELECT COUNT(*) FROM portal_requests WHERE status = 'Submitted') AS n`).n;
}
