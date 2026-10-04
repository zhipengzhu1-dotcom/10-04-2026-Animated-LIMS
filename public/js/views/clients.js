import { html } from '../core/html.js';
import { api } from '../core/api.js';
import { can } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/nav.js';
import {
  pageHead, card, kv, mountTable, searchBox, statusBadge, fmtDate, money, emptyState, field, openForm, toast, relTime, progress, debounce, badge,
} from '../core/ui.js';
import { recordFooter, wireRecordFooter } from '../core/components.js';

const clientFields = (c = {}) => html`
  ${field({ label: 'Client code', name: 'code', value: c.code, required: true, disabled: !!c.id, placeholder: 'e.g. ACME', hint: c.id ? 'Codes cannot be changed' : 'Short code used on labels and reports' })}
  ${field({ label: 'Company name', name: 'name', value: c.name, required: true })}
  ${field({ label: 'Main contact', name: 'contact_name', value: c.contact_name })}
  ${field({ label: 'Contact email', name: 'contact_email', type: 'email', value: c.contact_email })}
  ${field({ label: 'Phone', name: 'phone', value: c.phone })}
  ${field({ label: 'Payment terms (days)', name: 'payment_terms_days', type: 'number', value: c.payment_terms_days ?? 30, min: 0 })}
  ${field({ label: 'Invoice / report address', name: 'address', type: 'textarea', rows: 3, value: c.address, span: 2 })}
  ${field({ label: 'Notes', name: 'notes', type: 'textarea', rows: 2, value: c.notes, span: 2, placeholder: 'Quality agreement, special requirements, preferred report format…' })}
  ${c.id ? field({ label: 'Active client', name: 'active', type: 'checkbox', value: c.active }) : ''}`;

export async function newClient() {
  const id = await openForm({ title: 'New client', size: 'lg', submitLabel: 'Create client', body: clientFields(), onSubmit: async (d) => (await api.post('/api/clients', d)).id });
  if (id) { toast('Client created'); navigate(`/clients/${id}`); }
}

export async function list(ctx) {
  ctx.title('Clients');
  const rows = await api.get('/api/clients');
  const money_ = can('billing.view');
  ctx.el.innerHTML = String(html`
    ${pageHead({ title: 'Clients', sub: 'The pharmaceutical companies you work for.', actions: can('clients.edit') ? html`<button class="btn primary" data-act="new">${icon('plus', { size: 15 })}New client</button>` : '' })}
    <div class="toolbar"><span class="spacer"></span>${searchBox('Filter clients…')}</div>
    <div class="card"><div data-table></div></div>`);
  const table = mountTable(ctx.el.querySelector('[data-table]'), {
    rows,
    rowHref: (r) => `/clients/${r.id}`,
    sort: money_ ? { key: 'revenue_ytd', dir: -1 } : { key: 'name', dir: 1 },
    searchText: (r) => `${r.code} ${r.name} ${r.contact_name} ${r.contact_email}`,
    empty: emptyState({ icon: 'building', title: 'No clients yet', action: can('clients.edit') ? html`<button class="btn primary" data-act="new">Add your first client</button>` : '' }),
    columns: [
      { key: 'code', label: 'Code', sort: true, render: (r) => html`<span class="code">${r.code}</span>` },
      { key: 'name', label: 'Client', sort: true, cls: 'title-cell', render: (r) => html`<a href="/clients/${r.id}"><strong>${r.name}</strong></a><span class="sub-line">${r.contact_name || ''}${r.contact_email ? ` · ${r.contact_email}` : ''}</span>` },
      { key: 'open_projects', label: 'Open projects', sort: true, align: 'right', render: (r) => html`<span class="num">${r.open_projects}</span>` },
      { key: 'samples_in_lab', label: 'Samples in lab', sort: true, align: 'right', render: (r) => html`<span class="num">${r.samples_in_lab}</span>` },
      { key: 'last_sample_at', label: 'Last sample', sort: true, render: (r) => html`<span class="muted nowrap">${relTime(r.last_sample_at)}</span>` },
      money_ && { key: 'revenue_ytd', label: 'Revenue YTD', sort: true, align: 'right', render: (r) => html`<span class="num">${money(r.revenue_ytd)}</span>` },
      { key: 'active', label: '', render: (r) => (r.active ? '' : badge('Inactive', 'gray')) },
    ].filter(Boolean),
  });
  const f = ctx.el.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
  ctx.el.addEventListener('click', (e) => { if (e.target.closest('[data-act=new]')) newClient(); });
}

