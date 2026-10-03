import { html } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can, shipped } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate, setQuery } from '../core/nav.js';
import {
  pageHead, card, kv, segmented, statusBadge, fmtDate, fmtDateTime, emptyState, field, openForm, toast, person, badge, daysUntil, debounce, searchBox, dueChip, todayIso,
} from '../core/ui.js';
import { recordFooter, wireRecordFooter } from '../core/components.js';

function calBadge(i) {
  if (!i.calibration_due) return html`<span class="muted small">No calibration schedule</span>`;
  const d = daysUntil(i.calibration_due);
  if (d < 0) return badge(`Calibration overdue ${-d}d`, 'red');
  if (d <= 14) return badge(`Calibration due in ${d}d`, 'amber');
  return html`<span class="muted small">Calibrated · due ${fmtDate(i.calibration_due)}</span>`;
}

const instrumentFields = (i = {}) => {
  const L = state.lookups;
  return html`
    ${field({ label: 'Instrument ID', name: 'code', value: i.code, required: true, disabled: !!i.id, placeholder: 'e.g. HPLC-05', hint: i.id ? 'IDs cannot be changed' : 'The tag on the instrument' })}
    ${field({ label: 'Name', name: 'name', value: i.name, required: true, placeholder: 'e.g. Agilent 1260 Infinity II #2' })}
    ${field({ label: 'Type', name: 'type', type: 'select', options: L.instrumentTypes, value: i.type, empty: 'Choose…', required: true })}
    ${field({ label: 'Location', name: 'location', value: i.location, placeholder: 'e.g. Lab 2.01' })}
    ${field({ label: 'Manufacturer', name: 'manufacturer', value: i.manufacturer })}
    ${field({ label: 'Model', name: 'model', value: i.model })}
    ${field({ label: 'Serial number', name: 'serial_no', value: i.serial_no })}
    ${field({ label: 'Calibration interval (days)', name: 'calibration_interval_days', type: 'number', value: i.calibration_interval_days, min: 1, hint: 'Leave empty if not calibrated' })}
    ${i.id ? '' : field({ label: 'Last calibrated', name: 'last_calibrated', type: 'date' })}
    ${field({ label: 'Calibration due', name: 'calibration_due', type: 'date', value: i.calibration_due, hint: i.id ? 'Normally updated by logging a calibration' : 'Calculated from the interval if left empty' })}
    ${field({ label: 'Notes', name: 'notes', type: 'textarea', rows: 2, value: i.notes, span: 2 })}`;
};

export async function newInstrument() {
  const id = await openForm({
    title: 'Register instrument',
    size: 'lg',
    submitLabel: 'Register',
    body: instrumentFields(),
    onSubmit: async (d) => (await api.post('/api/instruments', d)).id,
  });
  if (id) navigate(`/instruments/${id}`);
}

