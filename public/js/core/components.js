// Panels shared by many record pages: attachments, audit history, signatures, workflow stepper.
import { html, raw } from './html.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { avatar, fmtDateTime, relTime, fileSize, emptyState, toast, showError, promptReason, card } from './ui.js';
import { state } from './state.js';

// ---------------------------------------------------------------------------------------------
// Workflow stepper
// ---------------------------------------------------------------------------------------------

export function stepper(steps, current, { stopped } = {}) {
  const idx = steps.indexOf(current);
  return html`<ol class="stepper ${stopped ? 'stopped' : ''}">${steps.map((s, i) => html`<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}"><span class="dot">${i < idx ? icon('check', { size: 11 }) : ''}</span><span class="lbl">${s}</span></li>`)}</ol>`;
}

// ---------------------------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------------------------

export function signatureList(signatures) {
  if (!signatures?.length) return html`<p class="muted small">No signatures yet.</p>`;
  return html`<ul class="sig-list">${signatures.map((s) => html`
    <li class="${/Return|Reject/.test(s.meaning) ? 'neg' : ''}">
      <span class="sig-ic">${icon(/Return|Reject/.test(s.meaning) ? 'undo' : 'sign', { size: 14 })}</span>
      <div>
        <div><strong>${s.meaning}</strong> · ${s.full_name}</div>
        <div class="muted small">${fmtDateTime(s.signed_at)}</div>
        ${s.comment ? html`<div class="sig-comment">“${s.comment}”</div>` : ''}
      </div>
    </li>`)}</ul>`;
}

// ---------------------------------------------------------------------------------------------
// Audit history of one record
// ---------------------------------------------------------------------------------------------

