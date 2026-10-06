// Client portal — staff side. Conversations with client contacts, incoming sample submissions,
// method development / validation requests and the client portal accounts themselves.
import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can, activeUsers } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate, setQuery, refreshNav } from '../core/nav.js';
import {
  pageHead, card, kv, mountTable, searchBox, segmented, badge, fmtDate, fmtDateTime, relTime, emptyState, field, openForm, openModal,
  confirmDialog, toast, busy, debounce, plural, localDateTimeValue,
} from '../core/ui.js';
import { stepper } from '../core/components.js';

const SUB_TONE = { Submitted: 'blue', Acknowledged: 'teal', Received: 'green', Declined: 'red', Withdrawn: 'gray' };
const REQ_TONE = { Submitted: 'blue', 'Under review': 'amber', 'Proposal sent': 'violet', Accepted: 'green', Declined: 'red' };
const REQUEST_STATUSES = ['Submitted', 'Under review', 'Proposal sent', 'Accepted', 'Declined'];
// Each status a request can move to, after the rule that offers the move.
const REQUEST_MOVES = [['review', 'Under review'], ['propose', 'Proposal sent'], ['accept', 'Accepted'], ['decline', 'Declined']];

// Conversation bubbles are specific to this view; the design system has no chat component.
function ensureStyles() {
  if (document.getElementById('portal-inbox-css')) return;
  const s = document.createElement('style');
  s.id = 'portal-inbox-css';
  s.textContent = `
    .pi-split { display: grid; gap: var(--gap, 12px); grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); align-items: start; }
    .pi-split > .card, .pi-split > div > .card { margin: 0; }
    .pi-back { display: none; }
    @media (max-width: 900px) {
      .pi-split { grid-template-columns: minmax(0, 1fr); }
      .pi-split.has-open > .pi-list { display: none; }
      .pi-split.has-open .pi-back { display: inline-flex; margin-bottom: 8px; }
    }
    .pi-threads > li { align-items: flex-start; }
    .pi-threads > li.active { background: var(--accent-soft); }
    .pi-threads a { color: inherit; text-decoration: none; display: flex; gap: 10px; width: 100%; min-width: 0; }
    .pi-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; margin-top: 6px; }
    .pi-msgs { display: flex; flex-direction: column; gap: 10px; max-height: 56vh; overflow-y: auto; padding: 4px 2px; }
    .pi-msg { max-width: 80%; }
    .pi-msg .pi-meta { font-size: 11.5px; color: var(--text-3); margin-bottom: 3px; }
    .pi-msg .pi-body { padding: 8px 11px; border-radius: 10px; background: var(--surface-3); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
    .pi-msg.lab { align-self: flex-end; }
    .pi-msg.lab .pi-meta { text-align: right; }
    .pi-msg.lab .pi-body { background: var(--accent-soft); color: var(--text); }
    .pi-msg.system { align-self: center; max-width: 92%; text-align: center; }
    .pi-msg.system .pi-body { background: none; color: var(--text-3); font-size: var(--fs-sm, 12px); padding: 0 6px; }
    .pi-msg.system .pi-meta { display: none; }
    .pi-reply { display: flex; gap: 8px; align-items: flex-end; margin-top: 12px; }
    .pi-reply textarea { flex: 1; min-height: 60px; }
    .pi-secret { font-family: var(--mono); font-size: 18px; letter-spacing: .04em; padding: 10px 12px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm, 6px); background: var(--surface-2); user-select: all; text-align: center; }
  `;
  document.head.append(s);
}

function tabsBar(active, summary) {
  return segmented([
    { key: 'messages', label: 'Messages', href: '/portal-inbox', count: summary.unread || null },
    { key: 'submissions', label: 'Sample submissions', href: '/portal-inbox?tab=submissions', count: summary.submissions || null },
    { key: 'requests', label: 'Method requests', href: '/portal-inbox?tab=requests', count: summary.requests || null },
    { key: 'accounts', label: 'Portal accounts', href: '/portal-inbox?tab=accounts' },
  ], active);
}

const portalUrl = () => `${location.origin}/portal/`;

