// App shell: boot, routing, sidebar, top bar, command palette.
import { html } from './core/html.js';
import { api, setApiHooks } from './core/api.js';
import { state, can, shipped, roleLabel } from './core/state.js';
import { icon, LOGO } from './core/icons.js';
import { avatar, emptyState, promptReason, modalOpen } from './core/ui.js';
import { openPalette } from './core/palette.js';
import { renderLogin, renderSetup, renderForcedPasswordChange } from './views/auth.js';
import { createRibbon } from './core/ribbon.js';
import { snapshot, settle } from './core/motion.js';

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

// The start page: the Dashboard, or the Samples list when the Dashboard is withheld.
const startPage = (ctx) => (shipped('dashboard') ? dashboard.render(ctx) : samples.list(ctx));

// [path pattern, view function, nav key, module (defaults to the nav key; a Withheld module's routes fall through to not found)]
// A route whose nav key names a Withheld module highlights its own module instead (the Test page goes under Samples).
const ROUTES = [
  ['/', startPage, 'dashboard', 'samples'],
  ['/samples', samples.list, 'samples'],
  ['/samples/receive', samples.receive, 'samples'],
  ['/samples/:id', samples.detail, 'samples'],
  ['/worklist', tests.worklist, 'worklist'],
  ['/tests/:id', tests.detail, 'worklist', 'samples'],
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
  ['/account', account.render, 'account', null],
  ['/print/coa/:id', print.coa, null],
  ['/print/labels', print.labels, null],
  ['/print/invoice/:id', print.invoice, null],
].map(([pattern, view, nav, module = nav]) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { pattern, re, keys, view, nav, module };
});

// Each item's `key` is its module key: a Withheld module's item is left out.
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
let lastPath = null;
let stayNext = false;

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

