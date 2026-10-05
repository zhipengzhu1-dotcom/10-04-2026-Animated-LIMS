import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can, activeUsers } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate, setQuery, refreshNav } from '../core/nav.js';
import { markdown } from '../core/markdown.js';
import {
  pageHead, card, kv, mountTable, searchBox, segmented, statusBadge, priorityBadge, dueChip, fmtDate, fmtDateTime, money, plural,
  emptyState, field, openForm, esign, toast, showError, busy, promptReason, specText, resultText, outcomeBadge, person, badge, debounce, todayIso,
} from '../core/ui.js';
import { stepper, signatureList, recordFooter, wireRecordFooter } from '../core/components.js';

const TEST_STEPS = ['Pending', 'In Progress', 'Submitted', 'Reviewed', 'Approved'];

// ---------------------------------------------------------------------------------------------
// Assign dialog (also used from the sample page)
// ---------------------------------------------------------------------------------------------

export async function assignDialog(testIds, tests) {
  const methodCodes = [...new Set(tests.map((t) => t.method_code))];
  const { users, qualifications } = await api.get('/api/qualifications');
  const qualified = (uid) => methodCodes.every((code) => qualifications.some((q) => q.user_id === uid && q.method_code === code && (!q.expires_at || q.expires_at >= todayIso())));
  const load = await api.get('/api/tests', { scope: 'open' });
  const openCount = (uid) => load.filter((t) => t.analyst_id === uid && ['Pending', 'In Progress'].includes(t.status)).length;
  const ranked = users.map((u) => ({ ...u, ok: qualified(u.id), open: openCount(u.id) })).sort((a, b) => (b.ok - a.ok) || (a.open - b.open));
  return openForm({
    title: `Assign ${plural(testIds.length, 'test')}`,
    submitLabel: 'Assign',
    body: html`
      <p class="span-2 muted small">Only analysts trained on ${methodCodes.join(', ')} can be assigned. Sorted by who is qualified and has the lightest workload.</p>
      <div class="span-2 pick-list" style="max-height:300px">${ranked.map((u) => html`
        <label class="${u.ok ? '' : 'disabled'}"><input type="radio" name="analyst_id" value="${u.id}" ${u.ok ? '' : raw('disabled')}>
          <span class="grow"><strong>${u.full_name}</strong><small>${u.title || u.role}${u.ok ? '' : ` · not qualified on ${methodCodes.length > 1 ? 'all methods' : methodCodes[0]}`}</small></span>
          <span class="badge ${u.open > 8 ? 'amber' : 'gray'}" title="Open tests">${u.open} open</span>
        </label>`)}</div>
      ${field({ label: 'Due date (optional)', name: 'due_date', type: 'date', hint: 'Leave empty to keep the current due date' })}`,
    onSubmit: async (d) => {
      if (!d.analyst_id) throw new Error('Choose an analyst');
      await api.post('/api/tests/assign', { test_ids: testIds, analyst_id: Number(d.analyst_id), due_date: d.due_date || null });
      toast(`${plural(testIds.length, 'test')} assigned`);
      refreshNav();
      return true;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Worklist
// ---------------------------------------------------------------------------------------------

export async function worklist(ctx) {
  ctx.title('Worklist');
  const canAssign = can('tests.assign');
  const defaultView = can('tests.perform') && !canAssign ? 'mine' : 'all';
  const view = ctx.query.view || defaultView;
  const params = { scope: 'open', method_id: ctx.query.method, analyst_id: ctx.query.analyst };
  if (view === 'mine') params.work = 'assigned';
  if (view === 'unassigned') params.unassigned = 1;
  if (view === 'overdue') params.overdue = 1;
  if (view === 'review') { delete params.scope; params.status = 'Submitted,Reviewed'; }
  const [rows, methods] = await Promise.all([api.get('/api/tests', params), api.get('/api/methods')]);
  const analysts = activeUsers(state.lookups.testPerformerRoles);

  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Worklist',
      sub: 'Open tests, most urgent first. Select tests to assign them in bulk.',
      actions: canAssign ? html`<button class="btn primary" data-act="assign" disabled>${icon('users', { size: 15 })}Assign</button>` : '',
    })}
    <div class="toolbar">
      ${segmented([
        can('tests.perform') && { key: 'mine', label: 'My tests', href: setQuery({ view: 'mine' }) },
        { key: 'unassigned', label: 'Unassigned', href: setQuery({ view: 'unassigned' }) },
        { key: 'all', label: 'All open', href: setQuery({ view: 'all' }) },
        { key: 'overdue', label: 'Overdue', href: setQuery({ view: 'overdue' }) },
        { key: 'review', label: 'In review', href: setQuery({ view: 'review' }) },
      ].filter(Boolean), view)}
      <select data-q="method" style="width:auto;max-width:260px" aria-label="Method"><option value="">All methods</option>${methods.map((m) => html`<option value="${m.id}" ${String(m.id) === ctx.query.method ? raw('selected') : ''}>${m.code} — ${m.title}</option>`)}</select>
      ${(canAssign || can('work.oversee')) && view !== 'mine' ? html`<select data-q="analyst" style="width:auto" aria-label="Analyst"><option value="">Anyone</option>${analysts.map((u) => html`<option value="${u.id}" ${String(u.id) === ctx.query.analyst ? raw('selected') : ''}>${u.full_name}</option>`)}</select>` : ''}
      <span class="spacer"></span>
      ${searchBox('Filter tests…')}
    </div>
    <div class="card"><div data-table></div></div>`);

  const table = mountTable(ctx.el.querySelector('[data-table]'), {
    rows,
    selectable: canAssign,
    rowHref: (r) => `/tests/${r.id}`,
    rowClass: (r) => (r.oos ? 'row-fail' : r.priority !== 'Standard' ? 'row-warn' : ''),
    onSelectionChange: (ids) => {
      const b = ctx.el.querySelector('[data-act=assign]');
      if (b) {
        b.disabled = !ids.length;
        b.innerHTML = String(html`${icon('users', { size: 15 })}Assign${ids.length ? ` ${ids.length}` : ''}`);
      }
    },
    searchText: (r) => `${r.code} ${r.sample_code} ${r.sample_description} ${r.batch_no} ${r.method_code} ${r.method_title} ${r.client_name} ${r.analyst_name}`,
    empty: emptyState({ icon: 'check', title: view === 'mine' ? 'Your worklist is clear' : 'No tests here', text: view === 'mine' ? 'Nothing is assigned to you right now.' : 'Nothing matches this view.', action: view === 'mine' ? html`<a class="btn" href="${setQuery({ view: 'unassigned' })}">See unassigned tests</a>` : '' }),
    columns: [
      { key: 'code', label: 'Test', sort: (r) => r.id, render: (r) => html`<a class="code" href="/tests/${r.id}">${r.code}</a>` },
      { key: 'sample_code', label: 'Sample', sort: true, render: (r) => html`<span class="code">${r.sample_code}</span><span class="sub-line">${r.sample_description}${r.batch_no ? ` · ${r.batch_no}` : ''}</span>` },
      { key: 'method_title', label: 'Method', sort: (r) => r.method_code, cls: 'title-cell', render: (r) => html`<strong>${r.method_title}</strong><span class="sub-line">${r.method_code} v${r.method_version} · ${r.technique}</span>` },
      { key: 'client_code', label: 'Client', sort: true, render: (r) => html`<span title="${r.client_name}">${r.client_code}</span>` },
      { key: 'analyst_name', label: 'Analyst', sort: true, render: (r) => person(r.analyst_name, r.analyst_id, r.analyst_initials) },
      { key: 'status', label: 'Status', cls: 'nowrap', sort: (r) => TEST_STEPS.indexOf(r.status), render: (r) => html`${statusBadge(r.status)} ${priorityBadge(r.priority)}${r.oos ? badge('OOS', 'red', { dot: false }) : ''}` },
      { key: 'due_date', label: 'Due', sort: true, render: (r) => dueChip(r.due_date) },
    ],
  });
  const filter = ctx.el.querySelector('[data-filter]');
  filter.addEventListener('input', debounce(() => table.filter(filter.value), 120));
  ctx.el.querySelectorAll('[data-q]').forEach((sel) => sel.addEventListener('change', () => navigate(setQuery({ [sel.dataset.q]: sel.value }))));
  ctx.el.querySelector('[data-act=assign]')?.addEventListener('click', async () => {
    const ids = table.selected();
    if (await assignDialog(ids, rows.filter((r) => ids.includes(r.id)))) ctx.refresh();
  });
}

// ---------------------------------------------------------------------------------------------
// Test detail & result entry
// ---------------------------------------------------------------------------------------------

function evaluate(r, raw_) {
  if (r.result_type !== 'numeric') return null;
  const s = String(raw_ ?? '').trim().replace(',', '.');
  if (s === '') return 'Pending';
  const v = Number(s);
  if (!Number.isFinite(v)) return 'Invalid';
  if (r.spec_min == null && r.spec_max == null) return 'Report';
  const p = 10 ** (r.decimals ?? 2);
  const x = Math.round(v * p) / p;
  if (r.spec_min != null && x < r.spec_min) return 'Fail';
  if (r.spec_max != null && x > r.spec_max) return 'Fail';
  return 'Pass';
}

export async function detail(ctx) {
  const d = await api.get(`/api/tests/${ctx.params.id}`);
  const t = d.test;
  ctx.title(t.code);
  const editable = d.can.edit;
  const materialIds = new Set(d.materials.map((m) => m.id));
  const lastSig = d.signatures[d.signatures.length - 1];
  const returned = t.status === 'In Progress' && lastSig && /Return|Reject/.test(lastSig.meaning) ? lastSig : null;
  const openInv = d.investigations.filter((v) => v.status !== 'Closed');
  const fails = d.results.filter((r) => r.outcome === 'Fail');

  const resultCell = (r) => {
    if (!editable) return html`<span class="r-value">${resultText(r)}</span>`;
    if (r.result_type === 'numeric') {
      return html`<input class="r-input ${r.outcome === 'Fail' ? 'fail' : r.outcome === 'Pass' ? 'pass' : ''}" data-rid="${r.id}" inputmode="decimal" value="${r.value_num ?? ''}" aria-label="${r.analyte} result" autocomplete="off"><span class="r-unit">${r.unit || ''}</span>`;
    }
    return html`<input class="r-input text" data-rid="${r.id}" value="${r.value_text ?? ''}" aria-label="${r.analyte} result" list="dl-${r.id}" autocomplete="off">
      <datalist id="dl-${r.id}"><option value="${r.spec_text || ''}"></option></datalist>
      ${r.spec_text ? html`<span class="conform">
        <label class="p"><input type="radio" name="o-${r.id}" value="Pass" ${r.outcome === 'Pass' ? raw('checked') : ''}>${icon('check', { size: 12 })}Conforms</label>
        <label class="f"><input type="radio" name="o-${r.id}" value="Fail" ${r.outcome === 'Fail' ? raw('checked') : ''}>${icon('x', { size: 12 })}Does not</label>
      </span>` : ''}`;
  };

  const actionsHtml = html`
    ${d.can.claim ? html`<button class="btn primary" data-act="claim">${icon('user', { size: 15 })}Pick up this test</button>` : ''}
    ${d.can.start ? html`<button class="btn primary" data-act="start">${icon('play', { size: 15 })}Start test</button>` : ''}
    ${d.can.submit ? html`<button class="btn primary" data-act="submit">${icon('send', { size: 15 })}Submit for review</button>` : ''}
    ${d.can.review ? html`<button class="btn" data-act="review-return">${icon('undo', { size: 15 })}Return</button><button class="btn primary" data-act="review-ok">${icon('sign', { size: 15 })}Sign review</button>` : ''}
    ${d.can.return ? html`<button class="btn" data-act="approve-return">${icon('undo', { size: 15 })}Return</button>` : ''}
    ${d.can.accept || d.can.return ? html`<button class="btn primary" data-act="approve-ok" ${d.can.accept ? '' : raw('disabled title="Close the open investigation first"')}>${icon('sign', { size: 15 })}Approve</button>` : ''}
    <div class="dropdown">
      <button class="btn" data-dd aria-label="More actions">${icon('more', { size: 16 })}</button>
      <div class="dropdown-menu" hidden>
        <a href="/samples/${t.sample_id}">${icon('tube')}Open sample ${t.sample_code}</a>
        <a href="/methods/${t.method_id}">${icon('method')}Open method ${t.method_code}</a>
        ${d.can.assign ? html`<button data-act="assign">${icon('users')}${t.analyst_id ? 'Reassign' : 'Assign'}</button>` : ''}
        ${d.can.raise ? html`<button data-act="investigate">${icon('alert')}Raise investigation</button>` : ''}
        ${can('notebook.write') ? html`<button data-act="note">${icon('book')}New notebook entry</button>` : ''}
        ${d.can.cancel ? html`<hr><button data-act="cancel">${icon('xCircle')}Cancel test</button>` : ''}
      </div>
    </div>`;

  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: `/samples/${t.sample_id}`, label: `Sample ${t.sample_code}` },
      title: html`${t.method_title}`,
      badges: html`${statusBadge(t.status)}${priorityBadge(t.priority)}${t.oos ? badge('OOS', 'red') : ''}`,
      meta: html`
        <span class="code">${t.code}</span>
        <span>${icon('method', { size: 14 })}<a href="/methods/${t.method_id}">${t.method_code} v${t.method_version}</a></span>
        <span>${icon('tube', { size: 14 })}<a href="/samples/${t.sample_id}">${t.sample_code}</a> · ${t.sample_description}${t.batch_no ? ` · ${t.batch_no}` : ''}</span>
        <span>${icon('building', { size: 14 })}${t.client_name}</span>
        <span>${icon('clock', { size: 14 })}${dueChip(t.due_date, { done: ['Approved', 'Cancelled'].includes(t.status) })}</span>`,
      actions: actionsHtml,
    })}

    <div class="card stepper-card">${stepper(TEST_STEPS, t.status === 'Cancelled' ? null : t.status, { stopped: t.status === 'Cancelled' })}</div>

    ${returned ? html`<div class="notice warn mb">${icon('undo', { size: 16 })}<span><strong>Returned by ${returned.full_name}:</strong> “${returned.comment}” — correct and resubmit.</span></div>` : ''}
    ${d.can.return && !d.can.accept ? html`<div class="notice bad mb">${icon('alert', { size: 16 })}<span>Investigation ${openInv.map((v) => html`<a href="/investigations/${v.id}"><strong>${v.code}</strong></a> `)}is open — this result cannot be approved until it is closed.</span></div>` : ''}
    ${t.analyst_id === state.me.id && !d.qualifiedMe && !['Approved', 'Cancelled'].includes(t.status) ? html`<div class="notice warn mb">${icon('training', { size: 16 })}<span>Your training on ${t.method_code} is not current. Ask your manager to update the training record before you record results.</span></div>` : ''}
    ${d.can.review ? html`<div class="notice info mb">${icon('review', { size: 16 })}<span><strong>Peer review:</strong> check the results against the raw data${t.raw_data_ref ? html` (${t.raw_data_ref})` : ''}, the calculations and the specification, then sign or return it to ${t.analyst_name}.</span></div>` : ''}
    ${d.can.return ? html`<div class="notice info mb">${icon('shield', { size: 16 })}<span><strong>QA approval:</strong> reviewed by ${t.reviewer_name}. Approve to release the result for the certificate.</span></div>` : ''}

    <div class="split">
      <div class="stack">
        <form data-results class="stack" novalidate>
          ${card({
            title: 'Results',
            sub: editable ? 'Results are checked against the specification as you type (rounded to the reported precision first).' : null,
            flush: true,
            body: html`<div class="table-wrap"><table class="table results-table">
              <thead><tr><th>Parameter</th><th>Specification</th><th>Result</th><th>Outcome</th></tr></thead>
              <tbody>${d.results.map((r) => html`<tr class="${r.outcome === 'Fail' ? 'fail' : ''}" data-row="${r.id}">
                <td><span class="r-name">${r.analyte}</span>${r.entered_by_name && !editable ? html`<span class="sub-line">${r.entered_by_name} · ${fmtDateTime(r.entered_at)}</span>` : ''}</td>
                <td class="r-spec">${specText(r)}</td>
                <td>${resultCell(r)}</td>
                <td data-outcome>${outcomeBadge(r.outcome)}</td>
              </tr>`)}</tbody></table></div>`,
          })}

          ${card({
            title: 'Instrument, standards & raw data',
            sub: editable ? 'Only calibrated instruments and in-date materials can be selected.' : null,
            body: editable ? html`<div class="form-grid">
              <label class="field"><span class="label">Instrument</span>
                <select name="instrument_id"><option value="">— Not applicable —</option>${d.instruments.map((i) => html`<option value="${i.id}" ${i.id === t.instrument_id ? raw('selected') : ''} ${i.problem && i.id !== t.instrument_id ? raw('disabled') : ''}>${i.code} — ${i.name}${i.problem ? ` (${i.problem.replace(`${i.code} `, '')})` : ''}</option>`)}</select>
              </label>
              ${field({ label: 'Raw data reference', name: 'raw_data_ref', value: t.raw_data_ref, placeholder: 'e.g. Empower 3 · HPLC-02 · 20261001-014', hint: 'Where the original data lives (CDS result set, printout number…)' })}
              <div class="field span-2"><span class="label">Standards, reagents & columns used</span>
                <input type="search" placeholder="Filter materials…" data-mat-filter style="margin-bottom:6px">
                <div class="pick-list">${d.inventory.map((m) => html`<label class="${m.problem && !materialIds.has(m.id) ? 'disabled' : ''}" data-mtext="${`${m.code} ${m.name} ${m.lot_no || ''}`.toLowerCase()}">
                  <input type="checkbox" name="material_ids" value="${m.id}" ${materialIds.has(m.id) ? raw('checked') : ''} ${m.problem && !materialIds.has(m.id) ? raw('disabled') : ''}>
                  <span class="grow"><strong>${m.name}</strong><small>${m.code} · ${m.category}${m.lot_no ? ` · Lot ${m.lot_no}` : ''}${m.potency ? ` · ${m.potency}` : ''}${m.expiry_date ? ` · Exp ${fmtDate(m.expiry_date)}` : ''}</small></span>
                  ${m.problem ? badge(m.status !== 'Active' ? m.status : 'Expired', 'red', { dot: false }) : m.used_with_method ? badge('Usual for this method', 'teal', { dot: false }) : ''}
                </label>`)}</div>
              </div>
              ${field({ label: 'Comments', name: 'comments', type: 'textarea', rows: 2, value: t.comments, span: 2, placeholder: 'System suitability, observations, deviations from the method…' })}
            </div>` : kv([
              ['Instrument', t.instrument_code ? html`<a href="/instruments/${t.instrument_id}">${t.instrument_code}</a> — ${t.instrument_name}` : null],
              ['Materials', d.materials.length ? html`${d.materials.map((m) => html`<div><a href="/inventory/${m.id}" class="code">${m.code}</a> ${m.name}${m.lot_no ? html` <span class="muted">· Lot ${m.lot_no}</span>` : ''}</div>`)}` : null],
              ['Raw data', t.raw_data_ref],
              ['Comments', t.comments],
            ]),
          })}

          ${editable ? html`<div class="card mt"><div class="summary-bar">
            <span class="muted small">${icon('shield', { size: 13 })} Every change is recorded. Changing a recorded result asks for a reason.</span>
            <span class="btn-group" style="margin-left:auto">
              <button type="submit" class="btn" data-save>${icon('check', { size: 15 })}Save</button>
              <button type="button" class="btn primary" data-act="submit">${icon('send', { size: 15 })}Save & submit for review</button>
            </span>
          </div></div>` : ''}
        </form>
        ${recordFooter()}
      </div>

      <div class="stack">
        ${card({ title: 'Test details', body: kv([
          ['Analyst', person(t.analyst_name, t.analyst_id, t.analyst_initials)],
          ['Technique', t.technique],
          ['Client', t.client_name],
          ['Priority', t.priority],
          can('billing.view') && ['Price', money(t.price)],
          ['Requested', fmtDateTime(t.created_at)],
          t.started_at && ['Started', fmtDateTime(t.started_at)],
          t.submitted_at && ['Submitted', fmtDateTime(t.submitted_at)],
          t.reviewed_at && ['Reviewed', html`${t.reviewer_name}<div class="muted small">${fmtDateTime(t.reviewed_at)}</div>`],
          t.approved_at && ['Approved', html`${t.approver_name}<div class="muted small">${fmtDateTime(t.approved_at)}</div>`],
          t.invoice_id && can('billing.view') && ['Invoice', html`<a href="/invoices/${t.invoice_id}">View invoice</a>`],
        ]) })}
        ${card({ title: 'Signatures', body: signatureList(d.signatures) })}
        ${d.investigations.map((v) => card({
          title: html`<a href="/investigations/${v.id}" class="code">${v.code}</a> ${statusBadge(v.status)}`,
          actions: v.can.close ? html`<button class="btn sm primary" data-act="close-investigation" data-id="${v.id}">${icon('sign', { size: 14 })}Close</button>` : '',
          body: kv([
            ['Raised', fmtDateTime(v.raised_at)],
            ['Description', v.description ? html`<div style="white-space:pre-wrap">${v.description}</div>` : null],
            v.status === 'Closed' && ['Root cause', html`<div style="white-space:pre-wrap">${v.root_cause}</div>`],
            v.status === 'Closed' && ['Conclusion', html`<div style="white-space:pre-wrap">${v.conclusion}</div>`],
            v.status === 'Closed' && ['Closed by', html`${v.closed_by_name}<div class="muted small">${fmtDateTime(v.closed_at)}</div>`],
            v.signatures.length > 0 && ['Signature', signatureList(v.signatures)],
          ]),
        }))}
        ${d.method.procedure ? card({ title: html`Method summary <span class="muted small" style="font-weight:400">· ${d.method.code} v${d.method.version}</span>`, body: html`<div class="md small">${raw(markdown(d.method.procedure))}</div>${d.method.reference ? html`<p class="muted small" style="margin-top:8px">Reference: ${d.method.reference}</p>` : ''}` }) : ''}
      </div>
    </div>`);

  const form = ctx.el.querySelector('form[data-results]');
  wireRecordFooter(ctx.el, 'tests', t.id, { locked: !editable, lockedReason: editable ? null : ['Submitted', 'Reviewed', 'Approved'].includes(t.status) ? 'Signed records are locked — attachments can no longer change.' : null });
  ctx.el.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) navigate(el.dataset.href); }));

  // Live specification check while typing.
  form.addEventListener('input', (e) => {
    const input = e.target.closest('input[data-rid]');
    if (input) {
      const r = d.results.find((x) => x.id === Number(input.dataset.rid));
      const outcome = evaluate(r, input.value);
      if (outcome) {
        const row = input.closest('tr');
        row.classList.toggle('fail', outcome === 'Fail');
        input.classList.toggle('fail', outcome === 'Fail' || outcome === 'Invalid');
        input.classList.toggle('pass', outcome === 'Pass');
        row.querySelector('[data-outcome]').innerHTML = String(outcome === 'Invalid' ? html`<span class="outcome fail">Not a number</span>` : outcomeBadge(outcome));
      }
    }
    if (e.target.matches('[data-mat-filter]')) {
      const q = e.target.value.toLowerCase();
      form.querySelectorAll('[data-mtext]').forEach((l) => { l.hidden = q && !l.dataset.mtext.includes(q); });
    }
  });

  const collect = () => {
    const results = d.results.map((r) => {
      const input = form.querySelector(`input[data-rid="${r.id}"]`);
      const o = form.querySelector(`input[name="o-${r.id}"]:checked`);
      return { id: r.id, value: input?.value ?? '', outcome: o?.value };
    });
    return {
      results,
      instrument_id: form.querySelector('[name=instrument_id]')?.value || null,
      raw_data_ref: form.querySelector('[name=raw_data_ref]')?.value ?? null,
      comments: form.querySelector('[name=comments]')?.value ?? null,
      material_ids: [...form.querySelectorAll('[name=material_ids]:checked')].map((c) => Number(c.value)),
    };
  };
  const save = async () => {
    await api.put(`/api/tests/${t.id}`, collect());
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy(form.querySelector('[data-save]'), async () => {
      await save();
      toast('Results saved');
      ctx.refresh();
    });
  });

  const signDecision = (kind, accept) => {
    const isReview = kind === 'review';
    return esign({
      title: accept ? (isReview ? 'Sign peer review' : 'Approve result') : 'Return to analyst',
      action: accept ? (isReview ? 'test.review.accept' : 'test.approve.accept') : isReview ? 'test.review.return' : 'test.approve.reject',
      description: accept
        ? html`${t.code} · ${t.method_code} on ${t.sample_code}${fails.length ? html` — <strong class="bad-text">${plural(fails.length, 'result')} out of specification</strong>` : ''}`
        : html`The test goes back to ${t.analyst_name} to correct and resubmit. Your reason is shown to them and kept in the audit trail.`,
      confirmLabel: accept ? (isReview ? 'Sign review' : 'Approve') : 'Return test',
      danger: !accept,
      comment: { label: accept ? 'Comment (optional)' : 'Reason for returning', required: !accept, placeholder: accept ? '' : 'e.g. Integration of impurity peak at RRT 1.32 needs correcting' },
      onSign: async (sig) => {
        await api.post(`/api/tests/${t.id}/${isReview ? 'review' : 'approve'}`, { ...sig, decision: accept ? 'approve' : 'reject' });
        toast(accept ? (isReview ? 'Review signed' : 'Result approved') : 'Returned to analyst');
        refreshNav();
        ctx.refresh();
      },
    });
  };

  const actions = {
    claim: (b) => busy(b, async () => { await api.post(`/api/tests/${t.id}/claim`); toast('Test assigned to you'); refreshNav(); ctx.refresh(); }),
    start: (b) => busy(b, async () => { await api.post(`/api/tests/${t.id}/start`); toast('Test started'); ctx.refresh(); }),
    submit: async (b) => {
      const instrumentSel = form.querySelector('[name=instrument_id]');
      if (instrumentSel && !instrumentSel.value && !['Physical / Visual', 'Gravimetric'].includes(t.technique)) {
        toast('Choose the instrument you used before submitting', 'error');
        instrumentSel.focus();
        instrumentSel.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (editable) {
        const ok = await busy(b, async () => { await save(); return true; });
        if (!ok) return;
      }
      const fresh = await api.get(`/api/tests/${t.id}`);
      const pending = fresh.results.filter((r) => r.outcome === 'Pending');
      if (pending.length) {
        toast(`Complete every result first: ${pending.map((r) => r.analyte).join(', ')}`, 'error');
        return ctx.refresh();
      }
      const oos = fresh.results.filter((r) => r.outcome === 'Fail');
      const signed = await esign({
        title: 'Submit for review',
        action: 'test.submit',
        description: html`<p style="margin:0 0 8px">You confirm that ${t.code} was performed according to <strong>${t.method_code} v${t.method_version}</strong> and the results below are complete and traceable to the raw data.</p>
          <table class="table compact"><tbody>${fresh.results.map((r) => html`<tr><td>${r.analyte}</td><td class="right num mono">${resultText(r)}</td><td>${outcomeBadge(r.outcome)}</td></tr>`)}</tbody></table>
          ${oos.length ? html`<p class="notice bad" style="margin-top:10px">${icon('alert', { size: 15 })}<span>${plural(oos.length, 'result')} out of specification. An OOS investigation will be opened automatically when you submit.</span></p>` : ''}`,
        confirmLabel: 'Sign & submit',
        onSign: async (sig) => api.post(`/api/tests/${t.id}/submit`, sig),
      });
      if (signed) {
        if (signed.investigation) toast(`Submitted. OOS investigation ${signed.investigation.code} opened`, 'info');
        else toast('Submitted for review');
        refreshNav();
        ctx.refresh();
      } else if (editable) ctx.refresh();
    },
    'review-ok': () => signDecision('review', true),
    'review-return': () => signDecision('review', false),
    'approve-ok': () => signDecision('approve', true),
    'approve-return': () => signDecision('approve', false),
    assign: async () => { if (await assignDialog([t.id], [t])) ctx.refresh(); },
    'close-investigation': (a) => {
      const v = d.investigations.find((x) => x.id === +a.dataset.id);
      return esign({
        title: `Close ${v.code}`,
        action: v.type === 'OOS' ? 'investigation.close.oos' : 'investigation.close',
        description: html`${t.code} · ${t.method_code} on ${t.sample_code}. Once closed the investigation is locked; the result can go to approval when no investigation on it is open.`,
        fields: html`
          ${field({ label: 'Root cause', name: 'root_cause', type: 'textarea', rows: 3, required: true, span: 2, autofocus: true, value: v.root_cause })}
          ${field({ label: 'Conclusion', name: 'conclusion', type: 'textarea', rows: 3, required: true, span: 2, placeholder: 'e.g. Confirmed OOS — result valid', value: v.conclusion })}`,
        confirmLabel: 'Sign & close',
        onSign: async (sig) => {
          await api.post(`/api/investigations/${v.id}/close`, { root_cause: sig.root_cause, conclusion: sig.conclusion, password: sig.password });
          toast('Investigation closed');
          refreshNav();
          ctx.refresh();
        },
      });
    },
    cancel: async () => {
      const reason = await promptReason('Why is this test being cancelled? It will no longer be billed or reported');
      if (!reason) return;
      try {
        await api.post(`/api/tests/${t.id}/cancel`, { reason });
        toast('Test cancelled');
        ctx.refresh();
      } catch (e) { showError(e); }
    },
    investigate: async () => {
      const { newInvestigation } = await import('./investigations.js');
      newInvestigation({ test_id: t.id, sample_id: t.sample_id, project_id: t.project_id, instrument_id: t.instrument_id, title: `${t.code} (${t.sample_code}) — ` });
    },
    note: async () => {
      const { newEntry } = await import('./notebook.js');
      newEntry({ sample_id: t.sample_id, project_id: t.project_id, method_id: t.method_id, title: `${t.code} ${t.method_code} — ` });
    },
  };
  ctx.el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (a && actions[a.dataset.act]) {
      e.preventDefault();
      actions[a.dataset.act](a);
    }
  });
  // Warn before leaving with unsaved results.
  let dirty = false;
  form.addEventListener('change', () => { dirty = true; });
  form.addEventListener('input', () => { dirty = true; });
  const guard = (e) => {
    if (!ctx.isCurrent()) return window.removeEventListener('beforeunload', guard);
    if (dirty && editable) { e.preventDefault(); e.returnValue = ''; }
    return undefined;
  };
  window.addEventListener('beforeunload', guard);
}
