// Word and Excel documents inside a notebook entry: open in the desktop apps (saves come straight back as
// new versions), upload a version from any computer, preview in the page, and see exactly what was signed.
import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { icon } from '../core/icons.js';
import { card, field, openForm, openModal, promptReason, toast, showError, fmtDateTime, relTime, fileSize, busy } from '../core/ui.js';

export const DOC_KINDS = {
  docx: { app: 'Word', label: 'Word document', letter: 'W' },
  xlsx: { app: 'Excel', label: 'Excel workbook', letter: 'X' },
};
export const DOC_TEMPLATES = [
  ['xlsx', 'Excel workbook', 'Excel workbook'],
  ['replicates', 'Excel — replicate statistics (mean, SD, %RSD)', 'Replicate statistics'],
  ['docx', 'Word document', 'Word document'],
];

const SOURCE = { template: 'created', upload: 'uploaded', office: 'saved from' };
const sourceText = (d) => (d.source === 'office' ? `saved from ${DOC_KINDS[d.kind].app}` : SOURCE[d.source] || d.source);
const shortHash = (h) => `${h.slice(0, 8)}…`;

/** Opens a document in desktop Word/Excel through a one-time WebDAV link. */
export async function openInOffice(doc) {
  const link = await api.post(`/api/notebook-documents/${doc.id}/edit-link`);
  // ms-excel:ofe|u|<url> = "open for edit"; the Office app then saves back to the same URL.
  window.location.href = `${link.scheme}:ofe|u|${location.origin}${link.path}`;
  toast(`Opening ${doc.filename} in ${link.app}… Each save (Ctrl+S) appears here as a new version.`, 'info', { timeout: 9000 });
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files[0] || null), { once: true });
    input.click();
  });
}

// ---------------------------------------------------------------------------------------------
// Preview rendering (data comes from the server already parsed; everything is escaped here)
// ---------------------------------------------------------------------------------------------

const colName = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const cellPos = (ref) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { c: [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1, r: Number(m[2]) - 1 } : null;
};

function sheetGrid(sheet) {
  if (!sheet.rows.length) return html`<p class="muted small doc-empty">This sheet is empty.</p>`;
  const cols = Math.max(...sheet.rows.map((r) => r.length));
  const span = new Map();
  const covered = new Set();
  for (const ref of sheet.merges || []) {
    const [a, b] = ref.split(':').map(cellPos);
    if (!a || !b) continue;
    span.set(`${a.r},${a.c}`, { rows: b.r - a.r + 1, cols: b.c - a.c + 1 });
    for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) if (r !== a.r || c !== a.c) covered.add(`${r},${c}`);
  }
  const isNum = (v) => /^-?[\d.,]+(\s?%)?$|^-?\d+(\.\d+)?E[+-]?\d+$/i.test(v);
  return html`<div class="sheet-grid"><table>
    <thead><tr><th></th>${Array.from({ length: cols }, (_, c) => html`<th>${colName(c)}</th>`)}</tr></thead>
    <tbody>${sheet.rows.map((row, r) => html`<tr><th>${r + 1}</th>${Array.from({ length: cols }, (_, c) => {
      const key = `${r},${c}`;
      if (covered.has(key)) return '';
      const s = span.get(key);
      const v = row[c] ?? '';
      return html`<td class="${isNum(v) ? 'n' : ''}" ${s ? raw(`colspan="${s.cols}" rowspan="${s.rows}"`) : ''}>${v}</td>`;
    })}</tr>`)}</tbody>
  </table></div>${sheet.truncated ? html`<p class="muted small doc-empty">Preview shows the first 400 rows and 40 columns — open or download the file for the rest.</p>` : ''}`;
}

function docBlocks(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'h') out.push(b.level <= 1 ? html`<h2>${b.text}</h2>` : html`<h3>${b.text}</h3>`);
    else if (b.type === 'table') out.push(html`<div class="md-table"><table>${b.rows.map((r, k) => html`<tr>${r.map((c) => (k === 0 ? html`<th>${c}</th>` : html`<td>${c}</td>`))}</tr>`)}</table></div>`);
    else if (b.list) {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'p' && blocks[i].list) items.push(blocks[i++].text);
      i--;
      out.push(html`<ul>${items.map((t) => html`<li>${t}</li>`)}</ul>`);
    } else if (b.text.trim()) out.push(html`<p>${b.text}</p>`);
  }
  return out.length ? html`<div class="md doc-text">${out}</div>` : html`<p class="muted small doc-empty">This document has no text yet.</p>`;
}

