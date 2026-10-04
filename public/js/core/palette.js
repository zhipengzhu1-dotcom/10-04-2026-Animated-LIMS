// ⌘K command palette: jump anywhere, create anything, or scan a barcode (an exact code match opens directly).
import { html } from './html.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { openModal, debounce } from './ui.js';
import { can } from './state.js';
import { navigate } from './nav.js';

// `perm`: offered only with that permission.
const PAGES = [
  { label: 'Dashboard', href: '/', icon: 'dashboard' },
  { label: 'Samples', href: '/samples', icon: 'tube' },
  { label: 'Worklist', href: '/worklist', icon: 'worklist' },
  { label: 'My tests', href: '/worklist?view=mine', icon: 'worklist' },
  { label: 'Reviews & approvals', href: '/reviews', icon: 'review' },
  { label: 'Lab notebook', href: '/notebook', icon: 'book' },
  { label: 'Methods', href: '/methods', icon: 'method' },
  { label: 'Instruments', href: '/instruments', icon: 'instrument' },
  { label: 'Standards & reagents', href: '/inventory', icon: 'package' },
  { label: 'Investigations', href: '/investigations', icon: 'alert' },
  { label: 'Clients', href: '/clients', icon: 'building' },
  { label: 'Projects', href: '/projects', icon: 'folder' },
  { label: 'Team & training', href: '/team', icon: 'users' },
  { label: 'Training matrix', href: '/team/training', icon: 'training' },
  { label: 'My account', href: '/account', icon: 'user' },
  { label: 'Invoices', href: '/invoices', icon: 'receipt', perm: 'billing.view' },
  { label: 'Insights', href: '/insights', icon: 'chart', perm: 'insights.view' },
  { label: 'Audit trail', href: '/audit', icon: 'shield', perm: 'audit.view' },
  { label: 'Settings', href: '/settings', icon: 'settings', perm: 'settings.edit' },
];

const TYPE_ICON = { Sample: 'tube', Test: 'worklist', Project: 'folder', Client: 'building', Method: 'method', Instrument: 'instrument', Inventory: 'package', Notebook: 'book', Investigation: 'alert', Invoice: 'receipt' };

export function openPalette({ newItems, runNewAction }) {
  const pages = PAGES.filter((p) => !p.perm || can(p.perm));
  const m = openModal({
    title: 'Search',
    cls: 'palette',
    size: 'lg',
    body: html`
      <div class="palette-input">${icon('search', { size: 18 })}<input type="text" placeholder="Search samples, batches, tests, methods… or scan a barcode" autocomplete="off" spellcheck="false" aria-label="Search"></div>
      <div class="palette-results" role="listbox"></div>
      <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></div>`,
  });
  const input = m.el.querySelector('input');
  const list = m.el.querySelector('.palette-results');
  let items = [];
  let active = 0;
  let pendingExact = null;
  let seq = 0;

  const draw = (groups) => {
    items = groups.flatMap((g) => g.items);
    active = Math.min(active, Math.max(0, items.length - 1));
    let i = 0;
    list.innerHTML = String(groups.filter((g) => g.items.length).map((g) => html`
      <div class="palette-group">${g.label}</div>
      ${g.items.map((it) => {
        const idx = i++;
        return html`<div class="palette-item ${idx === active ? 'active' : ''}" data-idx="${idx}" role="option">${icon(it.icon, { size: 15 })}${it.code ? html`<span class="p-code">${it.code}</span>` : ''}<span class="p-title">${it.title}</span>${it.meta ? html`<span class="p-meta">${it.meta}</span>` : ''}</div>`;
      })}`).join('') || String(html`<div class="empty"><p>No matches</p></div>`));
    list.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
  };

  const baseGroups = (q) => {
    const ql = q.toLowerCase();
    const create = newItems.filter((n) => !q || n.label.toLowerCase().includes(ql)).map((n) => ({ title: `New ${n.label.toLowerCase()}`, icon: 'plus', href: n.href, action: n.action }));
    const nav = pages.filter((p) => !q || p.label.toLowerCase().includes(ql)).map((p) => ({ title: p.label, href: p.href, icon: p.icon, meta: 'Go to' }));
    return { create, nav };
  };

  const search = debounce(async (q) => {
    const my = ++seq;
    const { create, nav } = baseGroups(q);
    if (q.length < 2) {
      draw([{ label: 'Create', items: create.slice(0, q ? 10 : 4) }, { label: 'Go to', items: nav }]);
      return;
    }
    let results = [];
    try {
      const r = await api.get('/api/search', { q });
      if (my !== seq) return;
      results = r.results.map((x) => ({ code: x.code, title: x.title, meta: `${x.type}${x.meta ? ` · ${x.meta}` : ''}`, href: x.href, icon: TYPE_ICON[x.type] || 'search' }));
      pendingExact = r.exact;
    } catch { /* show navigation only */ }
    draw([{ label: 'Records', items: results }, { label: 'Go to', items: nav.slice(0, 5) }, { label: 'Create', items: create.slice(0, 4) }]);
  }, 140);

  const open = (it) => {
    if (!it) return;
    m.close();
    if (it.action) runNewAction(it.action);
    else if (it.href) navigate(it.href);
  };

  input.addEventListener('input', () => { active = 0; pendingExact = null; search(input.value.trim()); });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); highlight(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      // Barcode scanners type the code and press Enter faster than the debounce — resolve it directly.
      if (q.length >= 2 && !pendingExact) {
        try {
          const r = await api.get('/api/search', { q });
          if (r.exact) { m.close(); navigate(r.exact); return; }
        } catch { /* fall through */ }
      }
      if (pendingExact && items[active]?.href !== pendingExact && active === 0) { m.close(); navigate(pendingExact); return; }
      open(items[active]);
    }
  });
  const highlight = () => {
    list.querySelectorAll('.palette-item').forEach((el) => el.classList.toggle('active', Number(el.dataset.idx) === active));
    list.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
  };
  list.addEventListener('click', (e) => {
    const el = e.target.closest('[data-idx]');
    if (el) open(items[Number(el.dataset.idx)]);
  });
  list.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-idx]');
    if (el && Number(el.dataset.idx) !== active) { active = Number(el.dataset.idx); highlight(); }
  });
  search('');
}
