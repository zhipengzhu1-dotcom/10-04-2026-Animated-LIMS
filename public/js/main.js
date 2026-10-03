// App shell: boot, routing, sidebar, top bar, command palette.
import { html } from './core/html.js';
import { api, setApiHooks } from './core/api.js';
import { state, can, roleLabel } from './core/state.js';
import { icon, LOGO } from './core/icons.js';
import { avatar, emptyState, promptReason, modalOpen } from './core/ui.js';
import { openPalette } from './core/palette.js';
import { renderLogin, renderSetup, renderForcedPasswordChange } from './views/auth.js';

import * as dashboard from './views/dashboard.js';
import * as samples from './views/samples.js';
import * as tests from './views/tests.js';
import * as reviews from './views/reviews.js';
import * as notebook from './views/notebook.js';
import * as methods from './views/methods.js';
import * as instruments from './views/instruments.js';
import * as inventory from './views/inventory.js';
import * as investigations from './views/investigations.js';
import * as clients from './views/clients.js';
import * as projects from './views/projects.js';
import * as invoices from './views/invoices.js';
import * as insights from './views/insights.js';
import * as portalInbox from './views/portal-inbox.js';
import * as team from './views/team.js';
import * as audit from './views/audit.js';
import * as settings from './views/settings.js';
import * as account from './views/account.js';
import * as print from './views/print.js';

// [path pattern, view function, nav key]
const ROUTES = [
  ['/', dashboard.render, 'dashboard'],
  ['/samples', samples.list, 'samples'],
  ['/samples/receive', samples.receive, 'samples'],
  ['/samples/:id', samples.detail, 'samples'],
  ['/worklist', tests.worklist, 'worklist'],
  ['/tests/:id', tests.detail, 'worklist'],
  ['/reviews', reviews.render, 'reviews'],
  ['/notebook', notebook.list, 'notebook'],
  ['/notebook/:id', notebook.detail, 'notebook'],
  ['/methods', methods.list, 'methods'],
  ['/methods/new', methods.edit, 'methods'],
  ['/methods/:id', methods.detail, 'methods'],
  ['/methods/:id/edit', methods.edit, 'methods'],
  ['/instruments', instruments.list, 'instruments'],
  ['/instruments/:id', instruments.detail, 'instruments'],
  ['/inventory', inventory.list, 'inventory'],
  ['/inventory/:id', inventory.detail, 'inventory'],
  ['/investigations', investigations.list, 'investigations'],
  ['/investigations/:id', investigations.detail, 'investigations'],
  ['/clients', clients.list, 'clients'],
  ['/clients/:id', clients.detail, 'clients'],
  ['/projects', projects.list, 'projects'],
  ['/projects/:id', projects.detail, 'projects'],
  ['/invoices', invoices.list, 'invoices'],
  ['/invoices/:id', invoices.detail, 'invoices'],
  ['/insights', insights.render, 'insights'],
  ['/portal-inbox', portalInbox.render, 'portal'],
  ['/portal-inbox/submissions/:id', portalInbox.submission, 'portal'],
  ['/portal-inbox/requests/:id', portalInbox.request, 'portal'],
  ['/team', team.list, 'team'],
  ['/team/training', team.training, 'team'],
  ['/team/:id', team.detail, 'team'],
  ['/audit', audit.render, 'audit'],
  ['/settings', settings.render, 'settings'],
  ['/account', account.render, 'account'],
  ['/print/coa/:id', print.coa, null],
  ['/print/labels', print.labels, null],
  ['/print/invoice/:id', print.invoice, null],
].map(([pattern, view, nav]) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { pattern, re, keys, view, nav };
});

