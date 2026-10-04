// Sign-in, first-run setup and forced password change: the full-screen lock screen, outside the app shell.
import { html, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { icon, LOGO } from '../core/icons.js';
import { field, formData } from '../core/ui.js';
import { lockFrame, mountLock, lockFlow, lockError, SILHOUETTE, initials, stamp, still, sleep, z } from '../core/lock.js';

const DEMO = [
  ['priya.raman', 'Priya Raman', 'Lab Manager'],
  ['tom.fletcher', 'Tom Fletcher', 'Analyst'],
  ['sarah.lindqvist', 'Sarah Lindqvist', 'Senior Scientist'],
  ['daniel.okafor', 'Daniel Okafor', 'Quality Assurance'],
  ['grace.holloway', 'Grace Holloway', 'Business & Finance'],
  ['admin', 'Alex Morgan', 'Administrator'],
];

export async function renderLogin(root, { message, onSuccess } = {}) {
  let info = { demo: false, labName: '' };
  try { info = await api.get('/api/setup'); } catch { /* offline */ }
  document.title = 'Sign in · Aliquot';
  const labName = info.labName || 'Aliquot';
  const lockedAt = stamp();
  const panel = html`
    <div class="lp-head"><span class="micro">■ Session login</span><span class="lp-org">${info.demo ? 'Demo data' : 'Restricted'}</span></div>
    <form class="lp-form" novalidate>
      <div class="operator">
        <div class="op-photo" data-photo>${SILHOUETTE}<span class="op-initials" data-initials hidden></span><em>Classified</em></div>
        <div class="op-main">
          <div class="op-tags"><span class="op-tag">Operator</span><span class="micro">Who is signing in</span><span class="lp-lights" aria-hidden="true"><i></i><i></i><i></i></span></div>
          <label class="op-name"><span class="sr">Username</span><input name="username" required autofocus autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="Username"></label>
          <div class="op-loaded">${LOGO}<span class="micro"><b data-loaded>Awaiting operator</b><br>Identity unverified</span></div>
        </div>
      </div>
      <dl class="op-profile">
        <dt>Laboratory</dt><dd>${labName}</dd>
        <dt>Terminal</dt><dd>${location.host}</dd>
        <dt>Locked at</dt><dd>${lockedAt}</dd>
        <dt>Keymap</dt><dd>${(navigator.language || 'en').toUpperCase()}</dd>
      </dl>
      ${message ? html`<div class="lp-notice">${icon('clock', { size: 15 })}<span>${message}</span></div>` : ''}
      <div class="lp-keyhead"><span class="micro">▬ Authorization key</span><span class="micro" data-attempts>Your password</span></div>
      <label class="auth-key"><span class="sr">Password</span><input type="password" name="password" required autocomplete="current-password" placeholder="Enter password"><button class="ak-btn" type="submit"><span>Request</span>${icon('arrowRight', { size: 14 })}</button></label>
      <div class="lp-dots" aria-hidden="true" data-dots></div>
      <div class="form-error" role="alert" hidden></div>
    </form>
    ${info.demo ? html`<div class="demo-ops">
      <div class="lp-keyhead"><span class="micro">▬ Demo operators</span><span class="micro">One click · key demo1234</span></div>
      <div class="demo-grid">${DEMO.map(([u, name, role]) => html`<button type="button" data-demo="${u}" data-name="${name}"><span class="dg-ini">${initials(name)}</span><span><strong>${name}</strong><small>${role}</small></span></button>`)}</div>
    </div>` : ''}`;
  root.innerHTML = String(lockFrame({
    labName,
    ghost: 'Access',
    panel,
    message: 'Your session is locked. Present your authorization key.',
    sub: 'Your authorization key is your Aliquot password',
  }));
  const ctl = mountLock(root);
  const form = root.querySelector('form');
  const user = form.querySelector('[name=username]');
  const pass = form.querySelector('[name=password]');
  const loaded = root.querySelector('[data-loaded]');
  const ini = root.querySelector('[data-initials]');
  const dots = root.querySelector('[data-dots]');
  const attempts = root.querySelector('[data-attempts]');
  const flow = lockFlow(ctl, { idle: 'Your session is locked. Present your authorization key.', idleSub: 'Your authorization key is your Aliquot password' });
  let tries = 0;
  const showOperator = (name) => {
    const i = initials(name);
    ini.textContent = i;
    ini.hidden = !i;
    root.querySelector('[data-photo]').classList.toggle('known', !!i);
    loaded.textContent = i ? 'Personal information loaded ●' : 'Awaiting operator';
  };
  user.addEventListener('input', () => showOperator(DEMO.find(([u]) => u === user.value.trim())?.[1] || user.value.trim()));
  let busy = false;
  const submit = async () => {
    if (busy) return;
    const d = formData(form);
    if (!d.username || !d.password) {
      lockError(form, 'Enter your username and password');
      (d.username ? pass : user).focus();
      return;
    }
    lockError(form, '');
    busy = true;
    tries++;
    attempts.textContent = `Attempt ${z(tries)} · recorded`;
    try {
      await flow.run(() => api.post('/api/auth/login', d));
      await onSuccess();
    } catch (e) {
      lockError(form, e.message);
      dots.innerHTML = String(raw('<i></i>'.repeat(Math.min(tries, 8))));
      pass.select();
    } finally {
      busy = false;
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  // A demo operator "types" their key: each character pulses the sculpture, then the request goes out.
  root.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', async () => {
    if (busy) return;
    flow.endLockdown();
    user.value = b.dataset.demo;
    showOperator(b.dataset.name);
    pass.value = '';
    for (const ch of 'demo1234') {
      pass.value += ch;
      ctl.ribbon.pulse(0.8);
      if (!still()) await sleep(38);
    }
    submit();
  }));
}

