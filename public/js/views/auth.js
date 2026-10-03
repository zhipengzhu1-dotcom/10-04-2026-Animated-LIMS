// Sign-in, first-run setup and forced password change (full-screen, outside the app shell).
import { html } from '../core/html.js';
import { api } from '../core/api.js';
import { icon, LOGO } from '../core/icons.js';
import { field, formData, avatar } from '../core/ui.js';

const DEMO = [
  ['priya.raman', 'Priya Raman', 'Lab Manager'],
  ['tom.fletcher', 'Tom Fletcher', 'Analyst'],
  ['sarah.lindqvist', 'Sarah Lindqvist', 'Senior Scientist'],
  ['daniel.okafor', 'Daniel Okafor', 'Quality Assurance'],
  ['grace.holloway', 'Grace Holloway', 'Business & Finance'],
  ['admin', 'Alex Morgan', 'Administrator'],
];

const side = () => html`
  <aside class="auth-side">
    <div class="brand">${LOGO}<div class="brand-name">Aliquot</div></div>
    <div>
      <h1>Your lab, without the paper.</h1>
      <p>Sample login to signed Certificate of Analysis, with a complete audit trail in between. Built for contract analytical labs serving the pharmaceutical industry.</p>
      <ul>
        <li>${icon('tube', { size: 16 })}<span>Barcoded sample receipt, custody and worklists for the whole team</span></li>
        <li>${icon('sign', { size: 16 })}<span>Electronic signatures, peer review and QA approval (21 CFR Part 11 / Annex 11 ready)</span></li>
        <li>${icon('shield', { size: 16 })}<span>Tamper-evident audit trail — every change, who, when and why</span></li>
        <li>${icon('chart', { size: 16 })}<span>Turnaround, workload, unbilled work and revenue at a glance</span></li>
      </ul>
    </div>
    <p style="font-size:12px;color:#8fb3ad;margin:0">Data stays on your own server.</p>
  </aside>`;

function errorBox(form, message) {
  let box = form.querySelector('.form-error');
  if (!box) {
    box = document.createElement('div');
    box.className = 'form-error';
    form.prepend(box);
  }
  box.textContent = message;
  box.hidden = !message;
}

export async function renderLogin(root, { message, onSuccess } = {}) {
  let info = { demo: false, labName: '' };
  try { info = await api.get('/api/setup'); } catch { /* offline */ }
  document.title = 'Sign in · Aliquot';
  root.innerHTML = String(html`
    <div class="auth">
      ${side()}
      <main class="auth-main">
        <div class="auth-box">
          <h2>Sign in</h2>
          <p class="sub">${info.labName || 'Aliquot'}</p>
          <form novalidate>
            ${message ? html`<div class="notice warn">${icon('clock', { size: 15 })}<span>${message}</span></div>` : ''}
            ${field({ label: 'Username', name: 'username', required: true, autofocus: true, attrs: 'autocomplete="username" autocapitalize="off" spellcheck="false"' })}
            ${field({ label: 'Password', name: 'password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
            <button class="btn primary lg" type="submit">Sign in</button>
          </form>
          ${info.demo ? html`<div class="demo-users">
            <h3>Demo accounts · password demo1234</h3>
            <div class="demo-grid">${DEMO.map(([u, name, role], i) => html`<button type="button" data-demo="${u}">${avatar(name, i + 1, { size: 28 })}<span><strong>${name}</strong><small>${role}</small></span></button>`)}</div>
          </div>` : ''}
        </div>
      </main>
    </div>`);
  const form = root.querySelector('form');
  const submit = async () => {
    const btn = form.querySelector('button[type=submit]');
    const d = formData(form);
    if (!d.username || !d.password) return errorBox(form, 'Enter your username and password');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await api.post('/api/auth/login', d);
      await onSuccess();
    } catch (e) {
      errorBox(form, e.message);
      form.querySelector('[name=password]').select();
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  root.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => {
    form.querySelector('[name=username]').value = b.dataset.demo;
    form.querySelector('[name=password]').value = 'demo1234';
    submit();
  }));
}

