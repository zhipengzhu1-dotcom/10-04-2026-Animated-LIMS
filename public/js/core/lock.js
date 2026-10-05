// The full-screen lock screen: staff sign-in, first-run setup, password change, and the client portal's sign-in.
// Styles live in /assets/lock.css, which both apps load.
import { html, raw } from './html.js';
import { icon, LOGO } from './icons.js';
import { createHelix, noHelix } from './helix.js';

export const z = (n) => String(n).padStart(2, '0');
export const stamp = (d = new Date()) => `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** The custom properties every helix reads its colours from: the three text greys shade its parts, faces turned from the light fade toward the page, lime verifies, orange denies. */
export const HELIX_TOKENS = { ink: '--text', ink2: '--text-2', ink3: '--text-3', paper: '--bg', signal: '--lime', alarm: '--signal' };
export const initials = (name) => String(name || '').split(/[\s._-]+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

// A head-and-shoulders silhouette filled with a halftone, as on a sealed personnel file.
export const SILHOUETTE = raw(`<svg viewBox="0 0 100 110" aria-hidden="true"><defs><pattern id="ht" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.05" fill="currentColor"/></pattern></defs>
  <path d="M50 14c13 0 21 10 21 24 0 9-3 16-8 21v6c18 4 31 13 33 45H4c2-32 15-41 33-45v-6c-5-5-8-12-8-21 0-14 8-24 21-24z" fill="url(#ht)"/></svg>`);

const RING = raw(`<svg viewBox="0 0 200 200" aria-hidden="true">
  <defs><path id="ring-text" d="M100 100 m-62 0 a62 62 0 1 1 124 0 a62 62 0 1 1 -124 0"/></defs>
  <circle class="r1" cx="100" cy="100" r="84" pathLength="100"/>
  <circle class="r2" cx="100" cy="100" r="74" pathLength="100"/>
  <circle class="r3" cx="100" cy="100" r="50" pathLength="100"/>
  <text><textPath href="#ring-text" class="ring-label">VERIFYING IDENTITY · VERIFYING IDENTITY ·</textPath></text>
