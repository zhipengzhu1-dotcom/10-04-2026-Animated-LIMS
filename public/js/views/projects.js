import { html } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can, activeUsers } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate, setQuery } from '../core/nav.js';
import {
  pageHead, card, kv, mountTable, searchBox, segmented, statusBadge, fmtDate, money, emptyState, field, openForm, toast, progress, person, dueChip, plural, debounce,
} from '../core/ui.js';
import { recordFooter, wireRecordFooter } from '../core/components.js';

const projectFields = (p = {}, clients = []) => {
  const L = state.lookups;
  return html`
    ${p.id ? '' : field({ label: 'Client', name: 'client_id', type: 'select', options: clients.filter((c) => c.active).map((c) => [c.id, c.name]), value: p.client_id, required: true, empty: 'Choose…' })}
    ${field({ label: 'Title', name: 'title', value: p.title, required: true, span: p.id ? 2 : 1, placeholder: 'e.g. Metformin 500 mg — batch release testing' })}
    ${field({ label: 'Type', name: 'type', type: 'select', options: L.projectTypes, value: p.type, required: true, empty: 'Choose…' })}
    ${field({ label: 'Status', name: 'status', type: 'select', options: L.projectStatuses, value: p.status || 'Active' })}
    ${field({ label: 'Project lead', name: 'lead_id', type: 'select', options: activeUsers(['manager', 'scientist', 'qa', 'analyst']).map((u) => [u.id, u.full_name]), value: p.lead_id, empty: '—' })}
    ${field({ label: 'Client PO number', name: 'po_number', value: p.po_number })}
    ${can('billing.edit') ? field({ label: `Budget / quote value (${state.settings.currency})`, name: 'budget', type: 'number', value: p.budget, min: 0, step: '0.01' }) : ''}
    ${field({ label: 'Start date', name: 'start_date', type: 'date', value: p.start_date })}
    ${field({ label: 'Due date', name: 'due_date', type: 'date', value: p.due_date })}
    ${field({ label: 'Scope / description', name: 'description', type: 'textarea', rows: 3, value: p.description, span: 2, placeholder: 'What the client asked for, quote reference, protocol…' })}`;
};

export async function newProject(prefill = {}) {
  const clients = await api.get('/api/clients');
  const res = await openForm({ title: 'New project', size: 'lg', submitLabel: 'Create project', body: projectFields(prefill, clients), onSubmit: (d) => api.post('/api/projects', d) });
  if (res) { toast(`Project ${res.code} created`); navigate(`/projects/${res.id}`); }
}

export async function list(ctx) {
  ctx.title('Projects');
  const status = ctx.query.status || 'open';
  const rows = await api.get('/api/projects', { status: status === 'all' ? '' : status });
  const money_ = can('billing.view');
  ctx.el.innerHTML = String(html`
    ${pageHead({ title: 'Projects', sub: 'Studies, method development work and testing programmes — with progress, budget and billing.', actions: can('projects.edit') ? html`<button class="btn primary" data-act="new">${icon('plus', { size: 15 })}New project</button>` : '' })}
    <div class="toolbar">
      ${segmented([
        { key: 'open', label: 'Open', href: setQuery({ status: null }) },
        { key: 'Quoted', label: 'Quoted', href: setQuery({ status: 'Quoted' }) },
        { key: 'Completed', label: 'Completed', href: setQuery({ status: 'Completed' }) },
        { key: 'all', label: 'All', href: setQuery({ status: 'all' }) },
      ], status)}
      <span class="spacer"></span>${searchBox('Filter projects…')}
    </div>
    <div class="card"><div data-table></div></div>`);
  const table = mountTable(ctx.el.querySelector('[data-table]'), {
    rows,
    rowHref: (r) => `/projects/${r.id}`,
    searchText: (r) => `${r.code} ${r.title} ${r.client_name} ${r.type} ${r.po_number} ${r.lead_name}`,
    empty: emptyState({ icon: 'folder', title: 'No projects', action: can('projects.edit') ? html`<button class="btn primary" data-act="new">New project</button>` : '' }),
    columns: [
      { key: 'title', label: 'Project', sort: true, cls: 'title-cell', render: (r) => html`<a href="/projects/${r.id}"><strong>${r.title}</strong></a><span class="sub-line">${r.code} · ${r.client_name}</span>` },
      { key: 'type', label: 'Type', sort: true, render: (r) => html`<span class="muted">${r.type}</span>` },
      { key: 'lead_name', label: 'Lead', sort: true, render: (r) => person(r.lead_name, r.lead_id) },
      { key: 'progress', label: 'Tests done', sort: (r) => (r.test_count ? r.tests_done / r.test_count : -1), render: (r) => html`<span class="row nowrap">${progress(r.tests_done, r.test_count)}<span class="muted small num">${r.tests_done}/${r.test_count}</span></span>` },
      money_ && { key: 'invoiced', label: 'Invoiced / budget', sort: true, align: 'right', render: (r) => html`<span class="num">${money(r.invoiced)}</span><span class="sub-line">${r.budget ? `of ${money(r.budget)}` : 'no budget'}</span>` },
      money_ && { key: 'unbilled', label: 'Ready to bill', sort: true, align: 'right', render: (r) => (r.unbilled ? html`<span class="num ok-text">${money(r.unbilled)}</span>` : html`<span class="muted">—</span>`) },
      { key: 'due_date', label: 'Due', sort: true, render: (r) => dueChip(r.due_date, { done: ['Completed', 'Cancelled'].includes(r.status) }) },
      { key: 'status', label: 'Status', sort: true, render: (r) => statusBadge(r.status) },
    ].filter(Boolean),
  });
  const f = ctx.el.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
  ctx.el.addEventListener('click', (e) => { if (e.target.closest('[data-act=new]')) newProject(); });
}

