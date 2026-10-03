import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate, setQuery } from '../core/nav.js';
import { pageHead, card, fmtDateTime, emptyState, busy, toast, field, num } from '../core/ui.js';

const ROUTE = { samples: 'samples', tests: 'tests', methods: 'methods', instruments: 'instruments', inventory: 'inventory', notebook_entries: 'notebook', investigations: 'investigations', projects: 'projects', clients: 'clients', invoices: 'invoices', users: 'team' };
const ENTITY_LABEL = { samples: 'Sample', tests: 'Test', methods: 'Method', instruments: 'Instrument', inventory: 'Inventory', notebook_entries: 'Notebook', investigations: 'Investigation', projects: 'Project', clients: 'Client', invoices: 'Invoice', users: 'User', qualifications: 'Training', settings: 'Settings', attachments: 'File', instrument_logs: 'Instrument log', notebook_addenda: 'Addendum', audit_log: 'Audit trail' };
const ACTIONS = ['CREATE', 'UPDATE', 'STATUS', 'SIGN', 'CUSTODY', 'LOGIN', 'LOGIN_FAILED', 'SIGNATURE_FAILED', 'PRINT', 'VERIFY'];
const ACTION_TONE = { CREATE: 'green', UPDATE: 'blue', STATUS: 'violet', SIGN: 'teal', LOGIN_FAILED: 'red', SIGNATURE_FAILED: 'red', LOGIN: 'gray', CUSTODY: 'amber' };

function changesCell(json) {
  if (!json) return '';
  let c;
  try { c = JSON.parse(json); } catch { return ''; }
  const entries = Object.entries(c).filter(([k]) => !['created_at', 'updated_at'].includes(k));
  if (!entries.length) return '';
  const short = (v) => (v == null || v === '' ? '∅' : String(v).length > 60 ? `${String(v).slice(0, 60)}…` : String(v));
  return html`<details><summary class="small">${entries.length} field${entries.length > 1 ? 's' : ''}</summary><table class="changes">${entries.map(([k, [a, b]]) => html`<tr><th>${k}</th><td class="old">${short(a)}</td><td class="arrow">→</td><td class="new">${short(b)}</td></tr>`)}</table></details>`;
}

function toCsv(rows) {
  // Quote every cell and neutralise spreadsheet formulas (CSV injection).
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ['id', 'timestamp_utc', 'user', 'full_name', 'action', 'record_type', 'record_id', 'record_code', 'summary', 'changes', 'reason', 'ip', 'hash'];
  return [head.join(','), ...rows.map((r) => [r.id, r.at, r.username, r.full_name, r.action, r.entity, r.entity_id, r.entity_code, r.summary, r.changes, r.reason, r.ip, r.hash].map(esc).join(','))].join('\n');
}

export async function render(ctx) {
  ctx.title('Audit trail');
  const q = ctx.query;
  const rows = await api.get('/api/audit', { q: q.q, user_id: q.user, action: q.action, entity: q.entity, from: q.from, to: q.to, limit: 1000 });
  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Audit trail',
      sub: 'Every create, change, signature and sign-in — who, when, old and new values, and why. Entries are append-only and hash-chained, so tampering is detectable.',
      actions: html`<button class="btn" data-act="csv">${icon('download', { size: 15 })}Export CSV</button><button class="btn primary" data-act="verify">${icon('shield', { size: 15 })}Verify integrity</button>`,
    })}
    <div data-verify></div>
    <form class="toolbar" data-filters>
      <label class="search-box">${icon('search', { size: 15 })}<input type="search" name="q" placeholder="Code, text, reason…" value="${q.q || ''}"></label>
      <select name="user" style="width:auto" aria-label="User"><option value="">Anyone</option>${state.lookups.users.map((u) => html`<option value="${u.id}" ${String(u.id) === q.user ? raw('selected') : ''}>${u.full_name}</option>`)}</select>
      <select name="action" style="width:auto" aria-label="Action"><option value="">Any action</option>${ACTIONS.map((a) => html`<option ${a === q.action ? raw('selected') : ''}>${a}</option>`)}</select>
      <select name="entity" style="width:auto" aria-label="Record type"><option value="">Any record</option>${Object.entries(ENTITY_LABEL).map(([k, l]) => html`<option value="${k}" ${k === q.entity ? raw('selected') : ''}>${l}</option>`)}</select>
      ${field({ name: 'from', type: 'date', value: q.from, attrs: 'aria-label="From" style="width:auto"' })}
      ${field({ name: 'to', type: 'date', value: q.to, attrs: 'aria-label="To" style="width:auto"' })}
      <button class="btn" type="submit">Apply</button>
      <a class="btn ghost" href="/audit">Reset</a>
    </form>
    ${card({
      flush: true,
      body: rows.length ? html`<div class="table-wrap"><table class="table compact">
        <thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>What</th><th>Changes</th><th>Reason</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr>
          <td class="muted small num">${r.id}</td>
          <td class="nowrap small">${fmtDateTime(r.at)}</td>
          <td class="nowrap">${r.full_name || r.username}</td>
          <td><span class="badge ${ACTION_TONE[r.action] || 'gray'}">${r.action}</span></td>
          <td class="nowrap">${r.entity ? html`<span class="muted small">${ENTITY_LABEL[r.entity] || r.entity}</span> ${ROUTE[r.entity] && r.entity_id ? html`<a class="code" href="/${ROUTE[r.entity]}/${r.entity_id}">${r.entity_code || `#${r.entity_id}`}</a>` : html`<span class="code">${r.entity_code || ''}</span>`}` : ''}</td>
          <td style="min-width:200px">${r.summary}</td>
          <td style="min-width:160px">${changesCell(r.changes)}</td>
          <td class="small">${r.reason || ''}</td>
        </tr>`)}</tbody></table></div>
        <div class="table-foot">Showing the latest ${num(rows.length)} matching entries${rows.length >= 1000 ? ' — narrow the filters or export to see more' : ''}.</div>` : emptyState({ icon: 'shield', title: 'No matching entries' }),
    })}`);

  ctx.el.querySelector('[data-filters]').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    navigate(setQuery({ q: d.q, user: d.user, action: d.action, entity: d.entity, from: d.from, to: d.to }));
  });
  ctx.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (b?.dataset.act === 'verify') {
      await busy(b, async () => {
        const r = await api.get('/api/audit/verify');
        ctx.el.querySelector('[data-verify]').innerHTML = String(r.ok
          ? html`<div class="notice ok mb">${icon('shield', { size: 16 })}<span><strong>Integrity verified.</strong> All ${num(r.count)} audit entries are intact and in sequence — no entry has been altered or removed.</span></div>`
          : html`<div class="notice bad mb">${icon('alert', { size: 16 })}<span><strong>Integrity check failed at entry #${r.brokenAt}</strong> (${fmtDateTime(r.at)}). The audit trail has been modified outside the application. Inform QA immediately.</span></div>`);
      });
    }
    if (b?.dataset.act === 'csv') {
      const blob = new Blob([toCsv(rows)], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `aliquot-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`Exported ${num(rows.length)} entries`);
    }
  });
}