// Interface intensity: "tuned" (default) keeps the work screens calm; "full" adds the HUD theatre
// (ambient sculpture, corner brackets, ghost type, readout strip). Remembered per computer like density.
const hudMode = () => (document.documentElement.getAttribute('data-hud') === 'full' ? 'full' : 'tuned');
let ambient = null;
function syncAmbient() {
  const host = root.querySelector('.hud-ambient');
  if (hudMode() === 'full' && host && !ambient) ambient = createRibbon(host.querySelector('canvas'), { cx: 0.6, cy: 0.52, scale: 0.4, slats: 260, fps: 30 });
  if ((hudMode() !== 'full' || !host) && ambient) { ambient.destroy(); ambient = null; }
}
function setHud(mode) {
  if (mode === 'full') document.documentElement.setAttribute('data-hud', 'full');
  else document.documentElement.removeAttribute('data-hud');
  try { localStorage.setItem('aq-hud', mode); } catch { /* ignore */ }
  root.querySelectorAll('[data-hud-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.hudSet === mode)));
  root.querySelectorAll('[data-hud-label]').forEach((el) => { el.textContent = hudLabel(); });
  syncAmbient();
  decorateView();
}
const hudLabel = () => (hudMode() === 'full' ? 'Tuned interface' : 'Full HUD interface');

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

const visible = (item) => shipped(item.key) && (!item.perm || item.perm.some((p) => can(p)));

function newMenuItems() {
  return [
    shipped('samples') && can('samples.receive') && { href: '/samples/receive', label: 'Receive samples', icon: 'inbox', kbd: '' },
    shipped('notebook') && can('notebook.write') && { action: 'notebook', label: 'Notebook entry', icon: 'book' },
    shipped('investigations') && can('investigations.raise') && { action: 'investigation', label: 'Investigation / deviation', icon: 'alert' },
    shipped('methods') && can('methods.edit') && { href: '/methods/new', label: 'Method', icon: 'method' },
    shipped('projects') && can('projects.edit') && { action: 'project', label: 'Project', icon: 'folder' },
    shipped('clients') && can('clients.edit') && { action: 'client', label: 'Client', icon: 'building' },
    shipped('instruments') && can('instruments.edit') && { action: 'instrument', label: 'Instrument', icon: 'instrument' },
    shipped('inventory') && can('inventory.edit') && { action: 'inventory', label: 'Standard / reagent', icon: 'package' },
    shipped('invoices') && can('billing.edit') && { action: 'invoice', label: 'Invoice', icon: 'receipt' },
    shipped('team') && can('users.manage') && { action: 'user', label: 'Team member', icon: 'user' },
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
  lastPath = null;
  const me = state.me;
  const newItems = newMenuItems();
  root.innerHTML = String(html`
    <div class="route-progress"></div>
    <div class="app">
      <aside class="sidebar" aria-label="Main navigation">
        <a class="brand" href="/" aria-label="Aliquot home">${LOGO}<div><div class="brand-name">Aliquot</div><div class="brand-os">Analysis <b>OS</b></div><div class="brand-lab">${state.settings.lab_name}</div></div></a>
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
            ${shipped('team') ? html`<a href="/team/${me.id}">${icon('training')}My training</a>` : ''}
            <button data-act="theme"><span data-theme-icon>${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</span>Toggle dark mode</button>
            <button data-act="density">${icon('menu')}<span data-density-label>${densityLabel()}</span></button>
            <button data-act="hud">${icon('sparkle')}<span data-hud-label>${hudLabel()}</span></button>
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
          <div class="readout hide-sm" aria-hidden="true"><i class="live"></i><span class="rd-date" data-clock-date></span><strong data-clock></strong></div>
          <div class="hud-switch hide-sm" role="group" aria-label="Interface">
            <button data-hud-set="tuned" aria-pressed="${String(hudMode() === 'tuned')}" title="Calm work screens">Tuned</button>
            <button data-hud-set="full" aria-pressed="${String(hudMode() === 'full')}" title="Full HUD: ambient sculpture, brackets, readouts">Full HUD</button>
          </div>
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
      <div class="hud-ambient" aria-hidden="true"><canvas></canvas></div>
      <div class="hud-strip" aria-hidden="true"><span class="hs-live">Session active</span><span>Operator <b>${me.username}</b></span><span>${roleLabel(me.role)}</span><span>Route <b data-strip-route></b></span><span class="hs-ruler"></span><span data-strip-alerts></span><span>${state.settings.lab_name}</span><b data-strip-clock></b><span>Aliquot OS</span></div>
    </div>`);
  ambient?.destroy();
  ambient = null;
  syncAmbient();
  tickClock();

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
  if (act === 'hud') setHud(hudMode() === 'full' ? 'tuned' : 'full');
  const hudSet = e.target.closest('[data-hud-set]')?.dataset.hudSet;
  if (hudSet) setHud(hudSet);
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
    const strip = root.querySelector('[data-strip-alerts]');
    if (strip) {
      const open = state.nav.investigations || 0;
      strip.textContent = open ? `${open} open investigation${open > 1 ? 's' : ''}` : 'No open investigations';
      strip.className = open ? 'hs-signal' : '';
    }
  } catch { /* non-critical */ }
}
let badgeTimer;
const scheduleBadges = () => { clearTimeout(badgeTimer); badgeTimer = setTimeout(refreshBadges, 250); };
window.addEventListener('aq:nav-refresh', scheduleBadges);
setInterval(() => { if (document.visibilityState === 'visible') refreshBadges(); }, 60_000);

// Live clock in the top bar and the HUD strip.
const clockFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
function tickClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const clock = root.querySelector('[data-clock]');
  if (clock && clock.textContent !== hm) clock.textContent = hm;
  const date = root.querySelector('[data-clock-date]');
  if (date) date.textContent = clockFmt.format(d).replace(',', ' ·');
  const strip = root.querySelector('[data-strip-clock]');
  if (strip) strip.textContent = `${hm}:${p(d.getSeconds())}`;
}
setInterval(() => { if (state.me && document.visibilityState === 'visible') tickClock(); }, 1000);

