// Electronic lab notebook, investigations (OOS / deviations / CAPA) and file attachments.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, tx } from '../db.js';
import { insert, update, nextCode, mustGet } from '../repo.js';
import { audit } from '../audit.js';
import { bad, forbidden, notFound } from '../http.js';
import { assertCan, can, verifySignature, applySignature } from '../auth.js';
import { INVESTIGATION_TYPES, INVESTIGATION_STATUSES, SEVERITIES, ATTACHABLE, recordAccess } from '../lookups.js';
import { clean, nowIso, today, addBusinessDays, likeTerm } from '../util.js';
import { DATA_DIR, MAX_UPLOAD_BYTES } from '../config.js';
import { listDocuments, freezeDocuments } from './documents.js';

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
  if (n.author_id !== ctx.user.id) throw forbidden('Only the author can sign this entry');
  if (n.status !== 'Draft') throw bad('This entry has already been signed');
  if (!n.body.trim()) throw bad('The entry is empty');
  verifySignature(ctx, body.password);
  tx(() => {
    applySignature(ctx, 'notebook_entries', id, 'Authored', { comment: body.comment || null, code: n.code });
    freezeDocuments(ctx, n);
    update(ctx, 'notebook_entries', id, { status: 'Signed', signed_at: nowIso() }, { action: 'STATUS', summary: 'Signed by author — entry locked' });
  });
  return { ok: true };
}

