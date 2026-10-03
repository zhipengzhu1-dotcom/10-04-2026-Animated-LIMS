import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can, activeUsers } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate, setQuery, refreshNav } from '../core/nav.js';
import { markdown } from '../core/markdown.js';
import {
  pageHead, card, kv, mountTable, searchBox, segmented, statusBadge, fmtDate, fmtDateTime, emptyState, field, openForm, esign, toast,
  person, badge, dueChip, debounce, specText, resultText, outcomeBadge, busy, todayIso,
} from '../core/ui.js';
import { stepper, signatureList, recordFooter, wireRecordFooter } from '../core/components.js';

const STEPS = ['Open', 'Under Investigation', 'CAPA', 'Closed'];

export async function newInvestigation(prefill = {}) {
  const L = state.lookups;
  const instruments = await api.get('/api/instruments');
  const id = await openForm({
    title: 'Raise an investigation',
    size: 'lg',
    submitLabel: 'Raise',
    body: html`
      ${field({ label: 'Type', name: 'type', type: 'select', options: L.investigationTypes, value: prefill.type || (prefill.test_id ? 'OOS' : 'Deviation'), required: true })}
      ${field({ label: 'Severity', name: 'severity', type: 'select', options: L.severities, value: prefill.severity || 'Minor' })}
      ${field({ label: 'Title', name: 'title', value: prefill.title, required: true, span: 2, autofocus: true, placeholder: 'One line: what happened' })}
      ${field({ label: 'What happened', name: 'description', type: 'textarea', rows: 5, required: true, span: 2, placeholder: 'Facts only: when, where, what was observed, immediate actions taken' })}
      ${field({ label: 'Owner', name: 'owner_id', type: 'select', options: activeUsers(['manager', 'qa', 'scientist']).map((u) => [u.id, u.full_name]), empty: 'Lab manager decides' })}
      ${field({ label: 'Due date', name: 'due_date', type: 'date', hint: 'Default: 20 working days (5 for critical)' })}
      ${field({ label: 'Instrument involved', name: 'instrument_id', type: 'select', options: instruments.map((i) => [i.id, `${i.code} — ${i.name}`]), value: prefill.instrument_id, empty: 'None' })}
      <input type="hidden" name="test_id" value="${prefill.test_id || ''}"><input type="hidden" name="sample_id" value="${prefill.sample_id || ''}"><input type="hidden" name="project_id" value="${prefill.project_id || ''}">`,
    onSubmit: async (d) => (await api.post('/api/investigations', { ...d, test_id: d.test_id || null, sample_id: d.sample_id || null, project_id: d.project_id || null, instrument_id: d.instrument_id || null, owner_id: d.owner_id || null })).id,
  });
  if (id) { refreshNav(); navigate(`/investigations/${id}`); }
}

