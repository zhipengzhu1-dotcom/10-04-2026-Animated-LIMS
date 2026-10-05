import { html } from '../core/html.js';
import { api } from '../core/api.js';
import { roleLabel } from '../core/state.js';
import { icon } from '../core/icons.js';
import { pageHead, mountTable, searchBox, emptyState, avatar, num, plural, debounce } from '../core/ui.js';

const count = (n, cls = '') => (n ? html`<span class="num ${cls}">${num(n)}</span>` : html`<span class="num muted">0</span>`);

const projectChip = (p) => html`<a class="chip" href="/projects/${p.id}" title="${p.title} · ${p.client_code}${p.lead ? ' · Project lead' : ''}">
  ${p.lead ? icon('user', { size: 11 }) : ''}<span class="code">${p.code}</span>${p.open_tests ? html`<span class="num">${p.open_tests}</span>` : ''}</a>`;

export async function list(ctx) {
  ctx.title('Workload');
  const d = await api.get('/api/workload');
  const total = (key) => d.analysts.reduce((n, a) => n + a[key], 0);
  const overdue = total('overdue');
  const returned = total('returned');
  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Workload',
      sub: 'Open tests per analyst and the projects they are on: projects they lead, or hold open tests for.',
      actions: html`<a class="btn primary" href="/worklist?view=unassigned">${icon('users', { size: 15 })}Assign work</a>`,
    })}
    <div class="kpis">
      <a class="kpi" href="/worklist"><div class="k-label">${icon('worklist', { size: 14 })}Open tests</div><div class="k-value">${num(total('open'))}</div><div class="k-sub">${num(total('in_progress'))} in progress · ${num(total('due_week'))} due in 7 days</div></a>
      <a class="kpi ${overdue ? 'alert' : ''}" href="/worklist?view=overdue"><div class="k-label">${icon('clock', { size: 14 })}Overdue</div><div class="k-value">${num(overdue)}</div><div class="k-sub">Assigned and past their due date</div></a>
      <a class="kpi ${d.unassigned ? 'warn' : ''}" href="/worklist?view=unassigned"><div class="k-label">${icon('inbox', { size: 14 })}Unassigned</div><div class="k-value">${num(d.unassigned)}</div><div class="k-sub">Pending tests with no analyst</div></a>
      <div class="kpi ${returned ? 'warn' : ''}"><div class="k-label">${icon('undo', { size: 14 })}Returned</div><div class="k-value">${num(returned)}</div><div class="k-sub">Sent back by a reviewer or QA</div></div>
    </div>
    <div class="toolbar"><span class="muted small">${plural(d.analysts.length, 'analyst')}</span><span class="spacer"></span>${searchBox('Filter analysts…')}</div>
    <div class="card"><div data-table></div></div>`);
  const table = mountTable(ctx.el.querySelector('[data-table]'), {
    rows: d.analysts,
    rowHref: (r) => `/team/${r.id}`,
    searchText: (r) => `${r.full_name} ${r.title} ${roleLabel(r.role)} ${r.projects.map((p) => p.code).join(' ')}`,
    empty: emptyState({ icon: 'users', title: 'No analysts', text: 'Nobody active can perform tests yet.' }),
    columns: [
      { key: 'full_name', label: 'Analyst', sort: true, render: (r) => html`<a class="person" href="/team/${r.id}">${avatar(r.full_name, r.id, { initials: r.initials, size: 30 })}<span><strong>${r.full_name}</strong><span class="sub-line">${r.title || roleLabel(r.role)}</span></span></a>` },
      { key: 'open', label: 'Open', sort: true, align: 'right', render: (r) => html`<a href="/worklist?analyst=${r.id}">${count(r.open)}</a>` },
      { key: 'in_progress', label: 'In progress', sort: true, align: 'right', render: (r) => count(r.in_progress) },
      { key: 'overdue', label: 'Overdue', sort: true, align: 'right', render: (r) => count(r.overdue, 'bad-text') },
      { key: 'due_week', label: 'Due in 7 days', sort: true, align: 'right', render: (r) => count(r.due_week) },
      { key: 'returned', label: 'Returned', sort: true, align: 'right', render: (r) => count(r.returned, 'warn-text') },
      { key: 'awaiting_review', label: 'Awaiting review', sort: true, align: 'right', render: (r) => count(r.awaiting_review) },
      { key: 'projects', label: 'Projects', sort: (r) => r.projects.length, render: (r) => (r.projects.length ? html`<span class="row">${r.projects.map(projectChip)}</span>` : html`<span class="muted">—</span>`) },
    ],
  });
  const f = ctx.el.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
}
