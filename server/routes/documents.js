// Word and Excel documents inside notebook entries.
//
// People keep working in the Office apps they know: a document opens in desktop Word/Excel through a
// one-time WebDAV link (ms-word:ofe|u|…), and every save lands here as a new, immutable version with its
// SHA-256 in the audit trail. Uploading a new version from the browser does the same for computers where
// direct saving isn't available. Signing the entry freezes the documents (also enforced by the database).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError, bad, clientIp, guard, notFound, readBody } from '../http.js';
import { nowIso, localDate } from '../util.js';
import { DATA_DIR, MAX_UPLOAD_BYTES, SESSION_MAX_HOURS } from '../config.js';
import { KINDS, kindOf, inspectOffice, makeDocx, makeXlsx, preview } from '../ooxml.js';
import { ENTRY_RULES } from './quality.js';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const SOURCES = { template: 'created in Aliquot', upload: 'uploaded', office: 'saved from' };

export const TEMPLATES = {
  docx: { kind: 'docx', label: 'Word document' },
  xlsx: { kind: 'xlsx', label: 'Excel workbook' },
  replicates: { kind: 'xlsx', label: 'Excel — replicate statistics (mean, SD, %RSD)' },
};

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

const DOC_SELECT = `
  SELECT d.*, n.status AS entry_status, n.author_id, n.code AS entry_code, n.title AS entry_title
  FROM notebook_documents d JOIN notebook_entries n ON n.id = d.entry_id`;

const getDoc = (id) => get(`${DOC_SELECT} WHERE d.id = ?`, id);

const latestVersion = (docId) => get(`SELECT v.*, u.full_name AS saved_by_name FROM notebook_document_versions v JOIN users u ON u.id = v.saved_by
  WHERE v.document_id = ? ORDER BY v.version DESC LIMIT 1`, docId);

/** Documents of an entry with their current version. */
export function listDocuments(entryId) {
  return all(`SELECT d.id, d.kind, d.filename, d.created_at, d.removed, d.removed_reason,
      v.version, v.size, v.sha256, v.source, v.saved_at, u.full_name AS saved_by_name
    FROM notebook_documents d
    JOIN notebook_document_versions v ON v.document_id = d.id
      AND v.version = (SELECT MAX(version) FROM notebook_document_versions WHERE document_id = d.id)
    JOIN users u ON u.id = v.saved_by
    WHERE d.entry_id = ? ORDER BY d.id`, entryId);
}

const entryOf = (doc) => get('SELECT * FROM notebook_entries WHERE id = ?', doc.entry_id);

function cleanFilename(name, kind) {
  let base = String(name || '').replace(/\.(docx|xlsx)$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!base || /^\.+$/.test(base)) base = KINDS[kind].label;
  return `${base}.${kind}`;
}

function storeFile(buf, sha) {
  const rel = path.join('files', sha.slice(0, 2), sha);
  const abs = path.join(DATA_DIR, rel);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
  }
  return rel;
}

const readVersion = (v) => {
  const abs = path.join(DATA_DIR, v.storage_path);
  if (!fs.existsSync(abs)) throw notFound('File');
  return fs.readFileSync(abs);
};

const sourceText = (source, kind) => (source === 'office' ? `saved from ${KINDS[kind].app}` : SOURCES[source] || source);

// ---------------------------------------------------------------------------------------------
// Creating documents and versions
// ---------------------------------------------------------------------------------------------

