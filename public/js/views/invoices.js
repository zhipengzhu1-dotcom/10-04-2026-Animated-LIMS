import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate, setQuery } from '../core/nav.js';
import {
  pageHead, card, kv, mountTable, searchBox, segmented, statusBadge, fmtDate, money, emptyState, field, openForm, toast, busy, confirmDialog,
  promptReason, showError, plural, debounce, todayIso, relTime,
} from '../core/ui.js';
import { recordFooter, wireRecordFooter } from '../core/components.js';

const isOverdue = (i) => i.status === 'Sent' && i.due_date && i.due_date < todayIso();
const displayStatus = (i) => (isOverdue(i) ? 'Overdue' : i.status);

export async function newInvoice(prefill = {}) {
  const [projects, clients, unbilled] = await Promise.all([api.get('/api/projects', { status: 'all' }), api.get('/api/clients'), api.get('/api/invoices/unbilled')]);
  const unbilledBy = Object.fromEntries(unbilled.map((u) => [u.id, u]));
  const res = await openForm({
    title: 'New invoice',
    submitLabel: 'Create draft',
    body: html`
      ${field({ label: 'Project', name: 'project_id', type: 'select', span: 2, value: prefill.project_id, empty: 'No project — choose a client below', options: projects.filter((p) => p.status !== 'Cancelled').map((p) => [p.id, `${p.code} — ${p.title} (${p.client_code})${unbilledBy[p.id] ? ` · ${money(unbilledBy[p.id].value)} ready` : ''}`]) })}
      ${field({ label: 'Client (if no project)', name: 'client_id', type: 'select', span: 2, options: clients.map((c) => [c.id, c.name]), empty: '—' })}
      ${field({ label: 'Include all approved, not-yet-invoiced tests of the project', name: 'include_unbilled', type: 'checkbox', value: true, span: 2 })}
      ${field({ label: 'Notes on invoice', name: 'notes', type: 'textarea', rows: 2, span: 2 })}`,
    onSubmit: (d) => api.post('/api/invoices', { ...d, project_id: d.project_id || null, client_id: d.client_id || null }),
  });
  if (res) { toast(`Draft ${res.code} created`); navigate(`/invoices/${res.id}`); }
}