export async function list(ctx) {
  ctx.title('Investigations');
  const status = ctx.query.status || 'open';
  const rows = await api.get('/api/investigations', { status: status === 'all' ? '' : status, type: ctx.query.type });
  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Investigations',
      sub: 'Out-of-specification results, deviations, lab incidents and client complaints — from first report to CAPA and closure.',
      actions: can('investigations.raise') ? html`<button class="btn primary" data-act="new">${icon('plus', { size: 15 })}Raise investigation</button>` : '',
    })}
    <div class="toolbar">
      ${segmented([
        { key: 'open', label: 'Open', href: setQuery({ status: null }) },
        { key: 'Closed', label: 'Closed', href: setQuery({ status: 'Closed' }) },
        { key: 'all', label: 'All', href: setQuery({ status: 'all' }) },
      ], status)}
      <select data-type style="width:auto" aria-label="Type"><option value="">All types</option>${state.lookups.investigationTypes.map((t) => html`<option ${t === ctx.query.type ? raw('selected') : ''}>${t}</option>`)}</select>
      <span class="spacer"></span>
      ${searchBox('Filter…')}
    </div>
    <div class="card"><div data-table></div></div>`);
  const table = mountTable(ctx.el.querySelector('[data-table]'), {
    rows,
    rowHref: (r) => `/investigations/${r.id}`,
    rowClass: (r) => (r.status !== 'Closed' && r.due_date && r.due_date < todayIso() ? 'row-fail' : ''),
    searchText: (r) => `${r.code} ${r.title} ${r.type} ${r.owner_name} ${r.sample_code} ${r.test_code}`,
    empty: emptyState({ icon: 'check', title: status === 'open' ? 'No open investigations' : 'Nothing here', text: status === 'open' ? 'Out-of-specification results open an investigation automatically.' : '' }),
    columns: [
      { key: 'code', label: 'Ref', sort: (r) => r.id, render: (r) => html`<a class="code" href="/investigations/${r.id}">${r.code}</a>` },
      { key: 'title', label: 'Investigation', sort: true, cls: 'title-cell', render: (r) => html`<strong>${r.title}</strong><span class="sub-line">${r.type}${r.sample_code ? ` · ${r.sample_code}` : ''}${r.instrument_code ? ` · ${r.instrument_code}` : ''}</span>` },
      { key: 'severity', label: 'Severity', sort: (r) => ['Minor', 'Major', 'Critical'].indexOf(r.severity), render: (r) => badge(r.severity) },
      { key: 'owner_name', label: 'Owner', sort: true, render: (r) => person(r.owner_name, r.owner_id) },
      { key: 'status', label: 'Status', sort: (r) => STEPS.indexOf(r.status), render: (r) => statusBadge(r.status) },
      { key: 'raised_at', label: 'Raised', sort: true, render: (r) => html`<span class="nowrap">${fmtDate(r.raised_at)}</span>` },
      { key: 'due_date', label: 'Due', sort: true, render: (r) => dueChip(r.due_date, { done: r.status === 'Closed' }) },
    ],
  });
  const f = ctx.el.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
  ctx.el.querySelector('[data-type]').addEventListener('change', (e) => navigate(setQuery({ type: e.target.value })));
  ctx.el.querySelector('[data-act=new]')?.addEventListener('click', () => newInvestigation());
}

export async function detail(ctx) {
  const d = await api.get(`/api/investigations/${ctx.params.id}`);
  const v = d.investigation;
  ctx.title(v.code);
  const L = state.lookups;
  const closed = v.status === 'Closed';
  const section = (label, key, placeholder, rows = 4) => (d.can.edit
    ? field({ label, name: key, type: 'textarea', rows, value: v[key], span: 2, placeholder })
    : html`<div class="span-2"><div class="section-title">${label}</div><div class="md">${raw(markdown(v[key] || '_Not recorded_'))}</div></div>`);

  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/investigations', label: 'Investigations' },
      title: v.title,
      badges: html`${statusBadge(v.status)}${badge(v.severity)}`,
      meta: html`<span class="code">${v.code}</span><span>${v.type}</span><span>${icon('user', { size: 14 })}Raised by ${v.raised_by_name} · ${fmtDate(v.raised_at)}</span><span>${icon('clock', { size: 14 })}${dueChip(v.due_date, { done: closed })}</span>`,
      actions: d.can.close ? html`<button class="btn primary" data-act="close">${icon('sign', { size: 15 })}Close investigation</button>` : '',
    })}
    <div class="card stepper-card">${stepper(STEPS, v.status)}</div>
    <div class="split">
      <div class="stack">
        ${d.results.length ? card({
          title: html`Results of test <a class="code" href="/tests/${v.test_id}">${v.test_code}</a>`,
          flush: true,
          body: html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Parameter</th><th>Specification</th><th class="right">Result</th><th>Outcome</th></tr></thead><tbody>${d.results.map((r) => html`<tr class="${r.outcome === 'Fail' ? 'row-fail' : ''}"><td>${r.analyte}</td><td class="muted">${specText(r)}</td><td class="right mono">${resultText(r)}</td><td>${outcomeBadge(r.outcome)}</td></tr>`)}</tbody></table></div>`,
        }) : ''}
        <form data-inv class="stack" novalidate>
          ${card({
            title: 'Investigation record',
            body: html`<div class="form-grid">
              <div class="span-2"><div class="section-title">Description</div><div class="md">${raw(markdown(v.description || ''))}</div></div>
              ${section('Root cause', 'root_cause', 'Phase I: laboratory checks (calculations, standards, instrument, sample prep). Phase II: manufacturing / process if no lab error.')}
              ${section('Impact assessment', 'impact', 'Which results, batches, studies or clients are affected?')}
              ${section('Corrective & preventive actions (CAPA)', 'capa', 'What will stop it happening again? Owners and dates.')}
              ${d.can.edit ? html`
                ${field({ label: 'Conclusion', name: 'conclusion', type: 'select', options: [...new Set([...(v.type === 'OOS' ? L.oosConclusions : ['No impact', 'Impact — see CAPA', 'Not applicable']), v.conclusion].filter(Boolean))], value: v.conclusion, empty: 'Not concluded yet' })}
                ${field({ label: 'Stage', name: 'status', type: 'select', options: L.investigationStatuses.filter((s) => s !== 'Closed'), value: v.status })}
                ${field({ label: 'Owner', name: 'owner_id', type: 'select', options: activeUsers(['manager', 'qa', 'scientist']).map((u) => [u.id, u.full_name]), value: v.owner_id, empty: 'Unassigned' })}
                ${field({ label: 'Due date', name: 'due_date', type: 'date', value: v.due_date })}
                ${field({ label: 'Severity', name: 'severity', type: 'select', options: L.severities, value: v.severity })}
                <div class="span-2 row"><span class="spacer"></span><button class="btn primary" type="submit">${icon('check', { size: 15 })}Save</button></div>` : html`<div class="span-2">${kv([['Conclusion', v.conclusion]])}</div>`}
            </div>`,
          })}
        </form>
        ${recordFooter()}
      </div>
      <div class="stack">
        ${card({ title: 'Details', body: kv([
          ['Reference', html`<span class="code">${v.code}</span>`], ['Type', v.type], ['Severity', badge(v.severity)], ['Owner', person(v.owner_name, v.owner_id)],
          ['Test', v.test_id ? html`<a href="/tests/${v.test_id}">${v.test_code}</a>` : null],
          ['Sample', v.sample_id ? html`<a href="/samples/${v.sample_id}">${v.sample_code}</a>` : null],
          ['Project', v.project_id ? html`<a href="/projects/${v.project_id}">${v.project_code}</a>` : null],
          ['Instrument', v.instrument_id ? html`<a href="/instruments/${v.instrument_id}">${v.instrument_code}</a>` : null],
          ['Raised', html`${v.raised_by_name}<div class="muted small">${fmtDateTime(v.raised_at)}</div>`],
          closed && ['Closed', html`${v.closed_by_name}<div class="muted small">${fmtDateTime(v.closed_at)}</div>`],
        ]) })}
        ${card({ title: 'Signatures', body: signatureList(d.signatures) })}
        ${v.type === 'OOS' && !closed ? card({ title: 'OOS procedure', body: html`<ol class="small" style="padding-left:18px;margin:0;display:grid;gap:6px">
          <li><strong>Phase I</strong> — check for an obvious lab error: calculations, standard & sample preparation, instrument performance, system suitability.</li>
          <li>Retain all original data. Don't retest into compliance.</li>
          <li>If a lab error is <em>proven</em>, invalidate the result; QA returns the test for repeat analysis.</li>
          <li>If not, the result stands: <strong>Phase II</strong> with the client (manufacturing investigation).</li>
          <li>QA closes the investigation; only then can the result be approved.</li></ol>` }) : ''}
      </div>
    </div>`);

  wireRecordFooter(ctx.el, 'investigations', v.id, { locked: closed, lockedReason: closed ? 'Closed investigations are locked.' : null });
  const form = ctx.el.querySelector('form[data-inv]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    await busy(form.querySelector('[type=submit]'), async () => {
      await api.put(`/api/investigations/${v.id}`, { ...data, title: v.title, owner_id: data.owner_id || null });
      toast('Investigation saved');
      ctx.refresh();
    });
  });
  ctx.el.querySelector('[data-act=close]')?.addEventListener('click', async () => {
    if (form.querySelector('[name=root_cause]') && (!form.root_cause.value.trim() || !form.conclusion.value)) {
      toast('Record the root cause and a conclusion, then save, before closing', 'error');
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    try { await api.put(`/api/investigations/${v.id}`, { ...data, title: v.title, owner_id: data.owner_id || null }); } catch (e) { toast(e.message, 'error'); return; }
    const ok = await esign({
      title: `Close ${v.code}`,
      meaning: 'Investigation reviewed and closed',
      description: html`Conclusion: <strong>${form.conclusion?.value || v.conclusion}</strong>. Closing locks the record${v.test_id ? ' and allows the related result to be approved or returned for repeat analysis' : ''}.`,
      confirmLabel: 'Sign & close',
      comment: { label: 'Closure comment (optional)' },
      onSign: (sig) => api.post(`/api/investigations/${v.id}/close`, sig),
    });
    if (ok) { toast('Investigation closed'); refreshNav(); ctx.refresh(); }
  });
}