async function renderPreview(el, doc, version) {
  el.innerHTML = '<div class="loading-block"></div>';
  try {
    const p = await api.get(`/api/notebook-documents/${doc.id}/preview`, { version });
    if (p.kind === 'docx') {
      el.innerHTML = String(docBlocks(p.blocks));
      return;
    }
    const draw = (i) => {
      el.innerHTML = String(html`
        ${p.sheets.length > 1 ? html`<div class="mini-tabs sheet-tabs">${p.sheets.map((s, k) => html`<button type="button" class="${k === i ? 'active' : ''}" data-sheet="${k}">${s.name}</button>`)}</div>` : ''}
        ${p.sheets[i] ? sheetGrid(p.sheets[i]) : html`<p class="muted small doc-empty">No visible sheets.</p>`}`);
      el.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => draw(Number(b.dataset.sheet))));
    };
    draw(0);
  } catch (e) {
    el.innerHTML = String(html`<p class="muted small doc-empty">${icon('info', { size: 13 })} Preview not available: ${e.message}</p>`);
  }
}

// ---------------------------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------------------------

/** Placeholder card; mountDocuments() fills it. Hidden on read-only entries without documents. */
export function documentsCard({ docs, editable }) {
  if (!Array.isArray(docs)) return ''; // server without document support (e.g. not restarted after an update)
  if (!editable && !docs.some((d) => !d.removed)) return '';
  return card({
    cls: 'docs-card',
    title: html`<span class="row">${icon('method', { size: 15 })}Word & Excel</span>`,
    actions: editable ? html`<div class="dropdown">
      <button type="button" class="btn sm" data-dd>${icon('plus', { size: 13 })}Add${icon('chevronDown', { size: 12 })}</button>
      <div class="dropdown-menu" hidden>
        ${DOC_TEMPLATES.map(([key, label]) => html`<button type="button" data-new-doc="${key}"><span class="doc-ic sm ${key === 'docx' ? 'docx' : 'xlsx'}">${key === 'docx' ? 'W' : 'X'}</span>New ${label}</button>`)}
        <hr><button type="button" data-new-doc="upload">${icon('upload')}Upload .docx / .xlsx…</button>
      </div></div>` : '',
    flush: true,
    body: html`<div data-docs></div>`,
  });
}

function docRow(d, { editable, signed }) {
  const k = DOC_KINDS[d.kind];
  return html`<li class="doc-row" data-doc="${d.id}">
    <span class="doc-ic ${d.kind}" aria-hidden="true">${k.letter}</span>
    <div class="grow">
      <button type="button" class="doc-name" data-act="preview" aria-expanded="false" title="Show preview">${d.filename}</button>
      <div class="meta">v${d.version} · ${sourceText(d)} by ${d.saved_by_name} · <span title="${fmtDateTime(d.saved_at)}">${relTime(d.saved_at)}</span> · ${fileSize(d.size)}</div>
    </div>
    ${signed ? html`<span class="chip doc-hash" title="Signed version ${d.version} · SHA-256 ${d.sha256}">${icon('lock', { size: 11 })}v${d.version} · ${shortHash(d.sha256)}</span>` : ''}
    ${editable ? html`<button type="button" class="btn sm" data-act="open" title="Edit in desktop ${k.app}; saves come back here">${icon('external', { size: 13 })}<span class="hide-sm">Open in ${k.app}</span></button>` : html`<a class="btn sm ghost" href="/api/notebook-documents/${d.id}/file" download title="Download">${icon('download', { size: 13 })}</a>`}
    <div class="dropdown">
      <button type="button" class="icon-btn" data-dd aria-label="More actions for ${d.filename}">${icon('more', { size: 16 })}</button>
      <div class="dropdown-menu" hidden>
        <a href="/api/notebook-documents/${d.id}/file" download>${icon('download')}Download</a>
        ${editable ? html`<button type="button" data-act="upload">${icon('upload')}Upload new version…</button>` : ''}
        <button type="button" data-act="versions">${icon('history')}Version history</button>
        ${editable ? html`<hr><button type="button" data-act="remove">${icon('trash')}Remove…</button>` : ''}
      </div>
    </div>
  </li>
  <li class="doc-preview" data-preview-for="${d.id}" hidden></li>`;
}