export async function detail(ctx) {
  const d = await api.get(`/api/clients/${ctx.params.id}`);
  const c = d.client;
  ctx.title(c.name);
  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/clients', label: 'Clients' },
      title: c.name,
      badges: c.active ? '' : badge('Inactive', 'gray'),
      meta: html`<span class="code">${c.code}</span>${c.contact_name ? html`<span>${icon('user', { size: 14 })}${c.contact_name}</span>` : ''}${c.contact_email ? html`<span><a href="mailto:${c.contact_email}">${c.contact_email}</a></span>` : ''}${c.phone ? html`<span>${c.phone}</span>` : ''}`,
      actions: html`
        ${can('samples.receive') ? html`<a class="btn primary" href="/samples/receive?client=${c.id}">${icon('inbox', { size: 15 })}Receive samples</a>` : ''}
        ${can('projects.edit') ? html`<button class="btn" data-act="project">${icon('folder', { size: 15 })}New project</button>` : ''}
        ${d.can.edit ? html`<button class="btn" data-act="edit">${icon('edit', { size: 15 })}Edit</button>` : ''}`,
    })}
    ${d.money ? html`<div class="kpis">
      <div class="kpi"><div class="k-label">Revenue this year</div><div class="k-value">${money(d.money.revenue_ytd)}</div></div>
      <div class="kpi"><div class="k-label">Awaiting payment</div><div class="k-value">${money(d.money.outstanding)}</div></div>
      <div class="kpi"><div class="k-label">Approved, not invoiced</div><div class="k-value">${money(d.money.unbilled)}</div></div>
      <div class="kpi"><div class="k-label">Work in progress</div><div class="k-value">${money(d.money.wip)}</div></div>
    </div>` : ''}
    <div class="split">
      <div class="stack">
        ${card({
          title: 'Projects',
          flush: true,
          body: d.projects.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Project</th><th>Type</th><th>Progress</th><th>Due</th><th>Status</th></tr></thead><tbody>${d.projects.map((p) => html`<tr class="link" data-href="/projects/${p.id}">
            <td class="title-cell"><a href="/projects/${p.id}"><strong>${p.title}</strong></a><span class="sub-line">${p.code}${p.po_number ? ` · PO ${p.po_number}` : ''}</span></td>
            <td class="muted">${p.type}</td>
            <td><span class="row nowrap">${progress(p.tests_done, p.test_count)}<span class="muted small num">${p.tests_done}/${p.test_count}</span></span></td>
            <td class="nowrap">${fmtDate(p.due_date)}</td><td>${statusBadge(p.status)}</td></tr>`)}</tbody></table></div>` : emptyState({ icon: 'folder', title: 'No projects yet' }),
        })}
        ${card({
          title: 'Recent samples',
          flush: true,
          actions: html`<a class="btn sm ghost" href="/samples?client=${c.id}&status=all">All samples</a>`,
          body: d.samples.length ? html`<div class="table-wrap"><table class="table compact"><tbody>${d.samples.map((s) => html`<tr class="link" data-href="/samples/${s.id}"><td><a class="code" href="/samples/${s.id}">${s.code}</a></td><td>${s.description}<span class="sub-line">${s.batch_no || ''}</span></td><td>${statusBadge(s.status)}</td><td class="muted nowrap">${fmtDate(s.received_at)}</td></tr>`)}</tbody></table></div>` : emptyState({ icon: 'tube', title: 'No samples yet' }),
        })}
        ${recordFooter()}
      </div>
      <div class="stack">
        ${card({ title: 'Client details', body: kv([['Code', c.code], ['Contact', c.contact_name], ['Email', c.contact_email], ['Phone', c.phone], ['Address', c.address], ['Payment terms', `${c.payment_terms_days} days`], ['Notes', c.notes]]) })}
        ${d.methods.length ? card({ title: 'Client-specific methods', flush: true, body: html`<ul class="list">${d.methods.map((m) => html`<li class="link" data-href="/methods/${m.id}"><div class="grow"><div class="title">${m.title}</div><div class="meta">${m.code} v${m.version}</div></div>${statusBadge(m.status)}</li>`)}</ul>` }) : ''}
        ${d.invoices ? card({ title: 'Invoices', flush: true, body: d.invoices.length ? html`<ul class="list">${d.invoices.slice(0, 8).map((i) => html`<li class="link" data-href="/invoices/${i.id}"><div class="grow"><div class="title"><span class="code">${i.code}</span></div><div class="meta">${i.issued_date ? fmtDate(i.issued_date) : 'Draft'}</div></div><span class="num">${money(i.subtotal * (1 + i.tax_rate / 100))}</span>${statusBadge(i.status)}</li>`)}</ul>` : emptyState({ icon: 'receipt', title: 'No invoices yet' }) }) : ''}
      </div>
    </div>`);
  wireRecordFooter(ctx.el, 'clients', c.id, { locked: !d.can.edit });
  ctx.el.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) navigate(el.dataset.href); }));
  ctx.el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') {
      const ok = await openForm({ title: `Edit ${c.name}`, size: 'lg', body: clientFields(c), onSubmit: (data) => api.put(`/api/clients/${c.id}`, data) });
      if (ok) { toast('Client updated'); ctx.refresh(); }
    }
    if (act === 'project') {
      const { newProject } = await import('./projects.js');
      newProject({ client_id: c.id });
    }
  });
}