/** A new document for an entry from a template, filled in with the entry's reference details. */
export function templateFile(template, entry, author) {
  const t = TEMPLATES[template];
  if (!t) throw bad('Unknown template');
  const ref = `${entry.code} · ${author.full_name} · ${localDate()}`;
  if (t.kind === 'docx') {
    return makeDocx({ title: entry.title, creator: author.full_name, blocks: [{ heading: entry.title, level: 0 }, { p: ref, muted: true }, { heading: 'Notes', level: 1 }, { p: '' }] });
  }
  const head = [[{ v: 'Notebook entry', b: true }, entry.code], [{ v: 'Title', b: true }, entry.title], [{ v: 'Author', b: true }, author.full_name], []];
  if (template === 'replicates') {
    const rows = [...head, [{ v: 'Replicate', b: true }, { v: 'Result', b: true }, { v: 'Unit', b: true }]];
    for (let i = 1; i <= 6; i++) rows.push([i]);
    rows.push([], [{ v: 'Mean', b: true }, { f: 'IFERROR(AVERAGE(B6:B11),"")', v: '', dp: 3 }], [{ v: 'SD', b: true }, { f: 'IFERROR(STDEV.S(B6:B11),"")', v: '', dp: 4 }], [{ v: '%RSD', b: true }, { f: 'IFERROR(B14/B13*100,"")', v: '', dp: 2 }], [{ v: 'n', b: true }, { f: 'COUNT(B6:B11)', v: 0 }]);
    return makeXlsx({ title: entry.title, creator: author.full_name, sheets: [{ name: 'Replicates', cols: [16, 16, 10], rows }] });
  }
  return makeXlsx({ title: entry.title, creator: author.full_name, sheets: [{ name: 'Sheet1', cols: [16, 36], rows: head }] });
}

/**
 * Adds a document to a draft entry. content: Buffer of a .docx/.xlsx (validated). Returns { id, version }.
 * Used by the API (templates, uploads) and by the demo-data generator.
 */
export function createDocument(ctx, entryId, { kind, filename, content, source }) {
  const entry = get('SELECT * FROM notebook_entries WHERE id = ?', entryId);
  if (!entry) throw notFound('Notebook entry');
  guard(ENTRY_RULES.edit(entry, ctx.user));
  if (!KINDS[kind]) throw bad('Only Word (.docx) and Excel (.xlsx) files can be added');
  if (content.length > MAX_UPLOAD_BYTES) throw bad('The file is larger than 50 MB');
  inspectOffice(content, kind);
  const name = cleanFilename(filename, kind);
  if (get('SELECT 1 FROM notebook_documents WHERE entry_id = ? AND removed = 0 AND lower(filename) = lower(?)', entryId, name)) {
    throw bad(`This entry already has a document called “${name}”`);
  }
  const sha = sha256(content);
  const rel = storeFile(content, sha);
  return tx(() => {
    const t = nowIso();
    const id = Number(run('INSERT INTO notebook_documents (entry_id, kind, filename, created_by, created_at) VALUES (?, ?, ?, ?, ?)', entryId, kind, name, ctx.user.id, t).lastInsertRowid);
    run('INSERT INTO notebook_document_versions (document_id, version, size, sha256, storage_path, source, saved_by, saved_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)', id, content.length, sha, rel, source, ctx.user.id, t);
    run('UPDATE notebook_entries SET updated_at = ? WHERE id = ?', t, entryId);
    audit(ctx, {
      action: 'UPDATE', entity: 'notebook_entries', entity_id: entryId, entity_code: entry.code,
      summary: `${KINDS[kind].label} added: ${name} (${sourceText(source, kind)})`,
      changes: { [name]: [null, `v1 · SHA-256 ${sha}`] },
    });
    return { id, version: 1 };
  });
}