export async function render(ctx) {
  ensureStyles();
  ctx.title('Client portal');
  const tab = ctx.query.tab || 'messages';
  const summary = await api.get('/api/portal-admin/summary');
  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Client portal',
      sub: html`Messages, sample submissions and method requests from clients. Clients sign in at <a href="${portalUrl()}" target="_blank" rel="noopener">${portalUrl()}</a>`,
      actions: tab === 'messages' && can('portal.respond') ? html`<button class="btn primary" data-act="new-thread">${icon('plus', { size: 15 })}Message a client</button>`
        : tab === 'accounts' && can('portal.manage') ? html`<button class="btn primary" data-act="invite">${icon('plus', { size: 15 })}Invite contact</button>` : '',
    })}
    <div class="toolbar">${tabsBar(tab, summary)}<span class="spacer"></span><span data-tools></span></div>
    <div data-body></div>`);
  const body = ctx.el.querySelector('[data-body]');
  const tools = ctx.el.querySelector('[data-tools]');
  if (tab === 'submissions') await submissionsTab(ctx, body, tools);
  else if (tab === 'requests') await requestsTab(ctx, body, tools);
  else if (tab === 'accounts') await accountsTab(ctx, body, tools);
  else await messagesTab(ctx, body, tools);
  ctx.el.querySelector('[data-act=new-thread]')?.addEventListener('click', () => newThread());
  ctx.el.querySelector('[data-act=invite]')?.addEventListener('click', () => invite(ctx));
}

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

const msgList = (messages) => html`<div class="pi-msgs" data-msgs>${messages.length ? messages.map((m) => html`
  <div class="pi-msg ${m.side}"><div class="pi-meta">${m.author_name}${m.side === 'client' ? ' (client)' : ''} · ${fmtDateTime(m.created_at)}</div><div class="pi-body">${m.body}</div></div>`) : html`<p class="muted small">No messages yet.</p>`}</div>`;

async function messagesTab(ctx, body, tools) {
  const unreadOnly = ctx.query.unread === '1';
  const threads = await api.get('/api/portal-admin/threads', { unread: unreadOnly ? 1 : '' });
  const openId = Number(ctx.query.thread) || null;
  const t = openId ? await api.get(`/api/portal-admin/threads/${openId}`) : null;
  if (t) refreshNav();
  tools.innerHTML = String(segmented([
    { key: 'all', label: 'All', href: setQuery({ unread: null }) },
    { key: 'unread', label: 'Unread', href: setQuery({ unread: '1' }) },
  ], unreadOnly ? 'unread' : 'all'));
  const linkFor = (th) => (th.submission_id ? html`<a class="code" href="/portal-inbox/submissions/${th.submission_id}">${th.submission_code}</a>`
    : th.request_id ? html`<a class="code" href="/portal-inbox/requests/${th.request_id}">${th.request_code}</a>`
      : th.sample_id ? html`<a href="/samples/${th.sample_id}" class="code">${th.sample_code}</a>` : '');
  body.innerHTML = String(html`<div class="pi-split ${t ? 'has-open' : ''}">
    <section class="card pi-list">
      ${threads.length ? html`<ul class="list pi-threads">${threads.map((x) => html`<li class="${x.id === openId ? 'active' : ''}"><a href="${setQuery({ thread: x.id })}">
        ${x.unread && x.id !== openId ? html`<span class="pi-dot" title="Unread"></span>` : ''}
        <span class="grow"><span class="title" style="display:block">${x.subject}</span><span class="meta" style="display:block">${x.client_name} · ${relTime(x.last_message_at)}</span><span class="meta" style="display:block">${x.last_author}: ${x.excerpt}</span></span>
      </a></li>`)}</ul>` : emptyState({ icon: 'inbox', title: unreadOnly ? 'All caught up' : 'No conversations yet', text: 'Messages from client contacts appear here.' })}
    </section>
    ${t ? html`<div><a class="btn sm ghost pi-back" href="${setQuery({ thread: null })}">${icon('chevronLeft', { size: 14 })}All conversations</a>${card({
      title: t.thread.subject,
      sub: html`${t.thread.client_name} · started ${fmtDate(t.thread.created_at)} ${linkFor(t.thread)}`,
      body: html`${msgList(t.messages)}
        ${can('portal.respond') ? html`<form class="pi-reply" data-reply><textarea name="body" placeholder="Reply to ${t.thread.client_name}…" required aria-label="Reply"></textarea><button class="btn primary" type="submit">${icon('send', { size: 14 })}Send</button></form>
        <p class="muted small" style="margin-top:6px">The client sees your name. Replies are plain text and are kept permanently.</p>` : ''}`,
    })}</div>` : card({ body: emptyState({ icon: 'inbox', title: 'Select a conversation', text: 'Pick a thread on the left to read and reply.' }) })}
  </div>`);
  const msgs = body.querySelector('[data-msgs]');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
  const form = body.querySelector('[data-reply]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = form.body.value.trim();
    if (!text) return;
    await busy(form.querySelector('button'), async () => {
      await api.post(`/api/portal-admin/threads/${openId}/messages`, { body: text });
      toast('Reply sent');
      ctx.refresh();
    });
  });
  form?.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
}

async function newThread(prefill = {}) {
  const clients = await api.get('/api/clients');
  const id = await openForm({
    title: 'Message a client',
    size: 'lg',
    submitLabel: 'Send',
    body: html`
      ${field({ label: 'Client', name: 'client_id', type: 'select', options: clients.filter((c) => c.active).map((c) => [c.id, c.name]), value: prefill.client_id, required: true, empty: 'Select…' })}
      ${field({ label: 'Subject', name: 'subject', required: true, value: prefill.subject })}
      ${field({ label: 'Message', name: 'body', type: 'textarea', rows: 6, required: true, span: 2, hint: 'Visible to every portal contact of this client.' })}`,
    onSubmit: async (d) => (await api.post('/api/portal-admin/threads', d)).id,
  });
  if (id) navigate(`/portal-inbox?thread=${id}`);
}

// ---------------------------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------------------------

async function submissionsTab(ctx, body, tools) {
  const status = ctx.query.status || 'open';
  const rows = await api.get('/api/portal-admin/submissions', { status });
  tools.innerHTML = String(html`${segmented([
    { key: 'open', label: 'Open', href: setQuery({ status: null }) },
    { key: 'Received', label: 'Received', href: setQuery({ status: 'Received' }) },
    { key: 'all', label: 'All', href: setQuery({ status: 'all' }) },
  ], status)} ${searchBox('Filter…')}`);
  body.innerHTML = '<div class="card"><div data-table></div></div>';
  const table = mountTable(body.querySelector('[data-table]'), {
    rows,
    rowHref: (r) => `/portal-inbox/submissions/${r.id}`,
    searchText: (r) => `${r.code} ${r.client_name} ${r.submitted_by} ${r.courier} ${r.tracking_no}`,
    empty: emptyState({ icon: 'package', title: status === 'open' ? 'No submissions waiting' : 'Nothing here', text: 'Clients announce shipments from the portal; acknowledge them here and receive them when the parcel arrives.' }),
    columns: [
      { key: 'code', label: 'Ref', sort: (r) => r.id, render: (r) => html`<a class="code" href="/portal-inbox/submissions/${r.id}">${r.code}</a>` },
      { key: 'client_name', label: 'Client', sort: true, cls: 'title-cell', render: (r) => html`<strong>${r.client_name}</strong><span class="sub-line">${r.submitted_by || ''}</span>` },
      { key: 'sample_count', label: 'Samples', sort: true, render: (r) => html`${plural(r.sample_count, 'sample')}${r.method_count ? html`<span class="sub-line">${plural(r.method_count, 'test')}</span>` : ''}` },
      { key: 'priority', label: 'Priority', sort: true, render: (r) => badge(r.priority) },
      { key: 'courier', label: 'Shipping', render: (r) => html`${r.courier || '—'}${r.tracking_no ? html`<span class="sub-line mono">${r.tracking_no}</span>` : ''}` },
      { key: 'created_at', label: 'Submitted', sort: true, render: (r) => html`<span class="nowrap" title="${fmtDateTime(r.created_at)}">${relTime(r.created_at)}</span>` },
      { key: 'status', label: 'Status', sort: true, render: (r) => badge(r.status, SUB_TONE[r.status]) },
    ],
  });
  const f = tools.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
}

export async function submission(ctx) {
  ensureStyles();
  const d = await api.get(`/api/portal-admin/submissions/${ctx.params.id}`);
  const { submission: s, thread_id, projects } = d;
  const thread = thread_id ? await api.get(`/api/portal-admin/threads/${thread_id}`) : null;
  ctx.title(s.code);
  const stopped = ['Declined', 'Withdrawn'].includes(s.status);
  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/portal-inbox?tab=submissions', label: 'Sample submissions' },
      title: html`Submission <span class="code" style="font-size:inherit">${s.code}</span>`,
      badges: html`${badge(s.status, SUB_TONE[s.status])} ${s.priority !== 'Standard' ? badge(s.priority) : ''}`,
      sub: html`${s.client_name} · ${s.submitted_by || 'client'} <span class="muted">(${s.submitted_by_email || ''})</span> · submitted ${fmtDateTime(s.created_at)}`,
      actions: html`
        ${d.can.acknowledge ? html`<button class="btn" data-act="ack">${icon('check', { size: 15 })}Acknowledge</button>` : ''}
        ${d.can.decline ? html`<button class="btn" data-act="decline">Decline</button>` : ''}
        ${d.can.receive ? html`<button class="btn primary" data-act="receive">${icon('tube', { size: 15 })}Receive samples</button>` : ''}`,
    })}
    <div class="card stepper-card">${stepper(['Submitted', 'Acknowledged', 'Received'], stopped ? 'Submitted' : s.status, { stopped: stopped ? s.status : undefined })}</div>
    <div class="split-wide" style="margin-top:var(--gap, 12px)">
      <div class="stack">
        ${card({
          title: `Samples (${s.samples.length})`,
          flush: true,
          body: html`<div class="table-wrap"><table class="table compact"><thead><tr><th>#</th><th>Description</th><th>Batch / lot</th><th>Client ref.</th><th>Quantity</th><th>Container</th></tr></thead>
            <tbody>${s.samples.map((r, i) => html`<tr><td class="muted">${i + 1}</td><td>${r.description}</td><td>${r.batch_no || '—'}</td><td>${r.client_ref || '—'}</td><td>${r.quantity || '—'}</td><td>${r.container || '—'}</td></tr>`)}</tbody></table></div>`,
        })}
        ${thread ? card({
          title: 'Conversation',
          actions: html`<a class="btn sm" href="/portal-inbox?thread=${thread_id}">Open in inbox</a>`,
          body: msgList(thread.messages),
        }) : ''}
      </div>
      <div class="stack">
        ${card({ title: 'Requested tests', body: s.methods.length ? html`<ul class="list">${s.methods.map((m) => html`<li><span class="code">${m.code}</span><span class="grow">${m.title}</span></li>`)}</ul>` : html`<p class="muted">None selected — see notes.</p>` })}
        ${card({
          title: 'Details',
          body: kv([
            ['Project', s.project_code ? html`<a href="/projects/${s.project_id}" class="code">${s.project_code}</a> ${s.project_title}` : null],
            ['Sample type', s.sample_type],
            ['Storage', s.storage],
            ['Courier', s.courier],
            ['Tracking', s.tracking_no ? html`<span class="mono">${s.tracking_no}</span>` : null],
            ['Ship date', s.ship_date ? fmtDate(s.ship_date) : null],
            ['Notes', s.notes ? html`<span style="white-space:pre-wrap">${s.notes}</span>` : null],
            s.acknowledged_at && ['Acknowledged', `${s.acknowledged_by_name} · ${fmtDateTime(s.acknowledged_at)}`],
            s.received_at && ['Received', `${s.received_by_name} · ${fmtDateTime(s.received_at)}`],
            s.received_samples.length && ['Samples created', html`${s.received_samples.map((x, i) => html`${i ? ', ' : ''}<a href="/samples/${x.id}" class="code">${x.code}</a>`)}`],
            s.status_note && ['Note to client', s.status_note],
          ]),
        })}
      </div>
    </div>`);

  const act = (name, fn) => ctx.el.querySelector(`[data-act=${name}]`)?.addEventListener('click', (e) => busy(e.currentTarget, fn));
  act('ack', async () => {
    const ok = await openForm({
      title: `Acknowledge ${s.code}`,
      submitLabel: 'Acknowledge',
      body: field({ label: 'Message to the client (optional)', name: 'note', type: 'textarea', rows: 3, span: 2, placeholder: 'e.g. Slot booked for receipt on Tuesday morning.' }),
      onSubmit: (d) => api.post(`/api/portal-admin/submissions/${s.id}/acknowledge`, d),
    });
    if (ok) { toast('Submission acknowledged — the client has been notified'); refreshNav(); ctx.refresh(); }
  });
  act('decline', async () => {
    const ok = await openForm({
      title: `Decline ${s.code}`,
      submitLabel: 'Decline submission',
      danger: true,
      body: field({ label: 'Reason (shown to the client)', name: 'reason', type: 'textarea', rows: 3, span: 2, required: true }),
      onSubmit: (d) => api.post(`/api/portal-admin/submissions/${s.id}/decline`, d),
    });
    if (ok) { toast('Submission declined'); refreshNav(); ctx.refresh(); }
  });
  act('receive', async () => {
    const L = state.lookups;
    const methods = await api.get('/api/methods', { usable: 1 });
    const usable = methods.filter((m) => !m.client_id || m.client_id === s.client_id);
    const res = await openForm({
      title: `Receive ${plural(s.samples.length, 'sample')} from ${s.code}`,
      size: 'lg',
      submitLabel: 'Receive & create samples',
      body: html`
        ${field({ label: 'Received at', name: 'received_at', type: 'datetime-local', value: localDateTimeValue(), required: true })}
        ${field({ label: 'Condition on receipt', name: 'condition', type: 'select', options: L.receiptConditions, value: 'Acceptable' })}
        ${field({ label: 'Storage', name: 'storage', type: 'select', options: L.storageConditions, value: s.storage, empty: 'Select…' })}
        ${field({ label: 'Location', name: 'location', placeholder: 'e.g. Sample store A · Shelf 2' })}
        ${field({ label: 'Project', name: 'project_id', type: 'select', options: projects.map((p) => [p.id, `${p.code} — ${p.title}`]), value: s.project_id, empty: 'No project' })}
        ${field({ label: 'Due date', name: 'due_date', type: 'date', hint: 'Default: from method turnaround times' })}
        <div class="field span-2"><span class="label">Tests to assign</span>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 16px;max-height:220px;overflow:auto">
            ${usable.map((m) => html`<label class="check"><input type="checkbox" name="method_ids" value="${m.id}" ${s.method_ids.includes(m.id) ? raw('checked') : ''}><span><span class="code">${m.code}</span> ${m.title}</span></label>`)}
          </div></div>
        ${field({ label: 'Receipt notes', name: 'notes', type: 'textarea', rows: 2, span: 2 })}`,
      onSubmit: (d) => api.post(`/api/portal-admin/submissions/${s.id}/receive`, {
        ...d, received_at: d.received_at ? new Date(d.received_at).toISOString() : null, project_id: d.project_id ? Number(d.project_id) : null,
        storage: d.storage || null, due_date: d.due_date || null, method_ids: (d.method_ids || []).map(Number),
      }),
    });
    if (res) { toast(`Received as ${res.samples.map((x) => x.code).join(', ')}`); refreshNav(); ctx.refresh(); }
  });
}