export async function list(ctx) {
  ctx.title('Instruments');
  const rows = await api.get('/api/instruments');
  const view = ctx.query.view || 'all';
  const attention = (i) => i.cal_state === 'overdue' || i.cal_state === 'due_soon' || ['Maintenance', 'Out of Service'].includes(i.status);
  const shown = rows.filter((i) => (view === 'attention' ? attention(i) : view === 'retired' ? i.status === 'Retired' : i.status !== 'Retired'));

  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Instruments',
      sub: 'The equipment register and electronic logbook. Instruments out of calibration are locked out of testing automatically.',
      actions: can('instruments.edit') ? html`<button class="btn primary" data-act="new">${icon('plus', { size: 15 })}Register instrument</button>` : '',
    })}
    <div class="toolbar">
      ${segmented([
        { key: 'all', label: 'In service', count: rows.filter((i) => i.status !== 'Retired').length, href: setQuery({ view: null }) },
        { key: 'attention', label: 'Needs attention', count: rows.filter(attention).length, href: setQuery({ view: 'attention' }) },
        { key: 'retired', label: 'Retired', href: setQuery({ view: 'retired' }) },
      ], view)}
      <span class="spacer"></span>
      ${searchBox('Filter instruments…')}
    </div>
    ${shown.length ? html`<div class="grid-3" data-grid>${shown.map((i) => html`
      <a class="card kpi" href="/instruments/${i.id}" data-text="${`${i.code} ${i.name} ${i.type} ${i.location} ${i.model}`.toLowerCase()}">
        <div class="row" style="justify-content:space-between"><span class="code">${i.code}</span>${statusBadge(i.status)}</div>
        <div style="font-weight:600;margin-top:4px;color:var(--text)">${i.name}</div>
        <div class="muted small">${i.type} · ${i.location || 'No location'}</div>
        <div class="row" style="margin-top:6px;justify-content:space-between">${calBadge(i)}<span class="muted small">${i.tests_30d} tests / 30 d</span></div>
      </a>`)}</div>` : emptyState({ icon: 'instrument', title: view === 'attention' ? 'Everything is in order' : 'No instruments', text: view === 'attention' ? 'No calibrations due and nothing out of service.' : 'Register your equipment to track calibration and use.' })}`);

  const f = ctx.el.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => {
    const q = f.value.toLowerCase();
    ctx.el.querySelectorAll('[data-text]').forEach((c) => { c.hidden = q && !c.dataset.text.includes(q); });
  }, 100));
  ctx.el.querySelector('[data-act=new]')?.addEventListener('click', newInstrument);
}

export async function detail(ctx) {
  const d = await api.get(`/api/instruments/${ctx.params.id}`);
  const i = d.instrument;
  ctx.title(i.code);
  const L = state.lookups;
  const KIND_IC = { Calibration: 'check', 'Preventive Maintenance': 'wrench', Repair: 'wrench', 'Qualification (IQ/OQ/PQ)': 'shield', 'Performance Check': 'activity', Note: 'info' };

  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/instruments', label: 'Instruments' },
      title: i.name,
      badges: html`${statusBadge(i.status)}`,
      meta: html`<span class="code">${i.code}</span><span>${icon('instrument', { size: 14 })}${i.type}</span>${i.location ? html`<span>${icon('pin', { size: 14 })}${i.location}</span>` : ''}<span>${calBadge(i)}</span>`,
      actions: html`
        ${d.can.log ? html`<button class="btn primary" data-act="log">${icon('plus', { size: 15 })}Log entry</button>` : ''}
        ${d.can.edit ? html`<button class="btn" data-act="edit">${icon('edit', { size: 15 })}Edit</button>` : ''}`,
    })}
    ${i.cal_state === 'overdue' ? html`<div class="notice bad mb">${icon('lock', { size: 16 })}<span><strong>Locked for testing.</strong> Calibration expired on ${fmtDate(i.calibration_due)}. Log a passing calibration to release it.</span></div>` : ''}
    ${['Out of Service', 'Maintenance'].includes(i.status) ? html`<div class="notice warn mb">${icon('wrench', { size: 16 })}<span>This instrument is <strong>${i.status.toLowerCase()}</strong> and can't be selected for tests.</span></div>` : ''}
    <div class="split">
      <div class="stack">
        ${card({
          title: 'Logbook',
          sub: 'Calibration, maintenance and repairs — the electronic equipment logbook.',
          body: d.logs.length ? html`<ol class="timeline">${d.logs.map((l) => html`<li><span class="tl-dot" style="${l.outcome === 'Fail' ? 'background:var(--red-fg)' : l.kind === 'Calibration' ? 'background:var(--green-fg)' : ''}"></span><div class="tl-body">
            <div class="tl-head"><strong>${icon(KIND_IC[l.kind] || 'info', { size: 13 })} ${l.kind}${l.outcome && l.outcome !== 'n/a' ? html` · <span class="${l.outcome === 'Fail' ? 'bad-text' : 'ok-text'}">${l.outcome}</span>` : ''}</strong><span class="muted small">${fmtDate(l.performed_at)} · ${l.full_name}</span></div>
            <div class="small">${l.description}</div>
            ${l.next_due ? html`<div class="muted small">Next due ${fmtDate(l.next_due)}</div>` : ''}
          </div></li>`)}</ol>` : emptyState({ icon: 'wrench', title: 'No log entries yet' }),
        })}
        ${card({
          title: 'Recent tests on this instrument',
          flush: true,
          body: d.recentTests.length ? html`<div class="table-wrap"><table class="table compact"><tbody>${d.recentTests.map((t) => html`<tr class="link" data-href="/tests/${t.id}"><td><a class="code" href="/tests/${t.id}">${t.code}</a></td><td>${t.method_code}<span class="sub-line">${t.sample_code}</span></td><td>${person(t.analyst_name, t.analyst_id, t.analyst_initials)}</td><td>${statusBadge(t.status)}</td><td class="muted small nowrap">${fmtDateTime(t.started_at)}</td></tr>`)}</tbody></table></div>` : emptyState({ icon: 'worklist', title: 'No tests recorded yet' }),
        })}
        ${recordFooter()}
      </div>
      <div class="stack">
        ${card({ title: 'Details', body: kv([
          ['Instrument ID', html`<span class="code">${i.code}</span>`], ['Type', i.type], ['Manufacturer', i.manufacturer], ['Model', i.model], ['Serial no.', i.serial_no],
          ['Location', i.location], ['Calibration interval', i.calibration_interval_days ? `${i.calibration_interval_days} days` : null],
          ['Last calibrated', fmtDate(i.last_calibrated)], ['Calibration due', i.calibration_due ? dueChip(i.calibration_due) : null], ['Notes', i.notes],
        ]) })}
        ${shipped('investigations') && d.investigations.length ? card({ title: 'Investigations', flush: true, body: html`<ul class="list">${d.investigations.map((v) => html`<li class="link" data-href="/investigations/${v.id}"><div class="grow"><div class="title"><span class="code">${v.code}</span></div><div class="meta">${v.title}</div></div>${statusBadge(v.status)}</li>`)}</ul>` }) : ''}
      </div>
    </div>`);

  wireRecordFooter(ctx.el, 'instruments', i.id);
  ctx.el.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) navigate(el.dataset.href); }));
  ctx.el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'log') {
      const ok = await openForm({
        title: `Logbook entry · ${i.code}`,
        body: html`
          ${field({ label: 'Type of entry', name: 'kind', type: 'select', options: L.instrumentLogKinds, required: true })}
          ${field({ label: 'Date performed', name: 'performed_at', type: 'date', value: todayIso(), required: true })}
          ${field({ label: 'What was done', name: 'description', type: 'textarea', rows: 3, required: true, span: 2, placeholder: 'e.g. Annual OQ by vendor; certificate no. 2026-1182 attached' })}
          ${field({ label: 'Outcome', name: 'outcome', type: 'select', options: [['Pass', 'Pass'], ['Fail', 'Fail — take out of service'], ['n/a', 'Not applicable']], value: 'Pass' })}
          ${field({ label: 'Next due', name: 'next_due', type: 'date', hint: i.calibration_interval_days ? `Defaults to +${i.calibration_interval_days} days for calibrations` : '' })}
          ${d.can.edit ? field({ label: 'Set status', name: 'status', type: 'select', options: L.instrumentStatuses, empty: 'Leave unchanged' }) : ''}`,
        onSubmit: (d2) => api.post(`/api/instruments/${i.id}/logs`, d2),
      });
      if (ok) { toast('Logbook updated'); ctx.refresh(); }
    }
    if (act === 'edit') {
      const ok = await openForm({
        title: `Edit ${i.code}`,
        size: 'lg',
        body: html`${instrumentFields(i)}${field({ label: 'Status', name: 'status', type: 'select', options: L.instrumentStatuses, value: i.status })}`,
        onSubmit: (d2) => api.put(`/api/instruments/${i.id}`, d2),
      });
      if (ok) { toast('Instrument updated'); ctx.refresh(); }
    }
  });
}