const FIELD_LABELS = {
  analyst_id: 'Analyst', instrument_id: 'Instrument', due_date: 'Due date', status: 'Status', raw_data_ref: 'Raw data reference',
  project_id: 'Project', client_id: 'Client', owner_id: 'Owner', lead_id: 'Lead', reviewed_by: 'Reviewed by', approved_by: 'Approved by',
  spec_min: 'Lower limit', spec_max: 'Upper limit', calibration_due: 'Calibration due', last_calibrated: 'Last calibrated',
  received_by: 'Received by', received_at: 'Received at', batch_no: 'Batch', client_ref: 'Client reference', tat_days: 'Turnaround (days)',
  password_hash: 'Password', must_change_password: 'Must change password', invoice_id: 'Invoice', oos: 'OOS flag',
};
const label = (k) => FIELD_LABELS[k] || k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function formatValue(k, v) {
  if (v == null || v === '') return html`<span class="muted">empty</span>`;
  if (/_id$|_by$/.test(k) && typeof v === 'number') {
    const u = state.lookups?.users?.find((x) => x.id === v);
    if (u && /analyst|owner|lead|reviewed|approved|received|trained|created|raised|closed|witness|author/.test(k)) return u.full_name;
  }
  const s = String(v);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

const ACTION_TEXT = { CREATE: 'Created', UPDATE: 'Edited', STATUS: 'Status', SIGN: 'Signed', CUSTODY: 'Custody', PRINT: 'Printed', VIEW: 'Viewed' };

export async function mountHistory(container, entity, id) {
  container.innerHTML = '<div class="loading-block"></div>';
  try {
    const rows = await api.get(`/api/history/${entity}/${id}`);
    if (!rows.length) {
      container.innerHTML = String(emptyState({ icon: 'history', title: 'No history yet' }));
      return;
    }
    container.innerHTML = String(html`<ol class="timeline">${rows.map((r) => {
      let changes = null;
      try { changes = r.changes ? JSON.parse(r.changes) : null; } catch { /* ignore */ }
      const entries = changes ? Object.entries(changes).filter(([k]) => !['created_at', 'updated_at'].includes(k)) : [];
      return html`<li class="tl-${(r.action || '').toLowerCase()}">
        <span class="tl-dot"></span>
        <div class="tl-body">
          <div class="tl-head"><strong>${r.summary || ACTION_TEXT[r.action] || r.action}</strong><span class="muted small" title="${fmtDateTime(r.at)}">${r.full_name || r.username} · ${fmtDateTime(r.at)}</span></div>
          ${r.reason ? html`<div class="tl-reason">${icon('info', { size: 12 })} Reason: ${r.reason}</div>` : ''}
          ${entries.length && r.action !== 'CREATE' ? html`<table class="changes">${entries.map(([k, [a, b]]) => html`<tr><th>${label(k)}</th><td class="old">${formatValue(k, a)}</td><td class="arrow">→</td><td class="new">${formatValue(k, b)}</td></tr>`)}</table>` : ''}
        </div>
      </li>`;
    })}</ol>`);
  } catch (e) {
    container.innerHTML = String(html`<p class="muted">${e.message}</p>`);
  }
}

// ---------------------------------------------------------------------------------------------
// Attachments (raw data printouts, chromatograms, CoAs, photos…)
// ---------------------------------------------------------------------------------------------

export async function mountAttachments(container, entity, id) {
  const load = async () => {
    let list;
    try {
      list = await api.get('/api/attachments', { entity, id });
    } catch (e) {
      container.innerHTML = String(html`<p class="muted">${e.message}</p>`);
      return;
    }
    const locked = !list.can.attach;
    const visible = list.files.filter((r) => !r.removed);
    const removed = list.files.filter((r) => r.removed);
    container.innerHTML = String(html`
      ${!locked ? html`<label class="dropzone">${icon('upload', { size: 18 })}<span><strong>Drop files</strong> or click to upload</span><small>PDF, images, CDS exports — up to 50 MB</small><input type="file" multiple hidden></label>` : html`<p class="muted small">${icon('lock', { size: 12 })} ${list.locks.attach}</p>`}
      ${visible.length ? html`<ul class="files">${visible.map((f) => html`
        <li>
          <span class="file-ic">${icon('paperclip', { size: 14 })}</span>
          <a href="/api/attachments/${f.id}/file?inline=1" target="_blank" rel="noopener">${f.filename}</a>
          <span class="muted small">${fileSize(f.size)} · ${f.uploaded_by_name} · ${relTime(f.uploaded_at)}</span>
          <span class="spacer"></span>
          <a class="icon-btn" href="/api/attachments/${f.id}/file" title="Download" download>${icon('download', { size: 14 })}</a>
          ${f.can.remove ? html`<button class="icon-btn" data-remove="${f.id}" title="Remove">${icon('x', { size: 14 })}</button>` : ''}
        </li>`)}</ul>` : locked ? html`<p class="muted small">No files attached.</p>` : ''}
      ${removed.length ? html`<details class="removed-files"><summary>${removed.length} removed file${removed.length > 1 ? 's' : ''}</summary><ul class="files">${removed.map((f) => html`<li class="removed"><span class="file-ic">${icon('paperclip', { size: 14 })}</span><span>${f.filename}</span><span class="muted small">Removed: ${f.removed_reason}</span></li>`)}</ul></details>` : ''}`);

    const input = container.querySelector('input[type=file]');
    const zone = container.querySelector('.dropzone');
    const upload = async (files) => {
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) { toast(`${file.name} is larger than 50 MB`, 'error'); continue; }
        zone?.classList.add('busy');
        try {
          await api.upload(`/api/attachments?entity=${entity}&id=${id}`, file);
          toast(`Attached ${file.name}`);
        } catch (e) { showError(e); }
      }
      zone?.classList.remove('busy');
      load();
    };
    input?.addEventListener('change', () => upload([...input.files]));
    zone?.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone?.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone?.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); upload([...e.dataTransfer.files]); });
    container.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      const reason = await promptReason('Why is this file being removed? The file is kept in the archive');
      if (!reason) return;
      try {
        await api.post(`/api/attachments/${b.dataset.remove}/remove`, { reason });
        load();
      } catch (e) { showError(e); }
    }));
  };
  await load();
}

/** Card with tabs for Files and History, used at the bottom of record pages. */
export function recordFooter() {
  return card({
    cls: 'record-footer',
    title: html`<span class="mini-tabs"><button class="active" data-ft="files">${icon('paperclip', { size: 14 })} Files</button><button data-ft="history">${icon('history', { size: 14 })} History</button></span>`,
    body: html`<div data-pane="files"></div><div data-pane="history" hidden></div>`,
  });
}

export function wireRecordFooter(root, entity, id) {
  const footer = root.querySelector('.record-footer');
  if (!footer) return;
  const files = footer.querySelector('[data-pane=files]');
  const hist = footer.querySelector('[data-pane=history]');
  mountAttachments(files, entity, id);
  let histLoaded = false;
  footer.querySelectorAll('[data-ft]').forEach((b) => b.addEventListener('click', () => {
    footer.querySelectorAll('[data-ft]').forEach((x) => x.classList.toggle('active', x === b));
    files.hidden = b.dataset.ft !== 'files';
    hist.hidden = b.dataset.ft !== 'history';
    if (b.dataset.ft === 'history' && !histLoaded) {
      histLoaded = true;
      mountHistory(hist, entity, id);
    }
  }));
}

export const avatarStack = (people) => html`<span class="avatar-stack">${people.slice(0, 5).map((p) => avatar(p.full_name, p.id, { initials: p.initials, size: 24 }))}${people.length > 5 ? html`<span class="avatar more">+${people.length - 5}</span>` : ''}</span>`;

export const kbd = (k) => raw(`<kbd>${k}</kbd>`);