/** Stores a new version unless the content is identical to the current one. */
export function addVersion(ctx, doc, content, source) {
  if (doc.removed) throw bad('This document has been removed');
  guard(ENTRY_RULES.edit(entryOf(doc), ctx.user));
  inspectOffice(content, doc.kind);
  const sha = sha256(content);
  const prev = latestVersion(doc.id);
  if (prev?.sha256 === sha) return { version: prev.version, unchanged: true };
  const rel = storeFile(content, sha);
  return tx(() => {
    const t = nowIso();
    const version = (get('SELECT MAX(version) AS v FROM notebook_document_versions WHERE document_id = ?', doc.id).v || 0) + 1;
    run('INSERT INTO notebook_document_versions (document_id, version, size, sha256, storage_path, source, saved_by, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', doc.id, version, content.length, sha, rel, source, ctx.user.id, t);
    run('UPDATE notebook_entries SET updated_at = ? WHERE id = ?', t, doc.entry_id);
    audit(ctx, {
      action: 'UPDATE', entity: 'notebook_entries', entity_id: doc.entry_id, entity_code: doc.entry_code,
      summary: `${doc.filename} — version ${version} ${sourceText(source, doc.kind)}`,
      changes: { [doc.filename]: [prev ? `v${prev.version} · SHA-256 ${prev.sha256}` : null, `v${version} · SHA-256 ${sha}`] },
    });
    return { version };
  });
}

/** Called inside the signing transaction: records exactly which versions were signed and ends Office editing. */
export function freezeDocuments(ctx, entry) {
  const docs = listDocuments(entry.id).filter((d) => !d.removed);
  for (const d of docs) locks.delete(d.id);
  run('DELETE FROM document_edit_links WHERE document_id IN (SELECT id FROM notebook_documents WHERE entry_id = ?)', entry.id);
  if (!docs.length) return;
  audit(ctx, {
    action: 'UPDATE', entity: 'notebook_entries', entity_id: entry.id, entity_code: entry.code,
    summary: `Documents signed with the entry: ${docs.map((d) => `${d.filename} v${d.version}`).join(', ')}`.slice(0, 480),
    changes: Object.fromEntries(docs.map((d) => [d.filename, [null, `v${d.version} · SHA-256 ${d.sha256}`]])),
  });
}

// ---------------------------------------------------------------------------------------------
// WebDAV for desktop Word / Excel
// ---------------------------------------------------------------------------------------------
// Office opens   ms-word:ofe|u|http://<server>/dav/<token>/<filename>
// and then uses OPTIONS, HEAD/GET, PROPFIND, LOCK, PUT, UNLOCK on that URL. The random token in the path is
// the credential (Office can't send the browser's session cookie); it is tied to one user and one document,
// stored hashed, and expires with the maximum session length.

const locks = new Map(); // document id → { token, userId, owner, expires }
const LOCK_SECONDS = 3600;
const DAV_HEADERS = { DAV: '1,2', 'MS-Author-Via': 'DAV', Allow: 'OPTIONS, GET, HEAD, PUT, LOCK, UNLOCK, PROPFIND' };
const xmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createEditLink(ctx, doc) {
  if (doc.removed) throw bad('This document has been removed');
  guard(ENTRY_RULES.edit(entryOf(doc), ctx.user));
  const token = crypto.randomBytes(32).toString('base64url');
  const t = nowIso();
  const expires = new Date(Date.now() + SESSION_MAX_HOURS * 3600_000).toISOString();
  run('INSERT INTO document_edit_links (token, document_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', sha256(token), doc.id, ctx.user.id, t, expires);
  audit(ctx, { action: 'UPDATE', entity: 'notebook_entries', entity_id: doc.entry_id, entity_code: doc.entry_code, summary: `${doc.filename} opened for editing in ${KINDS[doc.kind].app}` });
  return { path: `/dav/${token}/${encodeURIComponent(doc.filename)}`, scheme: KINDS[doc.kind].scheme, app: KINDS[doc.kind].app, expires_at: expires };
}

function activeLock(docId) {
  const l = locks.get(docId);
  if (l && l.expires < Date.now()) {
    locks.delete(docId);
    return null;
  }
  return l || null;
}

const lockXml = (l, href) => `<D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>0</D:depth>${l.owner ? `<D:owner>${xmlEsc(l.owner)}</D:owner>` : ''}<D:timeout>Second-${Math.max(0, Math.round((l.expires - Date.now()) / 1000))}</D:timeout><D:locktoken><D:href>${l.token}</D:href></D:locktoken><D:lockroot><D:href>${xmlEsc(href)}</D:href></D:lockroot></D:activelock>`;

