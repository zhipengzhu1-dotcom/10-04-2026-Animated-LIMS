import { html } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can } from '../core/state.js';
import { icon } from '../core/icons.js';
import { pageHead, card, statusBadge, priorityBadge, dueChip, money, num, relTime, emptyState, avatar, plural, progress } from '../core/ui.js';
import { columnChart, barList } from '../core/charts.js';

const ENTITY_HREF = { samples: 'samples', tests: 'tests', investigations: 'investigations', notebook_entries: 'notebook', methods: 'methods', invoices: 'invoices' };
const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' });
const monthLabel = (ym) => MONTH.format(new Date(`${ym}-15T12:00:00`));

const SIGN_TEXT = {
  Performed: 'submitted results', Reviewed: 'peer-reviewed', Approved: 'approved', 'Returned by reviewer': 'returned to the analyst',
  'Rejected at approval': 'returned at approval', 'Certificate of Analysis issued': 'issued the certificate for', Authored: 'signed notebook entry',
  Witnessed: 'witnessed', Closed: 'closed', 'Approved for use': 'approved method', Retired: 'retired method',
};
const CREATE_TEXT = { samples: 'received', investigations: 'raised', notebook_entries: 'started notebook entry', projects: 'opened project', clients: 'added client', methods: 'drafted method' };