const NAV = [
  { group: null, items: [
    { key: 'dashboard', href: '/', label: 'Dashboard', icon: 'dashboard' },
  ] },
  { group: 'Laboratory', items: [
    { key: 'samples', href: '/samples', label: 'Samples', icon: 'tube' },
    { key: 'worklist', href: '/worklist', label: 'Worklist', icon: 'worklist', badge: 'myTests', perm: ['tests.perform', 'tests.assign'] },
    { key: 'reviews', href: '/reviews', label: 'Reviews & approvals', icon: 'review', badge: 'reviews', hot: true, perm: ['tests.review', 'tests.approve', 'notebook.witness', 'reports.issue'] },
    { key: 'notebook', href: '/notebook', label: 'Lab notebook', icon: 'book' },
  ] },
  { group: 'Resources', items: [
    { key: 'methods', href: '/methods', label: 'Methods', icon: 'method' },
    { key: 'instruments', href: '/instruments', label: 'Instruments', icon: 'instrument' },
    { key: 'inventory', href: '/inventory', label: 'Standards & reagents', icon: 'package' },
  ] },
  { group: 'Quality', items: [
    { key: 'investigations', href: '/investigations', label: 'Investigations', icon: 'alert', badge: 'investigations', red: true },
    { key: 'audit', href: '/audit', label: 'Audit trail', icon: 'shield', perm: ['audit.view'] },
  ] },
  { group: 'Business', items: [
    { key: 'clients', href: '/clients', label: 'Clients', icon: 'building' },
    { key: 'projects', href: '/projects', label: 'Projects', icon: 'folder' },
    { key: 'invoices', href: '/invoices', label: 'Invoices', icon: 'receipt', perm: ['billing.view'] },
    { key: 'portal', href: '/portal-inbox', label: 'Client portal', icon: 'inbox', badge: 'portal', perm: ['portal.view'] },
    { key: 'insights', href: '/insights', label: 'Insights', icon: 'chart', perm: ['insights.view'] },
  ] },
  { group: 'Organisation', items: [
    { key: 'team', href: '/team', label: 'Team & training', icon: 'users' },
    { key: 'settings', href: '/settings', label: 'Settings', icon: 'settings', perm: ['settings.edit'] },
  ] },
];

const root = document.getElementById('root');
let currentNav = null;
let renderSeq = 0;

// ---------------------------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------------------------

function currentTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('aq-theme', next); } catch { /* ignore */ }
  document.querySelectorAll('[data-theme-icon]').forEach((el) => { el.innerHTML = String(icon(next === 'dark' ? 'sun' : 'moon', { size: 16 })); });
}

// Compact spacing is the default; "comfortable" restores roomier controls (e.g. for bench touchscreens).
const isComfortable = () => document.documentElement.getAttribute('data-density') === 'comfortable';
const densityLabel = () => (isComfortable() ? 'Compact spacing' : 'Comfortable spacing');
function toggleDensity() {
  const comfortable = !isComfortable();
  if (comfortable) document.documentElement.setAttribute('data-density', 'comfortable');
  else document.documentElement.removeAttribute('data-density');
  try { localStorage.setItem('aq-density', comfortable ? 'comfortable' : 'compact'); } catch { /* ignore */ }
  document.querySelectorAll('[data-density-label]').forEach((el) => { el.textContent = densityLabel(); });
}

