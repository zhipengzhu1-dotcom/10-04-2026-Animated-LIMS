import crypto from 'node:crypto';
import { get, run } from './db.js';
import { audit } from './audit.js';
import { HttpError, forbidden, parseCookies } from './http.js';
import { PERMISSIONS } from './lookups.js';
import { getNumber } from './settings.js';
import { nowIso } from './util.js';
import { SECURE_COOKIES, SESSION_MAX_HOURS } from './config.js';

const COOKIE = 'aq_session';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const SCRYPT = { N: 16384, r: 8, p: 1 };

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = crypto.scryptSync(String(password ?? ''), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(key, expected);
}

export function checkPasswordPolicy(password) {
  const pw = String(password || '');
  if (pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new HttpError(400, 'Password must contain letters and numbers');
}

export const can = (user, perm) => !!user && (PERMISSIONS[perm] || []).includes(user.role);

export function assertCan(ctx, perm, message) {
  if (!can(ctx.user, perm)) throw forbidden(message);
}

export const permissionsFor = (role) => Object.keys(PERMISSIONS).filter((p) => PERMISSIONS[p].includes(role));

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, failed_logins, locked_until, ...rest } = u;
  return rest;
}

function cookie(value, maxAgeSeconds) {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${SECURE_COOKIES ? '; Secure' : ''}`;
}

export function createSession(ctx, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const created = nowIso();
  const expires = new Date(Date.now() + SESSION_MAX_HOURS * 3600_000).toISOString();
  run(
    'INSERT INTO sessions (token, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    sha256(token), user.id, created, created, expires, ctx.ip, String(ctx.req?.headers['user-agent'] || '').slice(0, 300),
  );
  ctx.res.setHeader('Set-Cookie', cookie(token, SESSION_MAX_HOURS * 3600));
}

/** Signs the user out everywhere except this browser (after a password change). */
export function destroyOtherSessions(ctx) {
  const token = parseCookies(ctx.req.headers.cookie)[COOKIE];
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', ctx.user.id, token ? sha256(token) : '');
}

export function destroySession(ctx) {
  const token = parseCookies(ctx.req.headers.cookie)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token = ?', sha256(token));
  ctx.res.setHeader('Set-Cookie', cookie('', 0));
}

/** Resolves the signed-in user from the session cookie, enforcing absolute and idle timeouts. */
export function authenticate(ctx) {
  const token = parseCookies(ctx.req.headers.cookie)[COOKIE];
  if (!token) throw new HttpError(401, 'Please sign in', 'AUTH');
  const id = sha256(token);
  const session = get('SELECT * FROM sessions WHERE token = ?', id);
  if (!session) throw new HttpError(401, 'Please sign in', 'AUTH');
  const t = Date.now();
  const idleMs = (getNumber('session_idle_minutes') || 60) * 60_000;
  if (Date.parse(session.expires_at) < t || Date.parse(session.last_seen_at) + idleMs < t) {
    run('DELETE FROM sessions WHERE token = ?', id);
    throw new HttpError(401, 'Your session timed out. Please sign in again.', 'AUTH');
  }
  if (t - Date.parse(session.last_seen_at) > 30_000) run('UPDATE sessions SET last_seen_at = ? WHERE token = ?', new Date(t).toISOString(), id);
  const user = get('SELECT * FROM users WHERE id = ?', session.user_id);
  if (!user || !user.active) throw new HttpError(401, 'Your account is not active', 'AUTH');
  return user;
}

export function registerFailure(ctx, user, action, summary) {
  const failed = (user.failed_logins || 0) + 1;
  const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
  run('UPDATE users SET failed_logins = ?, locked_until = COALESCE(?, locked_until) WHERE id = ?', failed, lock, user.id);
  audit({ ...ctx, user }, { action, entity: 'users', entity_id: user.id, entity_code: user.username, summary: lock ? `${summary} — account locked for ${LOCK_MINUTES} minutes` : summary });
  return lock;
}

export function login(ctx, username, password) {
  const user = get('SELECT * FROM users WHERE username = ?', String(username || '').trim());
  const generic = new HttpError(401, 'Incorrect username or password');
  if (!user) {
    audit({ ...ctx, user: { id: null, username: String(username || '').slice(0, 60) } }, { action: 'LOGIN_FAILED', summary: 'Unknown username' });
    throw generic;
  }
  if (!user.active) {
    audit({ ...ctx, user }, { action: 'LOGIN_FAILED', entity: 'users', entity_id: user.id, entity_code: user.username, summary: 'Account deactivated' });
    throw generic;
  }
  if (user.locked_until && user.locked_until > nowIso()) {
    const mins = Math.ceil((Date.parse(user.locked_until) - Date.now()) / 60_000);
    throw new HttpError(423, `Account locked after repeated failed sign-ins. Try again in ${mins} min or ask an administrator to reset it.`);
  }
  if (!verifyPassword(password, user.password_hash)) {
    registerFailure(ctx, user, 'LOGIN_FAILED', 'Incorrect password');
    throw generic;
  }
  run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), user.id);
  createSession(ctx, user);
  audit({ ...ctx, user }, { action: 'LOGIN', entity: 'users', entity_id: user.id, entity_code: user.username, summary: 'Signed in' });
  return get('SELECT * FROM users WHERE id = ?', user.id);
}

/**
 * Electronic signature (21 CFR Part 11 §11.200): the signer re-enters their password at the moment of signing.
 * Must be called outside a transaction so failed attempts are always recorded.
 */
export function verifySignature(ctx, password) {
  if (ctx.trustedSigner) return; // demo-data generator only; never set from HTTP
  if (!password) throw new HttpError(400, 'Enter your password to sign', 'SIGNATURE');
  const user = get('SELECT * FROM users WHERE id = ?', ctx.user.id);
  if (user.locked_until && user.locked_until > nowIso()) throw new HttpError(423, 'Account locked after repeated failed signature attempts.');
  if (!verifyPassword(password, user.password_hash)) {
    registerFailure(ctx, user, 'SIGNATURE_FAILED', 'Incorrect password during electronic signature');
    throw new HttpError(400, 'Incorrect password — signature not applied', 'SIGNATURE');
  }
  if (user.failed_logins) run('UPDATE users SET failed_logins = 0 WHERE id = ?', user.id);
}

export function applySignature(ctx, entity, entityId, meaning, { comment = null, code = null } = {}) {
  run(
    'INSERT INTO signatures (entity, entity_id, user_id, full_name, meaning, comment, signed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    entity, entityId, ctx.user.id, ctx.user.full_name, meaning, comment == null || comment === '' ? null : String(comment), nowIso(),
  );
  audit(ctx, { action: 'SIGN', entity, entity_id: entityId, entity_code: code, summary: `Signed: ${meaning}`, reason: comment });
}