function activityText(a) {
  if (a.action === 'SIGN') {
    const meaning = String(a.summary || '').replace(/^Signed: /, '');
    return SIGN_TEXT[meaning] || `signed “${meaning}” on`;
  }
  return CREATE_TEXT[a.entity] || String(a.summary || '').toLowerCase();
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const kpi = ({ label, value, sub, href, tone = '', ic }) => html`
  <a class="kpi ${tone}" ${href ? html`href="${href}"` : ''}>
    <div class="k-label">${ic ? icon(ic, { size: 14 }) : ''}${label}</div>
    <div class="k-value">${value}</div>
    ${sub ? html`<div class="k-sub">${sub}</div>` : ''}
  </a>`;

export async function render(ctx) {
  ctx.title('Dashboard');
  const d = await api.get('/api/dashboard');
  const k = d.kpis;
  const me = state.me;
  const money_ = can('billing.view');
  const onTime = k.reported_90d ? Math.round((k.on_time_90d / k.reported_90d) * 100) : null;
  const returned = new Set(d.myReturned);
  const showWork = can('tests.perform');

  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: `${greeting()}, ${me.full_name.split(' ')[0]}`,
      sub: `${today} · ${state.settings.lab_name}`,
      actions: html`
        ${can('samples.receive') ? html`<a class="btn primary" href="/samples/receive">${icon('inbox', { size: 15 })}Receive samples</a>` : ''}
        ${showWork ? html`<a class="btn" href="/worklist?view=mine">${icon('worklist', { size: 15 })}My worklist</a>` : ''}`,
    })}

    <div class="kpi-band">
    <div class="kpis">
      ${kpi({ label: 'Samples in the lab', value: num(k.samples_in_lab), sub: html`<b>${k.received_7d}</b> received in the last 7 days`, href: '/samples?status=open', ic: 'tube' })}
      ${kpi({ label: 'Tests to do', value: num(k.tests_open), sub: k.tests_overdue ? html`<b class="bad-text">${k.tests_overdue} overdue</b>${k.unassigned ? html` · ${k.unassigned} unassigned` : ''}` : k.unassigned ? `${k.unassigned} unassigned` : 'None overdue', href: '/worklist', ic: 'worklist', tone: k.tests_overdue ? 'warn' : '' })}
      ${kpi({ label: 'Awaiting review / approval', value: html`${k.awaiting_review}<span class="muted" style="font-weight:500"> / ${k.awaiting_approval}</span>`, sub: 'Peer review · QA approval', href: '/reviews', ic: 'review' })}
      ${kpi({ label: 'Open investigations', value: num(k.open_investigations), sub: 'OOS, deviations, incidents', href: '/investigations?status=open', ic: 'alert', tone: k.open_investigations ? 'alert' : '' })}
      ${kpi({ label: 'On-time delivery', value: onTime == null ? '—' : `${onTime}%`, sub: `${k.reported_90d} CoAs in 90 days · avg ${k.avg_tat_90d ? k.avg_tat_90d.toFixed(1) : '—'} days`, href: can('insights.view') ? '/insights' : null, ic: 'clock', tone: onTime != null && onTime < 85 ? 'warn' : '' })}
    </div>
    ${money_ ? html`<div class="kpis">
      ${kpi({ label: 'Invoiced this month', value: money(k.revenue_mtd), sub: `Last month ${money(k.revenue_last_month)} · net of tax`, href: '/invoices', ic: 'receipt' })}
      ${kpi({ label: 'Approved, not yet invoiced', value: money(k.unbilled), sub: 'Ready to bill now', href: '/invoices?view=unbilled', ic: 'dollar', tone: k.unbilled > 0 ? '' : '' })}
      ${kpi({ label: 'Work in progress', value: money(k.wip_value), sub: 'Value of open tests', href: '/worklist', ic: 'flask' })}
      ${kpi({ label: 'Awaiting payment', value: money(k.outstanding), sub: k.overdue_receivables ? html`<b class="bad-text">${money(k.overdue_receivables)} overdue</b>` : 'Nothing overdue', href: '/invoices?status=Sent', ic: 'clock', tone: k.overdue_receivables ? 'warn' : '' })}
    </div>` : ''}
    </div>

    <div class="split-wide">
      <div class="stack">
        ${showWork ? card({
          title: 'My work',
          sub: d.myTests.length ? `${plural(d.myTests.length, 'test')} assigned to you` : null,
          actions: html`<a class="btn sm ghost" href="/worklist?view=mine">Open worklist ${icon('arrowRight', { size: 13 })}</a>`,
          flush: true,
          body: d.myTests.length ? html`<ul class="list">${d.myTests.map((t) => html`
            <li class="link" data-href="/tests/${t.id}">
              <div class="grow">
                <div class="title"><span class="code">${t.sample_code}</span> · ${t.method_title}</div>
                <div class="meta">${t.method_code} v${t.method_version} · ${t.client_code} · ${t.sample_description}${t.batch_no ? ` · ${t.batch_no}` : ''}</div>
              </div>
              ${returned.has(t.id) ? html`<span class="badge amber" title="Returned to you by the reviewer">${icon('undo', { size: 11 })}Returned</span>` : ''}
              ${priorityBadge(t.priority)}
              ${statusBadge(t.status)}
              ${dueChip(t.due_date)}
            </li>`)}</ul>` : emptyState({ icon: 'check', title: 'Nothing assigned to you', text: 'Pick up unassigned tests from the worklist.', action: html`<a class="btn sm" href="/worklist?view=unassigned">Unassigned tests</a>` }),
        }) : ''}

        ${card({
          title: 'Samples due in the next 3 days',
          flush: true,
          actions: html`<a class="btn sm ghost" href="/samples?status=open">All open samples ${icon('arrowRight', { size: 13 })}</a>`,
          body: d.dueSoon.length ? html`<ul class="list">${d.dueSoon.map((s) => html`
            <li class="link" data-href="/samples/${s.id}">
              <div class="grow">
                <div class="title"><span class="code">${s.code}</span> · ${s.description}</div>
                <div class="meta">${s.client_code} · ${s.tests_approved}/${s.test_count} tests approved</div>
              </div>
              ${progress(s.tests_approved, s.test_count)}
              ${priorityBadge(s.priority)}
              ${statusBadge(s.status)}
              ${dueChip(s.due_date)}
            </li>`)}</ul>` : emptyState({ icon: 'calendar', title: 'Nothing due soon', text: 'No open samples are due in the next three days.' }),
        })}

        ${money_ && d.revenueTrend ? card({ title: 'Invoiced revenue', sub: 'Last 6 months, net of tax', body: html`<div data-chart="revenue"></div>`, actions: can('insights.view') ? html`<a class="btn sm ghost" href="/insights">Insights ${icon('arrowRight', { size: 13 })}</a>` : '' }) : ''}
      </div>

      <div class="stack">
        ${card({
          title: 'Needs attention',
          sub: d.alerts.length ? `${plural(d.alerts.length, 'item')}` : null,
          flush: true,
          body: d.alerts.length ? html`<ul class="list">${d.alerts.slice(0, 10).map((a) => html`
            <li class="link" data-href="${a.href}">
              <span class="alert-ic ${a.level}">${icon(a.kind === 'Instrument' ? 'instrument' : a.kind === 'Inventory' ? 'package' : a.kind === 'Training' ? 'training' : 'alert', { size: 15 })}</span>
              <div class="grow"><div class="title" style="white-space:normal">${a.text}</div><div class="meta">${a.kind} · ${a.code}</div></div>
            </li>`)}${d.alerts.length > 10 ? html`<li class="muted small">+ ${d.alerts.length - 10} more</li>` : ''}</ul>` : emptyState({ icon: 'check', title: 'All clear', text: 'Calibrations, standards, training and investigations are all in date.' }),
        })}

        ${can('tests.assign') ? card({ title: 'Team workload', sub: 'Open tests per analyst', body: html`<div data-chart="workload"></div>`, actions: html`<a class="btn sm ghost" href="/worklist?view=unassigned">Assign work</a>` }) : ''}

        ${card({
          title: 'Recent activity',
          flush: true,
          body: html`<ul class="list feed">${d.activity.map((a) => html`
            <li class="${ENTITY_HREF[a.entity] && a.entity_id ? 'link' : ''}" ${ENTITY_HREF[a.entity] && a.entity_id ? html`data-href="/${ENTITY_HREF[a.entity]}/${a.entity_id}"` : ''}>
              ${avatar(a.full_name || 'System', a.user_id, { size: 22, initials: a.initials })}
              <div class="grow"><strong>${a.full_name || 'System'}</strong> ${activityText(a)} <span class="code">${a.entity_code || ''}</span></div>
              <span class="when">${relTime(a.at)}</span>
            </li>`)}</ul>`,
        })}
      </div>
    </div>`);

  ctx.el.querySelectorAll('[data-href]').forEach((li) => li.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    window.dispatchEvent(new CustomEvent('aq:navigate', { detail: li.dataset.href }));
  }));

  ctx.el.addEventListener('aq:mounted', () => {
    const rev = ctx.el.querySelector('[data-chart=revenue]');
    if (rev) columnChart(rev, { data: d.revenueTrend.map((m) => ({ label: monthLabel(m.month), value: m.value, tip: m.month })), format: (v) => money(v, { compact: true }), labelHead: 'Month', valueHead: 'Invoiced' });
    const wl = ctx.el.querySelector('[data-chart=workload]');
    if (wl) {
      const rows = d.workload.filter((w) => w.open > 0);
      if (rows.length) barList(wl, { data: rows.map((w) => ({ label: w.full_name, value: w.open, href: `/worklist?analyst=${w.id}` })), format: (v) => `${v}`, labelHead: 'Analyst', valueHead: 'Open tests' });
      else wl.innerHTML = String(emptyState({ icon: 'users', title: 'No open tests assigned' }));
    }
  }, { once: true });
}