export function renderSetup(root, onDone, { demoAllowed = true } = {}) {
  document.title = 'Welcome · Aliquot';
  const panel = html`
    <div class="lp-head"><span class="micro">■ System initialisation</span><span class="lp-org">First run</span></div>
    <h1 class="lp-title">Welcome to Aliquot</h1>
    <p class="lp-sub">Let's get your laboratory set up. This takes a minute.</p>
    <form class="lp-form" novalidate>
      <div class="setup-choice" ${demoAllowed ? '' : raw('hidden')}>
        <label><input type="radio" name="mode" value="demo" ${demoAllowed ? raw('checked') : ''}><span><strong>Explore with demo data</strong><small>A fictional lab with 22 people, 5 clients and 5 months of samples, tests, investigations and invoices. Best for trying everything out.</small></span></label>
        <label><input type="radio" name="mode" value="real" ${demoAllowed ? '' : raw('checked')}><span><strong>Set up my laboratory</strong><small>Start empty and create the first administrator account.</small></span></label>
      </div>
      <div class="real-fields" ${demoAllowed ? raw('hidden') : ''}>
        <div class="form-grid one">
          ${field({ label: 'Laboratory name', name: 'lab_name', placeholder: 'e.g. Northside Analytical Ltd.' })}
          ${field({ label: 'Your full name', name: 'full_name' })}
          ${field({ label: 'Username', name: 'username', attrs: 'autocapitalize="off" spellcheck="false" autocomplete="username"' })}
          ${field({ label: 'Email', name: 'email', type: 'email' })}
          ${field({ label: 'Password', name: 'password', type: 'password', hint: 'At least 8 characters, with letters and numbers', attrs: 'autocomplete="new-password"' })}
          ${field({ label: 'Confirm password', name: 'confirm', type: 'password', attrs: 'autocomplete="new-password"' })}
        </div>
      </div>
      <button class="btn primary lg" type="submit">Continue ${icon('arrowRight', { size: 15 })}</button>
    </form>`;
  root.innerHTML = String(lockFrame({ labName: 'Aliquot', ghost: 'Init', panel, message: 'System sealed. Initialise the laboratory to begin.', sub: 'First run · only possible on the computer running Aliquot' }));
  const ctl = mountLock(root);
  const flow = lockFlow(ctl, { idle: 'System sealed. Initialise the laboratory to begin.', idleSub: 'First run · only possible on the computer running Aliquot' });
  const form = root.querySelector('form');
  const realFields = form.querySelector('.real-fields');
  form.querySelectorAll('[name=mode]').forEach((r) => r.addEventListener('change', () => { realFields.hidden = formData(form).mode !== 'real'; }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    const btn = form.querySelector('button[type=submit]');
    if (d.mode === 'real') {
      for (const k of ['lab_name', 'full_name', 'username', 'password']) if (!d[k]) return lockError(form, 'Please fill in every field');
      if (d.password !== d.confirm) return lockError(form, 'The passwords do not match');
    }
    lockError(form, '');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await flow.run(async () => {
        await api.post('/api/setup', d);
        if (d.mode === 'real') await api.post('/api/auth/login', { username: d.username, password: d.password });
      });
      if (d.mode === 'demo') return renderLogin(root, { onSuccess: onDone });
      await onDone();
    } catch (err) {
      lockError(form, err.message);
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
    return undefined;
  });
}

export function renderForcedPasswordChange(root, onDone) {
  document.title = 'Choose a new password · Aliquot';
  const panel = html`
    <div class="lp-head"><span class="micro">■ Credential rotation</span><span class="lp-org">Required</span></div>
    <h1 class="lp-title">Choose a new password</h1>
    <p class="lp-sub">Your password was set by an administrator. Please choose your own before continuing.</p>
    <form class="lp-form" novalidate>
      <div class="form-grid one">
        ${field({ label: 'Current (temporary) password', name: 'current', type: 'password', attrs: 'autocomplete="current-password"', autofocus: true })}
        ${field({ label: 'New password', name: 'next', type: 'password', hint: 'At least 8 characters, with letters and numbers', attrs: 'autocomplete="new-password"' })}
        ${field({ label: 'Confirm new password', name: 'confirm', type: 'password', attrs: 'autocomplete="new-password"' })}
      </div>
      <button class="btn primary lg" type="submit">Save and continue</button>
      <button class="btn ghost" type="button" data-logout>Sign out</button>
    </form>`;
  root.innerHTML = String(lockFrame({ labName: 'Aliquot', ghost: 'Rotate', panel, message: 'Credential rotation required before the session unseals.', sub: 'Choose a password only you know' }));
  const ctl = mountLock(root);
  const flow = lockFlow(ctl, { idle: 'Credential rotation required before the session unseals.', idleSub: 'Choose a password only you know' });
  const form = root.querySelector('form');
  form.querySelector('[data-logout]').addEventListener('click', async () => {
    await api.post('/api/auth/logout').catch(() => {});
    location.href = '/';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    if (d.next !== d.confirm) return lockError(form, 'The new passwords do not match');
    lockError(form, '');
    try {
      await flow.run(() => api.post('/api/auth/password', { current: d.current, next: d.next }));
      await onDone();
    } catch (err) {
      lockError(form, err.message);
    }
    return undefined;
  });
}
