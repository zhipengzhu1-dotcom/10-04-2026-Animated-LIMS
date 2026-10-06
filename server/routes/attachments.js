// File attachments on records, kept for the record when removed, and locked when the record's own `attach` rule says so.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all } from '../db.js';
import { insert, update, mustGet } from '../repo.js';
import { bad, forbidden, notFound, guard, flags, locks } from '../http.js';
import { can } from '../auth.js';
import { RECORD_ACCESS } from '../lookups.js';
import { nowIso } from '../util.js';
import { DATA_DIR, MAX_UPLOAD_BYTES } from '../config.js';
import { TEST_RULES, SAMPLE_RULES } from '../workflow.js';
import { INVESTIGATION_RULES } from '../investigations.js';
import { ENTRY_RULES } from './quality.js';
import { METHOD_RULES, INSTRUMENT_RULES, INVENTORY_RULES } from './resources.js';
import { CLIENT_RULES, PROJECT_RULES, INVOICE_RULES } from './business.js';

/** Each record type that takes files, with the rules table whose `attach` rule decides when they can change. */
export const ATTACHABLE = {
  samples: SAMPLE_RULES, tests: TEST_RULES, methods: METHOD_RULES, notebook_entries: ENTRY_RULES, investigations: INVESTIGATION_RULES,
  instruments: INSTRUMENT_RULES, inventory: INVENTORY_RULES, projects: PROJECT_RULES, clients: CLIENT_RULES, invoices: INVOICE_RULES,
};

const recordOf = (entity, id) => mustGet(`SELECT * FROM ${entity} WHERE id = ?`, id, 'Record');

/** The record whose files `ctx.user` asks about, once they may see it. */
function viewable(ctx, entity, id) {
  if (!Object.hasOwn(ATTACHABLE, entity)) throw bad('Unknown record type');
  const { view } = RECORD_ACCESS[entity];
  if (view && !view.some((p) => can(ctx.user, p))) throw forbidden();
  return recordOf(entity, id);
}

export const ATTACHMENT_RULES = {
  remove(a, me) {
    if (a.removed) return bad('Already removed');
    const locked = ATTACHABLE[a.entity].attach(recordOf(a.entity, a.entity_id), me);
    if (locked) return locked;
    if (a.uploaded_by !== me.id && !['admin', 'manager'].includes(me.role)) return forbidden('Only the uploader or a manager can remove this file');
  },
};

const safeMime = (m) => (/^[\w.+-]+\/[\w.+-]+$/.test(m || '') ? m : 'application/octet-stream');

export default function routes(r) {
  r.get('/api/attachments', (ctx) => {
    const { entity } = ctx.query;
    const id = +ctx.query.id;
    const record = viewable(ctx, entity, id);
    const files = all(`SELECT a.id, a.entity, a.entity_id, a.filename, a.mime, a.size, a.sha256, a.uploaded_by, a.uploaded_at, a.removed, a.removed_reason, u.full_name AS uploaded_by_name
      FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC`, entity, id);
    const lock = locks(ATTACHABLE[entity], record, ctx.user, 'attach');
    return { can: { attach: !lock.attach }, locks: lock, files: files.map((f) => ({ ...f, can: flags(ATTACHMENT_RULES, f, ctx.user) })) };
  });

  r.post('/api/attachments', async (ctx) => {
    const { entity } = ctx.query;
    const id = +ctx.query.id;
    const record = viewable(ctx, entity, id);
    guard(ATTACHABLE[entity].attach(record, ctx.user));
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
    const newId = insert(ctx, 'attachments', {
      entity, entity_id: id, filename, mime: safeMime(ctx.req.headers['content-type']), size: buf.length, sha256, storage_path: rel,
      uploaded_by: ctx.user.id, uploaded_at: nowIso(),
    }, { code: record.code ?? null, summary: `File attached: ${filename}` });
    return { id: newId };
  }, { raw: true, limit: MAX_UPLOAD_BYTES });

  r.get('/api/attachments/:id/file', (ctx) => {
    const a = mustGet('SELECT * FROM attachments WHERE id = ?', +ctx.params.id, 'Attachment');
    viewable(ctx, a.entity, a.entity_id);
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
    viewable(ctx, a.entity, a.entity_id);
    guard(ATTACHMENT_RULES.remove(a, ctx.user));
    const reason = String(ctx.body.reason || '').trim();
    if (!reason) throw bad('A reason is required', 'REASON_REQUIRED');
    // The file itself is kept for the record; it is only hidden from the record's file list.
    update(ctx, 'attachments', a.id, { removed: 1, removed_reason: reason }, { summary: `File removed: ${a.filename}`, reason });
    return { ok: true };
  });
}
