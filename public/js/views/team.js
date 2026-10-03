import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { state, can, shipped, roleLabel } from '../core/state.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/nav.js';
import {
  pageHead, card, kv, mountTable, searchBox, statusBadge, fmtDate, fmtDateTime, relTime, emptyState, field, openForm, toast, avatar, badge,
  promptReason, showError, debounce, dueChip, todayIso, daysUntil, tabs,
} from '../core/ui.js';

const ROLE_TONE = { admin: 'gray', manager: 'violet', qa: 'teal', scientist: 'blue', analyst: 'green', business: 'amber' };
const roleBadge = (r) => badge(roleLabel(r), ROLE_TONE[r], { dot: false });

async function reloadLookups() {
  state.lookups = await api.get('/api/lookups');
}

const userFields = (u = {}) => html`
  ${field({ label: 'Full name', name: 'full_name', value: u.full_name, required: true })}
  ${u.id ? '' : field({ label: 'Username', name: 'username', required: true, hint: 'Letters, numbers, dots — e.g. jane.doe', attrs: 'autocapitalize="off" spellcheck="false"' })}
  ${field({ label: 'Role', name: 'role', type: 'select', required: true, value: u.role || 'analyst', options: Object.entries(state.lookups.roles).map(([k, r]) => [k, `${r.label} — ${r.description}`]), span: u.id ? 1 : 2 })}
  ${field({ label: 'Job title', name: 'title', value: u.title, placeholder: 'e.g. Analyst II' })}
  ${field({ label: 'Email', name: 'email', type: 'email', value: u.email })}
  ${field({ label: 'Initials', name: 'initials', value: u.initials, hint: 'Used on worksheets and labels' })}
  ${u.id ? '' : field({ label: 'Temporary password', name: 'password', type: 'password', required: true, hint: 'They must change it at first sign-in', attrs: 'autocomplete="new-password"' })}`;

export async function newUser() {
  const id = await openForm({ title: 'Add team member', size: 'lg', submitLabel: 'Create account', body: userFields(), onSubmit: async (d) => (await api.post('/api/users', d)).id });
  if (id) { await reloadLookups(); toast('Account created'); navigate(`/team/${id}`); }
}

export async function list(ctx) {
  ctx.title('Team');
  const users = await api.get('/api/users');
  const open = await api.get('/api/tests', { scope: 'open' });
  const openBy = (id) => open.filter((t) => t.analyst_id === id && ['Pending', 'In Progress'].includes(t.status)).length;
  ctx.el.innerHTML = String(html`
    ${pageHead({
      title: 'Team & training',
      sub: `${users.filter((u) => u.active).length} active people. Roles decide what each person can do; training decides which methods they can run.`,
      actions: html`${can('users.manage') ? html`<button class="btn primary" data-act="new">${icon('plus', { size: 15 })}Add team member</button>` : ''}`,
    })}
    ${tabs([{ key: 'people', label: 'People', href: '/team' }, { key: 'training', label: 'Training matrix', href: '/team/training' }], 'people')}
    <div class="toolbar"><span class="spacer"></span>${searchBox('Filter people…')}</div>
    <div class="card"><div data-table></div></div>`);
  const table = mountTable(ctx.el.querySelector('[data-table]'), {
    rows: users.map((u) => ({ ...u, open: openBy(u.id) })),
    rowHref: (r) => `/team/${r.id}`,
    sort: { key: 'full_name', dir: 1 },
    searchText: (r) => `${r.full_name} ${r.username} ${r.title} ${r.role} ${roleLabel(r.role)} ${r.email}`,
    columns: [
      { key: 'full_name', label: 'Name', sort: true, render: (r) => html`<span class="person">${avatar(r.full_name, r.id, { initials: r.initials, size: 30 })}<span><strong>${r.full_name}</strong><span class="sub-line">${r.title || ''}</span></span></span>` },
      { key: 'username', label: 'Username', sort: true, render: (r) => html`<span class="mono small">${r.username}</span>` },
      { key: 'role', label: 'Role', sort: true, render: (r) => roleBadge(r.role) },
      { key: 'open', label: 'Open tests', sort: true, align: 'right', render: (r) => (['analyst', 'scientist', 'manager'].includes(r.role) ? html`<span class="num">${r.open}</span>` : '') },
      { key: 'last_login_at', label: 'Last sign-in', sort: true, render: (r) => html`<span class="muted nowrap">${relTime(r.last_login_at)}</span>` },
      { key: 'active', label: 'Status', sort: true, render: (r) => (r.active ? badge('Active', 'green') : badge('Deactivated', 'gray')) },
    ],
  });
  const f = ctx.el.querySelector('[data-filter]');
  f.addEventListener('input', debounce(() => table.filter(f.value), 120));
  ctx.el.querySelector('[data-act=new]')?.addEventListener('click', newUser);
}

