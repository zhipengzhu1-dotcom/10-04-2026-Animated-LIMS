// Client portal — a small single-page app for the laboratory's customers. Hash routing (#/samples …)
// because the server falls back to the staff app for unknown paths. All text goes through html``, which
// escapes every interpolated value.

import { html, raw } from '/js/core/html.js';
import { icon, LOGO } from '/js/core/icons.js';
import { snapshot, settle } from '/js/core/motion.js';
import { lockFrame, mountLock, lockFlow, lockError, SILHOUETTE, stamp, z } from '/js/core/lock.js';

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

const EXTRA_ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.7A8 8 0 1 1 21 12z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  certificate: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7"/><path d="M14 2v6h6"/><path d="M20 8v3"/><circle cx="17.5" cy="16.5" r="3"/><path d="m16 19-1 3.5 2.5-1 2.5 1-1-3.5"/>',
};
const ic = (name, size = 18) => (EXTRA_ICONS[name]
  ? raw(`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EXTRA_ICONS[name]}</svg>`)
  : icon(name, { size }));

const MARK = (size = 32) => raw(`<svg class="mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect class="sq" width="32" height="32" rx="1"/><path class="ink" d="M12 6.5h8M13.5 6.5v12a2.5 2.5 0 0 0 5 0v-12" fill="none" stroke-width="2.2" stroke-linecap="square"/><path class="fill" d="M13.5 14.5h5v4a2.5 2.5 0 0 1-5 0z"/><rect class="fill" x="14.6" y="24.4" width="2.8" height="2.8"/></svg>`);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(v) {
  if (!v) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v);
  if (Number.isNaN(+d)) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
const fmtTime = (v) => { const d = new Date(v); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtDateTime = (v) => (v ? `${fmtDate(v)}, ${fmtTime(v)}` : '—');
function relTime(v) {
  if (!v) return '';
  const s = (Date.now() - Date.parse(v)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  const d = new Date(v);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return fmtTime(v);
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (s < 6 * 86400) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return fmtDate(v);
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const initials = (name = '') => name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

// Per-browser preferences only (theme, remembered lab name for the splash). Never anything sensitive.
const store = {
  read() { try { return JSON.parse(localStorage.getItem('aq.portal') || '{}') || {}; } catch { return {}; } },
  set(patch) { try { localStorage.setItem('aq.portal', JSON.stringify({ ...this.read(), ...patch })); } catch { /* private mode */ } },
};

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
  store.set({ theme: theme || 'system' });
}

function toast(message) {
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = String(html`${ic('check', 16)}<span>${message}</span>`);
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.list) { (out[el.name] ||= []); if (el.checked) out[el.name].push(el.value); } else out[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; } else out[el.name] = el.value;
  }
  return out;
}

/** Disables a form's buttons while a request runs (labelled `busyText` if given) and shows any error in the form's .form-error slot. */
async function submitting(form, fn, busyText) {
  const btn = $('button[type=submit]', form) || $('.js-submit', form.closest('.card') || form);
  const errBox = $('.form-error', form);
  if (errBox) errBox.innerHTML = '';
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = String(html`<span class="spinner"></span>${busyText || btn.textContent.trim()}`); }
  try {
    return await fn();
  } catch (e) {
    if (e.handled) return undefined;
    if (errBox) {
      errBox.innerHTML = String(html`<div class="alert alert-bad" role="alert">${ic('alert', 16)}<span>${e.message}</span></div>`);
      errBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else toast(e.message);
    return undefined;
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; }
  }
}

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api/portal${path}`, {
      method, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'aliquot', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('We could not reach the laboratory server. Check your connection and try again.');
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status, code: data?.code });
    if (err.code === 'PORTAL_AUTH' && state.me) { state.me = null; showSignIn(err.message); err.handled = true; }
    if (err.code === 'PASSWORD_CHANGE_REQUIRED') { showPasswordChange(); err.handled = true; }
    throw err;
  }
  return data;
}
const post = (path, body = {}) => api(path, { method: 'POST', body });

const state = { info: null, me: null, lookups: null };
const lookups = async () => (state.lookups ||= await api('/lookups'));

// ---------------------------------------------------------------------------------------------
// Splash: hidden as soon as the first screen is ready. If the progress line has appeared (after 150 ms)
// it stays for at least 400 ms so it never flickers.
// ---------------------------------------------------------------------------------------------

let barShownAt = null;
$('.splash-track')?.addEventListener('animationstart', (e) => { if (e.animationName === 'splash-show') barShownAt = performance.now(); });
function hideSplash() {
  const splash = $('#splash');
  if (!splash || splash.classList.contains('is-done')) return;
  const wait = barShownAt == null ? 0 : Math.max(0, barShownAt + 400 - performance.now());
  setTimeout(() => {
    splash.classList.add('is-done');
    setTimeout(() => splash.remove(), 400);
  }, wait);
}

// ---------------------------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------------------------

const SAMPLE_STAGE = { Received: 1, 'In Testing': 2, 'In Review': 3, Approved: 3, Reported: 4 };
const SAMPLE_LABEL = { Received: 'Received', 'In Testing': 'Testing', 'In Review': 'In review', Approved: 'Finalising', Reported: 'Reported', Cancelled: 'Cancelled', Disposed: 'Closed' };
const SAMPLE_TONE = { Received: 'info', 'In Testing': 'accent', 'In Review': 'accent', Approved: 'accent', Reported: 'ok', Cancelled: 'bad', Disposed: '' };
const SUB_TONE = { Submitted: 'info', Acknowledged: 'accent', Received: 'ok', Declined: 'bad', Withdrawn: '' };
const SUB_LABEL = { Submitted: 'Submitted', Acknowledged: 'Expected', Received: 'Received', Declined: 'Declined', Withdrawn: 'Withdrawn' };
const REQ_TONE = { Submitted: 'info', 'Under review': 'accent', 'Proposal sent': 'warn', Accepted: 'ok', Declined: 'bad' };

const pill = (label, tone = '') => html`<span class="pill ${tone}">${label}</span>`;
const samplePill = (s) => pill(SAMPLE_LABEL[s] || s, SAMPLE_TONE[s]);
const progress = (status) => {
  const n = SAMPLE_STAGE[status] || 0;
  return html`<div class="progress" role="img" aria-label="${`Step ${n} of 4`}">${[1, 2, 3, 4].map((i) => html`<i class="${i <= n ? 'on' : ''}"></i>`)}</div>`;
};
const empty = (iconName, text, action = '') => html`<div class="empty">${ic(iconName, 22)}<div>${text}</div>${action ? html`<div style="margin-top:14px">${action}</div>` : ''}</div>`;

const trustFooter = () => html`<div class="foot-trust">
  <span class="row">${ic('lock', 13)} ${location.protocol === 'https:' ? 'Encrypted connection' : 'Access-controlled'}</span>
  <span class="row">${ic('shield', 13)} Every action recorded in a 21 CFR Part 11 audit trail</span>
  ${state.info?.lab_accreditation ? html`<span>${state.info.lab_accreditation}</span>` : ''}