function propResponse(href, { collection, doc, ver, lock }) {
  const modified = new Date(ver.saved_at).toUTCString();
  const props = collection
    ? `<D:displayname>${xmlEsc(doc.entry_code)}</D:displayname><D:resourcetype><D:collection/></D:resourcetype><D:getlastmodified>${modified}</D:getlastmodified>`
    : `<D:displayname>${xmlEsc(doc.filename)}</D:displayname><D:resourcetype/><D:getcontentlength>${ver.size}</D:getcontentlength><D:getcontenttype>${KINDS[doc.kind].mime}</D:getcontenttype><D:getetag>"${ver.sha256}"</D:getetag><D:getlastmodified>${modified}</D:getlastmodified><D:creationdate>${doc.created_at}</D:creationdate><D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock><D:lockdiscovery>${lock ? lockXml(lock, href) : ''}</D:lockdiscovery>`;
  return `<D:response><D:href>${xmlEsc(href)}</D:href><D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}

const drain = (req) => readBody(req, 64 * 1024).catch(() => Buffer.alloc(0));

async function dav(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, { ...DAV_HEADERS, 'Content-Length': 0 }).end();
    return;
  }
  const [, , token = '', ...rest] = url.pathname.split('/');
  let name;
  try {
    name = decodeURIComponent(rest.join('/'));
  } catch {
    throw new HttpError(400, 'Bad request');
  }
  const link = token && get(`SELECT l.*, u.active FROM document_edit_links l JOIN users u ON u.id = l.user_id WHERE l.token = ?`, sha256(token));
  if (!link || link.expires_at < nowIso() || !link.active) throw new HttpError(404, 'This link has expired. Open the document again from Aliquot.');
  const doc = getDoc(link.document_id);
  if (!doc || doc.removed) throw new HttpError(404, 'Not found');
  const user = get('SELECT * FROM users WHERE id = ?', link.user_id);
  const ctx = { user, ip: clientIp(req) };
  const base = `/dav/${token}/`;
  const href = base + encodeURIComponent(doc.filename);
  const collection = !name;
  const editable = doc.entry_status === 'Draft' && doc.author_id === user.id;

  if (!collection && name !== doc.filename) {
    // Office never needs other files here; refuse rather than accept stray temp files.
    throw new HttpError(['PUT', 'LOCK'].includes(req.method) ? 403 : 404, 'Not found');
  }

  switch (req.method) {
    case 'PROPFIND': {
      await drain(req);
      const ver = latestVersion(doc.id);
      const lock = activeLock(doc.id);
      const parts = collection
        ? [propResponse(base, { collection: true, doc, ver }), ...(req.headers.depth === '0' ? [] : [propResponse(href, { doc, ver, lock })])]
        : [propResponse(href, { doc, ver, lock })];
      const body = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${parts.join('')}</D:multistatus>`;
      res.writeHead(207, { ...DAV_HEADERS, 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }).end(body);
      return;
    }
    case 'GET':
    case 'HEAD': {
      if (collection) throw new HttpError(405, 'Not a file');
      const ver = latestVersion(doc.id);
      const buf = readVersion(ver);
      res.writeHead(200, {
        ...DAV_HEADERS,
        'Content-Type': KINDS[doc.kind].mime,
        'Content-Length': buf.length,
        ETag: `"${ver.sha256}"`,
        'Last-Modified': new Date(ver.saved_at).toUTCString(),
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
      return;
    }
    case 'LOCK': {
      const body = (await drain(req)).toString('utf8');
      if (!editable) throw new HttpError(403, 'This entry is signed — the document is read-only');
      const existing = activeLock(doc.id);
      if (existing && existing.userId !== user.id) throw new HttpError(423, 'Locked');
      const timeout = Math.min(Number(/Second-(\d+)/i.exec(req.headers.timeout || '')?.[1]) || LOCK_SECONDS, LOCK_SECONDS);
      const isRefresh = !body.trim() && existing && String(req.headers.if || '').includes(existing.token);
      const lock = isRefresh ? existing : {
        token: `opaquelocktoken:${crypto.randomUUID()}`,
        userId: user.id,
        owner: /<(?:\w+:)?owner[^>]*>([\s\S]*?)<\/(?:\w+:)?owner>/i.exec(body)?.[1]?.replace(/<[^>]+>/g, '').trim().slice(0, 200) || user.full_name,
      };
      lock.expires = Date.now() + timeout * 1000;
      locks.set(doc.id, lock);
      const xml = `<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery>${lockXml(lock, href)}</D:lockdiscovery></D:prop>`;
      res.writeHead(200, { ...DAV_HEADERS, 'Lock-Token': `<${lock.token}>`, 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(xml) }).end(xml);
      return;
    }
    case 'UNLOCK': {
      await drain(req);
      const existing = activeLock(doc.id);
      const given = String(req.headers['lock-token'] || '').replace(/[<>\s]/g, '');
      if (existing && existing.token === given) locks.delete(doc.id);
      res.writeHead(204, DAV_HEADERS).end();
      return;
    }
    case 'PUT': {
      if (!editable) {
        await drain(req);
        throw new HttpError(403, 'This entry has been signed — changes can no longer be saved');
      }
      const existing = activeLock(doc.id);
      if (existing && existing.userId !== user.id) throw new HttpError(423, 'Locked');
      const buf = await readBody(req, MAX_UPLOAD_BYTES);
      const result = addVersion(ctx, getDoc(doc.id), buf, 'office');
      res.writeHead(204, { ...DAV_HEADERS, ETag: `"${sha256(buf)}"`, 'X-Aliquot-Version': String(result.version) }).end();
      return;
    }
    default:
      await drain(req);
      throw new HttpError(405, 'Method not allowed');
  }
}

