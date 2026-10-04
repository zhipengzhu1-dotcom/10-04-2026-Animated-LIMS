import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can, shipped, activeUsers } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate, setQuery } from '../core/nav.js';
import { markdown } from '../core/markdown.js';
import {
  pageHead, card, kv, mountTable, searchBox, segmented, statusBadge, fmtDate, money, plural, emptyState, field, esign, toast, busy,
  specText, person, debounce, dueChip, avatar, confirmDialog,
} from '../core/ui.js';
import { signatureList, recordFooter, wireRecordFooter } from '../core/components.js';

export async function list(ctx) {
  ctx.title('Methods');
  const view = ctx.query.view || 'active';
  const rows = await api.get('/api/methods', view === 'history' ? { all: 1 } : {});
  const filtered = rows.filter((m) => (view === 'active' ? m.status !== 'Retired' : view === 'effective' ? m.status === 'Effective' : view === 'dev' ? ['Draft', 'In Development', 'In Validation'].includes(m.status) : view === 'retired' ? m.status === 'Retired' : true));
  const money_ = can('billing.view');
  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Methods',
      sub: 'Your analytical method library — versions, specifications, pricing and who is trained to run them.',
      actions: can('methods.edit') ? html`<a class="btn primary" href="/methods/new">${icon('plus', { size: 15 })}New method</a>` : '',
    })}
    <div class="toolbar">
      ${segmented([
        { key: 'active', label: 'Current', href: setQuery({ view: null }) },
        { key: 'effective', label: 'Effective', href: setQuery({ view: 'effective' }) },
        { key: 'dev', label: 'In development / validation', href: setQuery({ view: 'dev' }) },
        { key: 'retired', label: 'Retired', href: setQuery({ view: 'retired' }) },
        { key: 'history', label: 'All versions', href: setQuery({ view: 'history' }) },
      ], view)}
      <span class="spacer"></span>
      ${searchBox('Filter methods…')}
    </div>
    <div class="card"><div data-table></div></div>`);
  const table = mountTable(ctx.el.querySelector('[data-table]'), {
    rows: filtered,
    rowHref: (r) => `/methods/${r.id}`,
    sort: { key: 'code', dir: 1 },
    searchText: (r) => `${r.code} ${r.title} ${r.technique} ${r.client_name} ${r.reference}`,
    empty: emptyState({ icon: 'method', title: 'No methods', text: 'Add your first analytical method.', action: can('methods.edit') ? html`<a class="btn primary" href="/methods/new">New method</a>` : '' }),
    columns: [
      { key: 'code', label: 'Code', sort: true, render: (r) => html`<a class="code" href="/methods/${r.id}">${r.code}</a> <span class="muted small">v${r.version}</span>${r.latest_version > r.version ? html`<span class="sub-line">v${r.latest_version} exists</span>` : ''}` },
      { key: 'title', label: 'Method', sort: true, cls: 'title-cell', render: (r) => html`<strong>${r.title}</strong><span class="sub-line">${r.reference || ''}</span>` },
      { key: 'technique', label: 'Technique', sort: true },
      { key: 'client_name', label: 'Client', sort: true, render: (r) => r.client_name || html`<span class="muted">General</span>` },
      { key: 'status', label: 'Status', sort: true, render: (r) => statusBadge(r.status) },
      { key: 'qualified_count', label: 'Trained', sort: true, align: 'right', render: (r) => html`<span class="num ${r.qualified_count < 2 && r.status === 'Effective' ? 'warn-text' : ''}" title="${r.qualified_count < 2 ? 'Fewer than 2 trained analysts — key-person risk' : ''}">${r.qualified_count}</span>` },
      { key: 'usage_count', label: 'Tests run', sort: true, align: 'right', render: (r) => html`<span class="num">${r.usage_count}</span>` },
      { key: 'tat_days', label: 'TAT', sort: true, align: 'right', render: (r) => html`<span class="num">${r.tat_days} d</span>` },
      money_ && { key: 'price', label: 'Price', sort: true, align: 'right', render: (r) => html`<span class="num">${money(r.price)}</span>` },
    ].filter(Boolean),
  });
  const f = ctx.el.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
}

export async function detail(ctx) {
  const d = await api.get(`/api/methods/${ctx.params.id}`);
  const m = d.method;
  ctx.title(`${m.code} v${m.version}`);
  const oosRate = d.stats.runs ? (d.stats.oos / d.stats.runs) * 100 : null;
  const transitionBtn = (target) => {
    const needsSign = ['Effective', 'Retired'].includes(target);
    if (needsSign && !d.can.approve) return '';
    if (!needsSign && !can('methods.edit')) return '';
    const label = { Effective: 'Approve & make effective', Retired: 'Retire', 'In Validation': 'Move to validation', 'In Development': 'Back to development', Draft: 'Back to draft' }[target] || target;
    return html`<button class="btn ${target === 'Effective' ? 'primary' : ''}" data-status="${target}">${needsSign ? icon('sign', { size: 15 }) : ''}${label}</button>`;
  };

  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/methods', label: 'Methods' },
      title: m.title,
      badges: html`${statusBadge(m.status)}`,
      meta: html`<span class="code">${m.code} v${m.version}</span><span>${icon('flask', { size: 14 })}${m.technique}</span>${m.client_name ? html`<span>${icon('building', { size: 14 })}${m.client_name}</span>` : ''}${m.reference ? html`<span>${icon('method', { size: 14 })}${m.reference}</span>` : ''}`,
      actions: html`
        ${d.transitions.map(transitionBtn)}
        ${d.can.edit ? html`<a class="btn" href="/methods/${m.id}/edit">${icon('edit', { size: 15 })}Edit</a>` : ''}
        ${d.can.newVersion && m.status !== 'Draft' ? html`<button class="btn" data-act="version">${icon('branch', { size: 15 })}New version</button>` : ''}`,
    })}
    ${m.status === 'Effective' ? html`<div class="locked-banner">${icon('lock', { size: 14 })}<span>Effective since ${fmtDate(m.effective_date)}${m.approved_by_name ? `, approved by ${m.approved_by_name}` : ''}. Effective methods are locked — create a new version to change them.</span></div>` : ''}
    <div class="split">
      <div class="stack">
        ${card({
          title: 'Parameters & specifications',
          sub: 'Copied onto every new test. Product-specific limits can differ per client.',
          flush: true,
          body: d.analytes.length ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Parameter</th><th>Type</th><th>Specification</th><th class="right">Decimals</th></tr></thead>
            <tbody>${d.analytes.map((a) => html`<tr><td><strong>${a.name}</strong></td><td class="muted">${a.result_type === 'numeric' ? 'Numeric' : 'Text / conformance'}</td><td class="num">${specText(a)}</td><td class="right num">${a.result_type === 'numeric' ? a.decimals : '—'}</td></tr>`)}</tbody>
          </table></div>` : emptyState({ icon: 'method', title: 'No parameters yet', text: 'Define what this method reports before it can be used.' }),
        })}
        ${card({ title: 'Scope & procedure', body: html`${m.scope ? html`<p>${m.scope}</p>` : ''}<div class="md">${raw(markdown(m.procedure || '_No procedure summary yet._'))}</div>` })}
        ${shipped('samples') ? card({
          title: 'Recent tests',
          flush: true,
          body: d.recentTests.length ? html`<div class="table-wrap"><table class="table compact"><tbody>${d.recentTests.map((t) => html`<tr class="link ${t.oos ? 'row-fail' : ''}" data-href="/tests/${t.id}"><td><a class="code" href="/tests/${t.id}">${t.code}</a></td><td>${t.sample_code}<span class="sub-line">${t.client_name}</span></td><td>${person(t.analyst_name, t.analyst_id, t.analyst_initials)}</td><td>${statusBadge(t.status)}</td><td>${dueChip(t.due_date, { done: ['Approved', 'Cancelled'].includes(t.status) })}</td></tr>`)}</tbody></table></div>` : emptyState({ icon: 'worklist', title: 'Not used yet' }),
        }) : ''}
        ${recordFooter()}
      </div>
      <div class="stack">
        ${card({ title: 'Method details', body: kv([
          ['Code / version', html`<span class="code">${m.code}</span> v${m.version}`],
          ['Technique', m.technique],
          ['Owner', m.owner_name],
          ['Client', m.client_name || 'General (all clients)'],
          can('billing.view') && ['Price per test', money(m.price)],
          ['Turnaround', `${m.tat_days} working days`],
          ['Effective', fmtDate(m.effective_date)],
        ]) })}
        ${card({ title: 'Performance', body: kv([
          ['Tests approved', d.stats.runs],
          ['OOS rate', oosRate == null ? '—' : html`<span class="${oosRate > 5 ? 'bad-text' : ''}">${oosRate.toFixed(1)}%</span> <span class="muted small">(${d.stats.oos})</span>`],
          ['Avg. start → approval', d.stats.avg_days ? `${d.stats.avg_days.toFixed(1)} days` : '—'],
        ]) })}
        ${shipped('team') ? card({
          title: 'Trained analysts',
          sub: `${plural(d.qualified.length, 'person', 'people')} qualified`,
          actions: can('qualifications.manage') ? html`<a class="btn sm ghost" href="/team/training">Training matrix</a>` : '',
          flush: true,
          body: d.qualified.length ? html`<ul class="list">${d.qualified.map((q) => html`<li class="link" data-href="/team/${q.user_id}">${avatar(q.full_name, q.user_id, { initials: q.initials, size: 26 })}<div class="grow"><div class="title">${q.full_name}</div><div class="meta">Since ${fmtDate(q.qualified_at)}${q.expires_at ? ` · expires ${fmtDate(q.expires_at)}` : ''}</div></div></li>`)}</ul>` : html`<div class="card-body"><div class="notice warn">${icon('alert', { size: 15 })}<span>Nobody is trained on this method yet — tests can't be assigned.</span></div></div>`,
        }) : ''}
        ${card({ title: 'Versions', flush: true, body: html`<ul class="list">${d.versions.map((v) => html`<li class="${v.id === m.id ? '' : 'link'}" ${v.id === m.id ? '' : html`data-href="/methods/${v.id}"`}><div class="grow"><div class="title">v${v.version}${v.id === m.id ? html` <span class="muted small">(this version)</span>` : ''}</div><div class="meta">${v.effective_date ? `Effective ${fmtDate(v.effective_date)}` : `Created ${fmtDate(v.created_at)}`}${v.approved_by_name ? ` · ${v.approved_by_name}` : ''}</div></div>${statusBadge(v.status)}</li>`)}</ul>` })}
        ${d.signatures.length ? card({ title: 'Signatures', body: signatureList(d.signatures) }) : ''}
      </div>
    </div>`);

  wireRecordFooter(ctx.el, 'methods', m.id, { locked: !can('methods.edit') });
  ctx.el.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) navigate(el.dataset.href); }));

  ctx.el.addEventListener('click', async (e) => {
    const sb = e.target.closest('[data-status]');
    if (sb) {
      const target = sb.dataset.status;
      if (['Effective', 'Retired'].includes(target)) {
        const ok = await esign({
          title: target === 'Effective' ? `Approve ${m.code} v${m.version}` : `Retire ${m.code} v${m.version}`,
          action: target === 'Effective' ? 'method.approve' : 'method.retire',
          description: target === 'Effective'
            ? html`The method becomes the controlled version for testing. ${d.versions.some((v) => v.status === 'Effective' && v.id !== m.id) ? 'The current effective version will be retired automatically.' : ''}`
            : 'Retired methods can no longer be used for new tests.',
          confirmLabel: target === 'Effective' ? 'Sign & approve' : 'Sign & retire',
          danger: target === 'Retired',
          comment: { label: target === 'Effective' ? 'Approval reference (e.g. validation report number)' : 'Reason', required: target === 'Retired' },
          onSign: (sig) => api.post(`/api/methods/${m.id}/status`, { status: target, ...sig }),
        });
        if (ok) { toast(`Method ${target === 'Effective' ? 'approved' : 'retired'}`); ctx.refresh(); }
      } else {
        await busy(sb, async () => { await api.post(`/api/methods/${m.id}/status`, { status: target }); toast(`Moved to ${target}`); ctx.refresh(); });
      }
    }
    if (e.target.closest('[data-act=version]')) {
      if (!(await confirmDialog({ title: `Create ${m.code} v${m.version + 1}?`, message: 'A draft copy of this method is created for editing. The current version stays in force until the new one is approved.', confirmLabel: 'Create draft' }))) return;
      await busy(e.target.closest('button'), async () => {
        const res = await api.post(`/api/methods/${m.id}/new-version`);
        toast(`Draft v${m.version + 1} created`);
        navigate(`/methods/${res.id}/edit`);
      });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------------------------

export async function edit(ctx) {
  const isNew = !ctx.params.id;
  if (!can('methods.edit')) throw Object.assign(new Error('You do not have permission to edit methods.'), { status: 403 });
  const [d, clients] = await Promise.all([isNew ? null : api.get(`/api/methods/${ctx.params.id}`), api.get('/api/clients')]);
  const m = d?.method || { technique: '', price: 0, tat_days: 5, owner_id: state.me.id };
  if (d && !d.can.edit) throw Object.assign(new Error(`${m.status} methods are locked. Create a new version to make changes.`), { status: 403 });
  let analytes = d?.analytes?.length ? d.analytes.map((a) => ({ ...a })) : [{ result_type: 'numeric', decimals: 2 }];
  ctx.title(isNew ? 'New method' : `Edit ${m.code}`);
  const L = state.lookups;

  ctx.el.innerHTML = String(html`
    ${pageHead({ back: { href: isNew ? '/methods' : `/methods/${m.id}`, label: isNew ? 'Methods' : `${m.code} v${m.version}` }, title: isNew ? 'New method' : `Edit ${m.code} v${m.version}`, sub: 'Methods start as drafts. QA approval (electronic signature) makes them effective and locks them.' })}
    <form data-method class="stack" novalidate>
      ${card({ title: 'Method', body: html`<div class="form-grid">
        ${isNew ? field({ label: 'Method code', name: 'code', placeholder: 'Leave empty to auto-number (ATM-0001…)', hint: 'Your SOP / ATM document number' }) : ''}
        ${field({ label: 'Title', name: 'title', value: m.title, required: true, span: isNew ? 1 : 2 })}
        ${field({ label: 'Technique', name: 'technique', type: 'select', options: L.techniques, value: m.technique, empty: 'Choose…', required: true })}
        ${field({ label: 'Reference / compendial basis', name: 'reference', value: m.reference, placeholder: 'e.g. USP <467>, Ph. Eur. 2.2.29, client method' })}
        ${field({ label: 'Client', name: 'client_id', type: 'select', options: clients.map((c) => [c.id, c.name]), value: m.client_id, empty: 'General — any client', hint: 'Set for client-specific or transferred methods' })}
        ${field({ label: 'Method owner', name: 'owner_id', type: 'select', options: activeUsers(['scientist', 'manager', 'analyst', 'qa']).map((u) => [u.id, u.full_name]), value: m.owner_id })}
        ${field({ label: 'Price per test', name: 'price', type: 'number', value: m.price, min: 0, step: '0.01', hint: `In ${state.settings.currency}. Rush/urgent surcharges are added automatically.` })}
        ${field({ label: 'Turnaround (working days)', name: 'tat_days', type: 'number', value: m.tat_days, min: 1, step: 1 })}
        ${field({ label: 'Scope', name: 'scope', type: 'textarea', rows: 2, value: m.scope, span: 2, placeholder: 'What the method is for and its applicable range' })}
        ${field({ label: 'Procedure summary', name: 'procedure', type: 'textarea', rows: 8, value: m.procedure, span: 2, hint: 'Markdown supported. Key conditions and system suitability — the full SOP can be attached as a file.' })}
      </div>` })}
      ${card({
        title: 'Reported parameters & specification limits',
        sub: 'Results are rounded to the stated decimals before being compared with the limits.',
        flush: true,
        body: html`<div class="table-wrap"><table class="table"><thead><tr><th>Parameter *</th><th>Type</th><th>Unit</th><th>Lower limit</th><th>Upper limit</th><th>Text specification</th><th>Decimals</th><th></th></tr></thead><tbody data-analytes></tbody></table></div>
          <div class="card-body"><button type="button" class="btn sm" data-add>${icon('plus', { size: 13 })}Add parameter</button></div>`,
      })}
      <div class="card mt"><div class="summary-bar"><span class="spacer"></span><a class="btn" href="${isNew ? '/methods' : `/methods/${m.id}`}">Cancel</a><button class="btn primary" type="submit">${icon('check', { size: 15 })}${isNew ? 'Create method' : 'Save changes'}</button></div></div>
    </form>`);

  const form = ctx.el.querySelector('form');
  const tbody = form.querySelector('[data-analytes]');
  const sync = () => {
    analytes = [...tbody.querySelectorAll('tr')].map((tr) => {
      const o = {};
      tr.querySelectorAll('[data-k]').forEach((i) => { o[i.dataset.k] = i.value; });
      return o;
    });
  };
  const draw = () => {
    tbody.innerHTML = String(html`${analytes.map((a, i) => html`<tr>
      <td><input data-k="name" value="${a.name || ''}" placeholder="e.g. Assay" aria-label="Parameter name"></td>
      <td><select data-k="result_type" style="width:120px" aria-label="Type"><option value="numeric" ${a.result_type !== 'text' ? raw('selected') : ''}>Numeric</option><option value="text" ${a.result_type === 'text' ? raw('selected') : ''}>Text</option></select></td>
      <td><input data-k="unit" value="${a.unit || ''}" style="width:90px" placeholder="%" aria-label="Unit" ${a.result_type === 'text' ? raw('disabled') : ''}></td>
      <td><input data-k="spec_min" value="${a.spec_min ?? ''}" style="width:90px" inputmode="decimal" aria-label="Lower limit" ${a.result_type === 'text' ? raw('disabled') : ''}></td>
      <td><input data-k="spec_max" value="${a.spec_max ?? ''}" style="width:90px" inputmode="decimal" aria-label="Upper limit" ${a.result_type === 'text' ? raw('disabled') : ''}></td>
      <td><input data-k="spec_text" value="${a.spec_text || ''}" placeholder="e.g. Conforms" aria-label="Text specification" ${a.result_type !== 'text' ? raw('disabled') : ''}></td>
      <td><input data-k="decimals" value="${a.decimals ?? 2}" style="width:64px" inputmode="numeric" aria-label="Decimals" ${a.result_type === 'text' ? raw('disabled') : ''}></td>
      <td class="nowrap"><button type="button" class="icon-btn" data-up="${i}" aria-label="Move up" ${i === 0 ? raw('disabled') : ''}>${icon('chevronUp', { size: 14 })}</button><button type="button" class="icon-btn" data-del="${i}" aria-label="Remove">${icon('x', { size: 14 })}</button></td>
    </tr>`)}`);
  };
  draw();
  form.addEventListener('change', (e) => { if (e.target.dataset.k === 'result_type') { sync(); draw(); } });
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) { sync(); analytes.push({ result_type: 'numeric', decimals: 2 }); draw(); tbody.querySelector('tr:last-child input')?.focus(); }
    const del = e.target.closest('[data-del]');
    if (del) { sync(); analytes.splice(Number(del.dataset.del), 1); draw(); }
    const up = e.target.closest('[data-up]');
    if (up) { sync(); const i = Number(up.dataset.up); [analytes[i - 1], analytes[i]] = [analytes[i], analytes[i - 1]]; draw(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    sync();
    const data = Object.fromEntries(new FormData(form));
    if (!data.title || !data.technique) return toast('Title and technique are required', 'error');
    const body = { ...data, client_id: data.client_id || null, analytes: analytes.filter((a) => String(a.name || '').trim()) };
    await busy(form.querySelector('[type=submit]'), async () => {
      if (isNew) {
        const res = await api.post('/api/methods', body);
        toast(`Method ${res.code} created`);
        navigate(`/methods/${res.id}`);
      } else {
        await api.put(`/api/methods/${m.id}`, body);
        toast('Method saved');
        navigate(`/methods/${m.id}`);
      }
    });
    return undefined;
  });
}
