import { html, raw, esc, Safe } from './html.js';
import { icon } from './icons.js';
import { state } from './state.js';
import { Cancelled } from './api.js';

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

const parseDate = (d) => (d instanceof Date ? d : /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d));

// Formatters never throw: an unparseable value is shown as-is rather than breaking the page.
const safeFormat = (fmt, d, empty) => {
  if (!d) return empty;
  const date = parseDate(d);
  return Number.isNaN(date.getTime()) ? String(d) : fmt.format(date);
};
export const fmtDate = (d) => safeFormat(dateFmt, d, '—');
export const fmtShortDate = (d) => safeFormat(shortDateFmt, d, '—');
export const fmtDateTime = (d) => safeFormat(dateTimeFmt, d, '—');
export const fmtTime = (d) => safeFormat(timeFmt, d, '');

export function relTime(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}

const z = (n) => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
export const todayIso = () => isoDate(new Date());
export const daysUntil = (date) => {
  const n = Math.round((parseDate(date) - parseDate(todayIso())) / 86400000);
  return Number.isFinite(n) ? n : 0;
};
export const localDateTimeValue = (d = new Date()) => `${isoDate(d)}T${z(d.getHours())}:${z(d.getMinutes())}`;

export function money(n, { compact = false } = {}) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const currency = state.settings?.currency || 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: compact || Math.abs(n) >= 10000 ? 0 : 2, notation: compact && Math.abs(n) >= 100000 ? 'compact' : 'standard' }).format(n);
  } catch {
    return `${currency} ${Number(n).toFixed(2)}`;
  }
}

export const num = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fixed = (n, d = 2) => (n == null || n === '' ? '' : Number(n).toFixed(d));
export const plural = (n, word, many = `${word}s`) => `${num(n)} ${n === 1 ? word : many}`;
export const fileSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

export function specText(r) {
  const d = r.decimals ?? 2;
  const unit = r.unit ? ` ${r.unit}` : '';
  if (r.result_type !== 'numeric') return r.spec_text || 'Report';
  if (r.spec_min != null && r.spec_max != null) return `${fixed(r.spec_min, d)} – ${fixed(r.spec_max, d)}${unit}`;
  if (r.spec_min != null) return `≥ ${fixed(r.spec_min, d)}${unit}`;
  if (r.spec_max != null) return `≤ ${fixed(r.spec_max, d)}${unit}`;
  return 'Report result';
}

