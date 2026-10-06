import { html } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate, setQuery } from '../core/nav.js';
import {
  pageHead, card, kv, mountTable, searchBox, segmented, statusBadge, fmtDate, fmtDateTime, emptyState, field, openForm, toast, person, badge, daysUntil, debounce, num, todayIso,
} from '../core/ui.js';
import { recordFooter, wireRecordFooter } from '../core/components.js';

function expiryCell(m) {
  if (!m.expiry_date) return html`<span class="muted">—</span>`;
  const d = daysUntil(m.expiry_date);
  if (d < 0) return badge(`Expired ${fmtDate(m.expiry_date)}`, 'red');
  if (d <= 30) return badge(`${fmtDate(m.expiry_date)} · ${d}d`, 'amber');
  return html`<span class="nowrap">${fmtDate(m.expiry_date)}</span>`;
}

const itemFields = (m = {}) => {
  const L = state.lookups;
  return html`
    ${field({ label: 'Name', name: 'name', value: m.name, required: true, span: 2, placeholder: 'e.g. Metformin Hydrochloride USP Reference Standard' })}
    ${m.id ? '' : field({ label: 'Category', name: 'category', type: 'select', options: L.inventoryCategories, required: true, empty: 'Choose…' })}
    ${field({ label: 'Supplier', name: 'supplier', value: m.supplier })}
    ${field({ label: 'Catalogue number', name: 'catalog_no', value: m.catalog_no })}
    ${field({ label: 'Lot / batch number', name: 'lot_no', value: m.lot_no })}
    ${field({ label: 'Purity / potency', name: 'potency', value: m.potency, placeholder: 'e.g. 99.8 %' })}
    ${m.id ? '' : field({ label: 'Quantity received', name: 'quantity', type: 'number', min: 0, step: 'any' })}
    ${field({ label: 'Unit', name: 'unit', value: m.unit, placeholder: 'mg, g, mL, L, vials…' })}
    ${field({ label: 'Reorder level', name: 'min_quantity', type: 'number', value: m.min_quantity, min: 0, step: 'any', hint: 'Flags low stock on the dashboard' })}
    ${field({ label: 'Storage condition', name: 'storage', value: m.storage, placeholder: 'e.g. 2–8 °C, desiccated' })}
    ${field({ label: 'Location', name: 'location', value: m.location, placeholder: 'e.g. Fridge R-02' })}
    ${field({ label: 'Received', name: 'received_date', type: 'date', value: m.received_date || (m.id ? '' : todayIso()) })}
    ${field({ label: 'Opened', name: 'opened_date', type: 'date', value: m.opened_date })}
    ${field({ label: 'Expiry / retest date', name: 'expiry_date', type: 'date', value: m.expiry_date, hint: 'Expired material is blocked from use in tests' })}
    ${m.id ? field({ label: 'Status', name: 'status', type: 'select', options: L.inventoryStatuses, value: m.status }) : ''}
    ${field({ label: 'Notes', name: 'notes', type: 'textarea', rows: 2, value: m.notes, span: 2 })}`;
};

export async function newItem() {
  const res = await openForm({ title: 'Receive standard / reagent', size: 'lg', submitLabel: 'Add to inventory', body: itemFields(), onSubmit: (d) => api.post('/api/inventory', d) });
  if (res) { toast(`${res.code} added`); navigate(`/inventory/${res.id}`); }
}