// The sidebar can collapse to an icon rail on desktop; on narrow screens the same button opens it off-canvas.
const isNarrow = () => matchMedia('(max-width: 860px)').matches;
function toggleRail() {
  const rail = !document.documentElement.hasAttribute('data-rail');
  document.documentElement.toggleAttribute('data-rail', rail);
  try { localStorage.setItem('aq-rail', rail ? '1' : '0'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------------------------

const visible = (item) => !item.perm || item.perm.some((p) => can(p));

function newMenuItems() {
  return [
    can('samples.receive') && { href: '/samples/receive', label: 'Receive samples', icon: 'inbox', kbd: '' },
    can('notebook.write') && { action: 'notebook', label: 'Notebook entry', icon: 'book' },
    can('investigations.raise') && { action: 'investigation', label: 'Investigation / deviation', icon: 'alert' },
    can('methods.edit') && { href: '/methods/new', label: 'Method', icon: 'method' },
    can('projects.edit') && { action: 'project', label: 'Project', icon: 'folder' },
    can('clients.edit') && { action: 'client', label: 'Client', icon: 'building' },
    can('instruments.edit') && { action: 'instrument', label: 'Instrument', icon: 'instrument' },
    can('inventory.edit') && { action: 'inventory', label: 'Standard / reagent', icon: 'package' },
    can('billing.edit') && { action: 'invoice', label: 'Invoice', icon: 'receipt' },
    can('users.manage') && { action: 'user', label: 'Team member', icon: 'user' },
  ].filter(Boolean);
}

export async function runNewAction(action) {
  const map = {
    notebook: () => notebook.newEntry(),
    investigation: () => investigations.newInvestigation(),
    project: () => projects.newProject(),
    client: () => clients.newClient(),
    instrument: () => instruments.newInstrument(),
    inventory: () => inventory.newItem(),
    invoice: () => invoices.newInvoice(),
    user: () => team.newUser(),
  };
  await map[action]?.();
}

function renderShell() {
  const me = state.me;
  const newItems = newMenuItems();
  root.innerHTML = String(html`
    <div class="route-progress"></div>
    <div class="app">
      <aside class="sidebar" aria-label="Main navigation">
        <a class="brand" href="/" aria-label="Aliquot home">${LOGO}<div><div class="brand-name">Aliquot</div><div class="brand-lab">${state.settings.lab_name}</div></div></a>
        <nav class="nav">
          ${NAV.map((g) => {
            const items = g.items.filter(visible);
            if (!items.length) return '';
            return html`<div class="nav-group">${g.group ? html`<div class="nav-label">${g.group}</div>` : ''}
              ${items.map((i) => html`<a href="${i.href}" data-nav="${i.key}" title="${i.label}">${icon(i.icon, { size: 16 })}<span>${i.label}</span>${i.badge ? html`<span class="pill ${i.hot ? 'hot' : ''} ${i.red ? 'red' : ''}" data-badge="${i.badge}" hidden></span>` : ''}</a>`)}
            </div>`;
          })}
        </nav>
        <div class="sidebar-foot dropdown">
          <button class="me-btn" data-menu="me" aria-haspopup="true" title="${me.full_name}">${avatar(me.full_name, me.id, { size: 28, initials: me.initials })}<span class="grow"><strong>${me.full_name}</strong><small>${roleLabel(me.role)}</small></span>${icon('chevronUp', { size: 14 })}</button>
          <div class="dropdown-menu up" data-menu-for="me" hidden>
            <a href="/account">${icon('user')}My account</a>
            <a href="/team/${me.id}">${icon('training')}My training</a>
            <button data-act="theme"><span data-theme-icon>${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</span>Toggle dark mode</button>
            <button data-act="density">${icon('menu')}<span data-density-label>${densityLabel()}</span></button>
            <hr>
            <button data-act="logout">${icon('logout')}Sign out</button>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn menu-toggle" data-act="menu" aria-label="Toggle sidebar" title="Toggle sidebar  [">${icon('menu', { size: 17 })}</button>
          <button class="search-trigger" data-act="palette">${icon('search', { size: 14 })}<span>Search or scan a barcode…</span><kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd></button>
          <span class="spacer"></span>
          ${newItems.length ? html`<div class="dropdown">
            <button class="btn primary" data-menu="new">${icon('plus', { size: 14 })}<span class="hide-sm">New</span>${icon('chevronDown', { size: 13 })}</button>
            <div class="dropdown-menu" data-menu-for="new" hidden>
              ${newItems.map((i) => (i.href ? html`<a href="${i.href}">${icon(i.icon)}${i.label}</a>` : html`<button data-new="${i.action}">${icon(i.icon)}${i.label}</button>`))}
            </div>
          </div>` : ''}
          <button class="icon-btn" data-act="theme" title="Toggle dark mode" aria-label="Toggle dark mode"><span data-theme-icon>${icon(currentTheme() === 'dark' ? 'sun' : 'moon', { size: 16 })}</span></button>
        </header>
        ${state.settings.demo_mode ? html`<div class="demo-banner">${icon('sparkle', { size: 14 })}<span>Demo data — explore freely. Everyone's password is <strong>demo1234</strong>. Switch accounts from the menu at bottom-left (Sign out).</span></div>` : ''}
        <main class="content" id="content" tabindex="-1"></main>
      </div>
    </div>`);

  root.addEventListener('click', onShellClick);
}

function closeMenus(except) {
  root.querySelectorAll('[data-menu-for]').forEach((m) => { if (m !== except) m.hidden = true; });
}

async function onShellClick(e) {
  const menuBtn = e.target.closest('[data-menu]');
  if (menuBtn) {
    const menu = root.querySelector(`[data-menu-for="${menuBtn.dataset.menu}"]`);
    closeMenus(menu);
    menu.hidden = !menu.hidden;
    e.stopPropagation();
    return;
  }
  if (!e.target.closest('.dropdown-menu')) closeMenus();
  else setTimeout(() => closeMenus(), 0);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'theme') toggleTheme();
  if (act === 'palette') openPalette({ newItems: newMenuItems(), runNewAction });
  if (act === 'density') toggleDensity();
  if (act === 'menu') {
    if (isNarrow()) root.querySelector('.app').classList.toggle('nav-open');
    else toggleRail();
  }
  if (act === 'logout') {
    await api.post('/api/auth/logout').catch(() => {});
    location.href = '/';
  }
  const nw = e.target.closest('[data-new]');
  if (nw) runNewAction(nw.dataset.new);
  if (e.target.closest('.nav a')) root.querySelector('.app')?.classList.remove('nav-open');
}

// Generic dropdowns in views: <div class="dropdown"><button data-dd>…</button><div class="dropdown-menu" hidden>…</div></div>
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-dd]');
  const menus = document.querySelectorAll('.dropdown-menu');
  if (toggle) {
    const menu = toggle.nextElementSibling;
    const wasHidden = menu.hidden;
    menus.forEach((m) => { m.hidden = true; });
    menu.hidden = !wasHidden;
    return;
  }
  const inside = e.target.closest('.dropdown');
  menus.forEach((m) => {
    if (!inside || !inside.contains(m) || e.target.closest('.dropdown-menu button, .dropdown-menu a')) m.hidden = true;
  });
});

async function refreshBadges() {
  if (!state.me) return;
  try {
    state.nav = await api.get('/api/nav');
    root.querySelectorAll('[data-badge]').forEach((b) => {
      const n = state.nav[b.dataset.badge] || 0;
      b.textContent = n > 99 ? '99+' : n;
      b.hidden = !n;
    });
  } catch { /* non-critical */ }
}
let badgeTimer;
const scheduleBadges = () => { clearTimeout(badgeTimer); badgeTimer = setTimeout(refreshBadges, 250); };
window.addEventListener('aq:nav-refresh', scheduleBadges);
setInterval(() => { if (document.visibilityState === 'visible') refreshBadges(); }, 60_000);

// ---------------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------------

function match(pathname) {
  for (const r of ROUTES) {
    const m = r.re.exec(pathname);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

export function go(path, { replace = false } = {}) {
  if (path === location.pathname + location.search && !replace) return renderRoute({ keepScroll: false });
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  return renderRoute();
}

async function renderRoute({ keepScroll = false } = {}) {
  const seq = ++renderSeq;
  const found = match(location.pathname);
  const isPrint = location.pathname.startsWith('/print/');
  if (isPrint) {
    root.removeEventListener('click', onShellClick);
    currentNav = null;
  } else if (!root.querySelector('.app')) {
    renderShell();
  }
  const container = isPrint ? root : document.getElementById('content');
  const progress = root.querySelector('.route-progress');
  progress?.classList.remove('done');
  progress?.classList.add('on');
  const scrollY = window.scrollY;

  const el = document.createElement('div');
  el.className = 'view';
  const ctx = {
    el,
    params: found?.params || {},
    query: Object.fromEntries(new URLSearchParams(location.search)),
    refresh: () => renderRoute({ keepScroll: true }),
    title: (t) => { document.title = t ? `${t} · Aliquot` : 'Aliquot'; },
    isCurrent: () => seq === renderSeq,
  };
  try {
    if (!found) throw Object.assign(new Error('Page not found'), { status: 404 });
    await found.route.view(ctx);
  } catch (e) {
    if (e.status === 401) return undefined;
    el.innerHTML = String(html`<div class="error-page">${emptyState({
      icon: e.status === 404 ? 'search' : e.status === 403 ? 'lock' : 'alert',
      title: e.status === 404 ? 'Not found' : e.status === 403 ? 'Access restricted' : 'Something went wrong',
      text: e.message,
      action: html`<a class="btn" href="/">Back to dashboard</a>`,
    })}</div>`);
  }
  if (seq !== renderSeq) return undefined;
  container.replaceChildren(el);
  progress?.classList.remove('on');
  progress?.classList.add('done');
  window.scrollTo(0, keepScroll ? scrollY : 0);
  if (!keepScroll && !isPrint) document.getElementById('content')?.focus({ preventScroll: true });
  if (!isPrint) {
    const nav = found?.route.nav;
    if (nav !== currentNav) {
      root.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
      currentNav = nav;
    }
    scheduleBadges();
  }
  // Views may register post-insert hooks (charts and editors need layout).
  el.dispatchEvent(new Event('aq:mounted'));
  return undefined;
}

window.addEventListener('popstate', () => renderRoute());
window.addEventListener('aq:navigate', (e) => {
  const d = e.detail;
  const path = typeof d === 'string' ? d : d.path;
  go(path, { replace: typeof d === 'object' && d.replace });
});

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('/api/') || a.target || a.hasAttribute('download')) return;
  e.preventDefault();
  if (!state.me) return;
  go(href);
});

document.addEventListener('keydown', (e) => {
  if (!state.me || modalOpen()) return;
  const inField = e.target.closest?.('input, textarea, select, [contenteditable]');
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !inField)) {
    e.preventDefault();
    openPalette({ newItems: newMenuItems(), runNewAction });
  }
  if (e.key === '[' && !inField && !e.metaKey && !e.ctrlKey && !e.altKey && !isNarrow()) {
    e.preventDefault();
    toggleRail();
  }
});

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------

async function loadSession() {
  const me = await api.get('/api/auth/me');
  state.me = me.user;
  state.permissions = new Set(me.permissions);
  state.settings = me.settings;
  if (me.user.must_change_password) return 'password';
  state.lookups = await api.get('/api/lookups');
  return 'ok';
}

export async function startApp() {
  root.innerHTML = '';
  const status = await loadSession();
  if (status === 'password') {
    renderForcedPasswordChange(root, startApp);
    return;
  }
  renderShell();
  await renderRoute();
  refreshBadges();
}

function signedOut(message) {
  state.me = null;
  document.querySelectorAll('.modal-backdrop, .viz-tip').forEach((el) => el.remove());
  renderLogin(root, { message, onSuccess: startApp });
}

// Shared bench computers: sign out an idle browser so results aren't left on screen (mirrors the server-side timeout).
let lastActivity = Date.now();
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true });
setInterval(async () => {
  if (!state.me) return;
  const minutes = state.settings.session_idle_minutes || 60;
  if (Date.now() - lastActivity > minutes * 60_000) {
    await api.post('/api/auth/logout').catch(() => {});
    signedOut(`You were signed out after ${minutes} minutes without activity.`);
  }
}, 15_000);

setApiHooks({
  onAuthLost: (message) => {
    if (!state.me) return;
    signedOut(message);
  },
  onPasswordChange: () => renderForcedPasswordChange(root, startApp),
  onReasonRequired: (message) => promptReason(message),
});

async function boot() {
  try {
    const { needsSetup, local, demoAllowed } = await api.get('/api/setup');
    if (needsSetup) {
      if (local) renderSetup(root, startApp, { demoAllowed });
      else root.innerHTML = String(html`<div class="error-page">${emptyState({ icon: 'lock', title: 'Aliquot is not set up yet', text: 'For security, the first-time setup has to be done on the computer that runs Aliquot. Open http://localhost:3000 there, then come back to this address.' })}</div>`);
      return;
    }
    await startApp();
  } catch (e) {
    if (e.status === 401) renderLogin(root, { onSuccess: startApp });
    else root.innerHTML = String(html`<div class="error-page">${emptyState({ icon: 'alert', title: 'Aliquot is not reachable', text: e.message, action: html`<a class="btn" href="/" target="_self">Retry</a>` })}</div>`);
  }
}

boot();
