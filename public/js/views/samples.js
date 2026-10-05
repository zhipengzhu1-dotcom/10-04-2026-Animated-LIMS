import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate, setQuery } from '../core/nav.js';
import {
  pageHead, card, kv, mountTable, searchBox, segmented, statusBadge, priorityBadge, dueChip, fmtDate, fmtDateTime, money, plural,
  emptyState, progress, field, openForm, esign, toast, showError, busy, confirmDialog, promptReason, specText, resultText, outcomeBadge,
  localDateTimeValue, todayIso, isoDate, person, badge, debounce,
} from '../core/ui.js';
import { stepper, signatureList, recordFooter, wireRecordFooter } from '../core/components.js';

const SAMPLE_STEPS = ['Received', 'In Testing', 'In Review', 'Approved', 'Reported'];
const openLabels = (ids) => window.open(`/print/labels?ids=${ids.join(',')}`, '_blank');

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------

export async function list(ctx) {
  ctx.title('Samples');
  const status = ctx.query.status ?? 'open';
  const works = [
    can('tests.perform') && ['assigned', 'Assigned to me'],
    can('tests.review') && ['review', 'Awaiting my review'],
    can('tests.approve') && ['approval', 'Awaiting QA approval'],
  ].filter(Boolean);
  const work = works.some(([key]) => key === ctx.query.work) ? ctx.query.work : '';
  const [rows, clients] = await Promise.all([
    api.get('/api/samples', { status: status === 'all' ? '' : status, client_id: ctx.query.client, project_id: ctx.query.project, overdue: ctx.query.overdue, work }),
    api.get('/api/clients'),
  ]);
  const statuses = [['open', 'Open'], ['Received', 'Received'], ['In Testing', 'In testing'], ['In Review', 'In review'], ['Approved', 'Approved'], ['Reported', 'Reported'], ['all', 'All']];

  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Samples',
      sub: 'Every sample in the lab — from receipt and chain of custody to the issued certificate.',
      actions: html`
        <button class="btn" data-act="labels" disabled>${icon('printer', { size: 15 })}Print labels</button>
        ${can('samples.receive') ? html`<a class="btn primary" href="/samples/receive">${icon('inbox', { size: 15 })}Receive samples</a>` : ''}`,
    })}
    <div class="toolbar">
      ${segmented(statuses.map(([key, label]) => ({ key, label, href: setQuery({ status: key === 'open' ? null : key }) })), status)}
      <select data-client class="auto-w" aria-label="Client">
        <option value="">All clients</option>
        ${clients.map((c) => html`<option value="${c.id}" ${String(c.id) === ctx.query.client ? raw('selected') : ''}>${c.name}</option>`)}
      </select>
      ${works.length ? html`<select data-work class="auto-w" aria-label="My work">
        <option value="">All work</option>
        ${works.map(([key, label]) => html`<option value="${key}" ${key === work ? raw('selected') : ''}>${label}</option>`)}
      </select>` : ''}
      <span class="spacer"></span>
      ${searchBox('Filter by code, batch, description…', ctx.query.q || '')}
    </div>
    <div class="card"><div data-table></div></div>`);

  const table = mountTable(ctx.el.querySelector('[data-table]'), {
    rows,
    selectable: true,
    rowHref: (r) => `/samples/${r.id}`,
    rowClass: (r) => (r.has_oos ? 'row-fail' : ''),
    sort: { key: 'code', dir: -1 },
    onSelectionChange: (ids) => {
      const b = ctx.el.querySelector('[data-act=labels]');
      b.disabled = !ids.length;
      b.innerHTML = String(html`${icon('printer', { size: 15 })}Print labels${ids.length ? ` (${ids.length})` : ''}`);
    },
    searchText: (r) => `${r.code} ${r.description} ${r.batch_no} ${r.client_ref} ${r.client_name} ${r.project_code}`,
    empty: emptyState({ icon: 'tube', title: 'No samples', text: status === 'open' ? 'There are no open samples. Receive a delivery to get started.' : 'No samples match this filter.', action: can('samples.receive') ? html`<a class="btn primary" href="/samples/receive">Receive samples</a>` : '' }),
    columns: [
      { key: 'code', label: 'Sample', sort: (r) => r.id, render: (r) => html`<a class="code" href="/samples/${r.id}">${r.code}</a>${r.client_ref ? html`<span class="sub-line">${r.client_ref}</span>` : ''}` },
      { key: 'description', label: 'Description', sort: true, cls: 'title-cell', render: (r) => html`<strong>${r.description}</strong><span class="sub-line">${r.batch_no ? `Batch ${r.batch_no}` : r.sample_type || ''}</span>` },
      { key: 'client_name', label: 'Client', sort: true, render: (r) => html`<span title="${r.client_name}">${r.client_code}</span>${r.project_code ? html`<span class="sub-line">${r.project_code}</span>` : ''}` },
      { key: 'tests', label: 'Tests', sort: (r) => (r.test_count ? r.tests_approved / r.test_count : -1), render: (r) => (r.test_count ? html`<span class="row nowrap">${progress(r.tests_approved, r.test_count)}<span class="muted small num">${r.tests_approved}/${r.test_count}</span>${r.has_oos ? badge('OOS', 'red', { dot: false }) : ''}</span>` : html`<span class="muted small">No tests</span>`) },
      { key: 'status', label: 'Status', sort: true, cls: 'nowrap', render: (r) => html`${statusBadge(r.status)} ${priorityBadge(r.priority)}` },
      { key: 'received_at', label: 'Received', sort: true, render: (r) => html`<span class="nowrap">${fmtDate(r.received_at)}</span>` },
      { key: 'due_date', label: 'Due', sort: true, render: (r) => dueChip(r.due_date, { done: ['Reported', 'Cancelled', 'Disposed'].includes(r.status) }) },
    ],
  });

  const filter = ctx.el.querySelector('[data-filter]');
  filter.addEventListener('input', debounce(() => table.filter(filter.value), 120));
  if (ctx.query.q) table.filter(ctx.query.q);
  ctx.el.querySelector('[data-client]').addEventListener('change', (e) => navigate(setQuery({ client: e.target.value })));
  ctx.el.querySelector('[data-work]')?.addEventListener('change', (e) => navigate(setQuery({ work: e.target.value })));
  ctx.el.querySelector('[data-act=labels]').addEventListener('click', () => openLabels(table.selected()));
}

// ---------------------------------------------------------------------------------------------
// Receive samples (batch login)
// ---------------------------------------------------------------------------------------------

// One line per method: title, any status/client flags, then code, turnaround and price in aligned columns.
// Shared by Receive samples and "Add tests". `taken` marks methods already requested on the sample.
function methodPicker(methods, { taken = new Set() } = {}) {
  const price = can('billing.view');
  const flagged = (m) => m.status !== 'Effective' || m.client_name || taken.has(m.id);
  return html`<div class="method-pick${price ? ' priced' : ''}">${methods.map((m) => html`
    <label class="method-opt" title="${`${m.title} · ${m.technique}${m.client_name ? ` · client-specific: ${m.client_name}` : ''}`}" data-mtext="${`${m.code} ${m.title} ${m.technique} ${m.client_name || ''}`.toLowerCase()}">
      <input type="checkbox" name="method_ids" value="${m.id}" data-price="${m.price}" data-tat="${m.tat_days}" data-code="${m.code}">
      <span class="m-main"><span class="m-title">${m.title}</span>${flagged(m) ? html`<span class="m-flags">
        ${m.status !== 'Effective' ? statusBadge(m.status) : ''}${m.client_name ? html`<span class="m-flag">Only for ${m.client_name}</span>` : ''}${taken.has(m.id) ? html`<span class="m-flag">Already on sample</span>` : ''}</span>` : ''}</span>
      <span class="m-code code">${m.code} v${m.version}</span>
      <span class="m-num">${m.tat_days} d</span>
      ${price ? html`<span class="m-num m-price">${money(m.price)}</span>` : ''}
    </label>`)}</div>`;
}

// Search box + "n selected" count for a methodPicker inside `root`.
function wireMethodPicker(root) {
  const count = root.querySelector('[data-mcount]');
  const recount = () => {
    const n = root.querySelectorAll('[name=method_ids]:checked').length;
    if (count) count.textContent = n ? `${n} selected` : '';
  };
  root.querySelector('[data-mfilter]')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    root.querySelectorAll('.method-opt').forEach((o) => { o.hidden = Boolean(q) && !o.dataset.mtext.includes(q); });
  });
  root.addEventListener('change', (e) => { if (e.target.name === 'method_ids') recount(); });
  recount();
}

function addBusinessDays(date, n) {
  const d = new Date(`${date}T12:00:00`);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return isoDate(d);
}

export async function receive(ctx) {
  ctx.title('Receive samples');
  if (!can('samples.receive')) throw Object.assign(new Error('You do not have permission to receive samples.'), { status: 403 });
  const [clients, projects, methods] = await Promise.all([api.get('/api/clients'), api.get('/api/projects', { status: 'open' }), api.get('/api/methods', { usable: 1 })]);
  const L = state.lookups;
  const activeClients = clients.filter((c) => c.active);
  let rows = [{}, {}, {}];
  let dueOverridden = false;

  ctx.el.innerHTML = String(html`
    ${pageHead({ title: 'Receive samples', sub: 'Log a delivery in one go: who it is from, what arrived, and which tests to run. Codes and barcode labels are generated for you.', back: { href: '/samples', label: 'Samples' } })}
    <form data-receive class="stack receive" novalidate>
      ${card({ title: html`<span class="row">${icon('building', { size: 16 })}1 · Delivery</span>`, body: html`<div class="form-grid receive-grid">
        ${field({ label: 'Client', name: 'client_id', type: 'select', required: true, empty: 'Choose a client…', options: activeClients.map((c) => [c.id, `${c.name} (${c.code})`]), value: ctx.query.client })}
        <label class="field" title="Links the samples to the PO for billing"><span class="label">Project</span><select name="project_id" data-project></select></label>
        ${field({ label: 'Sample type', name: 'sample_type', type: 'select', options: L.sampleTypes, empty: '—' })}
        <div class="field"><span class="label">Priority <small class="muted" data-prio-hint></small></span>
          <div class="segmented" data-priority>${L.priorities.map((p, i) => html`<a href="#" data-p="${p}" class="${i === 0 ? 'active' : ''}">${p === 'Standard' ? '' : icon('zap', { size: 12 })}${p}</a>`)}</div>
        </div>
        ${field({ label: 'Received at', name: 'received_at', type: 'datetime-local', value: localDateTimeValue(), required: true })}
        ${field({ label: 'Condition on receipt', name: 'condition', type: 'select', options: L.receiptConditions })}
        ${field({ label: 'Storage condition', name: 'storage', type: 'select', options: L.storageConditions, empty: '—' })}
        ${field({ label: 'Storage location', name: 'location', placeholder: 'e.g. Fridge R-02, shelf 3' })}
        <label class="field full"><span class="label">Notes</span><textarea name="notes" rows="1" placeholder="Courier, temperature logger reading, discrepancies…"></textarea></label>
      </div>` })}

      ${card({
        title: html`<span class="row">${icon('tube', { size: 16 })}2 · Samples</span>`,
        sub: 'One row per container. Tip: paste rows straight from Excel or the client\'s submission form.',
        actions: html`<button type="button" class="btn sm" data-act="paste">${icon('copy', { size: 13 })}Paste from spreadsheet</button><button type="button" class="btn sm" data-act="fill">Copy first description down</button>`,
        body: html`<div class="table-wrap"><table class="sample-rows"><thead><tr><th>#</th><th>Description *</th><th>Batch / lot</th><th>Client reference</th><th>Quantity</th><th>Container</th><th></th></tr></thead><tbody data-rows></tbody></table></div>
          <div class="row sample-rows-add"><button type="button" class="btn sm" data-act="add">${icon('plus', { size: 13 })}Add row</button><button type="button" class="btn sm ghost" data-act="add5">Add 5 rows</button></div>`,
      })}

      ${card({
        title: html`<span class="row">${icon('worklist', { size: 16 })}3 · Tests to perform</span>`,
        sub: 'Applied to every sample above. You can add more tests to individual samples later.',
        actions: html`<span class="small muted" data-mcount></span><label class="search-box">${icon('search', { size: 14 })}<input type="search" placeholder="Find a method…" data-mfilter></label>`,
        body: methodPicker(methods),
      })}

      <div class="card summary-bar">
        <span class="stat"><strong data-s="samples">0</strong> samples</span>
        <span class="stat">× <strong data-s="methods">0</strong> methods =</span>
        <span class="stat"><strong data-s="tests">0</strong> tests</span>
        ${can('billing.view') ? html`<span class="stat"><strong data-s="value">—</strong> est. value</span>` : ''}
        <label class="due">Due <input type="date" name="due_date" data-due></label>
        <span class="sb-codes" data-s="codes"></span>
        <span class="spacer"></span>
        <a class="btn" href="/samples">Cancel</a>
        <button class="btn primary" type="submit">${icon('check', { size: 15 })}Receive samples</button>
      </div>
    </form>`);

  const form = ctx.el.querySelector('form');
  const tbody = form.querySelector('[data-rows]');
  const clientSel = form.querySelector('[name=client_id]');
  const projectSel = form.querySelector('[data-project]');
  const dueInput = form.querySelector('[data-due]');
  let priority = 'Standard';

  const syncRowsFromDom = () => {
    rows = [...tbody.querySelectorAll('tr')].map((tr) => Object.fromEntries([...tr.querySelectorAll('input')].map((i) => [i.dataset.k, i.value])));
  };
  const drawRows = () => {
    tbody.innerHTML = String(html`${rows.map((r, i) => html`<tr>
      <td>${i + 1}</td>
      <td><input data-k="description" value="${r.description || ''}" placeholder="e.g. Metformin HCl 500 mg tablets" aria-label="Description row ${i + 1}"></td>
      <td><input data-k="batch_no" value="${r.batch_no || ''}" aria-label="Batch row ${i + 1}"></td>
      <td><input data-k="client_ref" value="${r.client_ref || ''}" aria-label="Client reference row ${i + 1}"></td>
      <td><input data-k="quantity" value="${r.quantity || ''}" placeholder="2 × 100 tablets" aria-label="Quantity row ${i + 1}"></td>
      <td><input data-k="container" value="${r.container || ''}" placeholder="HDPE bottle" aria-label="Container row ${i + 1}"></td>
      <td><button type="button" class="icon-btn" data-del="${i}" aria-label="Remove row">${icon('x', { size: 14 })}</button></td>
    </tr>`)}`);
    updateSummary();
  };
  const filledRows = () => rows.filter((r) => Object.values(r).some((v) => String(v || '').trim()));
  const selectedMethods = () => [...form.querySelectorAll('[name=method_ids]:checked')];

  const updateSummary = () => {
    syncRowsFromDom();
    const n = filledRows().length;
    const ms = selectedMethods();
    form.querySelector('[data-s=samples]').textContent = n;
    form.querySelector('[data-s=tests]').textContent = n * ms.length;
    form.querySelector('[data-s=methods]').textContent = ms.length;
    form.querySelector('[data-s=codes]').textContent = ms.map((m) => m.dataset.code).join(' · ');
    const pct = priority === 'Rush' ? state.settings.rush_surcharge_pct : priority === 'Urgent' ? state.settings.urgent_surcharge_pct : 0;
    const v = form.querySelector('[data-s=value]');
    if (v) v.textContent = n && ms.length ? money(n * ms.reduce((s, m) => s + Number(m.dataset.price), 0) * (1 + pct / 100)) : '—';
    if (!dueOverridden) {
      const tat = ms.length ? Math.max(...ms.map((m) => Number(m.dataset.tat))) : 10;
      const days = priority === 'Urgent' ? Math.min(2, tat) : priority === 'Rush' ? Math.ceil(tat / 2) : tat;
      const received = (form.querySelector('[name=received_at]').value || todayIso()).slice(0, 10);
      dueInput.value = addBusinessDays(received, days);
    }
    form.querySelector('[data-prio-hint]').textContent = priority === 'Standard' ? '' : `· faster, +${pct}%`;
  };

  const drawProjects = () => {
    const cid = Number(clientSel.value);
    const list = projects.filter((p) => p.client_id === cid);
    projectSel.innerHTML = String(html`<option value="">${cid ? (list.length ? 'No project' : 'No open projects for this client') : 'Choose a client first'}</option>${list.map((p) => html`<option value="${p.id}" ${String(p.id) === ctx.query.project ? raw('selected') : ''}>${p.code} — ${p.title}</option>`)}`);
    if (list.length === 1 && !ctx.query.project) projectSel.value = list[0].id;
  };
  clientSel.addEventListener('change', drawProjects);
  drawProjects();
  drawRows();

  form.addEventListener('input', (e) => {
    if (e.target === dueInput) dueOverridden = true;
    if (e.target.dataset.mfilter !== undefined) return;
    updateSummary();
  });
  form.addEventListener('change', (e) => { if (e.target.name === 'method_ids' || e.target.name === 'received_at') updateSummary(); });
  wireMethodPicker(form);
  form.querySelector('[data-priority]').addEventListener('click', (e) => {
    const a = e.target.closest('[data-p]');
    if (!a) return;
    e.preventDefault();
    priority = a.dataset.p;
    form.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('active', x === a));
    updateSummary();
  });
  form.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      syncRowsFromDom();
      rows.splice(Number(del.dataset.del), 1);
      if (!rows.length) rows.push({});
      drawRows();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add' || act === 'add5') {
      syncRowsFromDom();
      for (let i = 0; i < (act === 'add5' ? 5 : 1); i++) rows.push({});
      drawRows();
      tbody.querySelector('tr:last-child input')?.focus();
    }
    if (act === 'fill') {
      syncRowsFromDom();
      const first = rows.find((r) => r.description)?.description;
      if (!first) return toast('Enter a description in the first row', 'info');
      // Only rows that already have other details get the description — blank rows stay blank.
      rows = rows.map((r) => (r.description || !Object.entries(r).some(([k, v]) => k !== 'description' && String(v || '').trim()) ? r : { ...r, description: first }));
      drawRows();
    }
    if (act === 'paste') {
      const text = await openForm({
        title: 'Paste from spreadsheet',
        size: 'lg',
        submitLabel: 'Add rows',
        body: html`<p class="span-2 muted">Copy rows from Excel or Google Sheets and paste below. Columns in this order: <strong>Description, Batch, Client reference, Quantity, Container</strong> (extra columns are ignored).</p>
          ${field({ name: 'text', type: 'textarea', rows: 10, span: 2, autofocus: true, placeholder: 'Metformin HCl 500 mg\tMF5-2701\tACME-REL-2701\t2 × 100 tablets\tHDPE bottle' })}`,
        onSubmit: (d) => d.text,
      });
      if (!text) return undefined;
      syncRowsFromDom();
      const parsed = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
        const c = l.split('\t');
        return { description: c[0]?.trim(), batch_no: c[1]?.trim(), client_ref: c[2]?.trim(), quantity: c[3]?.trim(), container: c[4]?.trim() };
      });
      rows = [...filledRows(), ...parsed];
      drawRows();
      toast(`${plural(parsed.length, 'row')} added`);
    }
    return undefined;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    syncRowsFromDom();
    const d = Object.fromEntries(new FormData(form));
    const samples = filledRows();
    const methodIds = selectedMethods().map((m) => Number(m.value));
    if (!d.client_id) return toast('Choose the client', 'error');
    if (!samples.length) return toast('Add at least one sample', 'error');
    if (samples.some((s) => !String(s.description || '').trim())) return toast('Every sample needs a description', 'error');
    if (!methodIds.length && !(await confirmDialog({ title: 'No tests selected', message: 'Receive these samples without requesting any tests? You can add tests later.', confirmLabel: 'Receive without tests' }))) return undefined;
    const btn = form.querySelector('button[type=submit]');
    await busy(btn, async () => {
      const res = await api.post('/api/samples/receive', {
        client_id: d.client_id, project_id: d.project_id || null, sample_type: d.sample_type, storage: d.storage, location: d.location,
        condition: d.condition, priority, received_at: new Date(d.received_at).toISOString(), due_date: dueOverridden ? d.due_date : null, notes: d.notes,
        samples, method_ids: methodIds,
      });
      showReceived(ctx, res, samples, methods.filter((m) => methodIds.includes(m.id)));
    });
    return undefined;
  });
}

function showReceived(ctx, res, samples, methods) {
  const ids = res.samples.map((s) => s.id);
  const n = res.samples.length;
  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/samples', label: 'Samples' },
      title: html`<span class="row received-title"><span class="received-ok">${icon('check', { size: 15 })}</span>${plural(n, 'sample')} received</span>`,
      sub: `${plural(n * methods.length, 'test')} requested · due ${fmtDate(res.due_date)}. Label the containers now so nothing gets mixed up.`,
      actions: html`<a class="btn" href="/samples/receive">${icon('inbox', { size: 15 })}Receive more</a>
        <button class="btn primary" data-act="labels">${icon('printer', { size: 15 })}Print ${plural(n, 'label')}</button>`,
    })}
    ${card({
      flush: true,
      title: 'Samples logged',
      sub: methods.length ? html`Each sample: ${methods.map((m, i) => html`${i ? ' · ' : ''}<span class="code" title="${m.title}">${m.code}</span>`)}` : 'No tests requested yet. Add them from each sample.',
      body: html`<div class="table-wrap"><table class="table compact"><thead><tr><th>Code</th><th>Description</th><th>Batch / lot</th><th>Client reference</th><th>Quantity</th><th class="right">Tests</th></tr></thead><tbody>
        ${res.samples.map((s, i) => html`<tr>
          <td><a class="code" href="/samples/${s.id}">${s.code}</a></td>
          <td>${samples[i]?.description || ''}</td><td>${samples[i]?.batch_no || '—'}</td><td>${samples[i]?.client_ref || '—'}</td><td>${samples[i]?.quantity || '—'}</td>
          <td class="right num">${methods.length}</td>
        </tr>`)}</tbody></table></div>`,
    })}`);
  ctx.el.querySelector('[data-act=labels]').addEventListener('click', () => openLabels(ids));
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------