</div>`;

// ---------------------------------------------------------------------------------------------
// Sign-in and password change
// ---------------------------------------------------------------------------------------------

// The same lock screen as the laboratory's own sign-in (core/lock.js), in the client's words.
// Set once sign-in is granted, so the shell grows out of the sculpture's depth instead of simply appearing.
let arriving = false;
const LOCKED = { message: 'Your session is locked. Present your authorization key.', sub: 'Your authorization key is your portal password' };

function portalLock(panel, { ghost = 'Access', message = LOCKED.message, sub = LOCKED.sub } = {}) {
  app.innerHTML = String(lockFrame({
    labName: state.info?.lab_name || 'Client portal',
    ghost, panel, message, sub,
    variant: 'portal',
    os: raw('Client <b>portal</b>'),
    tagline: ['Track every sample', 'Signed certificates', 'Talk to the lab'],
    chips: [location.protocol === 'https:' ? 'Encrypted connection' : 'Access-controlled', 'Audit trail on', 'Your records only'],
  }));
  hideSplash();
  const ctl = mountLock(app);
  return { ctl, flow: lockFlow(ctl, { idle: message, idleSub: sub }) };
}

function showSignIn(message) {
  state.me = null;
  const info = state.info || {};
  const lab = info.lab_name || 'Client portal';
  document.title = `Sign in · ${lab}`;
  const contact = [info.lab_email, info.lab_phone].filter(Boolean);
  const demo = info.demo ? info.demo_accounts || [] : [];
  const { ctl, flow } = portalLock(html`
    <div class="lp-head"><span class="micro">■ Client sign-in</span><span class="lp-org">${info.demo ? 'Demo data' : 'Client portal'}</span></div>
    <form class="lp-form" id="signin" novalidate>
      <div class="operator">
        <div class="op-photo" data-photo>${SILHOUETTE}<span class="op-initials" data-initials hidden></span><em>Classified</em></div>
        <div class="op-main">
          <div class="op-tags"><span class="op-tag">Client</span><span class="micro">Registered email</span><span class="lp-lights" aria-hidden="true"><i></i><i></i><i></i></span></div>
          <label class="op-name"><span class="sr">Email</span><input name="email" type="email" inputmode="email" required autofocus autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="Email"></label>
          <div class="op-loaded">${LOGO}<span class="micro"><b data-loaded>Awaiting client</b><br>Identity unverified</span></div>
        </div>
      </div>
      <dl class="op-profile">
        <dt>Laboratory</dt><dd>${lab}</dd>
        <dt>Portal</dt><dd>${location.host}</dd>
        <dt>Locked at</dt><dd>${stamp()}</dd>
        <dt>Keymap</dt><dd>${(navigator.language || 'en').toUpperCase()}</dd>
      </dl>
      ${message ? html`<div class="lp-notice">${ic('info', 15)}<span>${message}</span></div>` : ''}
      <div class="lp-keyhead"><span class="micro">▬ Authorization key</span><span class="micro" data-attempts>Your password</span></div>
      <label class="auth-key"><span class="sr">Password</span><input type="password" name="password" required autocomplete="current-password" placeholder="Enter password"><button class="ak-btn" type="submit"><span>Request</span>${ic('arrowRight', 14)}</button></label>
      <div class="lp-dots" aria-hidden="true" data-dots></div>
      <div class="form-error" role="alert" hidden></div>
    </form>
    ${contact.length ? html`<p class="lp-help">Need access or help? ${contact.map((c, i) => html`${i ? ' · ' : ''}${c.includes('@') ? html`<a href="${`mailto:${c}`}">${c}</a>` : c}`)}</p>` : ''}
    ${demo.length ? html`<div class="demo-ops">
      <div class="lp-keyhead"><span class="micro">▬ Demo clients</span><span class="micro">One click · key demo1234</span></div>
      <div class="demo-grid">${demo.map((a) => html`<button type="button" data-demo="${a.email}" data-name="${a.full_name}"><span class="dg-ini">${initials(a.full_name)}</span><span><strong>${a.full_name}</strong><small>${a.client_name}</small></span></button>`)}</div>
    </div>` : ''}`);
  const form = $('#signin');
  const email = form.email;
  const pass = form.password;
  const attempts = $('[data-attempts]', form);
  const showClient = (name) => {
    const i = initials(name);
    const ini = $('[data-initials]', form);
    ini.textContent = i;
    ini.hidden = !i;
    $('[data-photo]', form).classList.toggle('known', !!i);
    $('[data-loaded]', form).textContent = i ? 'Client record loaded ●' : 'Awaiting client';
  };
  email.addEventListener('input', () => {
    const v = email.value.trim();
    showClient(demo.find((a) => a.email === v)?.full_name || v.split('@')[0].replace(/[._-]+/g, ' '));
  });
  let tries = 0;
  let busy = false;
  const submit = async () => {
    if (busy) return;
    const d = formData(form);
    if (!d.email || !d.password) {
      lockError(form, 'Enter your email and password');
      (d.email ? pass : email).focus();
      return;
    }
    lockError(form, '');
    busy = true;
    attempts.textContent = `Attempt ${z(++tries)} · recorded`;
    try {
      await flow.run(() => post('/login', { email: d.email, password: d.password }));
      arriving = true;
      await boot();
    } catch (e) {
      if (e.handled) return;
      lockError(form, e.message);
      $('[data-dots]', form).innerHTML = String(raw('<i></i>'.repeat(Math.min(tries, 8))));
      pass.select();
    } finally {
      busy = false;
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  // A demo client "types" their key: each character pulses the sculpture, then the request goes out.
  $$('[data-demo]').forEach((b) => b.addEventListener('click', async () => {
    if (busy) return;
    flow.endLockdown();
    email.value = b.dataset.demo;
    showClient(b.dataset.name);
    pass.value = '';
    for (const ch of 'demo1234') {
      pass.value += ch;
      ctl.ribbon.pulse(0.8);
      if (!reducedMotion()) await sleep(38);
    }
    submit();
  }));
}

function passwordFields(firstTime) {
  return html`
    <label class="field"><span class="label">${firstTime ? 'Temporary password' : 'Current password'}</span><input class="input" name="current" type="password" autocomplete="current-password" required></label>
    <label class="field"><span class="label">New password</span><input class="input" name="next" type="password" autocomplete="new-password" required minlength="8"><div class="hint">At least 8 characters, with both letters and numbers.</div></label>
    <label class="field"><span class="label">Repeat new password</span><input class="input" name="again" type="password" autocomplete="new-password" required></label>`;
}

async function changePassword(form) {
  const d = formData(form);
  if (d.next !== d.again) throw new Error('The two new passwords do not match');
  await post('/password', { current: d.current, next: d.next });
}

function showPasswordChange() {
  document.title = `Choose your password · ${state.info?.lab_name || 'Client portal'}`;
  const { flow } = portalLock(html`
    <div class="lp-head"><span class="micro">■ Credential rotation</span><span class="lp-org">Required</span></div>
    <h1 class="lp-title">Choose your password</h1>
    <p class="lp-sub">For your security, replace the temporary password you were given with one only you know.</p>
    <form class="lp-form" id="pw" novalidate>
      <div class="form-error" role="alert" hidden></div>
      ${passwordFields(true)}
      <button class="btn btn-primary btn-block" type="submit">Save and continue</button>
      <button class="btn btn-quiet btn-block js-signout" type="button">Sign out</button>
    </form>`, { ghost: 'Rotate', message: 'Credential rotation required before the session unseals.', sub: 'Choose a password only you know' });
  const form = $('#pw');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    if (d.next !== d.again) { lockError(form, 'The two new passwords do not match'); return; }
    lockError(form, '');
    try {
      await flow.run(() => post('/password', { current: d.current, next: d.next }));
      toast('Password saved');
      arriving = true;
      await boot();
    } catch (err) {
      if (!err.handled) lockError(form, err.message);
    }
  });
  $('.js-signout', form).addEventListener('click', signOut);
}

async function signOut() {
  await post('/logout').catch(() => {});
  state.me = null;
  state.lookups = null;
  location.hash = '';
  showSignIn('You have signed out.');
}

// ---------------------------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------------------------

const NAV = [
  { href: '#/', key: 'overview', label: 'Overview', icon: 'home' },
  { href: '#/samples', key: 'samples', label: 'Samples', icon: 'tube' },
  { href: '#/submit', key: 'submit', label: 'Submit', long: 'Submit samples', icon: 'box' },
  { href: '#/requests', key: 'requests', label: 'Requests', long: 'Method requests', icon: 'method' },
  { href: '#/messages', key: 'messages', label: 'Messages', icon: 'message' },
];

function renderShell() {
  if (arriving) {
    arriving = false;
    app.classList.add('arrive');
    app.addEventListener('animationend', function done(e) { if (e.target === app) { app.classList.remove('arrive'); app.removeEventListener('animationend', done); } });
  }
  const { me, info } = state;
  app.innerHTML = String(html`
    <header class="top">
      <div class="top-in">
        <a class="brand" href="#/">${MARK(30)}<span class="txt"><span class="name">${info.lab_name}</span><span class="client">${me.client.name}</span></span></a>
        <nav class="nav" aria-label="Main">${NAV.map((n) => html`<a href="${n.href}" data-nav="${n.key}">${n.long || n.label}${n.key === 'messages' ? html` <span class="dot js-unread" hidden></span>` : ''}</a>`)}</nav>
        <div class="me">
          <button class="avatar js-me" aria-haspopup="true" aria-expanded="false" title="${me.user.full_name}">${initials(me.user.full_name)}</button>
          <div class="menu" hidden>
            <div class="who"><div style="font-weight:600">${me.user.full_name}</div><div class="small muted">${me.user.email}</div><div class="small muted">${me.client.name}</div></div>
            <a href="#/account">${ic('user', 16)} Account & security</a>
            <button type="button" class="js-theme">${ic('moon', 16)} Appearance: <span class="js-theme-label"></span></button>
            <button type="button" class="js-signout">${ic('logout', 16)} Sign out</button>
          </div>
        </div>
      </div>
    </header>
    <main class="main" id="main" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Main">${NAV.map((n) => html`<a href="${n.href}" data-nav="${n.key}">${ic(n.icon, 21)}<span>${n.label}</span>${n.key === 'messages' ? html`<span class="dot js-unread" hidden></span>` : ''}</a>`)}</nav>`);
  const btn = $('.js-me');
  const menu = $('.menu');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
  const themes = ['system', 'light', 'dark'];
  const label = () => { $('.js-theme-label').textContent = { system: 'System', light: 'Light', dark: 'Dark' }[store.read().theme || 'system']; };
  label();
  $('.js-theme').addEventListener('click', () => { const cur = store.read().theme || 'system'; applyTheme(themes[(themes.indexOf(cur) + 1) % 3]); label(); });
  $('.js-signout').addEventListener('click', signOut);
}