export async function detail(ctx) {
  const d = await api.get(`/api/projects/${ctx.params.id}`);
  const p = d.project;
  ctx.title(p.code);
  const money_ = can('billing.view');
  const byStatus = Object.fromEntries(d.testsByStatus.map((x) => [x.status, x.n]));
  const budgetPct = p.budget ? Math.round((p.invoiced / p.budget) * 100) : null;

  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/projects', label: 'Projects' },
      title: p.title,
      badges: statusBadge(p.status),
      meta: html`<span class="code">${p.code}</span><span>${icon('building', { size: 14 })}<a href="/clients/${p.client_id}">${p.client_name}</a></span><span>${p.type}</span>${p.po_number ? html`<span>PO ${p.po_number}</span>` : ''}<span>${icon('clock', { size: 14 })}${dueChip(p.due_date, { done: ['Completed', 'Cancelled'].includes(p.status) })}</span>`,
      actions: html`
        ${d.can.receive && !['Completed', 'Cancelled'].includes(p.status) ? html`<a class="btn primary" href="/samples/receive?client=${p.client_id}&project=${p.id}">${icon('inbox', { size: 15 })}Receive samples</a>` : ''}
        ${d.can.bill ? html`<button class="btn" data-act="invoice">${icon('receipt', { size: 15 })}${p.unbilled ? `Invoice ${money(p.unbilled)}` : 'New invoice'}</button>` : ''}
        ${can('notebook.write') ? html`<button class="btn" data-act="note">${icon('book', { size: 15 })}Notebook</button>` : ''}
        ${d.can.edit ? html`<button class="btn" data-act="edit">${icon('edit', { size: 15 })}Edit</button>` : ''}`,
    })}
    <div class="kpis">
      <div class="kpi"><div class="k-label">Samples</div><div class="k-value">${p.sample_count}</div></div>
      <div class="kpi"><div class="k-label">Tests approved</div><div class="k-value">${p.tests_done}<span class="muted" style="font-weight:500"> / ${p.test_count}</span></div><div class="k-sub">${progress(p.tests_done, p.test_count, { tone: 'green' })}</div></div>
      ${money_ ? html`
        <div class="kpi"><div class="k-label">Invoiced</div><div class="k-value">${money(p.invoiced)}</div><div class="k-sub">${p.budget ? html`${budgetPct}% of ${money(p.budget)} budget` : 'No budget set'}</div></div>
        <div class="kpi"><div class="k-label">Ready to bill</div><div class="k-value ${p.unbilled ? 'ok-text' : ''}">${money(p.unbilled)}</div><div class="k-sub">Approved, not invoiced</div></div>` : ''}
    </div>
    <div class="split">
      <div class="stack">
        ${card({
          title: 'Samples',
          sub: plural(d.samples.length, 'sample'),
          flush: true,
          body: d.samples.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Sample</th><th>Description</th><th>Tests</th><th>Status</th><th>Due</th></tr></thead><tbody>${d.samples.map((s) => html`<tr class="link" data-href="/samples/${s.id}">
            <td><a class="code" href="/samples/${s.id}">${s.code}</a></td><td class="title-cell">${s.description}<span class="sub-line">${s.batch_no || ''}</span></td>
            <td><span class="row nowrap">${progress(s.tests_approved, s.test_count)}<span class="muted small num">${s.tests_approved}/${s.test_count}</span></span></td>
            <td>${statusBadge(s.status)}</td><td>${dueChip(s.due_date, { done: ['Reported', 'Cancelled', 'Disposed'].includes(s.status) })}</td></tr>`)}</tbody></table></div>` : emptyState({ icon: 'tube', title: 'No samples yet', action: d.can.receive ? html`<a class="btn primary" href="/samples/receive?client=${p.client_id}&project=${p.id}">Receive samples</a>` : '' }),
        })}
        ${card({
          title: 'Notebook entries',
          flush: true,
          body: d.notebook.length ? html`<ul class="list">${d.notebook.map((n) => html`<li class="link" data-href="/notebook/${n.id}"><div class="grow"><div class="title">${n.title}</div><div class="meta">${n.code} · ${n.author_name} · ${fmtDate(n.created_at)}</div></div>${statusBadge(n.status)}</li>`)}</ul>` : emptyState({ icon: 'book', title: 'No notebook entries', text: 'Method development and validation work is recorded here.' }),
        })}
        ${recordFooter()}
      </div>
      <div class="stack">
        ${card({ title: 'Project details', body: kv([
          ['Client', html`<a href="/clients/${p.client_id}">${p.client_name}</a>`], ['Type', p.type], ['Lead', person(p.lead_name, p.lead_id)], ['PO number', p.po_number],
          money_ && ['Budget', p.budget ? money(p.budget) : null], ['Start', fmtDate(p.start_date)], ['Due', fmtDate(p.due_date)], ['Scope', p.description],
        ]) })}
        ${card({ title: 'Tests by status', body: kv(['Pending', 'In Progress', 'Submitted', 'Reviewed', 'Approved', 'Cancelled'].filter((s) => byStatus[s]).map((s) => [statusBadge(s), html`<span class="num">${byStatus[s]}</span>`])) })}
        ${budgetPct != null && money_ ? card({ title: 'Budget', body: html`<div class="row" style="justify-content:space-between;margin-bottom:6px"><span>${money(p.invoiced)} invoiced</span><span class="muted">${money(p.budget)}</span></div><span class="progress wide ${budgetPct > 90 ? '' : 'green'}"><span style="width:${Math.min(100, budgetPct)}%"></span></span>${budgetPct > 90 ? html`<p class="small warn-text" style="margin:8px 0 0">${budgetPct}% of the budget is invoiced — talk to the client about a change order.</p>` : ''}` }) : ''}
        ${d.investigations.length ? card({ title: 'Investigations', flush: true, body: html`<ul class="list">${d.investigations.map((v) => html`<li class="link" data-href="/investigations/${v.id}"><div class="grow"><div class="title"><span class="code">${v.code}</span></div><div class="meta">${v.title}</div></div>${statusBadge(v.status)}</li>`)}</ul>` }) : ''}
        ${d.invoices ? card({ title: 'Invoices', flush: true, body: d.invoices.length ? html`<ul class="list">${d.invoices.map((i) => html`<li class="link" data-href="/invoices/${i.id}"><div class="grow"><div class="title"><span class="code">${i.code}</span></div><div class="meta">${i.issued_date ? fmtDate(i.issued_date) : 'Draft'}</div></div><span class="num">${money(i.subtotal)}</span>${statusBadge(i.status)}</li>`)}</ul>` : emptyState({ icon: 'receipt', title: 'Not invoiced yet' }) }) : ''}
      </div>
    </div>`);
  wireRecordFooter(ctx.el, 'projects', p.id, { locked: !d.can.edit });
  ctx.el.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) navigate(el.dataset.href); }));
  ctx.el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') {
      const ok = await openForm({ title: `Edit ${p.code}`, size: 'lg', body: projectFields(p), onSubmit: (data) => api.put(`/api/projects/${p.id}`, data) });
      if (ok) { toast('Project updated'); ctx.refresh(); }
    }
    if (act === 'invoice') {
      const { newInvoice } = await import('./invoices.js');
      newInvoice({ project_id: p.id });
    }
    if (act === 'note') {
      const { newEntry } = await import('./notebook.js');
      newEntry({ project_id: p.id, template: p.type === 'Method Validation' ? 'validation' : p.type === 'Method Development' ? 'devexp' : 'experiment' });
    }
  });
}