export function resultText(r) {
  if (r.result_type === 'numeric') return r.value_num == null ? '—' : `${fixed(r.value_num, r.decimals ?? 2)}${r.unit ? ` ${r.unit}` : ''}`;
  return r.value_text || '—';
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// ---------------------------------------------------------------------------------------------
// Badges, chips, avatars
// ---------------------------------------------------------------------------------------------

const TONES = {
  // samples
  Received: 'gray', 'In Testing': 'blue', 'In Review': 'violet', Reported: 'green', Disposed: 'gray',
  // tests
  Pending: 'gray', 'In Progress': 'blue', Submitted: 'violet', Reviewed: 'teal', Approved: 'green', Cancelled: 'gray',
  // methods
  Draft: 'gray', 'In Development': 'amber', 'In Validation': 'violet', Effective: 'green', Retired: 'gray',
  // instruments
  Available: 'green', 'In Use': 'blue', Maintenance: 'amber', 'Out of Service': 'red',
  // investigations
  Open: 'red', 'Under Investigation': 'amber', CAPA: 'violet', Closed: 'green',
  // invoices
  Sent: 'blue', Paid: 'green', Void: 'gray', Overdue: 'red',
  // projects
  Quoted: 'violet', Active: 'blue', 'On Hold': 'amber', Completed: 'green',
  // notebook
  Signed: 'blue', Witnessed: 'green',
  // inventory
  Quarantine: 'amber', Consumed: 'gray', Expired: 'red', 'Expiring soon': 'amber', 'Low stock': 'amber',
  // outcomes
  Pass: 'green', Fail: 'red', Report: 'gray',
  // misc
  Minor: 'gray', Major: 'amber', Critical: 'red', Rush: 'amber', Urgent: 'red', Standard: 'gray',
};

export const tone = (status) => TONES[status] || 'gray';

export const badge = (text, t = tone(text), { dot = true, title } = {}) =>
  html`<span class="badge ${t}" ${title ? raw(`title="${esc(title)}"`) : ''}>${dot ? raw('<i></i>') : ''}${text}</span>`;

export const statusBadge = (status) => badge(status);

export function outcomeBadge(outcome) {
  if (outcome === 'Pass') return html`<span class="outcome pass">${icon('check', { size: 12 })}Pass</span>`;
  if (outcome === 'Fail') return html`<span class="outcome fail">${icon('x', { size: 12 })}OOS</span>`;
  if (outcome === 'Report') return html`<span class="outcome report">Reported</span>`;
  return html`<span class="outcome pending">Pending</span>`;
}

export function priorityBadge(p) {
  if (!p || p === 'Standard') return '';
  return html`<span class="badge ${tone(p)} prio">${icon('zap', { size: 11 })}${p}</span>`;
}

export function dueChip(date, { done = false } = {}) {
  if (!date) return html`<span class="muted">—</span>`;
  if (done) return html`<span class="muted">${fmtDate(date)}</span>`;
  const d = daysUntil(date);
  if (d < 0) return html`<span class="due overdue" title="${fmtDate(date)}">${-d}d overdue</span>`;
  if (d === 0) return html`<span class="due soon" title="${fmtDate(date)}">Due today</span>`;
  if (d <= 2) return html`<span class="due soon" title="${fmtDate(date)}">Due in ${d}d</span>`;
  return html`<span class="due" title="${fmtDate(date)}">${fmtShortDate(date)}</span>`;
}

const AVATAR_TONES = 8;
export function avatar(name, id, { size = 24, initials } = {}) {
  const ini = initials || String(name || '?').split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return html`<span class="avatar a${(Number(id) || 0) % AVATAR_TONES}" style="--s:${size}px" title="${name || ''}">${ini}</span>`;
}

export const person = (name, id, initials) => (name ? html`<span class="person">${avatar(name, id, { initials })}<span>${name}</span></span>` : html`<span class="muted">Unassigned</span>`);

export function progress(done, total, { tone: t = 'accent' } = {}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return html`<span class="progress ${t}" title="${done} of ${total}"><span style="width:${pct}%"></span></span>`;
}

// ---------------------------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------------------------

export function pageHead({ title, sub, meta, actions, back, badges }) {
  return html`
    <header class="page-head">
      <div class="page-head-main">
        ${back ? html`<a class="back" href="${back.href}">${icon('arrowLeft', { size: 14 })}${back.label}</a>` : ''}
        <div class="title-row"><h1>${title}</h1>${badges || ''}</div>
        ${sub ? html`<p class="sub" ${typeof sub === 'string' ? html`title="${sub}"` : ''}>${sub}</p>` : ''}
        ${meta ? html`<div class="meta">${meta}</div>` : ''}
      </div>
      ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
    </header>`;
}

export function emptyState({ icon: ic = 'inbox', title, text, action }) {
  return html`<div class="empty">${icon(ic, { size: 28 })}<h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action || ''}</div>`;
}

export const kv = (items) => html`<dl class="kv">${items.filter(Boolean).map(([k, v]) => html`<dt>${k}</dt><dd>${v ?? html`<span class="muted">—</span>`}</dd>`)}</dl>`;

export function tabs(items, active) {
  return html`<nav class="tabs" role="tablist">${items.map((t) => html`<a href="${t.href}" class="${t.key === active ? 'active' : ''}" role="tab" aria-selected="${t.key === active}">${t.label}${t.count != null ? html`<span class="count">${t.count}</span>` : ''}</a>`)}</nav>`;
}

export const card = ({ title, actions, body, cls = '', flush = false, sub }) => html`
  <section class="card ${cls}">
    ${title ? html`<header class="card-head"><div><h2>${title}</h2>${sub ? html`<p class="sub">${sub}</p>` : ''}</div>${actions ? html`<div class="card-actions">${actions}</div>` : ''}</header>` : ''}
    <div class="card-body ${flush ? 'flush' : ''}">${body}</div>
  </section>`;

// ---------------------------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------------------------

export function options(list, selected, { empty } = {}) {
  const norm = (o) => (Array.isArray(o) ? { value: o[0], label: o[1] } : typeof o === 'object' && o !== null ? o : { value: o, label: o });
  const sel = Array.isArray(selected) ? selected.map(String) : [String(selected ?? '')];
  return html`${empty !== undefined ? html`<option value="">${empty}</option>` : ''}${list.map(norm).map((o) => html`<option value="${o.value}" ${sel.includes(String(o.value)) ? raw('selected') : ''} ${o.disabled ? raw('disabled') : ''}>${o.label}</option>`)}`;
}

/** One labelled form field. type: text | number | date | datetime-local | email | password | textarea | select | checkbox */
export function field({ label, name, type = 'text', value, required, options: opts, empty, placeholder, hint, rows = 3, span, attrs = '', min, max, step, disabled, autofocus, id, list }) {
  const a = raw([
    name ? `name="${esc(name)}"` : '', id ? `id="${esc(id)}"` : '', required ? 'required' : '', disabled ? 'disabled' : '', autofocus ? 'autofocus' : '',
    placeholder ? `placeholder="${esc(placeholder)}"` : '', min != null ? `min="${esc(min)}"` : '', max != null ? `max="${esc(max)}"` : '',
    step != null ? `step="${esc(step)}"` : '', list ? `list="${esc(list)}"` : '', attrs instanceof Safe ? attrs.s : attrs,
  ].filter(Boolean).join(' '));
  let control;
  if (type === 'textarea') control = html`<textarea ${a} rows="${rows}">${value ?? ''}</textarea>`;
  else if (type === 'select') control = html`<select ${a}>${options(opts || [], value, { empty })}</select>`;
  else if (type === 'checkbox') {
    return html`<label class="check ${span ? `span-${span}` : ''}"><input type="checkbox" ${a} ${value ? raw('checked') : ''}><span>${label}</span>${hint ? html`<small class="hint">${hint}</small>` : ''}</label>`;
  } else control = html`<input type="${type}" ${a} value="${value ?? ''}" ${type === 'number' ? raw('inputmode="decimal"') : ''}>`;
  return html`<label class="field ${span ? `span-${span}` : ''}">
    ${label ? html`<span class="label">${label}${required ? html`<b class="req" aria-hidden="true">*</b>` : ''}</span>` : ''}
    ${control}
    ${hint ? html`<small class="hint">${hint}</small>` : ''}
  </label>`;
}

/** Reads a form into a plain object. Checkboxes → true/false, multi-selects → arrays. */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      // Checkboxes with an explicit value form a list (even if only one is shown); bare ones are booleans.
      if (el.hasAttribute('value') || form.querySelectorAll(`input[type=checkbox][name="${CSS.escape(el.name)}"]`).length > 1) {
        out[el.name] = out[el.name] || [];
        if (el.checked) out[el.name].push(el.value);
      } else out[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else if (el.multiple) {
      out[el.name] = [...el.selectedOptions].map((o) => o.value);
    } else out[el.name] = el.value;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------------------------

export function toast(message, type = 'success', { timeout = 4200 } = {}) {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = String(html`${icon(type === 'error' ? 'xCircle' : type === 'info' ? 'info' : 'check', { size: 16 })}<span></span><button class="x" aria-label="Dismiss">${icon('x', { size: 14 })}</button>`);
  el.querySelector('span').textContent = message;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.x').onclick = close;
  host.append(el);
  if (timeout) setTimeout(close, type === 'error' ? timeout * 2 : timeout);
}

export function showError(e) {
  if (e instanceof Cancelled || e?.cancelled) return;
  toast(e?.message || 'Something went wrong', 'error');
}

/** Runs an async action with the button disabled and errors surfaced as toasts. */
export async function busy(button, fn) {
  if (button?.disabled) return undefined;
  const prev = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.classList.add('loading');
  }
  try {
    return await fn();
  } catch (e) {
    showError(e);
    return undefined;
  } finally {
    if (button && button.isConnected) {
      button.disabled = false;
      button.classList.remove('loading');
      button.innerHTML = prev;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------------------------

const openModals = [];

export function openModal({ title, body, footer, size = 'md', onClose, dismissable = true, cls = '' }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = String(html`
    <div class="modal ${size} ${cls}" role="dialog" aria-modal="true" aria-label="${typeof title === 'string' ? title : ''}">
      <header class="modal-head"><h2>${title}</h2>${dismissable ? html`<button type="button" class="icon-btn" data-close aria-label="Close">${icon('x', { size: 18 })}</button>` : ''}</header>
      <div class="modal-body">${body}</div>
      ${footer ? html`<footer class="modal-foot">${footer}</footer>` : ''}
    </div>`);
  const prevFocus = document.activeElement;
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.classList.add('out');
    openModals.splice(openModals.indexOf(api), 1);
    setTimeout(() => backdrop.remove(), 150);
    prevFocus?.focus?.();
    onClose?.(result);
  };
  const api = { el: backdrop.querySelector('.modal'), close, dismissable };
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && dismissable) close(null); });
  backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(null)));
  document.body.append(backdrop);
  openModals.push(api);
  requestAnimationFrame(() => {
    const first = backdrop.querySelector('[autofocus], input:not([type=hidden]):not([disabled]), select, textarea, button.primary');
    first?.focus();
  });
  return api;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openModals.length) {
    const top = openModals[openModals.length - 1];
    if (top.dismissable) {
      e.stopPropagation();
      top.close(null);
    }
  }
});