function setUnread(n) {
  $$('.js-unread').forEach((el) => { el.hidden = !n; el.textContent = n > 9 ? '9+' : String(n); });
}
async function refreshUnread() {
  if (!state.me) return;
  try { setUnread((await api('/threads')).filter((t) => t.unread).length); } catch { /* signed out */ }
}

// ---------------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------------

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

let routeSeq = 0;
let lastRoute = null;
async function route() {
  if (!state.me) return;
  const { parts, query } = parseHash();
  const [a, b] = parts;
  const seq = ++routeSeq;
  const main = $('#main');
  const navKey = { samples: 'samples', coa: 'samples', submissions: 'samples', submit: 'submit', requests: 'requests', messages: 'messages' }[a] || (a ? '' : 'overview');
  $$('[data-nav]').forEach((el) => (el.dataset.nav === navKey ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current')));
  // Same screen (a tab, a thread, a refresh): no entrance and no jump to the top. Either way the current screen stays
  // until the next is ready; only a wait long enough to notice brings skeletons (new screen) or a dim (same screen).
  const screen = a === 'messages' ? a : `${a || ''}/${b || ''}`;
  const stay = screen === lastRoute && !!main.querySelector(':scope > .view');
  const wait = setTimeout(() => {
    if (seq !== routeSeq) return;
    if (stay) main.querySelector(':scope > .view')?.classList.add('pending');
    else main.innerHTML = String(html`<div class="skeleton" style="height:28px;width:220px"></div><div class="skeleton" style="height:120px;margin-top:24px"></div><div class="skeleton" style="height:240px;margin-top:16px"></div>`);
  }, 162);
  let view;
  try {
    if (!a) view = await overview();
    else if (a === 'samples' && b) view = await sampleDetail(+b);
    else if (a === 'samples') view = await samplesList(query.tab || 'open');
    else if (a === 'coa' && b) view = await coaView(+b);
    else if (a === 'submit') view = await submitForm();
    else if (a === 'submissions' && b) view = await submissionDetail(+b);
    else if (a === 'requests' && b === 'new') view = await requestForm();
    else if (a === 'requests' && b) view = await requestDetail(+b);
    else if (a === 'requests') view = await requestsList();
    else if (a === 'messages' && b === 'new') view = await messagesView(null, query);
    else if (a === 'messages') view = await messagesView(b ? +b : null, query);
    else if (a === 'account') view = accountView();
    else view = { html: empty('info', 'This page does not exist.', html`<a class="btn" href="#/">Go to overview</a>`) };
  } catch (e) {
    if (e.handled) { clearTimeout(wait); return; }
    view = { html: html`<div class="card card-pad">${empty('alert', e.status === 404 ? 'We could not find that record.' : e.message, html`<a class="btn" href="#/">Back to overview</a>`)}</div>` };
  }
  if (seq !== routeSeq) return;
  clearTimeout(wait);
  const before = snapshot(main.querySelector(':scope > .view'));
  main.innerHTML = String(html`<div class="view">${view.html}${a === 'coa' ? '' : trustFooter()}</div>`);
  lastRoute = screen;
  settle(main.querySelector(':scope > .view'), before, { still: stay });
  document.title = `${view.title ? `${view.title} · ` : ''}${state.info.lab_name}`;
  view.mount?.(main);
  if (!view.keepScroll && !stay) window.scrollTo(0, 0);
  hideSplash();
  if (a !== 'messages') refreshUnread();
}

// ---------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------

async function overview() {
  const o = await api('/overview');
  setUnread(o.counts.unread);
  const first = state.me.user.full_name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').split(' ')[0];
  const stats = [
    { n: o.counts.in_lab, l: 'Samples in the lab', href: '#/samples' },
    { n: o.counts.reported_90d, l: 'Certificates, last 90 days', href: '#/samples?tab=reported' },
    { n: o.counts.submissions_open + o.counts.requests_open, l: 'Open submissions & requests', href: '#/requests' },
    { n: o.counts.unread, l: o.counts.unread === 1 ? 'Unread message' : 'Unread messages', href: '#/messages' },
  ];
  const open = [
    ...o.submissions.map((s) => ({ href: `#/submissions/${s.id}`, code: s.code, title: `Sample shipment · ${plural(s.sample_count, 'sample')}`, status: pill(SUB_LABEL[s.status], SUB_TONE[s.status]), at: s.created_at })),
    ...o.requests.map((r) => ({ href: `#/requests/${r.id}`, code: r.code, title: r.title, status: pill(r.status, REQ_TONE[r.status]), at: r.created_at })),
  ].sort((x, y) => (y.at > x.at ? 1 : -1));
  return {
    title: 'Overview',
    html: html`
      <div class="page-head">
        <div><div class="eyebrow">${state.me.client.name}</div><h1>${greeting()}, ${first}</h1><p class="sub">Here is where your work with ${state.info.lab_name} stands today.</p></div>
      </div>
      <div class="stack-lg">
        <div class="stats">${stats.map((s) => html`<a class="card stat" href="${s.href}"><div class="n">${s.n}</div><div class="l">${s.l}</div></a>`)}</div>
        <div class="quick">
          <a class="card" href="#/submit"><span class="ic">${ic('box', 20)}</span><span><b>Submit samples</b><span>Tell us what is on its way</span></span></a>
          <a class="card" href="#/requests/new"><span class="ic">${ic('flask', 20)}</span><span><b>Request method work</b><span>Development, validation or transfer</span></span></a>
          <a class="card" href="#/messages/new"><span class="ic">${ic('message', 20)}</span><span><b>Message the lab</b><span>Questions go straight to your team</span></span></a>
        </div>
        <div class="cols">
          <div class="stack">
            <section class="card">
              <div class="card-head"><h2>Samples in progress</h2><a class="small" href="#/samples">View all</a></div>
              ${o.inProgress.length ? html`<ul class="list">${o.inProgress.map((s) => html`<li><a class="item item-stack" href="${`#/samples/${s.id}`}">
                <div class="grow"><div class="t ellipsis"><span class="mono">${s.code}</span> · ${s.description}</div><div class="s ellipsis">${[s.batch_no && `Batch ${s.batch_no}`, s.client_ref].filter(Boolean).join(' · ') || '—'}</div></div>
                <div class="end">${progress(s.status)}<div class="progress-label">${SAMPLE_LABEL[s.status]} · due ${fmtDate(s.due_date)}</div></div>
              </a></li>`)}</ul>` : empty('tube', 'No samples in the lab right now.', html`<a class="btn btn-sm" href="#/submit">Submit samples</a>`)}
            </section>
            <section class="card">
              <div class="card-head"><h2>Recently issued certificates</h2><a class="small" href="#/samples?tab=reported">All certificates</a></div>
              ${o.recentCoas.length ? html`<ul class="list">${o.recentCoas.map((s) => html`<li><a class="item" href="${`#/coa/${s.id}`}">
                <span class="coa-ic">${ic('certificate', 18)}</span>
                <div class="grow"><div class="t ellipsis">${s.description}</div><div class="s ellipsis"><span class="mono">${s.code}</span>${s.batch_no ? ` · Batch ${s.batch_no}` : ''}</div></div>
                <div class="end small muted">${fmtDate(s.reported_at)}</div>
              </a></li>`)}</ul>` : empty('certificate', 'Certificates appear here as soon as QA issues them.')}
            </section>
          </div>
          <div class="stack">
            <section class="card">
              <div class="card-head"><h2>Messages</h2><a class="small" href="#/messages">Open inbox</a></div>
              ${o.threads.length ? html`<ul class="list threads">${o.threads.map((t) => html`<li class="${t.unread ? 'unread' : ''}"><a class="item" href="${`#/messages/${t.id}`}">
                <div class="grow"><div class="row"><span class="t grow ellipsis">${t.subject}</span>${t.unread ? html`<span class="udot" aria-label="Unread"></span>` : ''}<span class="tiny faint nowrap">${relTime(t.last_message_at)}</span></div><div class="s ellipsis">${t.last_author}: ${t.excerpt}</div></div>
              </a></li>`)}</ul>` : empty('message', 'No conversations yet.')}
            </section>
            <section class="card">
              <div class="card-head"><h2>Open submissions & requests</h2></div>
              ${open.length ? html`<ul class="list">${open.map((x) => html`<li><a class="item" href="${x.href}"><div class="grow"><div class="t ellipsis">${x.title}</div><div class="s"><span class="mono">${x.code}</span> · ${fmtDate(x.at)}</div></div><div class="end">${x.status}</div></a></li>`)}</ul>` : empty('inbox', 'Nothing open.')}
            </section>
          </div>
        </div>
      </div>`,
  };
}

// ---------------------------------------------------------------------------------------------
// Samples & certificates
// ---------------------------------------------------------------------------------------------

async function samplesList(tab) {
  const isShip = tab === 'shipments';
  const rows = isShip ? await api('/submissions') : await api(`/samples?status=${encodeURIComponent(tab)}`);
  const tabs = [['open', 'In the lab'], ['reported', 'Reported'], ['all', 'All samples'], ['shipments', 'Shipments']];
  const table = isShip
    ? (rows.length ? html`<div class="table-wrap"><table class="table responsive"><thead><tr><th>Submission</th><th>Samples</th><th>Courier</th><th>Submitted</th><th>Status</th></tr></thead><tbody>
        ${rows.map((s) => html`<tr data-href="${`#/submissions/${s.id}`}" style="cursor:pointer">
          <td><a class="mono" href="${`#/submissions/${s.id}`}">${s.code}</a>${s.priority !== 'Standard' ? html` <span class="pill warn plain" style="margin-left:6px">${s.priority}</span>` : ''}</td>
          <td data-label="Samples">${plural(s.sample_count, 'sample')}${s.method_count ? ` · ${plural(s.method_count, 'test')}` : ''}</td>
          <td data-label="Courier">${s.courier || '—'}${s.tracking_no ? html`<div class="tiny muted mono">${s.tracking_no}</div>` : ''}</td>
          <td data-label="Submitted">${fmtDate(s.created_at)}</td>
          <td>${pill(SUB_LABEL[s.status], SUB_TONE[s.status])}</td></tr>`)}
      </tbody></table></div>` : empty('box', 'No shipments yet.', html`<a class="btn btn-sm" href="#/submit">Submit samples</a>`))
    : (rows.length ? html`<div class="table-wrap"><table class="table responsive"><thead><tr><th>Sample</th><th>Batch / lot</th><th>Your reference</th><th>Progress</th><th>${tab === 'reported' ? 'Reported' : 'Due'}</th><th></th></tr></thead><tbody>
        ${rows.map((s) => html`<tr>
          <td><a href="${`#/samples/${s.id}`}" style="color:inherit"><span class="mono" style="color:var(--accent-text)">${s.code}</span><div class="small muted" style="max-width:340px">${s.description}</div></a></td>
          <td data-label="Batch">${s.batch_no || '—'}</td>
          <td data-label="Ref.">${s.client_ref || '—'}</td>
          <td>${samplePill(s.status)}</td>
          <td data-label="${s.status === 'Reported' ? 'Reported' : 'Due'}" class="nowrap">${fmtDate(s.status === 'Reported' ? s.reported_at : s.due_date)}</td>
          <td class="num">${s.status === 'Reported' ? html`<a class="btn btn-sm" href="${`#/coa/${s.id}`}">${ic('certificate', 15)} CoA</a>` : ''}</td></tr>`)}
      </tbody></table></div>` : empty('tube', tab === 'open' ? 'No samples in the lab right now.' : 'No samples to show.'));
  return {
    title: 'Samples',
    html: html`
      <div class="page-head"><div><div class="eyebrow">${state.me.client.name}</div><h1>Samples</h1><p class="sub">Status of everything we hold for you, and every certificate we have issued.</p></div><a class="btn btn-primary" href="#/submit">${ic('plus', 16)} Submit samples</a></div>
      <div class="seg" role="tablist" style="margin-bottom:16px;max-width:100%;overflow-x:auto">${tabs.map(([k, l]) => html`<a href="${`#/samples?tab=${k}`}" aria-current="${String(k === tab)}">${l}</a>`)}</div>
      <section class="card">${table}</section>`,
    mount(root) { $$('tr[data-href]', root).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; })); },
  };
}

async function sampleDetail(id) {
  const { sample: s, tests, submission } = await api(`/samples/${id}`);
  const stage = SAMPLE_STAGE[s.status] || 0;
  const steps = [['Received', fmtDate(s.received_at)], ['Testing', ''], ['Review', ''], ['Reported', s.reported_at ? fmtDate(s.reported_at) : '']];
  return {
    title: s.code,
    html: html`
      <a class="back" href="#/samples">${ic('arrowLeft', 15)} Samples</a>
      <div class="page-head">
        <div><div class="eyebrow mono">${s.code}</div><h1>${s.description}</h1><p class="sub">${[s.batch_no && `Batch ${s.batch_no}`, s.client_ref && `Your ref. ${s.client_ref}`].filter(Boolean).join(' · ')}</p></div>
        <div class="row">
          <a class="btn" href="${`#/messages/new?sample=${s.id}`}">${ic('message', 16)} Ask about this sample</a>
          ${s.status === 'Reported' ? html`<a class="btn btn-primary" href="${`#/coa/${s.id}`}">${ic('certificate', 16)} Certificate</a>` : ''}
        </div>
      </div>
      <div class="cols">
        <div class="stack">
          <section class="card card-pad">
            <div class="row" style="justify-content:space-between;margin-bottom:18px"><h2>Progress</h2>${samplePill(s.status)}</div>
            <ol class="steps">${steps.map(([l, d], i) => html`<li class="${i + 1 <= stage ? 'done' : ''} ${i + 1 === stage ? 'current' : ''}"><div>${l}</div><div class="tiny faint">${d}</div></li>`)}</ol>
            ${s.status !== 'Reported' && s.due_date ? html`<p class="small muted" style="margin-top:18px">Expected completion <b style="color:var(--ink)">${fmtDate(s.due_date)}</b>${s.priority !== 'Standard' ? html` · ${s.priority} priority` : ''}</p>` : ''}
          </section>
          <section class="card">
            <div class="card-head"><h2>Tests</h2><span class="small muted">${s.tests_done} of ${s.test_count} complete</span></div>
            ${tests.length ? html`<ul class="list">${tests.map((t) => html`<li class="item"><div class="grow"><div class="t">${t.method_title}</div><div class="s"><span class="mono">${t.method_code} v${t.method_version}</span> · ${t.technique}</div></div><div class="end">${t.status === 'Approved' ? pill('Complete', 'ok') : t.status === 'Pending' ? pill('Queued') : pill('In progress', 'accent')}</div></li>`)}</ul>` : empty('flask', 'Tests will be listed once they are scheduled.')}
          </section>
        </div>
        <section class="card card-pad">
          <h2 style="margin-bottom:16px">Details</h2>
          <dl class="facts">
            <dt>Sample type</dt><dd>${s.sample_type || '—'}</dd>
            <dt>Received</dt><dd>${fmtDateTime(s.received_at)}</dd>
            <dt>Due</dt><dd>${fmtDate(s.due_date)}</dd>
            <dt>Reported</dt><dd>${fmtDate(s.reported_at)}</dd>
            <dt>Project</dt><dd>${s.project_code ? html`<span class="mono">${s.project_code}</span> ${s.project_title}` : '—'}</dd>
            ${submission ? html`<dt>Shipment</dt><dd><a class="mono" href="${`#/submissions/${submission.id}`}">${submission.code}</a></dd>` : ''}
          </dl>
        </section>
      </div>`,
  };
}

async function coaView(id) {
  const c = await api(`/samples/${id}/coa`);
  const { sample: s, lab } = c;
  const outcome = (o) => (o === 'Pass' ? 'Complies' : o === 'Fail' ? html`<span class="fail">Does not comply</span>` : o === 'Report' ? 'For information' : o);
  return {
    title: `CoA ${s.code}`,
    html: html`
      <div class="coa-bar">
        <a class="back" style="margin:0" href="${`#/samples/${s.id}`}">${ic('arrowLeft', 15)} ${s.code}</a>
        <button class="btn btn-primary js-print" type="button">${ic('printer', 16)} Print or save as PDF</button>
      </div>
      <article class="sheet">
        <div class="lh">
          <div><div class="lab">${lab.lab_name}</div><div class="addr">${lab.lab_address}</div><div class="addr">${[lab.lab_phone, lab.lab_email].filter(Boolean).join(' · ')}</div>${lab.lab_accreditation ? html`<div class="addr">${lab.lab_accreditation}</div>` : ''}</div>
          <div class="ttl"><h1>Certificate of Analysis</h1><div class="no">${s.code}</div></div>
        </div>
        <table class="info"><tbody>
          <tr><td class="k">Client</td><td>${s.client_name}</td><td class="k">Sample ID</td><td class="mono">${s.code}</td></tr>
          <tr><td class="k">Description</td><td>${s.description}</td><td class="k">Batch / lot</td><td>${s.batch_no || '—'}</td></tr>
          <tr><td class="k">Client reference</td><td>${s.client_ref || '—'}</td><td class="k">Sample type</td><td>${s.sample_type || '—'}</td></tr>
          <tr><td class="k">Received</td><td>${fmtDate(s.received_at)}</td><td class="k">Condition</td><td>${s.condition || '—'}</td></tr>
          <tr><td class="k">Project</td><td>${s.project_code || '—'}</td><td class="k">PO number</td><td>${s.po_number || '—'}</td></tr>
          <tr><td class="k">Report date</td><td>${fmtDate(s.reported_at)}</td><td class="k">Quantity</td><td>${s.quantity || '—'}</td></tr>
        </tbody></table>
        ${c.tests.map((t) => html`<div class="res">
          <h3>${t.method_title}</h3>
          <div class="ref">${t.method_code} v${t.method_version}${t.reference ? ` · ${t.reference}` : ''}${t.approved_at ? ` · approved ${fmtDate(t.approved_at)}` : ''}</div>
          <table class="fixed"><thead><tr><th style="width:34%">Test / analyte</th><th style="width:26%">Specification</th><th style="width:22%">Result</th><th>Conclusion</th></tr></thead>
          <tbody>${t.results.map((r) => html`<tr><td class="an">${r.analyte}</td><td data-label="Specification">${r.spec}</td><td data-label="Result" class="num-t">${r.result}</td><td data-label="Conclusion">${outcome(r.outcome)}</td></tr>`)}</tbody></table>
        </div>`)}
        <div class="conclusion"><b>Conclusion:</b> ${c.complies ? 'The sample complies with the specifications listed above.' : 'One or more results do not comply with the specification. See results above.'}</div>
        ${lab.coa_statement ? html`<p class="stmt">${lab.coa_statement}</p>` : ''}
        <div class="sigs">
          <div class="sig"><div class="k">Performed by</div><div>${c.performed_by.join(', ') || '—'}</div></div>
          <div class="sig"><div class="k">Reviewed by</div><div>${c.reviewed_by.join(', ') || '—'}</div></div>
          <div class="sig"><div class="k">Approved & issued by (QA)</div><div>${c.issued?.full_name || '—'}</div><div class="k">${c.issued ? fmtDateTime(c.issued.signed_at) : ''}</div></div>
        </div>
        <div class="foot"><span>This certificate was electronically signed in accordance with 21 CFR Part 11.</span><span>${s.code}</span></div>
      </article>`,
    mount(root) { $('.js-print', root).addEventListener('click', () => window.print()); },
  };
}

// ---------------------------------------------------------------------------------------------
// Sample submission
// ---------------------------------------------------------------------------------------------

function sampleRow(i, v = {}) {
  const f = (name, label, ph) => html`<label><span class="label">${label}</span><input class="input" name="${`s.${name}`}" value="${v[name] || ''}" placeholder="${ph}" ${name === 'description' ? raw('required') : ''}></label>`;
  return html`<div class="srow" data-row>
    <div class="n">${i + 1}</div>
    ${f('description', 'Description', 'e.g. Tablets, 500 mg')}
    ${f('batch_no', 'Batch / lot', 'Batch')}
    ${f('client_ref', 'Your reference', 'Your ref.')}
    ${f('quantity', 'Quantity', 'e.g. 100 tabs')}
    ${f('container', 'Container', 'e.g. Bottle')}
    <button class="btn btn-quiet btn-sm remove" type="button" title="Remove sample" aria-label="Remove sample">${ic('x', 15)}</button>
  </div>`;
}

async function submitForm() {
  const lk = await lookups();
  return {
    title: 'Submit samples',
    html: html`
      <div class="page-head"><div><div class="eyebrow">${state.me.client.name}</div><h1>Submit samples</h1><p class="sub">Tell us what you are sending before it ships. We confirm every submission and let you know the moment it arrives.</p></div></div>
      <form class="card" id="submission" novalidate>
        <div class="form-section">
          <div class="about"><h2><span class="step-n"></span>Samples</h2><p>One line per container or batch. Up to 200 at a time.</p></div>
          <div>
            <div class="srows-head"><span>#</span><span>Description</span><span>Batch / lot</span><span>Your ref.</span><span>Quantity</span><span>Container</span><span></span></div>
            <div class="js-rows">${sampleRow(0)}</div>
            <button class="btn btn-sm js-add" type="button" style="margin-top:12px">${ic('plus', 15)} Add another sample</button>
          </div>
        </div>
        <div class="form-section">
          <div class="about"><h2><span class="step-n"></span>Tests</h2><p>Choose from our current validated methods. Not sure? Leave this empty and describe what you need in the notes.</p></div>
          <div>
            ${lk.methods.length > 6 ? html`<input class="input js-filter" type="search" placeholder="Filter tests" style="margin-bottom:10px" aria-label="Filter tests">` : ''}
            <div class="method-pick">${lk.methods.map((m) => html`<label class="check" data-text="${`${m.code} ${m.title} ${m.technique}`.toLowerCase()}"><input type="checkbox" name="method_ids" data-list="1" value="${m.id}"><span><b>${m.title}</b><span>${m.code} · ${m.technique}${m.tat_days ? ` · typically ${m.tat_days} working days` : ''}</span></span></label>`)}</div>
          </div>
        </div>
        <div class="form-section">
          <div class="about"><h2><span class="step-n"></span>Details</h2><p>How the samples should be handled once they are here.</p></div>
          <div class="stack">
            <div class="grid-2">
              <label class="field"><span class="label">Project <span class="opt">(optional)</span></span><select class="select" name="project_id"><option value="">No specific project</option>${lk.projects.map((p) => html`<option value="${p.id}">${p.code} — ${p.title}</option>`)}</select></label>
              <label class="field"><span class="label">Sample type</span><select class="select" name="sample_type"><option value="">Select…</option>${lk.sampleTypes.map((t) => html`<option>${t}</option>`)}</select></label>
            </div>
            <label class="field"><span class="label">Storage on arrival</span><select class="select" name="storage"><option value="">Select…</option>${lk.storageConditions.map((t) => html`<option>${t}</option>`)}</select></label>
            <div class="field"><span class="label">Priority</span>
              <div class="choice cols-3">${[['Standard', 'Our normal turnaround for each test.'], ['Rush', 'Ahead of the queue. Subject to confirmation; surcharge may apply.'], ['Urgent', 'Same or next working day where possible. Please call us as well.']].map(([p, d]) => html`<label><input type="radio" name="priority" value="${p}" ${p === 'Standard' ? raw('checked') : ''}><span class="t">${p}</span><span class="d">${d}</span></label>`)}</div>
            </div>
          </div>
        </div>
        <div class="form-section">
          <div class="about"><h2><span class="step-n"></span>Shipping</h2><p>So reception can watch for the parcel.</p></div>
          <div class="grid-3">
            <label class="field"><span class="label">Courier</span><input class="input" name="courier" placeholder="e.g. FedEx Priority"></label>
            <label class="field"><span class="label">Tracking number</span><input class="input" name="tracking_no"></label>
            <label class="field"><span class="label">Ship date</span><input class="input" type="date" name="ship_date" value="${todayIso()}"></label>
          </div>
        </div>
        <div class="form-section">
          <div class="about"><h2><span class="step-n"></span>Notes</h2><p>Hazards, special handling, or anything we should know.</p></div>
          <label class="field"><span class="sr-only">Notes</span><textarea class="textarea" name="notes" placeholder="Optional"></textarea></label>
        </div>
        <div class="form-actions"><div class="form-error grow" style="margin-right:auto"></div><a class="btn btn-quiet" href="#/">Cancel</a><button class="btn btn-primary" type="submit">${ic('send', 16)} Submit</button></div>
      </form>`,
    mount(root) {
      const form = $('#submission', root);
      const rows = $('.js-rows', form);
      const renumber = () => $$('[data-row]', rows).forEach((r, i) => { $('.n', r).textContent = i + 1; $('.remove', r).hidden = $$('[data-row]', rows).length === 1; });
      renumber();
      $('.js-add', form).addEventListener('click', () => {
        const last = $$('[data-row]', rows).at(-1);
        const carry = last ? { description: $('[name="s.description"]', last).value, container: $('[name="s.container"]', last).value, quantity: $('[name="s.quantity"]', last).value } : {};
        rows.insertAdjacentHTML('beforeend', String(sampleRow(0, carry)));
        renumber();
        $$('[data-row]', rows).at(-1).querySelector('[name="s.batch_no"]').focus();
      });
      rows.addEventListener('click', (e) => { const b = e.target.closest('.remove'); if (b) { b.closest('[data-row]').remove(); renumber(); } });
      $('.js-filter', form)?.addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); $$('.method-pick .check', form).forEach((l) => { l.hidden = q && !l.dataset.text.includes(q); }); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(form);
        const samples = $$('[data-row]', rows).map((r) => Object.fromEntries(['description', 'batch_no', 'client_ref', 'quantity', 'container'].map((k) => [k, $(`[name="s.${k}"]`, r).value])));
        const body = { project_id: d.project_id || null, sample_type: d.sample_type || null, storage: d.storage || null, priority: d.priority, courier: d.courier, tracking_no: d.tracking_no, ship_date: d.ship_date || null, notes: d.notes, method_ids: (d.method_ids || []).map(Number), samples };
        const res = await submitting(form, () => post('/submissions', body));
        if (!res) return;
        $('#main').innerHTML = String(html`<div class="view"><div class="card success">
          <div class="badge">${ic('check', 26)}</div>
          <h1>Submission ${res.code} received</h1>
          <p>Thank you. We will review it and confirm here, usually within a few working hours.</p>
          <ol class="next-steps">
            <li>Label each container with the batch and reference you entered.</li>
            <li>Put a note with <b>&nbsp;${res.code}&nbsp;</b> in the box so reception can match it.</li>
            <li>We will message you when the parcel arrives and the samples are logged.</li>
          </ol>
          <div class="row" style="justify-content:center;margin-top:28px;flex-wrap:wrap"><a class="btn" href="${`#/submissions/${res.id}`}">View submission</a><a class="btn btn-primary" href="#/">Back to overview</a></div>
        </div>${trustFooter()}</div>`);
        window.scrollTo(0, 0);
      });
    },
  };
}

async function submissionDetail(id) {
  const { submission: s, thread_id } = await api(`/submissions/${id}`);
  const order = ['Submitted', 'Acknowledged', 'Received'];
  const at = { Submitted: s.created_at, Acknowledged: s.acknowledged_at, Received: s.received_at };
  const stopped = ['Declined', 'Withdrawn'].includes(s.status);
  const reached = stopped ? 1 : order.indexOf(s.status) + 1;
  return {
    title: s.code,
    html: html`
      <a class="back" href="#/samples?tab=shipments">${ic('arrowLeft', 15)} Shipments</a>
      <div class="page-head">
        <div><div class="eyebrow">Sample submission</div><h1 class="mono" style="font-family:var(--font)">${s.code}</h1><p class="sub">${plural(s.samples.length, 'sample')} · submitted ${fmtDateTime(s.created_at)}</p></div>
        <div class="row">${thread_id ? html`<a class="btn" href="${`#/messages/${thread_id}`}">${ic('message', 16)} Conversation</a>` : ''}${s.status === 'Submitted' ? html`<button class="btn js-withdraw" type="button">Withdraw</button>` : ''}</div>
      </div>
      <div class="stack">
        <section class="card card-pad">
          <div class="row" style="justify-content:space-between;margin-bottom:18px"><h2>Status</h2>${pill(SUB_LABEL[s.status], SUB_TONE[s.status])}</div>
          <ol class="steps">
            ${order.map((st, i) => html`<li class="${i < reached ? 'done' : ''} ${i + 1 === reached && !stopped ? 'current' : ''}"><div>${st === 'Acknowledged' ? 'Confirmed' : st}</div><div class="tiny faint">${at[st] && i < reached ? fmtDate(at[st]) : ''}</div></li>`)}
            ${stopped ? html`<li class="done stop"><div>${s.status}</div><div class="tiny faint">${fmtDate(s.updated_at)}</div></li>` : ''}
          </ol>
          ${s.status_note && s.status === 'Declined' ? html`<div class="alert alert-bad" style="margin-top:18px">${ic('info', 16)}<span>${s.status_note}</span></div>` : ''}
          ${s.received_samples.length ? html`<p class="small" style="margin-top:18px">Logged as ${s.received_samples.map((x, i) => html`${i ? ', ' : ''}<a class="mono" href="${`#/samples/${x.id}`}">${x.code}</a>`)}</p>` : ''}
        </section>
        <section class="card">
          <div class="card-head"><h2>Samples</h2></div>
          <div class="table-wrap"><table class="table responsive"><thead><tr><th>#</th><th>Description</th><th>Batch / lot</th><th>Your reference</th><th>Quantity</th><th>Container</th></tr></thead>
          <tbody>${s.samples.map((r, i) => html`<tr><td class="muted">${i + 1}</td><td>${r.description}</td><td data-label="Batch">${r.batch_no || '—'}</td><td data-label="Ref.">${r.client_ref || '—'}</td><td data-label="Qty">${r.quantity || '—'}</td><td data-label="Container">${r.container || '—'}</td></tr>`)}</tbody></table></div>
        </section>
        <div class="grid-2">
          <section class="card card-pad"><h2 style="margin-bottom:14px">Tests requested</h2>
            ${s.methods.length ? html`<ul class="list" style="margin:-6px 0">${s.methods.map((m) => html`<li style="padding:8px 0"><div style="font-weight:560">${m.title}</div><div class="small muted">${m.code} · ${m.technique}</div></li>`)}</ul>` : html`<p class="muted small">None selected — described in the notes.</p>`}
          </section>
          <section class="card card-pad"><h2 style="margin-bottom:14px">Handling & shipping</h2>
            <dl class="facts">
              <dt>Priority</dt><dd>${s.priority}</dd>
              <dt>Sample type</dt><dd>${s.sample_type || '—'}</dd>
              <dt>Storage</dt><dd>${s.storage || '—'}</dd>
              <dt>Courier</dt><dd>${s.courier || '—'}</dd>
              <dt>Tracking</dt><dd class="mono">${s.tracking_no || '—'}</dd>
              <dt>Ship date</dt><dd>${fmtDate(s.ship_date)}</dd>
            </dl>
            ${s.notes ? html`<p class="small pre" style="margin-top:14px;color:var(--ink-2)">${s.notes}</p>` : ''}
          </section>
        </div>
      </div>`,
    mount(root) {
      $('.js-withdraw', root)?.addEventListener('click', async (e) => {
        if (!confirm(`Withdraw submission ${s.code}? The laboratory will be notified.`)) return;
        e.target.disabled = true;
        try { await post(`/submissions/${s.id}/withdraw`); toast('Submission withdrawn'); route(); } catch (err) { if (!err.handled) toast(err.message); e.target.disabled = false; }
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Method development / validation requests
// ---------------------------------------------------------------------------------------------

async function requestsList() {
  const [reqs, subs] = await Promise.all([api('/requests'), api('/submissions')]);
  const openSubs = subs.filter((s) => ['Submitted', 'Acknowledged'].includes(s.status));
  return {
    title: 'Requests',
    html: html`
      <div class="page-head"><div><div class="eyebrow">${state.me.client.name}</div><h1>Method requests</h1><p class="sub">Method development, validation and transfer — from first scope to an agreed project.</p></div><a class="btn btn-primary" href="#/requests/new">${ic('plus', 16)} New request</a></div>
      <div class="stack">
        <section class="card">
          ${reqs.length ? html`<ul class="list">${reqs.map((r) => html`<li><a class="item" href="${`#/requests/${r.id}`}">
            <div class="grow"><div class="t ellipsis">${r.title}</div><div class="s ellipsis"><span class="mono">${r.code}</span> · ${r.type}${r.product ? ` · ${r.product}` : ''} · ${fmtDate(r.created_at)}</div></div>
            <div class="end">${pill(r.status, REQ_TONE[r.status])}</div></a></li>`)}</ul>` : empty('flask', 'No method requests yet.', html`<a class="btn btn-sm" href="#/requests/new">Start a request</a>`)}
        </section>
        ${openSubs.length ? html`<section class="card"><div class="card-head"><h2>Open sample submissions</h2><a class="small" href="#/samples?tab=shipments">All shipments</a></div>
          <ul class="list">${openSubs.map((s) => html`<li><a class="item" href="${`#/submissions/${s.id}`}"><div class="grow"><div class="t"><span class="mono">${s.code}</span> · ${plural(s.sample_count, 'sample')}</div><div class="s">${s.courier || 'Courier not given'} · ${fmtDate(s.created_at)}</div></div><div class="end">${pill(SUB_LABEL[s.status], SUB_TONE[s.status])}</div></a></li>`)}</ul></section>` : ''}
      </div>`,
  };
}

async function requestForm() {
  const lk = await lookups();
  const types = [
    ['Method development', 'A new method for your product or impurity.'],
    ['Method validation', 'Validate an existing method to ICH Q2(R2).'],
    ['Method transfer', 'Bring your method into our lab.'],
    ['Other', 'Something else — tell us below.'],
  ];
  return {
    title: 'New method request',
    html: html`
      <a class="back" href="#/requests">${ic('arrowLeft', 15)} Method requests</a>
      <div class="page-head"><div><div class="eyebrow">${state.me.client.name}</div><h1>Request method work</h1><p class="sub">Give us the essentials. A scientist reviews every request and replies with questions or a proposal, usually within two working days.</p></div></div>
      <form class="card" id="request" novalidate>
        <div class="form-section">
          <div class="about"><h2><span class="step-n"></span>Type of work</h2></div>
          <div class="choice cols-4">${types.map(([t, d], i) => html`<label><input type="radio" name="type" value="${t}" ${i === 0 ? raw('checked') : ''}><span class="t">${t}</span><span class="d">${d}</span></label>`)}</div>
        </div>
        <div class="form-section">
          <div class="about"><h2><span class="step-n"></span>What it is for</h2><p>The product and the analytical question.</p></div>
          <div class="stack">
            <label class="field"><span class="label">Short title</span><input class="input" name="title" required maxlength="200" placeholder="e.g. Assay and impurities method for XY-101 tablets"></label>
            <div class="grid-2">
              <label class="field"><span class="label">Product / molecule</span><input class="input" name="product" placeholder="e.g. XY-101 25 mg film-coated tablets"></label>
              <label class="field"><span class="label">Technique <span class="opt">(if known)</span></span><select class="select" name="technique"><option value="">No preference</option>${lk.techniques.map((t) => html`<option>${t}</option>`)}</select></label>
            </div>
          </div>
        </div>
        <div class="form-section js-params">
          <div class="about"><h2><span class="step-n"></span>Validation scope</h2><p>Performance characteristics per ICH Q2(R2). Tick what you need; we will advise on the rest.</p></div>
          <div class="checks cols">${lk.validationParameters.map((p) => html`<label class="check"><input type="checkbox" name="parameters" data-list="1" value="${p}"><span>${p}</span></label>`)}</div>
        </div>
        <div class="form-section">
          <div class="about"><h2><span class="step-n"></span>Context & timing</h2></div>
          <div class="stack">
            <label class="field"><span class="label">Scope and background</span><textarea class="textarea" name="scope" placeholder="Analytes and ranges, sample matrix, existing methods or literature, material available, acceptance criteria…"></textarea></label>
            <div class="grid-2">
              <label class="field"><span class="label">Regulatory context</span><select class="select" name="regulatory"><option value="">Select…</option>${lk.regulatoryContexts.map((t) => html`<option>${t}</option>`)}</select></label>
              <label class="field"><span class="label">Target date <span class="opt">(optional)</span></span><input class="input" type="date" name="target_date" min="${todayIso()}"></label>
            </div>
          </div>
        </div>
        <div class="form-actions"><div class="form-error grow"></div><a class="btn btn-quiet" href="#/requests">Cancel</a><button class="btn btn-primary" type="submit">${ic('send', 16)} Send request</button></div>
      </form>`,
    mount(root) {
      const form = $('#request', root);
      const params = $('.js-params', form);
      const sync = () => { const t = formData(form).type; params.hidden = !['Method validation', 'Method transfer'].includes(t); };
      form.addEventListener('change', (e) => { if (e.target.name === 'type') sync(); });
      sync();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(form);
        if (params.hidden) d.parameters = [];
        const res = await submitting(form, () => post('/requests', { ...d, technique: d.technique || null, regulatory: d.regulatory || null, target_date: d.target_date || null }));
        if (res) { toast(`Request ${res.code} sent`); location.hash = `#/requests/${res.id}`; }
      });
    },
  };
}

async function requestDetail(id) {
  const { request: r, thread_id } = await api(`/requests/${id}`);
  const flow = ['Submitted', 'Under review', 'Proposal sent', r.status === 'Declined' ? 'Declined' : 'Accepted'];
  const reached = flow.indexOf(r.status) + 1;
  return {
    title: r.code,
    html: html`
      <a class="back" href="#/requests">${ic('arrowLeft', 15)} Method requests</a>
      <div class="page-head">
        <div><div class="eyebrow"><span class="mono">${r.code}</span> · ${r.type}</div><h1>${r.title}</h1><p class="sub">Submitted ${fmtDateTime(r.created_at)}</p></div>
        ${thread_id ? html`<a class="btn btn-primary" href="${`#/messages/${thread_id}`}">${ic('message', 16)} Conversation</a>` : ''}
      </div>
      <div class="cols">
        <div class="stack">
          <section class="card card-pad">
            <div class="row" style="justify-content:space-between;margin-bottom:18px"><h2>Status</h2>${pill(r.status, REQ_TONE[r.status])}</div>
            <ol class="steps">${flow.map((st, i) => html`<li class="${i < reached ? 'done' : ''} ${i + 1 === reached ? 'current' : ''} ${st === 'Declined' ? 'stop' : ''}"><div>${st}</div></li>`)}</ol>
            ${r.response ? html`<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line)"><div class="small muted" style="margin-bottom:6px">Latest response from the lab · ${fmtDate(r.responded_at)}</div><p class="pre">${r.response}</p></div>` : ''}
            ${r.project_code ? html`<div class="alert alert-ok" style="margin-top:16px">${ic('check', 16)}<span>Project <b class="mono">${r.project_code}</b> opened: ${r.project_title}</span></div>` : ''}
          </section>
          ${r.scope ? html`<section class="card card-pad"><h2 style="margin-bottom:10px">Scope and background</h2><p class="pre" style="color:var(--ink-2)">${r.scope}</p></section>` : ''}
        </div>
        <section class="card card-pad">
          <h2 style="margin-bottom:16px">Summary</h2>
          <dl class="facts">
            <dt>Type</dt><dd>${r.type}</dd>
            <dt>Product</dt><dd>${r.product || '—'}</dd>
            <dt>Technique</dt><dd>${r.technique || 'No preference'}</dd>
            <dt>Regulatory</dt><dd>${r.regulatory || '—'}</dd>
            <dt>Target date</dt><dd>${fmtDate(r.target_date)}</dd>
          </dl>
          ${r.parameters.length ? html`<h3 style="margin:20px 0 10px;font-size:13.5px">Validation parameters</h3><div class="row" style="flex-wrap:wrap;gap:6px">${r.parameters.map((p) => html`<span class="pill plain">${p}</span>`)}</div>` : ''}
        </section>
      </div>`,
  };
}

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

async function messagesView(threadId, query) {
  const threads = await api('/threads');
  const openId = threadId;
  const t = openId ? await api(`/threads/${openId}`) : null;
  if (t) {
    const row = threads.find((x) => x.id === openId);
    if (row) row.unread = 0;
  }
  setUnread(threads.filter((x) => x.unread).length);
  const composeNew = !openId && location.hash.startsWith('#/messages/new');
  let samples = [];
  if (composeNew) samples = await api('/samples?status=all');
  const preSample = query.sample ? +query.sample : null;
  const list = html`<section class="card threads-card">
    <div class="card-head"><h2>Conversations</h2><a class="btn btn-sm" href="#/messages/new">${ic('plus', 15)} New</a></div>
    ${threads.length ? html`<ul class="list threads">${threads.map((x) => html`<li class="${x.unread ? 'unread' : ''}"><a class="item" href="${`#/messages/${x.id}`}" aria-current="${String(x.id === openId)}">
      <div class="grow"><div class="row"><span class="t grow ellipsis">${x.subject}</span>${x.unread ? html`<span class="udot" aria-label="Unread"></span>` : ''}<span class="tiny faint nowrap">${relTime(x.last_message_at)}</span></div><div class="s ellipsis">${x.last_author}: ${x.excerpt}</div></div>
    </a></li>`)}</ul>` : empty('message', 'No conversations yet.')}
  </section>`;
  let pane;
  if (composeNew) {
    pane = html`<form class="card" id="newthread" novalidate>
      <div class="thread-head"><h2>New message</h2><p class="small muted" style="margin-top:2px">Goes to the team handling your account. We reply within one working day.</p></div>
      <div class="card-pad stack">
        <div class="form-error"></div>
        <label class="field"><span class="label">Subject</span><input class="input" name="subject" required maxlength="200" value="${preSample ? `Question about ${samples.find((s) => s.id === preSample)?.code || 'a sample'}` : ''}"></label>
        <label class="field"><span class="label">Related sample <span class="opt">(optional)</span></span><select class="select" name="sample_id"><option value="">None</option>${samples.map((s) => html`<option value="${s.id}" ${s.id === preSample ? raw('selected') : ''}>${s.code} — ${s.description}${s.batch_no ? ` (${s.batch_no})` : ''}</option>`)}</select></label>
        <label class="field"><span class="label">Message</span><textarea class="textarea" name="body" required style="min-height:160px"></textarea></label>
      </div>
      <div class="form-actions"><a class="btn btn-quiet" href="#/messages">Cancel</a><button class="btn btn-primary" type="submit">${ic('send', 16)} Send</button></div>
    </form>`;
  } else if (t) {
    const th = t.thread;
    const link = th.submission_id ? html`<a class="mono" href="${`#/submissions/${th.submission_id}`}">${th.submission_code}</a>` : th.request_id ? html`<a class="mono" href="${`#/requests/${th.request_id}`}">${th.request_code}</a>` : th.sample_id ? html`<a class="mono" href="${`#/samples/${th.sample_id}`}">${th.sample_code}</a>` : '';
    pane = html`<section class="card">
      <div class="thread-head"><a class="back" href="#/messages" style="margin-bottom:8px" data-phone-only>${ic('arrowLeft', 15)} All conversations</a><h2>${th.subject}</h2><p class="small muted" style="margin-top:2px">Started ${fmtDate(th.created_at)}${link ? html` · ${link}` : ''}</p></div>
      <div class="msgs" id="msgs">${t.messages.map((m) => html`<div class="msg ${m.side}"><div class="meta">${m.side === 'client' ? 'You' : m.author_name} · ${relTime(m.created_at)}</div><div class="bubble">${m.body}</div></div>`)}</div>
      <form id="reply" novalidate>
        <div class="composer">
          <label class="grow"><span class="sr-only">Reply</span><textarea class="textarea" name="body" rows="1" placeholder="Write a reply…" required></textarea></label>
          <button class="btn btn-primary" type="submit">${ic('send', 16)} Send</button>
        </div>
        <div class="form-error" style="padding:0 20px 14px"></div>
      </form>
    </section>`;
  } else {
    pane = html`<section class="card">${empty('message', threads.length ? 'Choose a conversation, or start a new one.' : 'Start a conversation with the laboratory.', html`<a class="btn btn-primary btn-sm" href="#/messages/new">New message</a>`)}</section>`;
  }
  const phoneShowsPane = composeNew || !!t;
  return {
    title: t ? t.thread.subject : 'Messages',
    html: html`
      <div class="page-head"><div><div class="eyebrow">${state.me.client.name}</div><h1>Messages</h1><p class="sub">Talk directly with the scientists and coordinators working on your samples.</p></div></div>
      <div class="inbox ${phoneShowsPane ? 'has-pane' : ''}">
        <div class="list-pane">${list}</div>
        <div class="thread-pane">${pane}</div>
      </div>`,
    mount(root) {
      // On phones show either the list or the open conversation, never both.
      if (window.matchMedia('(max-width: 959px)').matches) {
        $('.list-pane', root).hidden = phoneShowsPane;
        $('.thread-pane', root).hidden = !phoneShowsPane;
      } else $$('[data-phone-only]', root).forEach((el) => el.remove());
      const msgs = $('#msgs', root);
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      const nf = $('#newthread', root);
      nf?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = formData(nf);
        const res = await submitting(nf, () => post('/threads', { subject: d.subject, body: d.body, sample_id: d.sample_id || null }));
        if (res) { toast('Message sent'); location.hash = `#/messages/${res.id}`; }
      });
      const rf = $('#reply', root);
      if (rf) {
        const ta = $('textarea', rf);
        const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`; };
        ta.addEventListener('input', grow);
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) rf.requestSubmit(); });
        rf.addEventListener('submit', async (e) => {
          e.preventDefault();
          const body = ta.value.trim();
          if (!body) return;
          const ok = await submitting(rf, () => post(`/threads/${openId}/messages`, { body }));
          if (ok) route();
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------------------------

function accountView() {
  const { user, client } = state.me;
  const theme = store.read().theme || 'system';
  return {
    title: 'Account',
    html: html`
      <div class="page-head"><div><div class="eyebrow">${state.me.client.name}</div><h1>Account & security</h1><p class="sub">Your sign-in details for the ${state.info.lab_name} client portal.</p></div></div>
      <div class="cols">
        <section class="card">
          <div class="card-head"><h2>Change password</h2></div>
          <form class="card-pad" id="pwform" novalidate>
            <div class="form-error"></div>
            ${passwordFields(false)}
            <div class="row" style="justify-content:flex-end;margin-top:22px"><button class="btn btn-primary" type="submit">Update password</button></div>
            <p class="hint">Changing your password signs you out on every other device.</p>
          </form>
        </section>
        <div class="stack">
          <section class="card card-pad">
            <h2 style="margin-bottom:16px">Profile</h2>
            <dl class="facts">
              <dt>Name</dt><dd>${user.full_name}</dd>
              <dt>Email</dt><dd>${user.email}</dd>
              ${user.job_title ? html`<dt>Role</dt><dd>${user.job_title}</dd>` : ''}
              <dt>Organisation</dt><dd>${client.name}</dd>
              <dt>Last sign-in</dt><dd>${fmtDateTime(user.last_login_at)}</dd>
            </dl>
            <p class="hint" style="margin-top:16px">To change these details or add colleagues, message the laboratory.</p>
          </section>
          <section class="card card-pad">
            <h2 style="margin-bottom:14px">Appearance</h2>
            <div class="seg" role="group" aria-label="Theme">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => html`<button type="button" data-theme-set="${k}" aria-pressed="${String(k === theme)}">${l}</button>`)}</div>
          </section>
          <button class="btn btn-block js-out" type="button">${ic('logout', 16)} Sign out</button>
        </div>
      </div>`,
    mount(root) {
      const form = $('#pwform', root);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ok = await submitting(form, async () => { await changePassword(form); return true; });
        if (ok) { form.reset(); toast('Password updated'); }
      });
      $$('[data-theme-set]', root).forEach((b) => b.addEventListener('click', () => {
        applyTheme(b.dataset.themeSet);
        $$('[data-theme-set]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }));
      $('.js-out', root).addEventListener('click', signOut);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------

async function boot() {
  try {
    state.info ||= await api('/info');
    store.set({ lab: state.info.lab_name });
    const sn = $('#splash-name');
    if (sn) sn.textContent = state.info.lab_name;
  } catch (e) {
    app.innerHTML = String(html`<div class="auth-form" style="padding:96px 16px;text-align:center"><h1>We can't reach the portal right now</h1><p class="lede">${e.message}</p><button class="btn btn-primary js-retry" style="margin-top:24px">Try again</button></div>`);
    $('.js-retry').addEventListener('click', () => location.reload());
    hideSplash();
    return;
  }
  try {
    state.me = await api('/me');
  } catch (e) {
    if (e.status === 401) { showSignIn(); return; }
    throw e;
  }
  if (state.me.user.must_change_password) { showPasswordChange(); return; }
  renderShell();
  await route();
}

window.addEventListener('hashchange', route);
setInterval(refreshUnread, 60_000);
boot();