async function showVersions(doc) {
  const rows = await api.get(`/api/notebook-documents/${doc.id}/versions`);
  openModal({
    title: html`${icon('history', { size: 17 })}${doc.filename}`,
    size: 'lg',
    body: html`<p class="muted small" style="margin-top:0">Every save is kept. The SHA-256 fingerprint identifies each version exactly — the signed version's fingerprint is also in the audit trail.</p>
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th>Version</th><th>Saved</th><th>By</th><th>How</th><th class="right">Size</th><th>SHA-256</th><th></th></tr></thead>
        <tbody>${rows.map((v) => html`<tr>
          <td><strong>v${v.version}</strong></td>
          <td class="nowrap">${fmtDateTime(v.saved_at)}</td>
          <td class="nowrap">${v.saved_by_name}</td>
          <td class="nowrap">${sourceText({ ...v, kind: doc.kind })}</td>
          <td class="right num nowrap">${fileSize(v.size)}</td>
          <td><code class="small" title="${v.sha256}">${shortHash(v.sha256)}</code></td>
          <td class="right"><a class="btn sm ghost" href="/api/notebook-documents/${doc.id}/file?version=${v.version}" download>${icon('download', { size: 13 })}</a></td>
        </tr>`)}</tbody>
      </table></div>`,
  });
}

/**
 * Wires the documents card. entry: the notebook entry; editable: the entry's `edit` flag.
 * Returns { docs(): current list, refresh() }.
 */