export const modalOpen = () => openModals.length > 0;

/**
 * A form in a modal. onSubmit(data, form) may throw to show an error inline; its return value resolves the promise.
 * Resolves null if dismissed.
 */
export function openForm({ title, body, submitLabel = 'Save', size = 'md', onSubmit, onMount, danger = false, secondary }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      size,
      body: html`<form class="form-grid" novalidate>${body}<div class="form-error" hidden></div><button type="submit" hidden></button></form>`,
      footer: html`${secondary || ''}<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-submit>${submitLabel}</button>`,
      onClose: (r) => resolve(r ?? null),
    });
    const form = m.el.querySelector('form');
    const errBox = m.el.querySelector('.form-error');
    const submitBtn = m.el.querySelector('[data-submit]');
    const submit = async () => {
      errBox.hidden = true;
      for (const el of form.querySelectorAll('[required]')) {
        if (!String(el.value || '').trim()) {
          el.focus();
          errBox.textContent = `${el.closest('.field')?.querySelector('.label')?.textContent?.replace('*', '').trim() || 'This field'} is required`;
          errBox.hidden = false;
          return;
        }
      }
      submitBtn.disabled = true;
      submitBtn.classList.add('loading');
      try {
        const result = await onSubmit(formData(form), form);
        m.close(result === undefined ? true : result);
      } catch (e) {
        if (!(e instanceof Cancelled)) {
          errBox.textContent = e.message || 'Something went wrong';
          errBox.hidden = false;
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
      }
    };
    submitBtn.addEventListener('click', submit);
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    onMount?.(form, m);
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      size: 'sm',
      body: html`<p class="confirm-text">${message}</p>`,
      footer: html`<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${confirmLabel}</button>`,
      onClose: (r) => resolve(!!r),
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => m.close(true));
  });
}