export async function list(ctx) {
  ctx.title('Invoices');
  const view = ctx.query.view || ctx.query.status || 'all';
  const [rows, unbilled] = await Promise.all([api.get('/api/invoices'), api.get('/api/invoices/unbilled')]);
  const shown = rows.filter((i) => (view === 'all' ? true : view === 'Overdue' ? isOverdue(i) : view === 'unbilled' ? false : i.status === view));
  const totalUnbilled = unbilled.reduce((s, u) => s + u.value, 0);
  const outstanding = rows.filter((i) => i.status === 'Sent').reduce((s, i) => s + i.total, 0);
  const overdue = rows.filter(isOverdue).reduce((s, i) => s + i.total, 0);

  ctx.el.innerHTML = String(html`
    ${pageHead({ title: 'Invoices', sub: 'Turn approved work into invoices in two clicks, and keep track of what has been paid.', actions: can('billing.edit') ? html`<button class="btn primary" data-act="new">${icon('plus', { size: 15 })}New invoice</button>` : '' })}
    <div class="kpis">
      <a class="kpi" href="${setQuery({ view: 'unbilled', status: null })}"><div class="k-label">Ready to bill</div><div class="k-value">${money(totalUnbilled)}</div><div class="k-sub">${plural(unbilled.length, 'project')} with approved work</div></a>
      <a class="kpi" href="${setQuery({ view: 'Sent', status: null })}"><div class="k-label">Awaiting payment</div><div class="k-value">${money(outstanding)}</div><div class="k-sub">${plural(rows.filter((i) => i.status === 'Sent').length, 'invoice')}</div></a>
      <a class="kpi ${overdue ? 'alert' : ''}" href="${setQuery({ view: 'Overdue', status: null })}"><div class="k-label">Overdue</div><div class="k-value">${money(overdue)}</div><div class="k-sub">Past payment terms</div></a>
    </div>
    <div class="toolbar">
      ${segmented([
        { key: 'unbilled', label: 'Ready to bill', count: unbilled.length, href: setQuery({ view: 'unbilled', status: null }) },
        { key: 'all', label: 'All', href: setQuery({ view: null, status: null }) },
        { key: 'Draft', label: 'Draft', href: setQuery({ view: 'Draft', status: null }) },
        { key: 'Sent', label: 'Sent', href: setQuery({ view: 'Sent', status: null }) },
        { key: 'Overdue', label: 'Overdue', href: setQuery({ view: 'Overdue', status: null }) },
        { key: 'Paid', label: 'Paid', href: setQuery({ view: 'Paid', status: null }) },
      ], view)}
      <span class="spacer"></span>${view === 'unbilled' ? '' : searchBox('Filter invoices…')}
    </div>
    ${view === 'unbilled' ? card({
      title: 'Approved work not yet invoiced',
      sub: 'Grouped by project. Creating an invoice pulls in every approved test automatically.',
      flush: true,
      body: unbilled.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Project</th><th>Client</th><th class="right">Tests</th><th>Oldest approval</th><th class="right">Value</th><th></th></tr></thead><tbody>${unbilled.map((u) => html`<tr>
        <td class="title-cell"><a href="/projects/${u.id}"><strong>${u.title}</strong></a><span class="sub-line">${u.code}${u.po_number ? ` · PO ${u.po_number}` : ''}</span></td>
        <td>${u.client_name}</td><td class="right num">${u.tests}</td><td class="muted">${relTime(u.oldest)}</td><td class="right num"><strong>${money(u.value)}</strong></td>
        <td class="right">${can('billing.edit') ? html`<button class="btn sm primary" data-bill="${u.id}">${icon('receipt', { size: 13 })}Create invoice</button>` : ''}</td>
      </tr>`)}</tbody></table></div>` : emptyState({ icon: 'check', title: 'Everything approved has been invoiced' }),
    }) : html`<div class="card"><div data-table></div></div>`}`);

  if (view !== 'unbilled') {
    const table = mountTable(ctx.el.querySelector('[data-table]'), {
      rows: shown,
      rowHref: (r) => `/invoices/${r.id}`,
      rowClass: (r) => (isOverdue(r) ? 'row-fail' : ''),
      searchText: (r) => `${r.code} ${r.client_name} ${r.project_code} ${r.project_title} ${r.po_number}`,
      empty: emptyState({ icon: 'receipt', title: 'No invoices here' }),
      columns: [
        { key: 'code', label: 'Invoice', sort: (r) => r.id, render: (r) => html`<a class="code" href="/invoices/${r.id}">${r.code}</a>` },
        { key: 'client_name', label: 'Client', sort: true, cls: 'title-cell', render: (r) => html`<strong>${r.client_name}</strong><span class="sub-line">${r.project_code ? `${r.project_code} · ${r.project_title}` : ''}</span>` },
        { key: 'issued_date', label: 'Issued', sort: true, render: (r) => html`<span class="nowrap">${fmtDate(r.issued_date)}</span>` },
        { key: 'due_date', label: 'Due', sort: true, render: (r) => html`<span class="nowrap ${isOverdue(r) ? 'bad-text' : ''}">${fmtDate(r.due_date)}</span>` },
        { key: 'total', label: 'Total', sort: true, align: 'right', render: (r) => html`<span class="num">${money(r.total)}</span>` },
        { key: 'status', label: 'Status', sort: true, render: (r) => statusBadge(displayStatus(r)) },
      ],
    });
    const f = ctx.el.querySelector('[data-filter]');
    f?.addEventListener('input', debounce(() => table.filter(f.value), 120));
  }
  ctx.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act=new]')) newInvoice();
    const bill = e.target.closest('[data-bill]');
    if (bill) {
      await busy(bill, async () => {
        const res = await api.post('/api/invoices', { project_id: Number(bill.dataset.bill), include_unbilled: true });
        toast(`Draft ${res.code} created`);
        navigate(`/invoices/${res.id}`);
      });
    }
  });
}

export async function detail(ctx) {
  const d = await api.get(`/api/invoices/${ctx.params.id}`);
  const inv = d.invoice;
  ctx.title(inv.code);
  let lines = d.lines.map((l) => ({ ...l }));
  const editable = d.can.edit;

  const totals = () => {
    const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
    const rate = Number(ctx.el.querySelector('[name=tax_rate]')?.value ?? inv.tax_rate) || 0;
    const tax = Math.round(subtotal * rate) / 100;
    return { subtotal, tax, total: subtotal + tax, rate };
  };

  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/invoices', label: 'Invoices' },
      title: html`<span class="mono">${inv.code}</span>`,
      badges: statusBadge(displayStatus(inv)),
      meta: html`<span>${icon('building', { size: 14 })}<a href="/clients/${inv.client_id}">${inv.client_name}</a></span>${inv.project_id ? html`<span>${icon('folder', { size: 14 })}<a href="/projects/${inv.project_id}">${inv.project_code}</a></span>` : ''}${inv.po_number ? html`<span>PO ${inv.po_number}</span>` : ''}${inv.issued_date ? html`<span>Issued ${fmtDate(inv.issued_date)} · due ${fmtDate(inv.due_date)}</span>` : ''}`,
      actions: html`
        <a class="btn" href="/print/invoice/${inv.id}" target="_blank">${icon('printer', { size: 15 })}Print / PDF</a>
        ${editable && d.unbilledAvailable ? html`<button class="btn" data-act="pull">${icon('plus', { size: 15 })}Add ${plural(d.unbilledAvailable, 'completed test')}</button>` : ''}
        ${editable ? html`<button class="btn primary" data-act="issue">${icon('send', { size: 15 })}Issue invoice</button>` : ''}
        ${d.can.status && inv.status === 'Sent' ? html`<button class="btn primary" data-act="paid">${icon('check', { size: 15 })}Mark paid</button>` : ''}
        ${d.can.status && ['Draft', 'Sent'].includes(inv.status) ? html`<button class="btn" data-act="void">${icon('xCircle', { size: 15 })}Void</button>` : ''}`,
    })}
    ${inv.status !== 'Draft' ? html`<div class="locked-banner">${icon('lock', { size: 14 })}<span>${inv.status === 'Void' ? 'This invoice was voided; its tests are billable again.' : 'Issued invoices are locked. To correct one, void it and create a new invoice.'}</span></div>` : ''}
    <div class="split">
      <div class="stack">
        ${card({
          title: 'Invoice lines',
          flush: true,
          body: html`<div class="table-wrap"><table class="table"><thead><tr><th>Description</th><th class="right" style="width:110px">Qty</th><th class="right" style="width:150px">Unit price</th><th class="right" style="width:140px">Amount</th>${editable ? html`<th style="width:40px"></th>` : ''}</tr></thead><tbody data-lines></tbody>
            <tfoot data-totals></tfoot></table></div>
            ${editable ? html`<div class="card-body row"><button class="btn sm" data-act="add-line">${icon('plus', { size: 13 })}Add line</button><span class="spacer"></span>${field({ label: '', name: 'tax_rate', type: 'number', value: inv.tax_rate, min: 0, max: 100, step: '0.01', attrs: 'style="width:90px" aria-label="Tax rate %"' })}<span class="muted small">% tax</span><button class="btn primary" data-act="save">${icon('check', { size: 15 })}Save draft</button></div>` : ''}`,
        })}
        ${d.tests.length ? card({
          title: 'Tests on this invoice',
          sub: plural(d.tests.length, 'approved test'),
          flush: true,
          body: html`<details><summary class="card-body" style="cursor:pointer">Show tests</summary><div class="table-wrap"><table class="table compact"><tbody>${d.tests.map((t) => html`<tr><td><a href="/tests/${t.id}" class="code">${t.code}</a></td><td>${t.method_code}</td><td><a href="/samples/${t.sample_id}" class="code">${t.sample_code}</a></td><td class="muted">${t.sample_description}</td><td class="right num">${money(t.price)}</td></tr>`)}</tbody></table></div></details>`,
        }) : ''}
        ${recordFooter()}
      </div>
      <div class="stack">
        ${card({ title: 'Bill to', body: html`<strong>${inv.client_name}</strong>${inv.contact_name ? html`<div>Attn: ${inv.contact_name}</div>` : ''}<div class="muted" style="white-space:pre-line">${inv.client_address || ''}</div>${inv.contact_email ? html`<div><a href="mailto:${inv.contact_email}">${inv.contact_email}</a></div>` : ''}` })}
        ${card({ title: 'Details', body: kv([
          ['Status', statusBadge(displayStatus(inv))], ['Created', `${fmtDate(inv.created_at)} by ${inv.created_by_name || '—'}`], ['Issued', fmtDate(inv.issued_date)], ['Due', fmtDate(inv.due_date)],
          ['Paid', inv.paid_date ? fmtDate(inv.paid_date) : null], ['Project', inv.project_id ? html`<a href="/projects/${inv.project_id}">${inv.project_code}</a>` : null], ['Notes', inv.notes],
        ]) })}
      </div>
    </div>`);

  const tbody = ctx.el.querySelector('[data-lines]');
  const tfoot = ctx.el.querySelector('[data-totals]');
  const drawTotals = () => {
    const t = totals();
    tfoot.innerHTML = String(html`
      <tr><td colspan="3" class="right muted">Subtotal</td><td class="right num">${money(t.subtotal)}</td>${editable ? html`<td></td>` : ''}</tr>
      <tr><td colspan="3" class="right muted">Tax (${t.rate}%)</td><td class="right num">${money(t.tax)}</td>${editable ? html`<td></td>` : ''}</tr>
      <tr><td colspan="3" class="right"><strong>Total ${state.settings.currency}</strong></td><td class="right num"><strong>${money(t.total)}</strong></td>${editable ? html`<td></td>` : ''}</tr>`);
  };
  const sync = () => {
    if (!editable) return;
    lines = [...tbody.querySelectorAll('tr[data-line]')].map((tr) => {
      const prev = lines[Number(tr.dataset.line)] || {};
      return { id: prev.id, test_ids: prev.test_ids, description: tr.querySelector('[data-k=description]').value, quantity: prev.test_ids ? prev.quantity : tr.querySelector('[data-k=quantity]').value, unit_price: tr.querySelector('[data-k=unit_price]').value };
    });
  };
  const drawLines = () => {
    tbody.innerHTML = lines.length ? String(html`${lines.map((l, i) => (editable ? html`<tr data-line="${i}">
      <td><input data-k="description" value="${l.description}" aria-label="Description">${l.test_ids ? html`<span class="sub-line">${icon('lock', { size: 11 })} ${l.quantity} approved tests — remove the line to release them for later billing</span>` : ''}</td>
      <td><input data-k="quantity" value="${l.quantity}" inputmode="decimal" class="right" style="text-align:right" aria-label="Quantity" ${l.test_ids ? raw('disabled') : ''}></td>
      <td><input data-k="unit_price" value="${l.unit_price}" inputmode="decimal" style="text-align:right" aria-label="Unit price"></td>
      <td class="right num" data-amt>${money((Number(l.quantity) || 0) * (Number(l.unit_price) || 0))}</td>
      <td><button class="icon-btn" data-del="${i}" aria-label="Remove line">${icon('x', { size: 14 })}</button></td></tr>`
      : html`<tr><td>${l.description}</td><td class="right num">${l.quantity}</td><td class="right num">${money(l.unit_price)}</td><td class="right num">${money(l.quantity * l.unit_price)}</td></tr>`))}`)
      : String(html`<tr><td colspan="5">${emptyState({ icon: 'receipt', title: 'No lines yet', text: 'Add completed work or a manual line (e.g. a method development milestone).' })}</td></tr>`);
    drawTotals();
  };
  drawLines();
  wireRecordFooter(ctx.el, 'invoices', inv.id);

  ctx.el.addEventListener('input', (e) => {
    if (e.target.closest('[data-lines]')) {
      sync();
      const tr = e.target.closest('tr');
      const q = Number(tr.querySelector('[data-k=quantity]').value) || 0;
      const p = Number(tr.querySelector('[data-k=unit_price]').value) || 0;
      tr.querySelector('[data-amt]').textContent = money(q * p);
      drawTotals();
    }
    if (e.target.name === 'tax_rate') drawTotals();
  });
  const save = async () => {
    const res = await api.put(`/api/invoices/${inv.id}`, { lines, tax_rate: ctx.el.querySelector('[name=tax_rate]')?.value });
    if (res.released) toast(`${plural(res.released, 'test')} released back to “ready to bill”`, 'info');
    return res;
  };

  ctx.el.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { sync(); lines.splice(Number(del.dataset.del), 1); drawLines(); return; }
    const b = e.target.closest('[data-act]');
    const act = b?.dataset.act;
    if (act === 'add-line') { sync(); lines.push({ description: '', quantity: 1, unit_price: 0 }); drawLines(); tbody.querySelector('tr:last-child input')?.focus(); }
    if (act === 'save') await busy(b, async () => { sync(); await save(); toast('Draft saved'); ctx.refresh(); });
    if (act === 'pull') await busy(b, async () => { sync(); await save(); await api.post(`/api/invoices/${inv.id}/add-unbilled`); toast('Completed work added'); ctx.refresh(); });
    if (act === 'issue') {
      sync();
      const t = totals();
      if (!(await confirmDialog({ title: `Issue ${inv.code}?`, message: `Total ${money(t.total)} to ${inv.client_name}. The invoice will be locked and the payment due date set from the client's terms.`, confirmLabel: 'Issue invoice' }))) return;
      await busy(b, async () => { await save(); await api.post(`/api/invoices/${inv.id}/issue`); toast('Invoice issued'); ctx.refresh(); });
    }
    if (act === 'paid') {
      const ok = await openForm({ title: `Payment received for ${inv.code}`, size: 'sm', submitLabel: 'Mark paid', body: field({ label: 'Payment date', name: 'paid_date', type: 'date', value: todayIso(), span: 2 }), onSubmit: (dd) => api.post(`/api/invoices/${inv.id}/paid`, dd) });
      if (ok) { toast('Marked as paid'); ctx.refresh(); }
    }
    if (act === 'void') {
      const reason = await promptReason('Why is this invoice being voided? Its tests become billable again');
      if (!reason) return;
      try { await api.post(`/api/invoices/${inv.id}/void`, { reason }); toast('Invoice voided'); ctx.refresh(); } catch (err) { showError(err); }
    }
  });
}
