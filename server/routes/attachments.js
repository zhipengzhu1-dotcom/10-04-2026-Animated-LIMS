// File attachments on records, kept for the record when removed and locked once the record is signed off.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get } from '../db.js';
import { insert, update, mustGet } from '../repo.js';
import { bad, forbidden, notFound } from '../http.js';
import { can } from '../auth.js';
import { ATTACHABLE, RECORD_ACCESS } from '../lookups.js';
import { nowIso } from '../util.js';
import { DATA_DIR, MAX_UPLOAD_BYTES } from '../config.js';
import { TEST_EDITABLE } from '../workflow.js';

const canAny = (user, perms) => perms === null || perms.some((p) => can(user, p));

function assertAttachmentAccess(ctx, entity, id, mode) {
  if (!ATTACHABLE.includes(entity)) throw bad('Unknown record type');
  const rule = RECORD_ACCESS[entity];
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
    if (!TEST_EDITABLE.includes(t.status)) return `The test is ${t.status.toLowerCase()} — attachments are locked`;
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

export default function routes(r) {
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