// ---------------------------------------------------------------------------------------------
// Method requests
// ---------------------------------------------------------------------------------------------

async function requestsTab(ctx, body, tools) {
  const status = ctx.query.status || 'open';
  const rows = await api.get('/api/portal-admin/requests', { status });
  tools.innerHTML = String(html`${segmented([
    { key: 'open', label: 'Open', href: setQuery({ status: null }) },
    { key: 'Accepted', label: 'Accepted', href: setQuery({ status: 'Accepted' }) },
    { key: 'all', label: 'All', href: setQuery({ status: 'all' }) },
  ], status)} ${searchBox('Filter…')}`);
  body.innerHTML = '<div class="card"><div data-table></div></div>';
  const table = mountTable(body.querySelector('[data-table]'), {
    rows,
    rowHref: (r) => `/portal-inbox/requests/${r.id}`,
    searchText: (r) => `${r.code} ${r.title} ${r.client_name} ${r.product} ${r.technique} ${r.type}`,
    empty: emptyState({ icon: 'method', title: status === 'open' ? 'No open requests' : 'Nothing here', text: 'Method development, validation and transfer requests from clients.' }),
    columns: [
      { key: 'code', label: 'Ref', sort: (r) => r.id, render: (r) => html`<a class="code" href="/portal-inbox/requests/${r.id}">${r.code}</a>` },
      { key: 'title', label: 'Request', sort: true, cls: 'title-cell', render: (r) => html`<strong>${r.title}</strong><span class="sub-line">${r.type}${r.technique ? ` · ${r.technique}` : ''}</span>` },
      { key: 'client_name', label: 'Client', sort: true, render: (r) => html`${r.client_name}<span class="sub-line">${r.submitted_by || ''}</span>` },
      { key: 'target_date', label: 'Target', sort: true, render: (r) => html`<span class="nowrap">${fmtDate(r.target_date)}</span>` },
      { key: 'project_code', label: 'Project', render: (r) => (r.project_code ? html`<a href="/projects/${r.project_id}" class="code">${r.project_code}</a>` : '') },
      { key: 'status', label: 'Status', sort: (r) => REQUEST_STATUSES.indexOf(r.status), render: (r) => badge(r.status, REQ_TONE[r.status]) },
    ],
  });
  const f = tools.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
}