export function renderSetup(root, onDone) {
  document.title = 'Welcome · Aliquot';
  root.innerHTML = String(html`
    <div class="auth">
      ${side()}
      <main class="auth-main">
        <div class="auth-box">
          <h2>Welcome to Aliquot</h2>
          <p class="sub">Let's get your laboratory set up. This takes a minute.</p>
          <form novalidate>
            <div class="setup-choice">
              <label><input type="radio" name="mode" value="demo" checked><span><strong>Explore with demo data</strong><small>A fictional lab with 22 people, 5 clients and 5 months of samples, tests, investigations and invoices. Best for trying everything out.</small></span></label>
              <label><input type="radio" name="mode" value="real"><span><strong>Set up my laboratory</strong><small>Start empty and create the first administrator account.</small></span></label>
            </div>
            <div class="real-fields" hidden>
              <div style="display:grid;gap:14px">
                ${field({ label: 'Laboratory name', name: 'lab_name', placeholder: 'e.g. Northside Analytical Ltd.' })}
                ${field({ label: 'Your full name', name: 'full_name' })}
                ${field({ label: 'Username', name: 'username', attrs: 'autocapitalize="off" spellcheck="false" autocomplete="username"' })}
                ${field({ label: 'Email', name: 'email', type: 'email' })}
                ${field({ label: 'Password', name: 'password', type: 'password', hint: 'At least 8 characters, with letters and numbers', attrs: 'autocomplete="new-password"' })}
                ${field({ label: 'Confirm password', name: 'confirm', type: 'password', attrs: 'autocomplete="new-password"' })}
              </div>
            </div>
            <button class="btn primary lg" type="submit">Continue ${icon('arrowRight', { size: 15 })}</button>
          </form>
        </div>
      </main>
    </div>`);
  const form = root.querySelector('form');
  const realFields = form.querySelector('.real-fields');
  form.querySelectorAll('[name=mode]').forEach((r) => r.addEventListener('change', () => { realFields.hidden = formData(form).mode !== 'real'; }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    const btn = form.querySelector('button[type=submit]');
    if (d.mode === 'real') {
      for (const k of ['lab_name', 'full_name', 'username', 'password']) if (!d[k]) return errorBox(form, 'Please fill in every field');
      if (d.password !== d.confirm) return errorBox(form, 'The passwords do not match');
    }
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await api.post('/api/setup', d);
      if (d.mode === 'real') await api.post('/api/auth/login', { username: d.username, password: d.password });
      if (d.mode === 'demo') return renderLogin(root, { onSuccess: onDone });
      await onDone();
    } catch (err) {
      errorBox(form, err.message);
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
    return undefined;
  });
}

export function renderForcedPasswordChange(root, onDone) {
  document.title = 'Choose a new password · Aliquot';
  root.innerHTML = String(html`
    <div class="auth">
      ${side()}
      <main class="auth-main">
        <div class="auth-box">
          <h2>Choose a new password</h2>
          <p class="sub">Your password was set by an administrator. Please choose your own before continuing.</p>
          <form novalidate>
            ${field({ label: 'Current (temporary) password', name: 'current', type: 'password', attrs: 'autocomplete="current-password"', autofocus: true })}
            ${field({ label: 'New password', name: 'next', type: 'password', hint: 'At least 8 characters, with letters and numbers', attrs: 'autocomplete="new-password"' })}
            ${field({ label: 'Confirm new password', name: 'confirm', type: 'password', attrs: 'autocomplete="new-password"' })}
            <button class="btn primary lg" type="submit">Save and continue</button>
            <button class="btn ghost" type="button" data-logout>Sign out</button>
          </form>
        </div>
      </main>
    </div>`);
  const form = root.querySelector('form');
  form.querySelector('[data-logout]').addEventListener('click', async () => {
    await api.post('/api/auth/logout').catch(() => {});
    location.href = '/';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    if (d.next !== d.confirm) return errorBox(form, 'The new passwords do not match');
    try {
      await api.post('/api/auth/password', { current: d.current, next: d.next });
      await onDone();
    } catch (err) {
      errorBox(form, err.message);
    }
    return undefined;
  });
}