export async function detail(ctx) {
  const d = await api.get(`/api/users/${ctx.params.id}`);
  const u = d.user;
  ctx.title(u.full_name);
  const admin = can('users.manage');
  const manageQ = can('qualifications.manage');
  ctx.el.innerHTML = String(html`
    ${pageHead({
      back: { href: '/team', label: 'Team' },
      title: html`<span class="row">${avatar(u.full_name, u.id, { initials: u.initials, size: 36 })}${u.full_name}</span>`,
      badges: html`${roleBadge(u.role)}${u.active ? '' : badge('Deactivated', 'gray')}${u.locked_until && u.locked_until > new Date().toISOString() ? badge('Locked', 'red') : ''}`,
      meta: html`<span>${u.title || ''}</span><span class="mono">${u.username}</span>${u.email ? html`<span><a href="mailto:${u.email}">${u.email}</a></span>` : ''}<span>Last sign-in ${relTime(u.last_login_at)}</span>`,
      actions: html`
        ${manageQ ? html`<button class="btn primary" data-act="qualify">${icon('training', { size: 15 })}Record training</button>` : ''}
        ${admin ? html`<button class="btn" data-act="edit">${icon('edit', { size: 15 })}Edit</button><button class="btn" data-act="reset">${icon('lock', { size: 15 })}Reset password</button>` : ''}
        ${admin && u.id !== state.me.id ? html`<button class="btn" data-act="toggle">${u.active ? 'Deactivate' : 'Reactivate'}</button>` : ''}`,
    })}
    <div class="kpis">
      <div class="kpi"><div class="k-label">Tests approved (90 days)</div><div class="k-value">${d.stats.approved_90d}</div></div>
      <div class="kpi"><div class="k-label">Reviews & approvals signed (90 days)</div><div class="k-value">${d.stats.reviews_90d}</div></div>
      ${shipped('samples') ? html`<div class="kpi"><div class="k-label">Open tests</div><div class="k-value">${d.openTests.length}</div></div>` : ''}
      ${shipped('notebook') ? html`<div class="kpi"><div class="k-label">Notebook entries</div><div class="k-value">${d.stats.notebook_entries}</div></div>` : ''}
    </div>
    <div class="split">
      <div class="stack">
        ${card({
          title: 'Method qualifications',
          sub: 'Only qualified people can be assigned tests on a method.',
          flush: true,
          body: d.qualifications.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Method</th><th>Qualified</th><th>Trained by</th><th>Expires</th><th>Status</th>${manageQ ? html`<th></th>` : ''}</tr></thead><tbody>${d.qualifications.map((q) => {
            const expired = q.expires_at && q.expires_at < todayIso();
            return html`<tr class="${q.revoked ? '' : expired ? 'row-fail' : q.expires_at && daysUntil(q.expires_at) <= 30 ? 'row-warn' : ''}">
              <td><span class="code">${q.method_code}</span><span class="sub-line">${q.method_title || ''}</span></td>
              <td class="nowrap">${fmtDate(q.qualified_at)}</td><td>${q.trained_by_name || '—'}</td>
              <td>${q.expires_at ? dueChip(q.expires_at) : html`<span class="muted">No expiry</span>`}</td>
              <td>${q.revoked ? badge('Revoked', 'gray') : expired ? badge('Expired', 'red') : badge('Qualified', 'green')}</td>
              ${manageQ ? html`<td class="right nowrap">${q.revoked || expired ? html`<button class="btn sm" data-renew="${q.method_code}">Re-qualify</button>` : html`<button class="btn sm ghost" data-revoke="${q.id}" data-code="${q.method_code}">Revoke</button>`}</td>` : ''}
            </tr>`;
          })}</tbody></table></div>` : emptyState({ icon: 'training', title: 'No qualifications recorded', text: 'Record training so this person can be assigned tests.' }),
        })}
        ${shipped('samples') && d.openTests.length ? card({ title: 'Open tests', flush: true, body: html`<div class="table-wrap"><table class="table compact"><tbody>${d.openTests.map((t) => html`<tr class="link" data-href="/tests/${t.id}"><td><a class="code" href="/tests/${t.id}">${t.code}</a></td><td>${t.method_code}<span class="sub-line">${t.method_title}</span></td><td class="code">${t.sample_code}</td><td>${statusBadge(t.status)}</td><td>${dueChip(t.due_date)}</td></tr>`)}</tbody></table></div>` }) : ''}
      </div>
      <div class="stack">
        ${card({ title: 'Account', body: kv([
          ['Role', html`${roleLabel(u.role)}<div class="muted small">${state.lookups.roles[u.role]?.description}</div>`], ['Username', u.username], ['Email', u.email], ['Initials', u.initials],
          ['Created', fmtDate(u.created_at)], ['Last sign-in', fmtDateTime(u.last_login_at)], ['Password changed', fmtDate(u.password_changed_at)],
          u.must_change_password && ['Note', 'Must choose a new password at next sign-in'],
        ]) })}
      </div>
    </div>`);
  ctx.el.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) navigate(el.dataset.href); }));

  ctx.el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const renew = e.target.closest('[data-renew]')?.dataset.renew;
    if (act === 'qualify' || renew) {
      const { methods } = await api.get('/api/qualifications');
      const ok = await openForm({
        title: `Record training · ${u.full_name}`,
        body: html`
          ${field({ label: 'Method', name: 'method_code', type: 'select', required: true, span: 2, value: renew, options: methods.map((m) => [m.code, `${m.code} — ${m.title}`]), empty: 'Choose…' })}
          ${field({ label: 'Qualified on', name: 'qualified_at', type: 'date', value: todayIso() })}
          ${field({ label: 'Expires (optional)', name: 'expires_at', type: 'date', hint: 'e.g. annual requalification' })}
          ${field({ label: 'Evidence / notes', name: 'notes', type: 'textarea', rows: 2, span: 2, placeholder: 'e.g. Read & understood SOP rev. 4; 3 supervised runs passed (T-2026-00412…)' })}`,
        onSubmit: (dd) => api.post('/api/qualifications', { ...dd, user_id: u.id }),
      });
      if (ok) { toast('Training recorded'); ctx.refresh(); }
    }
    const rv = e.target.closest('[data-revoke]');
    if (rv) {
      const reason = await promptReason(`Why is ${u.full_name} no longer qualified on ${rv.dataset.code}?`);
      if (!reason) return;
      try { await api.post(`/api/qualifications/${rv.dataset.revoke}/revoke`, { reason }); toast('Qualification revoked'); ctx.refresh(); } catch (err) { showError(err); }
    }
    if (act === 'edit') {
      const ok = await openForm({ title: `Edit ${u.full_name}`, size: 'lg', body: userFields(u), onSubmit: (dd) => api.put(`/api/users/${u.id}`, dd) });
      if (ok) { await reloadLookups(); toast('Account updated'); ctx.refresh(); }
    }
    if (act === 'reset') {
      const ok = await openForm({
        title: `Reset password · ${u.full_name}`,
        size: 'sm',
        submitLabel: 'Reset password',
        body: html`<p class="span-2 muted">Give them this temporary password in person. They must change it when they next sign in. Any lock-out is cleared.</p>${field({ label: 'Temporary password', name: 'password', type: 'password', required: true, span: 2, attrs: 'autocomplete="new-password"' })}`,
        onSubmit: (dd) => api.post(`/api/users/${u.id}/reset-password`, dd),
      });
      if (ok) toast('Password reset');
    }
    if (act === 'toggle') {
      try { await api.put(`/api/users/${u.id}`, { active: !u.active }); await reloadLookups(); toast(u.active ? 'Account deactivated — the person is signed out everywhere' : 'Account reactivated'); ctx.refresh(); } catch (err) { showError(err); }
    }
  });
}

export async function training(ctx) {
  ctx.title('Training matrix');
  const d = await api.get('/api/qualifications');
  const manage = can('qualifications.manage');
  const q = new Map(d.qualifications.map((x) => [`${x.user_id}|${x.method_code}`, x]));
  const today = todayIso();
  const coverage = (code) => d.users.filter((u) => {
    const x = q.get(`${u.id}|${code}`);
    return x && (!x.expires_at || x.expires_at >= today);
  }).length;

  ctx.el.innerHTML = String(html`
    ${pageHead({ title: 'Team & training', sub: 'Who is qualified to run which method. Methods with fewer than two qualified people are a key-person risk.' })}
    ${tabs([{ key: 'people', label: 'People', href: '/team' }, { key: 'training', label: 'Training matrix', href: '/team/training' }], 'training')}
    ${card({
      flush: true,
      body: html`<div class="table-wrap" style="max-height:calc(100vh - 260px)"><table class="matrix">
        <thead><tr><th style="text-align:left;vertical-align:bottom;min-width:200px">${manage ? html`<span class="muted small" style="font-weight:400">Click a cell to grant or revoke</span>` : ''}</th>${d.methods.map((m) => html`<th class="m" title="${m.title}">${m.code}</th>`)}</tr></thead>
        <tbody>
          ${d.users.map((u) => html`<tr><th>${avatar(u.full_name, u.id, { initials: u.initials, size: 22 })} <a href="/team/${u.id}">${u.full_name}</a> <span class="muted small">${u.title || ''}</span></th>
            ${d.methods.map((m) => {
              const x = q.get(`${u.id}|${m.code}`);
              const expired = x?.expires_at && x.expires_at < today;
              const soon = x?.expires_at && !expired && daysUntil(x.expires_at) <= 30;
              return html`<td class="cell"><button class="q ${x && !expired ? (soon ? 'exp' : 'on') : expired ? 'exp' : ''}" data-u="${u.id}" data-m="${m.code}" ${x ? raw(`data-q="${x.id}"`) : ''} ${manage ? '' : raw('disabled')} title="${u.full_name} · ${m.code}${x ? ` · since ${x.qualified_at}${x.expires_at ? ` · expires ${x.expires_at}` : ''}` : ' · not qualified'}" aria-label="${u.full_name} ${m.code} ${x && !expired ? 'qualified' : 'not qualified'}">${x && !expired ? icon('check', { size: 14 }) : expired ? icon('clock', { size: 13 }) : ''}</button></td>`;
            })}</tr>`)}
          <tr><th class="muted small">Qualified people</th>${d.methods.map((m) => { const c = coverage(m.code); return html`<td class="cell num ${c < 2 ? 'bad-text' : 'muted'}" style="font-weight:600">${c}</td>`; })}</tr>
        </tbody></table></div>`,
    })}
    <p class="muted small" style="margin-top:10px">${icon('check', { size: 12 })} qualified · ${icon('clock', { size: 12 })} expired or expiring within 30 days</p>`);

  if (!manage) return;
  ctx.el.querySelector('.matrix').addEventListener('click', async (e) => {
    const b = e.target.closest('button.q');
    if (!b) return;
    const u = d.users.find((x) => x.id === Number(b.dataset.u));
    const existing = b.dataset.q ? q.get(`${u.id}|${b.dataset.m}`) : null;
    const active = existing && (!existing.expires_at || existing.expires_at >= today);
    if (active) {
      const reason = await promptReason(`Revoke ${u.full_name}'s qualification on ${b.dataset.m}?`);
      if (!reason) return;
      try { await api.post(`/api/qualifications/${existing.id}/revoke`, { reason }); toast('Qualification revoked'); ctx.refresh(); } catch (err) { showError(err); }
    } else {
      const ok = await openForm({
        title: `Qualify ${u.full_name} on ${b.dataset.m}`,
        body: html`
          ${field({ label: 'Qualified on', name: 'qualified_at', type: 'date', value: todayIso() })}
          ${field({ label: 'Expires (optional)', name: 'expires_at', type: 'date' })}
          ${field({ label: 'Evidence / notes', name: 'notes', type: 'textarea', rows: 2, span: 2, placeholder: 'Read & understood SOP; supervised runs…' })}`,
        onSubmit: (dd) => api.post('/api/qualifications', { ...dd, user_id: u.id, method_code: b.dataset.m }),
      });
      if (ok) { toast('Training recorded'); ctx.refresh(); }
    }
  });
}