</svg>`);

const clockMarkup = () => html`<div class="lock-clock" aria-hidden="true"><div class="lc-ticks">${raw('<i></i>'.repeat(5))}</div><div class="lc-time"><span data-hm>--:--</span><sup data-ss>--</sup></div><div class="lc-date" data-date></div></div>`;

const STAFF_TAGLINE = ['Aliquot LIMS · ELN', 'Sample to signed CoA', 'Full audit trail'];

/**
 * The lock-screen frame: brand rail, sculpture, clock, the glass card (`panel`) and the status line.
 * Staff sign-in, setup and password change use the defaults; the client portal passes its own words.
 */
export function lockFrame({
  labName, ghost, panel, message, sub,
  variant = 'staff',
  os = raw('Analysis <b>OS</b>'),
  tagline = STAFF_TAGLINE,
  chips = [location.protocol === 'https:' ? 'Encrypted connection' : 'Lab network only', 'Audit trail on', 'Data stays on site'],
}) {
  return html`
    <div class="lock" data-state="idle" data-variant="${variant}">
      <canvas class="lock-helix" aria-hidden="true"></canvas>
      <div class="lock-grain" aria-hidden="true"></div>
      <header class="lock-brand">
        <div class="lb-word">Aliquot</div>
        <div class="lb-tag">Laboratory information</div>
        <div class="lb-os">${os}</div>
      </header>
      <div class="lock-side" aria-hidden="true">
        <div class="ls-dash"></div>
        <p class="micro">${tagline.map((t, i) => html`${i ? raw('<br>') : ''}${t}`)}</p>
        <ol class="lock-log" data-log></ol>
        <div class="ls-keys micro"><span><kbd>Enter</kbd> request</span><span><kbd>Tab</kbd> next field</span></div>
        <div class="ls-section"><span></span><b class="ls-n">${labName}</b><b class="ls-d">Lockdown active</b></div>
      </div>
      <div class="lock-seal" aria-hidden="true">
        <span class="micro">Locked</span>
        <div class="seal-slab">${LOGO}<span class="seal-word">${initials(labName) || 'AQ'}</span><i class="seal-dot"></i><small>Sealed section</small></div>
      </div>
      ${clockMarkup()}
      <section class="lock-panel"><div class="lp-ghost" aria-hidden="true">${ghost}</div><div class="lp-body">${panel}</div></section>
      <footer class="lock-foot" aria-hidden="true">${chips.map((c) => html`<span>${c}</span>`)}<span class="spacer"></span><span>Powered by <b>Aliquot</b></span></footer>
      <p class="lock-msg" data-msg>${message}<small data-msg-sub>${sub}</small></p>
      <div class="lock-verify" aria-hidden="true">${RING}<div class="lv-bar"><i></i></div><span class="micro">Processing</span></div>
      <div class="lock-warning" aria-hidden="true">
        <div class="lw-head">${icon('alert', { size: 18 })}<span>Warning</span></div>
        <ul><li>Authentication failed</li><li data-warn-msg></li><li data-warn-attempt></li></ul>
      </div>
    </div>`;
}

/** Wires the live parts of a mounted frame: clock, helix, event log. Returns controls; stops itself when removed. */
export function mountLock(root) {
  const lock = root.querySelector('.lock');
  // three.js arrives asynchronously; until it does, the helix controls go to a stand-in that does nothing.
  let live = noHelix;
  const pending = createHelix(lock.querySelector('.lock-helix'), { cx: 0.42, cy: 0.5, span: 1.9, colours: HELIX_TOKENS });
  pending.then((h) => { live = h; h.setMode(lock.dataset.state); });
  const helix = { pulse: () => live.pulse(), flyIn: () => live.flyIn() };
  const hm = lock.querySelector('[data-hm]');
  const ss = lock.querySelector('[data-ss]');
  const date = lock.querySelector('[data-date]');
  const log = lock.querySelector('[data-log]');
  const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const tick = () => {
    if (!lock.isConnected) { clearInterval(timer); pending.then((h) => h.destroy()); return; }
    const d = new Date();
    hm.textContent = `${z(d.getHours())}:${z(d.getMinutes())}`;
    ss.textContent = z(d.getSeconds());
    date.textContent = dateFmt.format(d).replace(',', ' ·').toUpperCase();
  };
  const timer = setInterval(tick, 1000);
  tick();
  const addLog = (text, tone = '') => {
    const li = document.createElement('li');
    li.className = tone;
    li.innerHTML = String(html`<time>${stamp()}</time><span>${text}</span>`);
    log.append(li);
    while (log.children.length > 7) log.firstElementChild.remove();
  };
  addLog('Lock engaged');
  const setState = (s) => {
    lock.dataset.state = s;
    live.setMode(s);
  };
  return { lock, helix, addLog, setState };
}

/** Shows `message` in the form's alert slot, or hides the slot when it is empty. */
export function lockError(form, message) {
  let box = form.querySelector('.form-error');
  if (!box) {
    box = document.createElement('div');
    box.className = 'form-error';
    box.setAttribute('role', 'alert');
    form.prepend(box);
  }
  box.textContent = message;
  box.hidden = !message;
}

/** Submit choreography: verify ring while the request runs, then a granted fly-in or a lockdown cut. */
export function lockFlow(ctl, msg) {
  let attempt = 0;
  let lockdownTimer;
  const msgEl = ctl.lock.querySelector('[data-msg]');
  const setMsg = (text, sub) => { msgEl.firstChild.textContent = text; msgEl.querySelector('[data-msg-sub]').textContent = sub; };
  const endLockdown = () => {
    if (ctl.lock.dataset.state !== 'denied') return;
    clearTimeout(lockdownTimer);
    ctl.setState('idle');
    setMsg(msg.idle, msg.idleSub);
  };
  ctl.lock.addEventListener('input', () => { endLockdown(); ctl.helix.pulse(); });
  return {
    endLockdown,
    async run(request) {
      endLockdown();
      attempt++;
      ctl.setState('verify');
      setMsg('Cross-checking authorization key…', 'Verifying · key handed to the laboratory server');
      ctl.addLog(`Verify ${z(attempt)}`);
      try {
        await Promise.all([request(), sleep(still() ? 0 : 650)]);
      } catch (e) {
        ctl.addLog(`Denied ${z(attempt)}`, 'bad');
        ctl.lock.querySelector('[data-warn-msg]').textContent = e.message;
        ctl.lock.querySelector('[data-warn-attempt]').textContent = `Attempt ${z(attempt)} · recorded in the audit trail`;
        ctl.setState('denied');
        setMsg('Access denied. The attempt has been recorded.', 'Denied · recovers automatically, or just retype');
        lockdownTimer = setTimeout(endLockdown, 1800);
        throw e;
      }
      ctl.addLog('Granted', 'ok');
      ctl.setState('granted');
      setMsg('Access granted.', 'Session unsealed · loading workspace');
      const fly = ctl.helix.flyIn();
      landings.set(ctl.lock, fly.landed);
      await fly.handoff;
    },
  };
}

// When each granted lock's fly-in lands, so a lifted lock knows when it may go.
const landings = new WeakMap();

/**
 * Lifts the granted lock out of `host` into a fixed overlay, so the caller can replace `host` beneath it while the helix
 * finishes its dive. The overlay keeps its paper until reveal(el) grows `el` in: then the paper and the lock's last
 * words fade, the strands sweep off over `el`, and the overlay goes once the dive has landed. Without a granted lock in
 * `host`, reveal does nothing, so callers can use it on every path.
 */
export function liftLock(host) {
  const lock = host.querySelector('.lock[data-state="granted"]');
  const landed = lock && landings.get(lock);
  if (!landed) return () => {};
  const paper = document.createElement('div');
  paper.className = 'lock-paper';
  paper.style.background = getComputedStyle(lock).background;
  lock.style.background = 'none';
  // Moving an element restarts its CSS animations, which would bring the unsealed card back; hold each part as it is.
  const held = [...lock.children].map((c) => [c, getComputedStyle(c).opacity]);
  for (const [c, opacity] of held) Object.assign(c.style, { animation: 'none', opacity });
  lock.prepend(paper);
  lock.classList.add('lifted');
  document.body.append(lock);
  return (el) => {
    lock.classList.add('revealed');
    if (el) {
      el.classList.add('arrive');
      el.addEventListener('animationend', function done(e) { if (e.target === el) { el.classList.remove('arrive'); el.removeEventListener('animationend', done); } });
    }
    const fades = [...lock.children].filter((c) => !c.matches('.lock-helix')).map((c) => c.animate(
      { opacity: [getComputedStyle(c).opacity, 0] },
      { duration: still() ? 0 : 260, easing: 'ease-out', fill: 'forwards' },
    ).finished);
    Promise.all([landed, ...fades]).then(() => lock.remove());
  };
}