export async function request(ctx) {
  ensureStyles();
  const d = await api.get(`/api/portal-admin/requests/${ctx.params.id}`);
  const { request: q, thread_id } = d;
  const thread = thread_id ? await api.get(`/api/portal-admin/threads/${thread_id}`) : null;
  ctx.title(q.code);
  const moves = REQUEST_MOVES.filter(([action]) => d.can[action]).map(([, status]) => status);
  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/portal-inbox?tab=requests', label: 'Method requests' },
      title: q.title,
      badges: badge(q.status, REQ_TONE[q.status]),
      sub: html`<span class="code">${q.code}</span> · ${q.type} · ${q.client_name} · ${q.submitted_by || ''} · ${fmtDateTime(q.created_at)}`,
      actions: html`
        ${d.can.reply || moves.length ? html`<button class="btn" data-act="respond">${icon('send', { size: 15 })}Respond / update status</button>` : ''}
        ${d.can.openProject ? html`<button class="btn primary" data-act="project">${icon('folder', { size: 15 })}Open project</button>` : ''}`,
    })}
    <div class="card stepper-card">${stepper(['Submitted', 'Under review', 'Proposal sent', q.status === 'Declined' ? 'Declined' : 'Accepted'], q.status, { stopped: q.status === 'Declined' ? 'Declined' : undefined })}</div>
    <div class="split-wide" style="margin-top:var(--gap, 12px)">
      <div class="stack">
        ${card({ title: 'Scope and background', body: q.scope ? html`<div style="white-space:pre-wrap">${q.scope}</div>` : html`<p class="muted">Not given.</p>` })}
        ${thread ? card({ title: 'Conversation', actions: html`<a class="btn sm" href="/portal-inbox?thread=${thread_id}">Reply in inbox</a>`, body: msgList(thread.messages) }) : ''}
      </div>
      <div class="stack">
        ${card({
          title: 'Request',
          body: kv([
            ['Type', q.type],
            ['Product', q.product],
            ['Technique', q.technique || 'No preference'],
            ['Regulatory', q.regulatory],
            ['Target date', q.target_date ? fmtDate(q.target_date) : null],
            ['Contact', q.submitted_by ? html`${q.submitted_by}<br><span class="muted small">${q.submitted_by_email}</span>` : null],
            ['Project', q.project_code ? html`<a href="/projects/${q.project_id}" class="code">${q.project_code}</a> ${q.project_title}` : null],
            q.responded_at && ['Last response', `${q.responded_by_name} · ${fmtDateTime(q.responded_at)}`],
          ]),
        })}
        ${q.parameters.length ? card({ title: 'ICH Q2(R2) parameters', body: html`<div class="row">${q.parameters.map((p) => badge(p, 'gray', { dot: false }))}</div>` }) : ''}
      </div>
    </div>`);
  const msgs = ctx.el.querySelector('[data-msgs]');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
  ctx.el.querySelector('[data-act=respond]')?.addEventListener('click', async () => {
    const ok = await openForm({
      title: `Respond to ${q.code}`,
      size: 'lg',
      submitLabel: 'Send to client',
      body: html`
        ${field({ label: 'Status', name: 'status', type: 'select', options: moves, empty: d.can.reply ? `No change (${q.status})` : undefined, value: d.can.review ? 'Under review' : '' })}
        <div></div>
        ${field({ label: 'Message to the client', name: 'response', type: 'textarea', rows: 6, span: 2, hint: 'Required for “Proposal sent” and “Declined”. Posted in the request’s conversation.' })}`,
      onSubmit: (d) => api.post(`/api/portal-admin/requests/${q.id}/status`, d),
    });
    if (ok) { toast('Response sent'); refreshNav(); ctx.refresh(); }
  });
  ctx.el.querySelector('[data-act=project]')?.addEventListener('click', async () => {
    const p = await openForm({
      title: 'Open a project for this request',
      submitLabel: 'Create project',
      body: html`
        ${field({ label: 'Project title', name: 'title', value: q.title, required: true, span: 2 })}
        ${field({ label: 'Status', name: 'status', type: 'select', options: state.lookups.projectStartStatuses, value: q.status === 'Accepted' ? 'Active' : 'Quoted' })}
        ${field({ label: 'Project lead', name: 'lead_id', type: 'select', options: activeUsers(['manager', 'scientist']).map((u) => [u.id, u.full_name]), empty: 'Decide later' })}`,
      onSubmit: (d) => api.post(`/api/portal-admin/requests/${q.id}/project`, { ...d, lead_id: d.lead_id ? Number(d.lead_id) : null }),
    });
    if (p) { toast(`Project ${p.code} created`); navigate(`/projects/${p.id}`); }
  });
}

// ---------------------------------------------------------------------------------------------
// Portal accounts
// ---------------------------------------------------------------------------------------------

function showSecret(title, email, password) {
  openModal({
    title,
    size: 'sm',
    body: html`<p>Give these details to <strong>${email}</strong> by phone or a separate channel. The password is shown <strong>only once</strong>; they must choose their own when they first sign in.</p>
      <div class="pi-secret" style="margin-top:12px">${password}</div>
      <p class="muted small" style="margin-top:12px">Sign-in page: ${portalUrl()}</p>`,
    footer: html`<span class="spacer"></span><button class="btn" data-copy>${icon('copy', { size: 14 })}Copy password</button><button class="btn primary" data-close>Done</button>`,
  }).el.querySelector('[data-copy]').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(password); e.currentTarget.textContent = 'Copied'; } catch { toast('Copy failed — select the password and copy it manually', 'error'); }
  });
}

async function invite(ctx, prefill = {}) {
  const clients = await api.get('/api/clients');
  const res = await openForm({
    title: 'Invite a client contact to the portal',
    submitLabel: 'Create account',
    body: html`
      ${field({ label: 'Client', name: 'client_id', type: 'select', options: clients.filter((c) => c.active).map((c) => [c.id, c.name]), value: prefill.client_id, required: true, empty: 'Select…' })}
      ${field({ label: 'Full name', name: 'full_name', required: true })}
      ${field({ label: 'Email (sign-in)', name: 'email', type: 'email', required: true })}
      ${field({ label: 'Job title', name: 'job_title' })}
      <p class="muted small span-2">They will see this client's samples, issued certificates, projects, requests and conversations — nothing else.</p>`,
    onSubmit: (d) => api.post('/api/portal-admin/accounts', { ...d, client_id: Number(d.client_id) }),
  });
  if (res) { showSecret('Account created', res.email, res.temp_password); ctx.refresh(); }
}