export function mountDocuments(root, entry, { docs: initial, editable, isCurrent, beforeOpen }) {
  const host = root.querySelector('.docs-card [data-docs]');
  if (!host) return { docs: () => initial || [], refresh: async () => {} };
  let docs = initial;
  const signed = entry.status !== 'Draft';
  const openPreviews = new Set();

  const draw = () => {
    const visible = docs.filter((d) => !d.removed);
    const removed = docs.filter((d) => d.removed);
    host.innerHTML = String(html`
      ${visible.length ? html`<ul class="list docs">${visible.map((d) => docRow(d, { editable, signed }))}</ul>` : html`
        <div class="docs-empty">
          <p>Keep calculations and write-ups in <strong>Excel</strong> and <strong>Word</strong>. They open in the desktop apps, and every save is stored here as a new version.</p>
          <div class="row">${DOC_TEMPLATES.map(([key, label]) => html`<button type="button" class="btn sm" data-new-doc="${key}"><span class="doc-ic sm ${key === 'docx' ? 'docx' : 'xlsx'}">${key === 'docx' ? 'W' : 'X'}</span>${label}</button>`)}<button type="button" class="btn sm ghost" data-new-doc="upload">${icon('upload', { size: 13 })}Upload</button></div>
        </div>`}
      ${removed.length ? html`<details class="removed-files docs-removed"><summary>${removed.length} removed document${removed.length > 1 ? 's' : ''}</summary><ul class="files">${removed.map((d) => html`<li class="removed"><span class="file-ic">${icon('paperclip', { size: 14 })}</span><span>${d.filename}</span><span class="muted small">Removed: ${d.removed_reason}</span><span class="spacer"></span><a class="icon-btn" href="/api/notebook-documents/${d.id}/file" download title="Download last version">${icon('download', { size: 14 })}</a></li>`)}</ul></details>` : ''}
      ${editable && visible.length ? html`<p class="docs-hint">${icon('info', { size: 12 })}<span><strong>Open in Word/Excel</strong> saves straight back here (Office on Windows). Elsewhere: download, edit, then <em>Upload new version</em>. Signing the entry freezes the current versions.</span></p>` : ''}
      ${signed && visible.length ? html`<p class="docs-hint">${icon('lock', { size: 12 })}<span>These versions were signed with the entry and can no longer change. Their SHA-256 fingerprints are recorded in the audit trail.</span></p>` : ''}`);
    for (const id of openPreviews) {
      const li = host.querySelector(`[data-preview-for="${id}"]`);
      if (!li) continue;
      li.hidden = false;
      host.querySelector(`[data-doc="${id}"] [data-act=preview]`)?.setAttribute('aria-expanded', 'true');
      renderPreview(li, docs.find((d) => d.id === id));
    }
  };

  const refresh = async ({ announce = false } = {}) => {
    const next = await api.get(`/api/notebook/${entry.id}/documents`);
    const changed = next.filter((n) => {
      const old = docs.find((d) => d.id === n.id);
      return !old || old.version !== n.version || old.removed !== n.removed;
    });
    const lengthChanged = next.length !== docs.length;
    docs = next;
    if (changed.length || lengthChanged) draw();
    if (announce) for (const d of changed) if (d.source === 'office') toast(`${d.filename} — version ${d.version} saved from ${DOC_KINDS[d.kind].app}`);
  };

  // After opening a document in Office, watch for saves: poll for a while, and check whenever the page regains focus.
  let watchUntil = 0;
  let timer = null;
  const tick = () => {
    if (!isCurrent()) { clearInterval(timer); timer = null; return; }
    if (document.visibilityState === 'visible') refresh({ announce: true }).catch(() => {});
    if (Date.now() > watchUntil) { clearInterval(timer); timer = null; }
  };
  const watch = () => {
    watchUntil = Date.now() + 20 * 60_000;
    if (!timer) timer = setInterval(tick, 5000);
  };
  const onFocus = () => {
    if (!isCurrent()) { window.removeEventListener('focus', onFocus); return; }
    if (editable && watchUntil > Date.now()) refresh({ announce: true }).catch(() => {});
  };
  window.addEventListener('focus', onFocus);

  const createDoc = async (key) => {
    if (key === 'upload') {
      const file = await pickFile('.docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (!file) return;
      try {
        await api.upload(`/api/notebook/${entry.id}/documents/upload`, file);
        toast(`Added ${file.name}`);
        await refresh();
      } catch (e) { showError(e); }
      return;
    }
    const [, label, defaultName] = DOC_TEMPLATES.find(([k]) => k === key);
    const app = key === 'docx' ? 'Word' : 'Excel';
    const res = await openForm({
      title: `New ${label}`,
      size: 'sm',
      submitLabel: 'Create',
      body: html`
        ${field({ label: 'File name', name: 'name', value: defaultName, required: true, span: 2, autofocus: true, hint: `Starts with this entry's code, title and author so printed copies stay traceable.` })}
        ${field({ label: `Open in ${app} now`, name: 'open', type: 'checkbox', value: true, span: 2 })}`,
      onSubmit: async (d) => ({ ...(await api.post(`/api/notebook/${entry.id}/documents`, { template: key, name: d.name })), open: d.open }),
    });
    if (!res) return;
    await refresh();
    if (res.open) {
      await beforeOpen?.();
      openInOffice(docs.find((d) => d.id === res.id)).catch(showError);
      watch();
    } else toast('Document created');
  };

  root.addEventListener('click', async (e) => {
    const nd = e.target.closest('[data-new-doc]');
    if (nd && root.querySelector('.docs-card')?.contains(nd)) {
      createDoc(nd.dataset.newDoc);
      return;
    }
    const btn = e.target.closest('.docs-card [data-act]');
    if (!btn) return;
    const id = Number(btn.closest('[data-doc]')?.dataset.doc);
    const doc = docs.find((d) => d.id === id);
    if (!doc) return;
    const act = btn.dataset.act;
    if (act === 'preview') {
      const li = host.querySelector(`[data-preview-for="${id}"]`);
      const open = li.hidden;
      li.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) { openPreviews.add(id); renderPreview(li, doc); } else openPreviews.delete(id);
    }
    if (act === 'open') {
      await busy(btn, async () => {
        await beforeOpen?.();
        await openInOffice(doc);
      });
      watch();
    }
    if (act === 'upload') {
      const file = await pickFile(`.${doc.kind}`);
      if (!file) return;
      try {
        const r = await api.upload(`/api/notebook-documents/${id}/versions`, file);
        toast(r.unchanged ? 'Same content as the current version — nothing to save' : `${doc.filename} — version ${r.version} uploaded`, r.unchanged ? 'info' : 'success');
        await refresh();
      } catch (err) { showError(err); }
    }
    if (act === 'versions') showVersions(doc).catch(showError);
    if (act === 'remove') {
      const reason = await promptReason(`Why is ${doc.filename} being removed? All its versions are kept in the archive`);
      if (!reason) return;
      try {
        await api.post(`/api/notebook-documents/${id}/remove`, { reason });
        openPreviews.delete(id);
        await refresh();
      } catch (err) { showError(err); }
    }
  });

  draw();
  return { docs: () => docs, refresh };
}
