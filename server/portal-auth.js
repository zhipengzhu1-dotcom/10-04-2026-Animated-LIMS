// Client-portal sign-in. Deliberately separate from staff authentication: its own accounts table, its own
// session table and its own cookie (scoped to /api/portal), so a client session can never reach a staff
// endpoint and a staff session is never accepted by the portal.

import crypto from 'node:crypto';
import { get, run } from './db.js';
import { audit } from './audit.js';
import { HttpError, parseCookies } from './http.js';
import { verifyPassword } from './auth.js';
import { getNumber } from './settings.js';
import { nowIso } from './util.js';
import { SECURE_COOKIES, SESSION_MAX_HOURS } from './config.js';

const COOKIE = 'aq_portal';
const COOKIE_PATH = '/api/portal';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const cookie = (value, maxAge) => `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=${maxAge}${SECURE_COOKIES ? '; Secure' : ''}`;

/** Audit context for an action taken by a client contact (no staff user id; identifiable username). */
export const portalCtx = (ctx, pu) => ({ ...ctx, user: { id: null, username: `portal:${pu.email}`, full_name: pu.full_name } });

export function publicPortalUser(pu) {
  if (!pu) return null;
  const { password_hash, failed_logins, locked_until, ...rest } = pu;
  return rest;
}

function registerFailure(ctx, pu, summary) {
  const failed = (pu.failed_logins || 0) + 1;
  const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
  run('UPDATE portal_users SET failed_logins = ?, locked_until = COALESCE(?, locked_until) WHERE id = ?', failed, lock, pu.id);
  audit(portalCtx(ctx, pu), { action: 'LOGIN_FAILED', entity: 'portal_users', entity_id: pu.id, entity_code: pu.email, summary: lock ? `${summary} — account locked for ${LOCK_MINUTES} minutes` : summary });
}

export function portalLogin(ctx, email, password) {
  const pu = get('SELECT * FROM portal_users WHERE email = ?', String(email || '').trim());
  const generic = new HttpError(401, 'Incorrect email or password');
  if (!pu) {
    audit({ ...ctx, user: { id: null, username: `portal:${String(email || '').slice(0, 80)}` } }, { action: 'LOGIN_FAILED', summary: 'Client portal: unknown account' });
    throw generic;
  }
  if (!pu.active || !get('SELECT 1 FROM clients WHERE id = ? AND active = 1', pu.client_id)) {
    audit(portalCtx(ctx, pu), { action: 'LOGIN_FAILED', entity: 'portal_users', entity_id: pu.id, entity_code: pu.email, summary: 'Client portal: account deactivated' });
    throw generic;
  }
  if (pu.locked_until && pu.locked_until > nowIso()) {
    const mins = Math.ceil((Date.parse(pu.locked_until) - Date.now()) / 60_000);
    throw new HttpError(423, `For your security this account is locked after repeated failed sign-ins. Try again in ${mins} min or contact the laboratory.`);
  }
  if (!verifyPassword(password, pu.password_hash)) {
    registerFailure(ctx, pu, 'Client portal: incorrect password');
    throw generic;
  }
  run('UPDATE portal_users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), pu.id);
  const token = crypto.randomBytes(32).toString('base64url');
  const t = nowIso();
  run(
    'INSERT INTO portal_sessions (token, portal_user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    sha256(token), pu.id, t, t, new Date(Date.now() + SESSION_MAX_HOURS * 3600_000).toISOString(), ctx.ip, String(ctx.req?.headers['user-agent'] || '').slice(0, 300),
  );
  ctx.res.setHeader('Set-Cookie', cookie(token, SESSION_MAX_HOURS * 3600));
  audit(portalCtx(ctx, pu), { action: 'LOGIN', entity: 'portal_users', entity_id: pu.id, entity_code: pu.email, summary: 'Signed in to the client portal' });
  return get('SELECT * FROM portal_users WHERE id = ?', pu.id);
}

export function portalLogout(ctx) {
  const token = parseCookies(ctx.req.headers.cookie)[COOKIE];
  if (token) run('DELETE FROM portal_sessions WHERE token = ?', sha256(token));
  ctx.res.setHeader('Set-Cookie', cookie('', 0));
}

/** Signs the client contact out everywhere except this browser (after a password change). */
export function portalDestroyOtherSessions(ctx, puId) {
  const token = parseCookies(ctx.req.headers.cookie)[COOKIE];
  run('DELETE FROM portal_sessions WHERE portal_user_id = ? AND token != ?', puId, token ? sha256(token) : '');
}

/**
 * Resolves the signed-in client contact. Every portal endpoint calls this first and then scopes all
 * queries by the returned client_id. { allowPasswordChange } lets /me and /password through before the
 * temporary password has been replaced.
 */
export function portalAuth(ctx, { allowPasswordChange = false } = {}) {
  const token = parseCookies(ctx.req.headers.cookie)[COOKIE];
  const signIn = (msg = 'Please sign in') => new HttpError(401, msg, 'PORTAL_AUTH');
  if (!token) throw signIn();
  const id = sha256(token);
  const s = get('SELECT * FROM portal_sessions WHERE token = ?', id);
  if (!s) throw signIn();
  const t = Date.now();
  const idleMs = (getNumber('session_idle_minutes') || 60) * 60_000;
  if (Date.parse(s.expires_at) < t || Date.parse(s.last_seen_at) + idleMs < t) {
    run('DELETE FROM portal_sessions WHERE token = ?', id);
    throw signIn('Your session timed out. Please sign in again.');
  }
  if (t - Date.parse(s.last_seen_at) > 30_000) run('UPDATE portal_sessions SET last_seen_at = ? WHERE token = ?', new Date(t).toISOString(), id);
  const pu = get('SELECT * FROM portal_users WHERE id = ?', s.portal_user_id);
  if (!pu || !pu.active || !get('SELECT 1 FROM clients WHERE id = ? AND active = 1', pu.client_id)) {
    run('DELETE FROM portal_sessions WHERE token = ?', id);
    throw signIn('This account is not active');
  }
  if (pu.must_change_password && !allowPasswordChange) throw new HttpError(403, 'Please choose a new password first', 'PASSWORD_CHANGE_REQUIRED');
  ctx.portal = pu;
  return pu;
}