export function witnessEntry(ctx, id, body) {
  assertCan(ctx, 'notebook.witness');
  const n = mustGet('SELECT * FROM notebook_entries WHERE id = ?', id, 'Entry');
  if (n.author_id === ctx.user.id) throw forbidden('You cannot witness your own entry');
  if (n.status !== 'Signed') throw bad('Only signed entries can be witnessed');
  verifySignature(ctx, body.password);
  tx(() => {
    applySignature(ctx, 'notebook_entries', id, 'Witnessed', { comment: body.comment || null, code: n.code });
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

export function createInvestigation(ctx, body) {
  assertCan(ctx, 'investigations.raise');
  const b = clean(body, investigationSchema);
  if (b.test_id && !b.sample_id) b.sample_id = get('SELECT sample_id FROM tests WHERE id = ?', b.test_id).sample_id;
  if (b.sample_id && !b.project_id) b.project_id = get('SELECT project_id FROM samples WHERE id = ?', b.sample_id).project_id;
  return tx(() => {
    const code = nextCode(INVESTIGATION_TYPES[b.type], { pad: 3 });
    const id = insert(ctx, 'investigations', {
      code, ...b, status: 'Open', raised_by: ctx.user.id, raised_at: nowIso(),
      due_date: b.due_date ?? addBusinessDays(today(), b.severity === 'Critical' ? 5 : 20),
    }, { summary: `${b.type} raised` });
    return { id, code };
  });
}

export function updateInvestigation(ctx, id, body) {
  const v = mustGet('SELECT * FROM investigations WHERE id = ?', id, 'Investigation');
  if (v.status === 'Closed') throw bad('Closed investigations are locked');
  if (!can(ctx.user, 'investigations.raise') && !can(ctx.user, 'investigations.close')) throw forbidden();
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
 * Closes an investigation with an e-signature, from the Investigations screen or the Test page. A root cause and
 * conclusion given here are recorded with the closure; otherwise the ones already recorded must be filled in.
 */
export function closeInvestigation(ctx, id, body) {
  assertCan(ctx, 'investigations.close');
  const v = mustGet('SELECT * FROM investigations WHERE id = ?', id, 'Investigation');
  if (v.status === 'Closed') throw bad('Already closed');
  if (v.test_id && get('SELECT analyst_id FROM tests WHERE id = ?', v.test_id)?.analyst_id === ctx.user.id) {
    throw forbidden('You performed the test under investigation — someone independent must close it');
  }
  const given = clean(body, { root_cause: { type: 'text' }, conclusion: { type: 'text' } }, { partial: true });
  const findings = Object.fromEntries(Object.entries(given).filter(([, text]) => text));
  if (!(findings.root_cause ?? v.root_cause)?.trim()) throw bad('Record the root cause before closing');
  if (!(findings.conclusion ?? v.conclusion)?.trim()) throw bad('Record a conclusion before closing');
  verifySignature(ctx, body.password);
  tx(() => {
    update(ctx, 'investigations', id, { ...findings, status: 'Closed', closed_by: ctx.user.id, closed_at: nowIso() }, { action: 'STATUS', summary: 'Investigation closed' });
    applySignature(ctx, 'investigations', id, v.type === 'OOS' ? 'OOS investigation closed' : 'Closed', { comment: body.comment || null, code: v.code });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------------------------

const canAny = (user, perms) => perms === null || perms.some((p) => can(user, p));

function assertAttachmentAccess(ctx, entity, id, mode) {
  if (!ATTACHABLE.includes(entity)) throw bad('Unknown record type');
  const rule = recordAccess(entity);
  if (!canAny(ctx.user, rule.view)) throw forbidden();
  if (mode === 'edit') {
    if (!canAny(ctx.user, rule.edit)) throw forbidden('You cannot add or remove files on this record');
    if (entity === 'tests') {
      const t = get('SELECT analyst_id FROM tests WHERE id = ?', id);
      if (t && t.analyst_id !== ctx.user.id && !can(ctx.user, 'tests.assign')) throw forbidden('Only the assigned analyst can attach files to this test');
    }
    if (entity === 'notebook_entries') {
      const n = get('SELECT author_id FROM notebook_entries WHERE id = ?', id);
      if (n && n.author_id !== ctx.user.id) throw forbidden('Only the author can attach files to this entry');
    }
  }
}

/** Records that are signed off cannot gain or lose attachments. */
function attachmentLock(entity, id) {
  if (entity === 'invoices' && get(`SELECT 1 FROM invoices WHERE id = ? AND status != 'Draft'`, id)) return 'Issued invoices are locked';
  if (entity === 'tests') {
    const t = get('SELECT status FROM tests WHERE id = ?', id);
    if (!t) return 'Record not found';
    if (['Submitted', 'Reviewed', 'Approved', 'Cancelled'].includes(t.status)) return `The test is ${t.status.toLowerCase()} — attachments are locked`;
  }
  if (entity === 'notebook_entries') {
    const n = get('SELECT status FROM notebook_entries WHERE id = ?', id);
    if (!n) return 'Record not found';
    if (n.status !== 'Draft') return 'Signed notebook entries are locked — add an addendum instead';
  }
  if (entity === 'investigations' && get(`SELECT 1 FROM investigations WHERE id = ? AND status = 'Closed'`, id)) return 'Closed investigations are locked';
  if (!get(`SELECT 1 FROM ${entity} WHERE id = ?`, id)) return 'Record not found';
  return null;
}

const safeMime = (m) => (/^[\w.+-]+\/[\w.+-]+$/.test(m || '') ? m : 'application/octet-stream');

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
    if (q.q) { const t = likeTerm(q.q); where.push(`(n.code LIKE ? ESCAPE '\\' OR n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\' OR n.tags LIKE ? ESCAPE '\\')`); params.push(t, t, t, t); }
    return all(`${NOTEBOOK_SELECT.replace('SELECT n.*', 'SELECT n.id, n.code, n.title, n.status, n.tags, n.project_id, n.sample_id, n.method_id, n.author_id, n.signed_at, n.witnessed_at, n.created_at, n.updated_at, substr(n.body, 1, 220) AS excerpt, (SELECT COUNT(*) FROM notebook_documents d WHERE d.entry_id = n.id AND d.removed = 0) AS doc_count')}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY n.updated_at DESC LIMIT 500`, ...params);
  }, { module: 'notebook' });

  r.get('/api/notebook/:id', (ctx) => {
    const id = +ctx.params.id;
    const entry = mustGet(`${NOTEBOOK_SELECT} WHERE n.id = ?`, id, 'Notebook entry');
    return {
      entry,
      addenda: all('SELECT a.*, u.full_name AS author_name FROM notebook_addenda a JOIN users u ON u.id = a.author_id WHERE a.entry_id = ? ORDER BY a.id', id),
      signatures: all(`SELECT * FROM signatures WHERE entity = 'notebook_entries' AND entity_id = ? ORDER BY id`, id),
      documents: listDocuments(id),
      can: {
        edit: entry.author_id === ctx.user.id && entry.status === 'Draft',
        sign: entry.author_id === ctx.user.id && entry.status === 'Draft',
        witness: can(ctx.user, 'notebook.witness') && entry.status === 'Signed' && entry.author_id !== ctx.user.id,
        addendum: can(ctx.user, 'notebook.write') && entry.status !== 'Draft',
      },
    };
  }, { module: 'notebook' });

  r.post('/api/notebook', (ctx) => createEntry(ctx, ctx.body), { module: 'notebook' });

  r.put('/api/notebook/:id', (ctx) => {
    const id = +ctx.params.id;
    const n = mustGet('SELECT * FROM notebook_entries WHERE id = ?', id, 'Entry');
    if (n.author_id !== ctx.user.id) throw forbidden('Only the author can edit this entry');
    if (n.status !== 'Draft') throw bad('Signed entries are locked — add an addendum instead');
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
  }, { module: 'notebook' });

  r.post('/api/notebook/:id/sign', (ctx) => signEntry(ctx, +ctx.params.id, ctx.body), { module: 'notebook' });
  r.post('/api/notebook/:id/witness', (ctx) => witnessEntry(ctx, +ctx.params.id, ctx.body), { module: 'notebook' });

  r.post('/api/notebook/:id/addenda', (ctx) => {
    assertCan(ctx, 'notebook.write');
    const id = +ctx.params.id;
    const n = mustGet('SELECT * FROM notebook_entries WHERE id = ?', id, 'Entry');
    if (n.status === 'Draft') throw bad('Edit the draft directly instead of adding an addendum');
    const text = String(ctx.body.body || '').trim();
    if (!text) throw bad('The addendum is empty');
    insert(ctx, 'notebook_addenda', { entry_id: id, author_id: ctx.user.id, body: text, created_at: nowIso() }, { code: n.code, summary: 'Addendum added' });
    return { ok: true };
  }, { module: 'notebook' });

  // ----- Investigations -----
  r.get('/api/investigations', (ctx) => {
    const q = ctx.query;
    const where = [];
    const params = [];
    if (q.status === 'open') where.push(`v.status != 'Closed'`);
    else if (q.status && q.status !== 'all') { where.push('v.status = ?'); params.push(q.status); }
    if (q.type) { where.push('v.type = ?'); params.push(q.type); }
    return all(`${INV_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY v.status = 'Closed', v.id DESC`, ...params);
  }, { module: 'investigations' });

  r.get('/api/investigations/:id', (ctx) => {
    const id = +ctx.params.id;
    const investigation = mustGet(`${INV_SELECT} WHERE v.id = ?`, id, 'Investigation');
    return {
      investigation,
      results: investigation.test_id ? all('SELECT * FROM results WHERE test_id = ? ORDER BY sort_order, id', investigation.test_id) : [],
      signatures: all(`SELECT * FROM signatures WHERE entity = 'investigations' AND entity_id = ? ORDER BY id`, id),
      can: {
        edit: investigation.status !== 'Closed' && (can(ctx.user, 'investigations.raise') || can(ctx.user, 'investigations.close')),
        close: investigation.status !== 'Closed' && can(ctx.user, 'investigations.close'),
      },
    };
  }, { module: 'investigations' });

  r.post('/api/investigations', (ctx) => createInvestigation(ctx, ctx.body), { module: 'investigations' });
  r.put('/api/investigations/:id', (ctx) => updateInvestigation(ctx, +ctx.params.id, ctx.body), { module: 'investigations' });
  r.post('/api/investigations/:id/close', (ctx) => closeInvestigation(ctx, +ctx.params.id, ctx.body), { module: 'investigations' });

  // ----- Attachments -----
  r.get('/api/attachments', (ctx) => {
    const { entity, id } = ctx.query;
    assertAttachmentAccess(ctx, entity, +id, 'view');
    return all(`SELECT a.id, a.filename, a.mime, a.size, a.sha256, a.uploaded_at, a.removed, a.removed_reason, u.full_name AS uploaded_by_name
      FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC`, entity, +id);
  });

  r.post('/api/attachments', async (ctx) => {
    const { entity } = ctx.query;
    const id = +ctx.query.id;
    assertAttachmentAccess(ctx, entity, id, 'edit');
    const lock = attachmentLock(entity, id);
    if (lock) throw bad(lock);
    let filename = String(ctx.req.headers['x-filename'] || 'file');
    try { filename = decodeURIComponent(filename); } catch { /* keep the raw header value */ }
    filename = filename.replace(/[\\/\0\r\n]/g, '_').slice(0, 200) || 'file';
    const buf = ctx.rawBody;
    if (!buf?.length) throw bad('The file is empty');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const rel = path.join('files', sha256.slice(0, 2), sha256);
    const abs = path.join(DATA_DIR, rel);
    if (!fs.existsSync(abs)) {
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      await fs.promises.writeFile(abs, buf);
    }
    const code = get(`SELECT * FROM ${entity} WHERE id = ?`, id);
    const newId = insert(ctx, 'attachments', {
      entity, entity_id: id, filename, mime: safeMime(ctx.req.headers['content-type']), size: buf.length, sha256, storage_path: rel,
      uploaded_by: ctx.user.id, uploaded_at: nowIso(),
    }, { code: code?.code ?? null, summary: `File attached: ${filename}` });
    return { id: newId };
  }, { raw: true, limit: MAX_UPLOAD_BYTES });

  r.get('/api/attachments/:id/file', (ctx) => {
    const a = mustGet('SELECT * FROM attachments WHERE id = ?', +ctx.params.id, 'Attachment');
    assertAttachmentAccess(ctx, a.entity, a.entity_id, 'view');
    const abs = path.join(DATA_DIR, a.storage_path);
    if (!fs.existsSync(abs)) throw notFound('File');
    const inline = ctx.query.inline && /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(a.mime);
    ctx.res.writeHead(200, {
      'Content-Type': inline ? a.mime : 'application/octet-stream',
      'Content-Length': a.size,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      'Content-Security-Policy': a.mime === 'application/pdf' && inline ? "default-src 'none'; object-src 'self'" : "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'Cache-Control': 'private, max-age=3600',
    });
    fs.createReadStream(abs).pipe(ctx.res);
    return undefined;
  });

  r.post('/api/attachments/:id/remove', (ctx) => {
    const a = mustGet('SELECT * FROM attachments WHERE id = ?', +ctx.params.id, 'Attachment');
    if (a.removed) throw bad('Already removed');
    assertAttachmentAccess(ctx, a.entity, a.entity_id, 'edit');
    if (a.uploaded_by !== ctx.user.id && !['admin', 'manager'].includes(ctx.user.role)) throw forbidden('Only the uploader or a manager can remove this file');
    const lock = attachmentLock(a.entity, a.entity_id);
    if (lock) throw bad(lock);
    const reason = String(ctx.body.reason || '').trim();
    if (!reason) throw bad('A reason is required', 'REASON_REQUIRED');
    // The file itself is kept for the record; it is only hidden from the record's file list.
    update(ctx, 'attachments', a.id, { removed: 1, removed_reason: reason }, { summary: `File removed: ${a.filename}`, reason });
    return { ok: true };
  });
}
