import { html } from '../core/html.js';
import { api } from '../core/api.js';
import { state, roleLabel } from '../core/state.js';
import { pageHead, card, kv, field, formData, toast, showError, avatar, fmtDateTime } from '../core/ui.js';

export async function render(ctx) {
  ctx.title('My account');
  const me = state.me;
  ctx.el.innerHTML = String(html`
    ${pageHead({ title: 'My account', sub: 'Your profile and sign-in security.' })}
    <div class="grid-2">
      ${card({ title: 'Profile', body: html`
        <div class="row" style="margin-bottom:16px">${avatar(me.full_name, me.id, { size: 44, initials: me.initials })}<div><strong style="font-size:16px">${me.full_name}</strong><div class="muted">${me.title || roleLabel(me.role)}</div></div></div>
        ${kv([['Username', me.username], ['Role', roleLabel(me.role)], ['Email', me.email], ['Last sign-in', fmtDateTime(me.last_login_at)]])}
        <p class="muted small" style="margin-top:14px">To change your name, role or email, ask an administrator.</p>` })}
      ${card({ title: 'Change password', body: html`
        <form class="form-grid one" data-pw novalidate>
          ${field({ label: 'Current password', name: 'current', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
          ${field({ label: 'New password', name: 'next', type: 'password', required: true, hint: 'At least 8 characters, with letters and numbers. Your password is also your electronic signature — never share it.', attrs: 'autocomplete="new-password"' })}
          ${field({ label: 'Confirm new password', name: 'confirm', type: 'password', required: true, attrs: 'autocomplete="new-password"' })}
          <div><button class="btn primary" type="submit">Update password</button></div>
        </form>` })}
    </div>`);
  const form = ctx.el.querySelector('[data-pw]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    if (d.next !== d.confirm) return toast('The new passwords do not match', 'error');
    try {
      await api.post('/api/auth/password', { current: d.current, next: d.next });
      form.reset();
      toast('Password updated');
    } catch (err) { showError(err); }
    return undefined;
  });
}