/** Labels the mounted view with its section (the eyebrow and the Full HUD ghost type) and serial-numbers its cards. */
function decorateView() {
  const view = root.querySelector('#content > .view');
  if (!view) return;
  const key = currentNav;
  const item = NAV.flatMap((g) => g.items).find((i) => i.key === key);
  const section = item?.label || (location.pathname.startsWith('/account') ? 'My account' : '');
  if (section) {
    view.dataset.section = section;
    view.dataset.code = location.pathname === '/' ? '/HOME' : location.pathname.toUpperCase();
  }
  const route = root.querySelector('[data-strip-route]');
  if (route) route.textContent = location.pathname;
  if (hudMode() !== 'full') return;
  const tag = (key || 'aq').slice(0, 3).toUpperCase();
  view.querySelectorAll('.card-head').forEach((h, i) => { h.dataset.serial = `${tag}-${String(i + 1).padStart(2, '0')}`; });
}

// ---------------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------------

/** The sidebar item a route highlights: its own, or its module's when its own is withheld. */
function activeNav(route) {
  if (shipped(route.nav) || !route.module) return route.nav;
  return route.module;
}

function match(pathname) {
  for (const r of ROUTES) {
    if (r.module && !shipped(r.module)) continue;
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
  // Same screen (a tab, a filter, a refresh after saving): no entrance, no jump to the top, no HUD sweep.
  const stay = keepScroll || stayNext || location.pathname === lastPath;
  stayNext = false;
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
      action: html`<a class="btn" href="/">Back to ${shipped('dashboard') ? 'dashboard' : 'samples'}</a>`,
    })}</div>`);
  }
  if (seq !== renderSeq) return undefined;
  const before = snapshot(container.querySelector(':scope > .view'));
  container.replaceChildren(el);
  lastPath = location.pathname;
  progress?.classList.remove('on');
  progress?.classList.add('done');
  window.scrollTo(0, stay ? scrollY : 0);
  if (!stay && !isPrint) document.getElementById('content')?.focus({ preventScroll: true });
  if (!isPrint) {
    const nav = found && activeNav(found.route);
    if (nav !== currentNav) {
      root.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
      currentNav = nav;
    }
    scheduleBadges();
    decorateView();
    settle(el, before, { still: stay });
    const content = document.getElementById('content');
    if (!stay && hudMode() === 'full') {
      content.classList.remove('sweep');
      void content.offsetWidth;
      content.classList.add('sweep');
      ambient?.pulse(1.2);
    }
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
  stayNext = !!a.closest('.view .tabs, .view .segmented');
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
  state.modules = new Set(me.modules);
  state.settings = me.settings;
  if (me.user.must_change_password) return 'password';
  state.lookups = await api.get('/api/lookups');
  return 'ok';
}

/** Loads the session and mounts the shell; `arrive` grows it out of the sign-in fly-in instead of cutting to it. */
export async function startApp({ arrive = false } = {}) {
  const status = await loadSession();
  root.innerHTML = '';
  if (status === 'password') {
    renderForcedPasswordChange(root, startApp);
    return;
  }
  renderShell();
  const app = root.querySelector('.app');
  if (arrive && app) {
    app.classList.add('arrive');
    app.addEventListener('animationend', (e) => { if (e.target === app) app.classList.remove('arrive'); });
  }
  await renderRoute();
  refreshBadges();
}

function signedOut(message) {
  state.me = null;
  document.querySelectorAll('.modal-backdrop, .viz-tip').forEach((el) => el.remove());
  renderLogin(root, { message, onSuccess: () => startApp({ arrive: true }) });
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
      if (local) renderSetup(root, () => startApp({ arrive: true }), { demoAllowed });
      else root.innerHTML = String(html`<div class="error-page">${emptyState({ icon: 'lock', title: 'Aliquot is not set up yet', text: 'For security, the first-time setup has to be done on the computer that runs Aliquot. Open http://localhost:3000 there, then come back to this address.' })}</div>`);
      return;
    }
    await startApp();
  } catch (e) {
    if (e.status === 401) renderLogin(root, { onSuccess: () => startApp({ arrive: true }) });
    else root.innerHTML = String(html`<div class="error-page">${emptyState({ icon: 'alert', title: 'Aliquot is not reachable', text: e.message, action: html`<a class="btn" href="/" target="_self">Retry</a>` })}</div>`);
  }
}

boot();
