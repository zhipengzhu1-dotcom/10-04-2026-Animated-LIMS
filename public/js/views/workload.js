import { html } from '../core/html.js';
import { api } from '../core/api.js';
import { roleLabel, can } from '../core/state.js';
import { icon } from '../core/icons.js';
import { hoverTips } from '../core/charts.js';
import { pageHead, mountTable, searchBox, emptyState, avatar, num, plural, debounce, progress } from '../core/ui.js';

const count = (n, cls = '') => (n ? html`<span class="num ${cls}">${num(n)}</span>` : html`<span class="num muted">0</span>`);

const SEGMENTS = [
  ['overdue', 'Overdue', (r) => r.overdue],
  ['soon', 'Due in 7 days', (r) => r.due_week],
  ['later', 'Due later', (r) => r.open - r.overdue - r.due_week],
  ['review', 'Awaiting review', (r) => r.awaiting_review],
];
const loadOf = (r) => r.open + r.awaiting_review;

const loadBar = (r, max) => {
  const parts = SEGMENTS.map(([key, label, n]) => [key, label, n(r)]).filter(([, , n]) => n);
  return html`<span class="load-track" role="img" aria-label="${parts.map(([, label, n]) => `${n} ${label.toLowerCase()}`).join(', ') || 'No tests'}">
    <span class="load-bar" style="width:${(loadOf(r) / max) * 100}%">${parts.map(([key, label, n]) => html`<span class="seg-${key}" style="flex:${n}" data-tip="${n}" data-tip-label="${label}"></span>`)}</span></span>`;
};

const legend = html`<span class="load-legend">${SEGMENTS.map(([key, label]) => html`<span><i class="seg-${key}"></i>${label}</span>`)}</span>`;

const projectChip = (p) => html`<a class="chip" href="/projects/${p.id}" title="${p.title} · ${p.client_code}${p.lead ? ' · Project lead' : ''} · ${p.tests_done} of ${p.test_count} tests approved">
  ${p.lead ? icon('user', { size: 11 }) : ''}<span class="code">${p.code}</span>${p.open_tests ? html`<span class="num">${p.open_tests}</span>` : ''}${p.test_count ? progress(p.tests_done, p.test_count, { tone: 'green' }) : ''}</a>`;

export async function list(ctx) {
  ctx.title('Workload');
  const d = await api.get('/api/workload');
  const total = (key) => d.analysts.reduce((n, a) => n + a[key], 0);
  const overdue = total('overdue');
  const returned = total('returned');
  const max = Math.max(1, ...d.analysts.map(loadOf));
  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Workload',
      sub: 'Open tests per analyst and the projects they are on: projects they lead, or hold open tests for.',
      actions: can('tests.assign') ? html`<a class="btn primary" href="/worklist?view=unassigned">${icon('users', { size: 15 })}Assign work</a>` : '',
    })}
    <div class="kpis">
      <a class="kpi" href="/worklist"><div class="k-label">${icon('worklist', { size: 14 })}Open tests</div><div class="k-value">${num(total('open'))}</div><div class="k-sub">${num(total('in_progress'))} in progress · ${num(total('due_week'))} due in 7 days</div></a>
      <a class="kpi ${overdue ? 'alert' : ''}" href="/worklist?view=overdue"><div class="k-label">${icon('clock', { size: 14 })}Overdue</div><div class="k-value">${num(overdue)}</div><div class="k-sub">Assigned and past their due date</div></a>
      <a class="kpi ${d.unassigned ? 'warn' : ''}" href="/worklist?view=unassigned"><div class="k-label">${icon('inbox', { size: 14 })}Unassigned</div><div class="k-value">${num(d.unassigned)}</div><div class="k-sub">Pending tests with no analyst</div></a>
      <div class="kpi ${returned ? 'warn' : ''}"><div class="k-label">${icon('undo', { size: 14 })}Returned</div><div class="k-value">${num(returned)}</div><div class="k-sub">Sent back by a reviewer or QA</div></div>
    </div>
    <div class="toolbar">${legend}<span class="spacer"></span><span class="muted small">${plural(d.analysts.length, 'analyst')}</span>${searchBox('Filter analysts…')}</div>
    <div class="card"><div data-table></div></div>`);
  const table = mountTable(ctx.el.querySelector('[data-table]'), {
    rows: d.analysts,
    rowHref: (r) => `/team/${r.id}`,
    searchText: (r) => `${r.full_name} ${r.title} ${roleLabel(r.role)} ${r.projects.map((p) => p.code).join(' ')}`,
    empty: emptyState({ icon: 'users', title: 'No analysts', text: 'Nobody active can perform tests yet.' }),
    columns: [
      { key: 'full_name', label: 'Analyst', sort: true, render: (r) => html`<a class="person" href="/team/${r.id}">${avatar(r.full_name, r.id, { initials: r.initials, size: 30 })}<span><strong>${r.full_name}</strong><span class="sub-line">${r.title || roleLabel(r.role)}</span></span></a>` },
      { key: 'load', label: 'Load', sort: loadOf, render: (r) => loadBar(r, max) },
      { key: 'open', label: 'Open', sort: true, align: 'right', render: (r) => html`<a href="/worklist?analyst=${r.id}">${count(r.open)}</a>` },
      { key: 'in_progress', label: 'In progress', sort: true, align: 'right', render: (r) => count(r.in_progress) },
      { key: 'overdue', label: 'Overdue', sort: true, align: 'right', render: (r) => count(r.overdue, 'bad-text') },
      { key: 'due_week', label: 'Due in 7 days', sort: true, align: 'right', render: (r) => count(r.due_week) },
      { key: 'returned', label: 'Returned', sort: true, align: 'right', render: (r) => count(r.returned, 'warn-text') },
      { key: 'projects', label: 'Projects', sort: (r) => r.projects.length, render: (r) => (r.projects.length ? html`<span class="row">${r.projects.map(projectChip)}</span>` : html`<span class="muted">—</span>`) },
    ],
  });
  hoverTips(ctx.el.querySelector('[data-table]'));
  const f = ctx.el.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
}