export function promptReason(message = 'Give a reason for this change') {
  return openForm({
    title: 'Reason for change',
    size: 'sm',
    submitLabel: 'Continue',
    body: html`
      <p class="span-2 notice">${icon('shield', { size: 16 })}<span>${message}. It is stored permanently in the audit trail.</span></p>
      ${field({ label: 'Reason', name: 'reason', type: 'textarea', rows: 3, required: true, span: 2, autofocus: true, placeholder: 'e.g. Transcription error corrected — see raw data printout' })}`,
    onSubmit: (d) => d.reason.trim(),
  });
}

/**
 * Electronic signature dialog (21 CFR Part 11): the signer re-enters their password and states the meaning.
 * onSign({ password, comment }) performs the signed action; errors (e.g. wrong password) stay in the dialog.
 */
export function esign({ title, meaning, description, confirmLabel = 'Sign', danger = false, comment = null, fields = null, onSign }) {
  return openForm({
    title,
    size: 'sm',
    submitLabel: html`${icon('sign', { size: 15 })}${confirmLabel}`,
    danger,
    body: html`
      ${description ? html`<div class="span-2 esign-desc">${description}</div>` : ''}
      <div class="span-2 esign-card">
        <div class="esign-who">${avatar(state.me.full_name, state.me.id, { size: 32 })}<div><strong>${state.me.full_name}</strong><small>${state.me.title || ''}</small></div></div>
        <div class="esign-meaning"><span>Meaning of signature</span><strong>${meaning}</strong></div>
      </div>
      ${fields || ''}
      ${comment ? field({ label: comment.label || 'Comment', name: 'comment', type: 'textarea', rows: 2, required: comment.required, span: 2, placeholder: comment.placeholder }) : ''}
      ${field({ label: 'Password', name: 'password', type: 'password', required: true, span: 2, autofocus: !comment && !fields, attrs: 'autocomplete="current-password"' })}
      <p class="span-2 legal">${icon('lock', { size: 12 })} By signing you confirm this electronic signature is the legally binding equivalent of your handwritten signature.</p>`,
    onSubmit: (d) => onSign({ ...d, password: d.password, comment: d.comment?.trim() || null }),
  });
}