export async function handleDav(req, res, url) {
  try {
    await dav(req, res, url);
  } catch (e) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const known = e instanceof HttpError;
    if (!known && /append-only/.test(e?.message || '')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('This entry has been signed — changes can no longer be saved');
      return;
    }
    if (!known) console.error(`[${nowIso()}] ${req.method} /dav`, e);
    res.writeHead(known ? e.status : 500, { ...DAV_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end(known ? e.message : 'Server error');
  }
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

const previewCache = new Map();

function mustDoc(id) {
  const d = getDoc(id);
  if (!d) throw notFound('Document');
  return d;
}

function versionOf(doc, v) {
  if (v == null || v === '') return latestVersion(doc.id);
  const row = get('SELECT * FROM notebook_document_versions WHERE document_id = ? AND version = ?', doc.id, Number(v));
  if (!row) throw notFound('Version');
  return row;
}

function uploadedName(ctx) {
  let filename = String(ctx.req.headers['x-filename'] || '');
  try { filename = decodeURIComponent(filename); } catch { /* keep the raw header value */ }
  return filename;
}

export default function routes(r) {
  r.get('/api/notebook/:id/documents', (ctx) => {
    if (!get('SELECT 1 FROM notebook_entries WHERE id = ?', +ctx.params.id)) throw notFound('Notebook entry');
    return listDocuments(+ctx.params.id);
  });

  r.post('/api/notebook/:id/documents', (ctx) => {
    const template = String(ctx.body.template || '');
    const t = TEMPLATES[template];
    if (!t) throw bad('Choose Word document or Excel workbook');
    const entry = get('SELECT * FROM notebook_entries WHERE id = ?', +ctx.params.id);
    if (!entry) throw notFound('Notebook entry');
    guard(ENTRY_RULES.edit(entry, ctx.user));
    const content = templateFile(template, entry, ctx.user);
    return createDocument(ctx, entry.id, { kind: t.kind, filename: ctx.body.name || (template === 'replicates' ? 'Replicate statistics' : t.label), content, source: 'template' });
  });

  r.post('/api/notebook/:id/documents/upload', (ctx) => {
    const filename = uploadedName(ctx);
    const kind = kindOf(filename);
    if (!kind) throw bad('Only Word (.docx) and Excel (.xlsx) files can be added here. Other files go under Files.');
    if (!ctx.rawBody?.length) throw bad('The file is empty');
    return createDocument(ctx, +ctx.params.id, { kind, filename, content: ctx.rawBody, source: 'upload' });
  }, { raw: true, limit: MAX_UPLOAD_BYTES });

  r.get('/api/notebook-documents/:id/versions', (ctx) => {
    const doc = mustDoc(+ctx.params.id);
    return all(`SELECT v.version, v.size, v.sha256, v.source, v.saved_at, u.full_name AS saved_by_name FROM notebook_document_versions v
      JOIN users u ON u.id = v.saved_by WHERE v.document_id = ? ORDER BY v.version DESC`, doc.id);
  });

  r.get('/api/notebook-documents/:id/file', (ctx) => {
    const doc = mustDoc(+ctx.params.id);
    const ver = versionOf(doc, ctx.query.version);
    const buf = readVersion(ver);
    const latest = latestVersion(doc.id);
    const name = ver.version === latest.version ? doc.filename : doc.filename.replace(/(\.\w+)$/, ` (v${ver.version})$1`);
    ctx.res.writeHead(200, {
      'Content-Type': KINDS[doc.kind].mime,
      'Content-Length': buf.length,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store',
    });
    ctx.res.end(buf);
    return undefined;
  });

  r.get('/api/notebook-documents/:id/preview', (ctx) => {
    const doc = mustDoc(+ctx.params.id);
    const ver = versionOf(doc, ctx.query.version);
    let p = previewCache.get(ver.sha256);
    if (!p) {
      p = preview(readVersion(ver), doc.kind);
      previewCache.set(ver.sha256, p);
      if (previewCache.size > 40) previewCache.delete(previewCache.keys().next().value);
    }
    return { kind: doc.kind, version: ver.version, ...p };
  });

  r.post('/api/notebook-documents/:id/versions', (ctx) => {
    const doc = mustDoc(+ctx.params.id);
    const filename = uploadedName(ctx);
    if (kindOf(filename) !== doc.kind) throw bad(`Upload a ${KINDS[doc.kind].label} (.${doc.kind}) as the new version of ${doc.filename}`);
    if (!ctx.rawBody?.length) throw bad('The file is empty');
    return addVersion(ctx, doc, ctx.rawBody, 'upload');
  }, { raw: true, limit: MAX_UPLOAD_BYTES });

  r.post('/api/notebook-documents/:id/edit-link', (ctx) => createEditLink(ctx, mustDoc(+ctx.params.id)));

  r.post('/api/notebook-documents/:id/remove', (ctx) => {
    const doc = mustDoc(+ctx.params.id);
    if (doc.removed) throw bad('Already removed');
    guard(ENTRY_RULES.edit(entryOf(doc), ctx.user));
    const reason = String(ctx.body.reason || '').trim();
    if (!reason) throw bad('A reason is required', 'REASON_REQUIRED');
    tx(() => {
      run('UPDATE notebook_documents SET removed = 1, removed_reason = ? WHERE id = ?', reason, doc.id);
      run('DELETE FROM document_edit_links WHERE document_id = ?', doc.id);
      audit(ctx, { action: 'UPDATE', entity: 'notebook_entries', entity_id: doc.entry_id, entity_code: doc.entry_code, summary: `Document removed: ${doc.filename} (all versions kept)`, reason });
    });
    locks.delete(doc.id);
    return { ok: true };
  });
}