export async function detail(ctx) {
  const d = await api.get(`/api/samples/${ctx.params.id}`);
  const s = d.sample;
  ctx.title(s.code);
  const stopped = ['Cancelled', 'Disposed'].includes(s.status);
  const allResults = d.tests.flatMap((t) => (t.status === 'Cancelled' ? [] : t.results));
  const fails = allResults.filter((r) => r.outcome === 'Fail').length;
  const L = state.lookups;

  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/samples', label: 'Samples' },
      title: html`<span class="mono">${s.code}</span>`,
      badges: html`${statusBadge(s.status)}${priorityBadge(s.priority)}${s.has_oos ? badge('OOS result', 'red') : ''}`,
      sub: html`${s.description}${s.batch_no ? html` · Batch <strong>${s.batch_no}</strong>` : ''}`,
      meta: html`
        <span>${icon('building', { size: 14 })}<a href="/clients/${s.client_id}">${s.client_name}</a></span>
        ${s.project_id ? html`<span>${icon('folder', { size: 14 })}<a href="/projects/${s.project_id}">${s.project_code}</a></span>` : ''}
        <span>${icon('calendar', { size: 14 })}Received ${fmtDateTime(s.received_at)}</span>
        <span>${icon('clock', { size: 14 })}${dueChip(s.due_date, { done: ['Reported', 'Cancelled', 'Disposed'].includes(s.status) })}</span>`,
      actions: html`
        <button class="btn" data-act="label">${icon('printer', { size: 15 })}Label</button>
        ${d.tests.length ? html`<a class="btn" href="/print/coa/${s.id}" target="_blank">${icon('method', { size: 15 })}${s.status === 'Reported' ? 'Certificate' : 'Draft CoA'}</a>` : ''}
        ${d.can.issue ? html`<button class="btn primary" data-act="issue">${icon('sign', { size: 15 })}Issue CoA</button>` : ''}
        ${d.can.addTests ? html`<button class="btn" data-act="add-tests">${icon('plus', { size: 15 })}Add tests</button>` : ''}
        <div class="dropdown">
          <button class="btn" data-dd aria-label="More actions">${icon('more', { size: 16 })}</button>
          <div class="dropdown-menu" hidden>
            ${d.can.edit ? html`<button data-act="edit">${icon('edit')}Edit details</button>` : ''}
            ${d.can.custody ? html`<button data-act="custody">${icon('pin')}Record movement</button>` : ''}
            ${can('investigations.raise') ? html`<button data-act="investigate">${icon('alert')}Raise investigation</button>` : ''}
            ${can('notebook.write') ? html`<button data-act="note">${icon('book')}New notebook entry</button>` : ''}
            ${d.can.cancel ? html`<hr><button data-act="cancel">${icon('xCircle')}Cancel sample</button>` : ''}
            ${d.can.dispose ? html`<button data-act="dispose">${icon('trash')}Dispose</button>` : ''}
          </div>
        </div>`,
    })}

    <div class="card stepper-card">${stepper(SAMPLE_STEPS, stopped ? null : s.status, { stopped })}${stopped ? html`<p class="muted small" style="margin:10px 0 0;text-align:center">This sample is ${s.status.toLowerCase()}.</p>` : ''}</div>

    ${fails ? html`<div class="notice bad mb">${icon('alert', { size: 16 })}<span><strong>${plural(fails, 'result')} out of specification.</strong> ${d.investigations.filter((v) => v.status !== 'Closed').length ? html`Investigation ${d.investigations.filter((v) => v.status !== 'Closed').map((v) => html`<a href="/investigations/${v.id}">${v.code}</a> `)}is open.` : 'See the linked investigation for the conclusion.'}</span></div>` : ''}

    <div class="split">
      <div class="stack">
        ${card({
          title: 'Tests & results',
          sub: d.tests.length ? `${d.tests.filter((t) => t.status === 'Approved').length} of ${d.tests.filter((t) => t.status !== 'Cancelled').length} approved` : null,
          flush: true,
          actions: d.can.assign ? html`<button class="btn sm" data-act="assign-all">${icon('users', { size: 13 })}Assign unassigned</button>` : '',
          body: d.tests.length ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Test / parameter</th><th>Specification</th><th class="right">Result</th><th>Outcome</th><th>Analyst</th><th>Status</th></tr></thead>
            <tbody>${d.tests.map((t) => html`
              <tr class="link" data-href="/tests/${t.id}" style="background:var(--surface-2)">
                <td colspan="4"><a class="code" href="/tests/${t.id}">${t.code}</a> · <strong>${t.method_title}</strong> <span class="muted small">${t.method_code} v${t.method_version}</span></td>
                <td>${person(t.analyst_name, t.analyst_id, t.analyst_initials)}</td>
                <td>${statusBadge(t.status)}</td>
              </tr>
              ${t.status === 'Cancelled' ? '' : t.results.map((r) => html`<tr class="${r.outcome === 'Fail' ? 'row-fail' : ''}">
                <td style="padding-left:30px">${r.analyte}</td>
                <td class="muted num">${specText(r)}</td>
                <td class="right num mono">${resultText(r)}</td>
                <td>${outcomeBadge(r.outcome)}</td>
                <td colspan="2"></td>
              </tr>`)}`)}
            </tbody></table></div>` : emptyState({ icon: 'worklist', title: 'No tests requested', text: 'Add the tests the client asked for.', action: d.can.addTests ? html`<button class="btn primary" data-act="add-tests">Add tests</button>` : '' }),
        })}
        ${recordFooter()}
      </div>
      <div class="stack">
        ${card({ title: 'Sample details', body: kv([
          ['Type', s.sample_type], ['Batch / lot', s.batch_no], ['Client reference', s.client_ref], ['Quantity', s.quantity], ['Container', s.container],
          ['Storage', s.storage], ['Location', s.location], ['Condition', s.condition && s.condition !== 'Acceptable' ? badge(s.condition, 'amber') : s.condition],
          ['Received by', s.received_by_name], ['Due', fmtDate(s.due_date)], s.reported_at && ['CoA issued', fmtDateTime(s.reported_at)], s.notes && ['Notes', s.notes],
        ]) })}
        ${card({
          title: 'Chain of custody',
          actions: d.can.custody ? html`<button class="btn sm" data-act="custody">${icon('pin', { size: 13 })}Move</button>` : '',
          body: html`<ol class="timeline">${d.custody.map((c) => html`<li><span class="tl-dot"></span><div class="tl-body"><div><strong>${c.action}</strong>${c.location ? html` → ${c.location}` : ''}</div><div class="muted small">${c.full_name} · ${fmtDateTime(c.at)}</div>${c.note ? html`<div class="small">${c.note}</div>` : ''}</div></li>`)}</ol>`,
        })}
        ${d.investigations.length ? card({ title: 'Investigations', flush: true, body: html`<ul class="list">${d.investigations.map((v) => html`<li class="link" data-href="/investigations/${v.id}"><div class="grow"><div class="title"><span class="code">${v.code}</span></div><div class="meta">${v.title}</div></div>${statusBadge(v.status)}</li>`)}</ul>` }) : ''}
        ${d.notebook.length ? card({ title: 'Notebook entries', flush: true, body: html`<ul class="list">${d.notebook.map((n) => html`<li class="link" data-href="/notebook/${n.id}"><div class="grow"><div class="title">${n.title}</div><div class="meta">${n.code} · ${n.author_name}</div></div>${statusBadge(n.status)}</li>`)}</ul>` }) : ''}
        ${d.signatures.length ? card({ title: 'Signatures', body: signatureList(d.signatures) }) : ''}
      </div>
    </div>`);

  wireRecordFooter(ctx.el, 'samples', s.id, { locked: stopped });
  ctx.el.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', (e) => {
    if (!e.target.closest('a, button')) navigate(el.dataset.href);
  }));

  const actions = {
    label: () => openLabels([s.id]),
    'add-tests': () => addTests(ctx, s, d.tests),
    'assign-all': async () => {
      const { assignDialog } = await import('./tests.js');
      if (await assignDialog(d.assignable, d.tests.filter((t) => d.assignable.includes(t.id)))) ctx.refresh();
    },
    issue: () => esign({
      title: 'Issue Certificate of Analysis',
      action: 'sample.coa.issue',
      description: html`All ${plural(d.tests.filter((t) => t.status === 'Approved').length, 'test')} on <strong>${s.code}</strong> are approved${fails ? html` — <strong class="bad-text">including ${plural(fails, 'OOS result')}</strong>` : ''}. Issuing locks the sample and releases the certificate to the client.`,
      confirmLabel: 'Sign & issue',
      comment: { label: 'Comment (optional)' },
      onSign: async (sig) => {
        await api.post(`/api/samples/${s.id}/report`, sig);
        toast('Certificate issued');
        ctx.refresh();
      },
    }),
    edit: () => openForm({
      title: `Edit ${s.code}`,
      size: 'lg',
      body: html`
        ${s.status !== 'Received' ? html`<p class="span-2 notice warn">${icon('shield', { size: 15 })}<span>Testing has started — you'll be asked for a reason. The change is recorded in the audit trail.</span></p>` : ''}
        ${field({ label: 'Description', name: 'description', value: s.description, required: true, span: 2 })}
        ${field({ label: 'Batch / lot', name: 'batch_no', value: s.batch_no })}
        ${field({ label: 'Client reference', name: 'client_ref', value: s.client_ref })}
        ${field({ label: 'Sample type', name: 'sample_type', type: 'select', options: L.sampleTypes, value: s.sample_type, empty: '—' })}
        ${field({ label: 'Priority', name: 'priority', type: 'select', options: L.priorities, value: s.priority })}
        ${field({ label: 'Quantity', name: 'quantity', value: s.quantity })}
        ${field({ label: 'Container', name: 'container', value: s.container })}
        ${field({ label: 'Storage', name: 'storage', type: 'select', options: L.storageConditions, value: s.storage, empty: '—' })}
        ${field({ label: 'Due date', name: 'due_date', type: 'date', value: s.due_date })}
        ${field({ label: 'Notes', name: 'notes', type: 'textarea', value: s.notes, span: 2 })}`,
      onSubmit: async (data) => {
        await api.put(`/api/samples/${s.id}`, data);
        toast('Sample updated');
        ctx.refresh();
      },
    }),
    custody: () => openForm({
      title: 'Record sample movement',
      body: html`
        ${field({ label: 'What happened', name: 'action', type: 'select', options: L.custodyActions.filter((a) => a !== 'Disposed'), required: true })}
        ${field({ label: 'New location', name: 'location', value: s.location, placeholder: 'e.g. Lab 2.01 bench 4' })}
        ${field({ label: 'Note', name: 'note', type: 'textarea', rows: 2, span: 2 })}`,
      onSubmit: async (data) => {
        await api.post(`/api/samples/${s.id}/custody`, data);
        toast('Movement recorded');
        ctx.refresh();
      },
    }),
    dispose: () => openForm({
      title: `Dispose ${s.code}`,
      danger: true,
      submitLabel: 'Record disposal',
      body: html`<p class="span-2 muted">Record that the remaining material has been destroyed or returned. This cannot be undone.</p>
        ${field({ label: 'Method / note', name: 'note', type: 'textarea', rows: 2, span: 2, required: true, placeholder: 'e.g. Incinerated via waste contractor, consignment note #' })}`,
      onSubmit: async (data) => {
        await api.post(`/api/samples/${s.id}/custody`, { action: 'Disposed', note: data.note });
        toast('Disposal recorded');
        ctx.refresh();
      },
    }),
    cancel: async () => {
      const reason = await promptReason('Why is this sample being cancelled? All open tests will be cancelled too');
      if (!reason) return;
      try {
        await api.post(`/api/samples/${s.id}/cancel`, { reason });
        toast('Sample cancelled');
        ctx.refresh();
      } catch (e) { showError(e); }
    },
    investigate: async () => {
      const { newInvestigation } = await import('./investigations.js');
      newInvestigation({ sample_id: s.id, project_id: s.project_id, title: `${s.code} — ` });
    },
    note: async () => {
      const { newEntry } = await import('./notebook.js');
      newEntry({ sample_id: s.id, project_id: s.project_id, title: `${s.code} — ` });
    },
  };
  ctx.el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (a && actions[a.dataset.act]) {
      e.preventDefault();
      a.closest('.dropdown-menu')?.setAttribute('hidden', '');
      actions[a.dataset.act]();
    }
  });
}

async function addTests(ctx, s, tests = []) {
  const methods = await api.get('/api/methods', { usable: 1 });
  const taken = new Set(tests.filter((t) => t.status !== 'Cancelled').map((t) => t.method_id));
  await openForm({
    title: `Add tests to ${s.code}`,
    size: 'lg',
    submitLabel: 'Add tests',
    body: html`<div class="span-2 row picker-tools"><label class="search-box">${icon('search', { size: 14 })}<input type="search" placeholder="Find a method…" data-mfilter autofocus></label><span class="spacer"></span><span class="small muted" data-mcount></span></div>
      <div class="span-2">${methodPicker(methods, { taken })}</div>`,
    onMount: (form) => wireMethodPicker(form),
    onSubmit: async (data) => {
      const ids = [].concat(data.method_ids || []);
      if (!ids.length) throw new Error('Choose at least one method');
      await api.post(`/api/samples/${s.id}/tests`, { method_ids: ids });
      toast(`${plural(ids.length, 'test')} added`);
      ctx.refresh();
    },
  });
}