// ---------------------------------------------------------------------------------------------
// Data table: sorting, quick filter, row links, optional selection
// ---------------------------------------------------------------------------------------------

/**
 * columns: [{ key, label, render(row) → html|string, sort: true | (row) => value, align: 'right', cls, width }]
 * Returns { setRows(rows), filter(text), selected() }.
 */
export function mountTable(container, { columns, rows, rowHref, empty, selectable = false, onSelectionChange, sort: initialSort, searchText, rowClass, compact = false }) {
  let data = rows.slice();
  let shown = data;
  let sortKey = initialSort?.key ?? null;
  let sortDir = initialSort?.dir ?? 1;
  let query = '';
  const selected = new Set();

  const sortValue = (col, row) => (typeof col.sort === 'function' ? col.sort(row) : row[col.key]);
  const textOf = searchText || ((r) => columns.map((c) => r[c.key]).join(' '));

  function apply() {
    const q = query.toLowerCase();
    shown = q ? data.filter((r) => String(textOf(r) ?? '').toLowerCase().includes(q)) : data.slice();
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) {
        shown.sort((a, b) => {
          const x = sortValue(col, a);
          const y = sortValue(col, b);
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sortDir;
        });
      }
    }
    draw();
  }

  function draw() {
    if (!data.length) {
      container.innerHTML = String(empty || emptyState({ title: 'Nothing here yet' }));
      return;
    }
    const allChecked = shown.length > 0 && shown.every((r) => selected.has(r.id));
    container.innerHTML = String(html`
      <div class="table-wrap">
        <table class="table ${compact ? 'compact' : ''}">
          <thead><tr>
            ${selectable ? html`<th class="sel"><input type="checkbox" data-all aria-label="Select all" ${allChecked ? raw('checked') : ''}></th>` : ''}
            ${columns.map((c) => html`<th class="${c.align || ''} ${c.cls || ''} ${c.sort ? 'sortable' : ''} ${sortKey === c.key ? 'sorted' : ''}" ${c.width ? raw(`style="width:${c.width}"`) : ''} ${c.sort ? raw(`data-sort="${esc(c.key)}" tabindex="0" aria-sort="${sortKey === c.key ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}"`) : ''}>${c.label}${c.sort ? icon(sortKey === c.key && sortDir < 0 ? 'chevronDown' : 'chevronUp', { size: 12, cls: 'sort-ic' }) : ''}</th>`)}
          </tr></thead>
          <tbody>
            ${shown.map((r, i) => html`<tr ${rowHref ? raw(`data-href="${esc(rowHref(r))}"`) : ''} class="${rowHref ? 'link' : ''} ${rowClass ? rowClass(r) : ''} ${selected.has(r.id) ? 'selected' : ''}" data-i="${i}">
              ${selectable ? html`<td class="sel"><input type="checkbox" data-id="${r.id}" aria-label="Select row" ${selected.has(r.id) ? raw('checked') : ''}></td>` : ''}
              ${columns.map((c) => html`<td class="${c.align || ''} ${c.cls || ''}">${c.render ? c.render(r) : r[c.key] ?? ''}</td>`)}
            </tr>`)}
          </tbody>
        </table>
        ${!shown.length ? html`<div class="table-empty">No matches for “${query}”</div>` : ''}
      </div>
      <div class="table-foot">${shown.length === data.length ? plural(data.length, 'row') : `${num(shown.length)} of ${plural(data.length, 'row')}`}${selectable && selected.size ? html` · <strong>${selected.size} selected</strong>` : ''}</div>`);
    // Title cells are clipped to one line; the full text stays available on hover.
    container.querySelectorAll('td.title-cell').forEach((td) => { td.title = td.textContent.trim().replace(/\s+/g, ' '); });
  }

  container.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const key = th.dataset.sort;
      sortDir = sortKey === key ? -sortDir : 1;
      sortKey = key;
      apply();
      return;
    }
    if (e.target.matches('input[data-all]')) {
      for (const r of shown) e.target.checked ? selected.add(r.id) : selected.delete(r.id);
      draw();
      onSelectionChange?.([...selected]);
      return;
    }
    if (e.target.matches('input[data-id]')) {
      const id = Number(e.target.dataset.id);
      e.target.checked ? selected.add(id) : selected.delete(id);
      e.target.closest('tr').classList.toggle('selected', e.target.checked);
      const foot = container.querySelector('.table-foot');
      if (foot) foot.innerHTML = String(html`${shown.length === data.length ? plural(data.length, 'row') : `${num(shown.length)} of ${plural(data.length, 'row')}`}${selected.size ? html` · <strong>${selected.size} selected</strong>` : ''}`);
      onSelectionChange?.([...selected]);
      return;
    }
    if (e.target.closest('a, button, input, select, label, td.sel')) return;
    const tr = e.target.closest('tr[data-href]');
    if (tr) {
      if (e.metaKey || e.ctrlKey) window.open(tr.dataset.href, '_blank');
      else window.dispatchEvent(new CustomEvent('aq:navigate', { detail: tr.dataset.href }));
    }
  });
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('th[data-sort]')) e.target.click();
  });

  apply();
  return {
    setRows(next) { data = next.slice(); apply(); },
    filter(text) { query = text.trim(); apply(); },
    selected: () => [...selected],
    clearSelection() { selected.clear(); draw(); onSelectionChange?.([]); },
    rows: () => shown,
  };
}

/** A search box wired to a mounted table's quick filter. */
export const searchBox = (placeholder = 'Filter…', value = '') => html`<label class="search-box">${icon('search', { size: 15 })}<input type="search" placeholder="${placeholder}" value="${value}" data-filter aria-label="${placeholder}"></label>`;

/** Segmented filter control built from links, so filters live in the URL and survive reloads. */
export function segmented(items, active) {
  return html`<div class="segmented">${items.map((i) => html`<a href="${i.href}" class="${i.key === active ? 'active' : ''}">${i.label}${i.count != null ? html`<span class="count">${i.count}</span>` : ''}</a>`)}</div>`;
}