export async function list(ctx) {
  ctx.title('Standards & reagents');
  const cat = ctx.query.category || '';
  const rows = await api.get('/api/inventory', { category: cat });
  const view = ctx.query.view || 'active';
  const shown = rows.filter((m) => (view === 'active' ? m.status === 'Active' : view === 'attention' ? m.status === 'Active' && (m.expired || m.expiring || m.low_stock) : true));
  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Standards & reagents',
      sub: 'Reference standards, reagents, solvents and columns — with lot traceability to every test that used them.',
      actions: can('inventory.edit') ? html`<button class="btn primary" data-act="new">${icon('plus', { size: 15 })}Receive item</button>` : '',
    })}
    <div class="toolbar">
      ${segmented([
        { key: 'active', label: 'In use', href: setQuery({ view: null }) },
        { key: 'attention', label: 'Expiring / low', count: rows.filter((m) => m.status === 'Active' && (m.expired || m.expiring || m.low_stock)).length, href: setQuery({ view: 'attention' }) },
        { key: 'all', label: 'All', href: setQuery({ view: 'all' }) },
      ], view)}
      <select data-cat style="width:auto" aria-label="Category"><option value="">All categories</option>${state.lookups.inventoryCategories.map((c) => html`<option ${c === cat ? 'selected' : ''}>${c}</option>`)}</select>
      <span class="spacer"></span>
      ${searchBox('Filter by name, lot, code…')}
    </div>
    <div class="card"><div data-table></div></div>`);
  const table = mountTable(ctx.el.querySelector('[data-table]'), {
    rows: shown,
    rowHref: (r) => `/inventory/${r.id}`,
    rowClass: (r) => (r.expired ? 'row-fail' : r.expiring || r.low_stock ? 'row-warn' : ''),
    searchText: (r) => `${r.code} ${r.name} ${r.lot_no} ${r.supplier} ${r.catalog_no} ${r.location}`,
    empty: emptyState({ icon: 'package', title: 'Nothing here', text: 'Receive your reference standards and reagents to track lots and expiry.' }),
    columns: [
      { key: 'code', label: 'Code', sort: true, render: (r) => html`<a class="code" href="/inventory/${r.id}">${r.code}</a>` },
      { key: 'name', label: 'Item', sort: true, cls: 'title-cell', render: (r) => html`<strong>${r.name}</strong><span class="sub-line">${r.category}${r.supplier ? ` · ${r.supplier}` : ''}${r.catalog_no ? ` ${r.catalog_no}` : ''}</span>` },
      { key: 'lot_no', label: 'Lot', sort: true, render: (r) => html`<span class="mono small">${r.lot_no || '—'}</span>` },
      { key: 'potency', label: 'Potency', render: (r) => r.potency || html`<span class="muted">—</span>` },
      { key: 'quantity', label: 'Stock', sort: true, align: 'right', render: (r) => html`<span class="num ${r.low_stock ? 'warn-text' : ''}">${r.quantity == null ? '—' : `${num(r.quantity, r.quantity % 1 ? 2 : 0)} ${r.unit || ''}`}</span>${r.low_stock ? html`<span class="sub-line warn-text">Low stock</span>` : ''}` },
      { key: 'location', label: 'Location', sort: true },
      { key: 'expiry_date', label: 'Expiry', sort: true, render: expiryCell },
      { key: 'status', label: 'Status', sort: true, render: (r) => statusBadge(r.status) },
    ],
  });
  const f = ctx.el.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
  ctx.el.querySelector('[data-cat]').addEventListener('change', (e) => navigate(setQuery({ category: e.target.value })));
  ctx.el.querySelector('[data-act=new]')?.addEventListener('click', newItem);
}

export async function detail(ctx) {
  const d = await api.get(`/api/inventory/${ctx.params.id}`);
  const m = d.item;
  ctx.title(m.code);
  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/inventory', label: 'Standards & reagents' },
      title: m.name,
      badges: html`${statusBadge(m.status)}${m.expired ? badge('Expired', 'red') : m.expiring ? badge('Expiring soon', 'amber') : ''}${m.low_stock ? badge('Low stock', 'amber') : ''}`,
      meta: html`<span class="code">${m.code}</span><span>${m.category}</span>${m.lot_no ? html`<span>Lot <span class="mono">${m.lot_no}</span></span>` : ''}${m.location ? html`<span>${icon('pin', { size: 14 })}${m.location}</span>` : ''}`,
      actions: html`
        ${d.can.stock ? html`<button class="btn primary" data-act="use">${icon('flask', { size: 15 })}Record use</button>
        <button class="btn" data-act="add">${icon('plus', { size: 15 })}Add stock</button>` : ''}
        ${d.can.edit ? html`<button class="btn" data-act="edit">${icon('edit', { size: 15 })}Edit</button>` : ''}`,
    })}
    ${m.expired ? html`<div class="notice bad mb">${icon('lock', { size: 16 })}<span><strong>Expired on ${fmtDate(m.expiry_date)}.</strong> It can no longer be selected for tests. Requalify (new expiry date) or dispose of it.</span></div>` : ''}
    <div class="split">
      <div class="stack">
        ${card({
          title: 'Used in tests',
          sub: 'Traceability: every test that recorded this lot.',
          flush: true,
          body: d.tests.length ? html`<div class="table-wrap"><table class="table compact"><tbody>${d.tests.map((t) => html`<tr class="link" data-href="/tests/${t.id}"><td><a class="code" href="/tests/${t.id}">${t.code}</a></td><td>${t.method_code}<span class="sub-line">${t.method_title}</span></td><td><span class="code">${t.sample_code}</span><span class="sub-line">${t.client_name}</span></td><td>${person(t.analyst_name, t.analyst_id, t.analyst_initials)}</td><td>${statusBadge(t.status)}</td></tr>`)}</tbody></table></div>` : emptyState({ icon: 'worklist', title: 'Not used in any test yet' }),
        })}
        ${card({
          title: 'Stock movements',
          flush: true,
          body: d.txns.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>When</th><th>Who</th><th class="right">Change</th><th class="right">Balance</th><th>Reason</th></tr></thead><tbody>${d.txns.map((x) => html`<tr><td class="nowrap">${fmtDateTime(x.at)}</td><td>${x.full_name}</td><td class="right num ${x.delta < 0 ? 'bad-text' : 'ok-text'}">${x.delta > 0 ? '+' : ''}${x.delta} ${m.unit || ''}</td><td class="right num">${x.balance ?? '—'}</td><td>${x.reason || ''}</td></tr>`)}</tbody></table></div>` : emptyState({ icon: 'package', title: 'No movements' }),
        })}
        ${recordFooter()}
      </div>
      <div class="stack">
        ${card({ title: 'Details', body: kv([
          ['Code', html`<span class="code">${m.code}</span>`], ['Category', m.category], ['Supplier', m.supplier], ['Catalogue no.', m.catalog_no], ['Lot', m.lot_no], ['Purity / potency', m.potency],
          ['In stock', m.quantity == null ? null : `${m.quantity} ${m.unit || ''}`], ['Reorder level', m.min_quantity == null ? null : `${m.min_quantity} ${m.unit || ''}`],
          ['Storage', m.storage], ['Location', m.location], ['Received', fmtDate(m.received_date)], ['Opened', fmtDate(m.opened_date)], ['Expiry', expiryCell(m)], ['Notes', m.notes],
        ]) })}
      </div>
    </div>`);
  wireRecordFooter(ctx.el, 'inventory', m.id);
  ctx.el.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) navigate(el.dataset.href); }));
  ctx.el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'use' || act === 'add') {
      const ok = await openForm({
        title: act === 'use' ? `Record use of ${m.code}` : `Add stock to ${m.code}`,
        size: 'sm',
        body: html`
          ${field({ label: `Quantity ${act === 'use' ? 'used' : 'added'}${m.unit ? ` (${m.unit})` : ''}`, name: 'amount', type: 'number', min: 0, step: 'any', required: true, span: 2, autofocus: true })}
          ${field({ label: 'Reason / reference', name: 'reason', required: true, span: 2, placeholder: act === 'use' ? 'e.g. Standard prep for T-2026-00412' : 'e.g. New bottle, same lot' })}`,
        onSubmit: (d2) => api.post(`/api/inventory/${m.id}/adjust`, { delta: (act === 'use' ? -1 : 1) * Number(d2.amount), reason: d2.reason }),
      });
      if (ok) { toast('Stock updated'); ctx.refresh(); }
    }
    if (act === 'edit') {
      const ok = await openForm({ title: `Edit ${m.code}`, size: 'lg', body: itemFields(m), onSubmit: (d2) => api.put(`/api/inventory/${m.id}`, d2) });
      if (ok) { toast('Item updated'); ctx.refresh(); }
    }
  });
}