async function accountsTab(ctx, body, tools) {
  const rows = await api.get('/api/portal-admin/accounts');
  tools.innerHTML = String(searchBox('Filter…'));
  body.innerHTML = '<div class="card"><div data-table></div></div>';
  const manage = can('portal.manage');
  const table = mountTable(body.querySelector('[data-table]'), {
    rows,
    searchText: (r) => `${r.full_name} ${r.email} ${r.client_name} ${r.job_title}`,
    rowClass: (r) => (r.active ? '' : 'muted'),
    empty: emptyState({ icon: 'users', title: 'No portal accounts yet', text: 'Invite a contact at each client so they can submit samples, download certificates and message the lab.' }),
    columns: [
      { key: 'full_name', label: 'Contact', sort: true, cls: 'title-cell', render: (r) => html`<strong>${r.full_name}</strong><span class="sub-line">${r.email}${r.job_title ? ` · ${r.job_title}` : ''}</span>` },
      { key: 'client_name', label: 'Client', sort: true, render: (r) => html`<a href="/clients/${r.client_id}">${r.client_name}</a>` },
      { key: 'status', label: 'Status', sort: (r) => (r.active ? (r.locked ? 1 : r.must_change_password ? 2 : 0) : 3), render: (r) => (!r.active ? badge('Deactivated', 'gray') : r.locked ? badge('Locked', 'red') : r.must_change_password ? badge('Invited', 'amber') : badge('Active', 'green')) },
      { key: 'last_login_at', label: 'Last sign-in', sort: true, render: (r) => html`<span class="nowrap">${r.last_login_at ? relTime(r.last_login_at) : '—'}</span>` },
      { key: 'created_at', label: 'Created', sort: true, render: (r) => html`<span class="nowrap">${fmtDate(r.created_at)}</span><span class="sub-line">${r.created_by_name || ''}</span>` },
      ...(manage ? [{ key: 'actions', label: '', render: (r) => html`<span class="row nowrap" style="justify-content:flex-end">
        ${r.active ? html`<button class="btn sm" data-reset="${r.id}">Reset password</button><button class="btn sm ghost" data-active="${r.id}" data-on="0">Deactivate</button>` : html`<button class="btn sm" data-active="${r.id}" data-on="1">Reactivate</button>`}
      </span>` }] : []),
    ],
  });
  const f = tools.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
  body.addEventListener('click', async (e) => {
    const reset = e.target.closest('[data-reset]');
    const act = e.target.closest('[data-active]');
    if (reset) {
      const r = rows.find((x) => x.id === Number(reset.dataset.reset));
      if (!await confirmDialog({ title: 'Reset portal password?', message: `${r.full_name} will be signed out everywhere and must use a new temporary password.`, confirmLabel: 'Reset' })) return;
      const res = await busy(reset, () => api.post(`/api/portal-admin/accounts/${r.id}/reset`));
      if (res) { showSecret('Password reset', res.email, res.temp_password); ctx.refresh(); }
    } else if (act) {
      const r = rows.find((x) => x.id === Number(act.dataset.active));
      const on = act.dataset.on === '1';
      if (!on && !await confirmDialog({ title: 'Deactivate portal account?', message: `${r.full_name} will be signed out immediately and can no longer sign in. Their messages and submissions are kept.`, confirmLabel: 'Deactivate', danger: true })) return;
      const ok = await busy(act, () => api.post(`/api/portal-admin/accounts/${r.id}/active`, { active: on }));
      if (ok) { toast(on ? 'Account reactivated' : 'Account deactivated'); ctx.refresh(); }
    }
  });
}
