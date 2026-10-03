import { html } from '../core/html.js';
import { api } from '../core/api.js';
import { can, shipped } from '../core/state.js';
import { pageHead, card, money, num, emptyState } from '../core/ui.js';
import { columnChart, lineChart, barList } from '../core/charts.js';

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' });
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const mLabel = (ym) => MONTH.format(new Date(`${ym}-15T12:00:00`));
let currentMonth = '';
const mTip = (ym) => `${MONTH_YEAR.format(new Date(`${ym}-15T12:00:00`))}${ym === currentMonth ? ' (so far)' : ''}`;
const sum = (a) => a.reduce((s, x) => s + (x.value || 0), 0);
const lastN = (a, n) => a.slice(-n).filter((x) => x.value);

export async function render(ctx) {
  ctx.title('Insights');
  const d = await api.get('/api/insights');
  // Start the charts at the first month with any activity (keeping at least six months) so a lab that
  // is new to the system doesn't see half-empty charts.
  const series = ['revenueByMonth', 'completedByMonth', 'receivedByMonth', 'tatByMonth', 'onTimeByMonth'];
  const firstActive = Math.min(...series.filter((k) => d[k]).map((k) => { const i = d[k].findIndex((x) => x.value); return i < 0 ? d[k].length : i; }));
  const start = Math.max(0, Math.min(firstActive, d.months.length - 6));
  for (const k of series) if (d[k]) d[k] = d[k].slice(start);
  currentMonth = d.months[d.months.length - 1];
  const money_ = can('billing.view') && d.revenueByMonth;
  const recentTat = lastN(d.tatByMonth, 3);
  const recentOnTime = lastN(d.onTimeByMonth, 3);
  const avgTat = recentTat.length ? sum(recentTat) / recentTat.length : null;
  const onTime = recentOnTime.length ? sum(recentOnTime) / recentOnTime.length : null;
  const runs = d.oosByMethod.reduce((s, m) => s + m.runs, 0);
  const oos = d.oosByMethod.reduce((s, m) => s + m.oos, 0);

  ctx.el.innerHTML = String(html`
    ${pageHead({ title: 'Insights', sub: 'How the lab is performing over the last 12 months — throughput, turnaround, quality and revenue. The current month is partial.' })}
    <div class="kpis">
      ${money_ ? html`<div class="kpi"><div class="k-label">Invoiced, 12 months</div><div class="k-value">${money(sum(d.revenueByMonth))}</div><div class="k-sub">Net of tax</div></div>` : ''}
      <div class="kpi"><div class="k-label">Tests approved, 12 months</div><div class="k-value">${num(sum(d.completedByMonth))}</div><div class="k-sub">${num(sum(d.receivedByMonth))} samples received</div></div>
      <div class="kpi"><div class="k-label">Turnaround, last 3 months</div><div class="k-value">${avgTat == null ? '—' : `${avgTat.toFixed(1)} d`}</div><div class="k-sub">Receipt → certificate (calendar days)</div></div>
      <div class="kpi ${onTime != null && onTime < 85 ? 'warn' : ''}"><div class="k-label">On-time, last 3 months</div><div class="k-value">${onTime == null ? '—' : `${Math.round(onTime)}%`}</div><div class="k-sub">Certificates issued by the due date</div></div>
      <div class="kpi"><div class="k-label">OOS rate</div><div class="k-value">${runs ? `${((oos / runs) * 100).toFixed(1)}%` : '—'}</div><div class="k-sub">${oos} of ${num(runs)} submitted tests</div></div>
    </div>
    <div class="grid-2">
      ${money_ ? card({ title: 'Invoiced revenue per month', sub: 'Net of tax', body: html`<div data-c="revenue"></div>` }) : ''}
      ${card({ title: 'Tests approved per month', body: html`<div data-c="completed"></div>` })}
      ${card({ title: 'Samples received per month', body: html`<div data-c="received"></div>` })}
      ${card({ title: 'Average turnaround (days)', sub: 'Receipt to issued certificate, by month of issue', body: html`<div data-c="tat"></div>` })}
      ${card({ title: 'On-time delivery (%)', sub: 'Dashed line: 90% target', body: html`<div data-c="ontime"></div>` })}
      ${card({ title: 'Analyst throughput', sub: 'Tests approved in the last 90 days', body: html`<div data-c="throughput"></div>` })}
      ${money_ && d.revenueByClient?.length ? card({ title: 'Revenue by client', sub: 'Last 12 months', body: html`<div data-c="clients"></div>` }) : ''}
      ${money_ && d.valueByTechnique?.length ? card({ title: 'Approved work by technique', sub: 'Value, last 12 months', body: html`<div data-c="technique"></div>` }) : ''}
    </div>
    ${card({
      title: 'Out-of-specification rate by method',
      sub: 'A rising OOS rate on one method often points to a robustness or training issue rather than product quality.',
      flush: true,
      body: d.oosByMethod.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Method</th><th class="right">Tests</th><th class="right">OOS</th><th style="width:40%">Rate</th></tr></thead><tbody>${d.oosByMethod.map((m) => {
        const rate = m.runs ? (m.oos / m.runs) * 100 : 0;
        return html`<tr><td><span class="code">${m.code}</span><span class="sub-line">${m.title}</span></td><td class="right num">${m.runs}</td><td class="right num">${m.oos}</td><td><span class="row nowrap"><span class="progress wide" style="max-width:240px"><span style="width:${Math.min(100, rate * 5)}%;background:${rate > 5 ? 'var(--red-fg)' : 'var(--series-1)'}"></span></span><span class="num small">${rate.toFixed(1)}%</span></span></td></tr>`;
      })}</tbody></table></div>` : emptyState({ icon: 'chart', title: 'No data yet' }),
    })}`);

  ctx.el.addEventListener('aq:mounted', () => {
    const el = (k) => ctx.el.querySelector(`[data-c="${k}"]`);
    const months = (series) => series.map((x) => ({ label: mLabel(x.month), tip: mTip(x.month), value: x.value }));
    if (money_) columnChart(el('revenue'), { data: months(d.revenueByMonth), format: (v) => money(v, { compact: true }), labelHead: 'Month', valueHead: 'Invoiced' });
    columnChart(el('completed'), { data: months(d.completedByMonth), format: (v) => num(v), labelHead: 'Month', valueHead: 'Tests approved' });
    columnChart(el('received'), { data: months(d.receivedByMonth), format: (v) => num(v), labelHead: 'Month', valueHead: 'Samples received' });
    lineChart(el('tat'), { data: d.tatByMonth.map((x) => ({ label: mLabel(x.month), tip: mTip(x.month), value: x.value || null })), format: (v) => `${(+v).toFixed(1)} d`, min: 0, labelHead: 'Month', valueHead: 'Average turnaround' });
    lineChart(el('ontime'), { data: d.onTimeByMonth.map((x) => ({ label: mLabel(x.month), tip: mTip(x.month), value: x.value || null })), format: (v) => `${Math.round(v)}%`, min: 0, max: 100, target: 90, labelHead: 'Month', valueHead: 'On-time %' });
    const tp = d.throughput.filter((t) => t.approved > 0);
    if (tp.length) barList(el('throughput'), { data: tp.map((t) => ({ label: t.full_name, value: t.approved, href: shipped('team') ? `/team/${t.id}` : null })), format: (v) => `${v}`, labelHead: 'Analyst', valueHead: 'Tests approved' });
    else el('throughput').innerHTML = String(emptyState({ icon: 'users', title: 'No approved tests in 90 days' }));
    if (el('clients')) barList(el('clients'), { data: d.revenueByClient.map((c) => ({ label: c.name, value: c.value, href: shipped('clients') ? `/clients/${c.id}` : null })), format: (v) => money(v, { compact: true }), labelHead: 'Client', valueHead: 'Revenue' });
    if (el('technique')) barList(el('technique'), { data: d.valueByTechnique.map((t) => ({ label: t.label, value: t.value })), format: (v) => money(v, { compact: true }), labelHead: 'Technique', valueHead: 'Value' });
  }, { once: true });
}
