import { all, get, run, ph, tx } from '../db.js';
import { insert, update } from '../repo.js';
import { audit, verifyChain } from '../audit.js';
import { HttpError, bad, forbidden, isLoopback, notFound } from '../http.js';
import {
  can, checkPasswordPolicy, destroySession, destroyOtherSessions, hashPassword, login, permissionsFor, publicUser, registerFailure, verifyPassword,
} from '../auth.js';
import { getSettings, setSettings, DEFAULTS } from '../settings.js';
import { ROLES, lookups, RECORD_ACCESS, MONEY_FIELDS, rolesWith } from '../lookups.js';
import { clean, initialsOf, likeTerm, limitParam, nowIso, today, addDays } from '../util.js';
import { seedDemo } from '../seed.js';
import { CLOUDFLARE_TUNNEL } from '../config.js';
import { portalBadge } from './portal.js';
import { TEST_QUEUES, TEST_OPEN } from '../workflow.js';
import { INVESTIGATION_OPEN } from '../investigations.js';

const USER_FIELDS = 'id, username, full_name, initials, email, title, role, active, last_login_at, created_at, must_change_password';

function publicSettings() {
  const s = getSettings();
  return {
    lab_name: s.lab_name, currency: s.currency, demo_mode: s.demo_mode === '1',
    session_idle_minutes: Number(s.session_idle_minutes) || 60,
    rush_surcharge_pct: Number(s.rush_surcharge_pct) || 0,
    urgent_surcharge_pct: Number(s.urgent_surcharge_pct) || 0,
  };
}

export default function routes(r) {
  // ---------- First-run setup ----------
  // First-time setup creates the first administrator, so it is only offered on the computer Aliquot runs on.
  r.get('/api/setup', (ctx) => {
    const s = getSettings();
    return { needsSetup: !get('SELECT 1 FROM users LIMIT 1'), local: isLoopback(ctx.ip), demoAllowed: !CLOUDFLARE_TUNNEL, demo: s.demo_mode === '1', labName: s.lab_name };
  }, { auth: false });

  r.post('/api/setup', (ctx) => {
    if (get('SELECT 1 FROM users LIMIT 1')) throw forbidden('Setup has already been completed.');
    if (!isLoopback(ctx.ip)) throw forbidden('For security, finish the first-time setup on the computer running Aliquot (open http://localhost:3000 there).');
    if (ctx.body.mode === 'demo') {
      if (CLOUDFLARE_TUNNEL) throw forbidden('Demo data cannot be loaded while Aliquot is published through Cloudflare Tunnel.');
      seedDemo();
      return { ok: true, demo: true };
    }
    const b = clean(ctx.body, {
      lab_name: { required: true, label: 'laboratory name' },
      full_name: { required: true, label: 'your name' },
      username: { required: true, max: 40 },
      email: { type: 'email' },
      password: { required: true },
    });
    checkPasswordPolicy(b.password);
    tx(() => {
      const sys = { user: { id: null, username: 'setup' }, ip: ctx.ip };
      setSettings(sys, { lab_name: b.lab_name });
      insert(sys, 'users', {
        username: b.username, full_name: b.full_name, initials: initialsOf(b.full_name), email: b.email,
        title: 'Administrator', role: 'admin', password_hash: hashPassword(b.password), password_changed_at: nowIso(), created_at: nowIso(),
      }, { summary: 'First administrator created during setup' });
    });
    return { ok: true };
  }, { auth: false });

  // ---------- Authentication ----------
  r.post('/api/auth/login', (ctx) => {
    const user = login(ctx, ctx.body.username, ctx.body.password);
    return { user: publicUser(user) };
  }, { auth: false });

  r.post('/api/auth/logout', (ctx) => {
    destroySession(ctx);
    return { ok: true };
  }, { auth: false });

  r.get('/api/auth/me', (ctx) => ({
    user: publicUser(ctx.user),
    permissions: permissionsFor(ctx.user.role),
    settings: publicSettings(),
  }), { allowPasswordChange: true });

  r.post('/api/auth/password', (ctx) => {
    const { current, next } = ctx.body;
    if (ctx.user.locked_until && ctx.user.locked_until > nowIso()) throw new HttpError(423, 'Account locked after repeated wrong passwords. Try again later.');
    if (!verifyPassword(current, ctx.user.password_hash)) {
      registerFailure(ctx, ctx.user, 'PASSWORD_CHANGE_FAILED', 'Wrong current password on password change');
      throw bad('Your current password is incorrect');
    }
    checkPasswordPolicy(next);
    if (verifyPassword(next, ctx.user.password_hash)) throw bad('Choose a password different from your current one');
    update(ctx, 'users', ctx.user.id, { password_hash: hashPassword(String(next)), must_change_password: 0, password_changed_at: nowIso(), failed_logins: 0 }, { summary: 'Password changed by user — other sessions signed out' });
    destroyOtherSessions(ctx);
    return { ok: true };
  }, { allowPasswordChange: true });

  r.get('/api/lookups', () => ({
    ...lookups(),
    users: all(`SELECT ${USER_FIELDS} FROM users ORDER BY full_name`),
  }));

  // Counts for the sidebar badges.
  r.get('/api/nav', (ctx) => {
    const me = ctx.user.id;
    const queued = (name) => {
      const [sql, ...params] = TEST_QUEUES[name](me);
      return get(`SELECT COUNT(*) n FROM tests t WHERE ${sql}`, ...params).n;
    };
    const reviews = () => {
      let n = 0;
      if (can(ctx.user, 'tests.review')) n += queued('review');
      if (can(ctx.user, 'tests.approve')) n += queued('approval');
      if (can(ctx.user, 'notebook.witness')) n += get(`SELECT COUNT(*) n FROM notebook_entries WHERE status = 'Signed' AND author_id != ?`, me).n;
      return n;
    };
    return {
      myTests: can(ctx.user, 'tests.perform') ? queued('assigned') : 0,
      reviews: reviews(),
      investigations: get(`SELECT COUNT(*) n FROM investigations v WHERE ${INVESTIGATION_OPEN}`).n,
      portal: portalBadge(ctx.user), // unread client messages + new submissions/requests
    };
  });

  // ---------- Users ----------
  r.get('/api/users', () => all(`SELECT ${USER_FIELDS} FROM users ORDER BY active DESC, full_name`));

  r.get('/api/users/:id', (ctx) => {
    const user = get(`SELECT ${USER_FIELDS}, locked_until, password_changed_at FROM users WHERE id = ?`, +ctx.params.id);
    if (!user) throw notFound('User');
    const stats = get(`
      SELECT
        (SELECT COUNT(*) FROM tests WHERE analyst_id = ? AND status = 'Approved' AND approved_at >= ?) AS approved_90d,
        (SELECT COUNT(*) FROM signatures WHERE user_id = ? AND meaning IN ('Reviewed','Approved') AND signed_at >= ?) AS reviews_90d`,
    user.id, addDays(today(), -90), user.id, addDays(today(), -90));
    stats.notebook_entries = get('SELECT COUNT(*) n FROM notebook_entries WHERE author_id = ?', user.id).n;
    return {
      user,
      qualifications: all(`
        SELECT q.*, t.full_name AS trained_by_name,
          (SELECT title FROM methods m WHERE m.code = q.method_code ORDER BY version DESC LIMIT 1) AS method_title
        FROM qualifications q LEFT JOIN users t ON t.id = q.trained_by WHERE q.user_id = ? ORDER BY q.method_code`, user.id),
      openTests: all(`
        SELECT t.id, t.code, t.status, t.due_date, s.code AS sample_code, m.code AS method_code, m.title AS method_title
        FROM tests t JOIN samples s ON s.id = t.sample_id JOIN methods m ON m.id = t.method_id
        WHERE t.analyst_id = ? AND t.status IN (${ph(TEST_OPEN)}) ORDER BY t.due_date`, user.id, ...TEST_OPEN),
      stats,
    };
  });

  const userSchema = {
    username: { required: true, max: 40 },
    full_name: { required: true, label: 'full name' },
    initials: { max: 4 },
    email: { type: 'email' },
    title: { label: 'job title' },
    role: { type: 'enum', values: Object.keys(ROLES), required: true },
    active: { type: 'bool' },
  };

  r.post('/api/users', (ctx) => {
    const b = clean(ctx.body, userSchema);
    if (!/^[a-zA-Z0-9._-]+$/.test(b.username)) throw bad('Username may only contain letters, numbers, dots, dashes and underscores');
    checkPasswordPolicy(ctx.body.password);
    if (get('SELECT 1 FROM users WHERE username = ?', b.username)) throw bad('That username is already taken');
    const id = insert(ctx, 'users', {
      ...b, initials: b.initials || initialsOf(b.full_name), active: 1,
      password_hash: hashPassword(ctx.body.password), must_change_password: 1, created_at: nowIso(),
    }, { summary: `User account created (${ROLES[b.role].label})` });
    return { id };
  }, { perm: 'users.manage' });

  r.put('/api/users/:id', (ctx) => {
    const id = +ctx.params.id;
    const { username, ...schema } = userSchema;
    const b = clean(ctx.body, schema, { partial: true });
    if (id === ctx.user.id && (b.active === 0 || (b.role && b.role !== ctx.user.role))) throw bad('You cannot deactivate yourself or change your own role');
    update(ctx, 'users', id, b, { summary: 'User account updated' });
    if (b.active === 0) run('DELETE FROM sessions WHERE user_id = ?', id);
    return { ok: true };
  }, { perm: 'users.manage' });

  r.post('/api/users/:id/reset-password', (ctx) => {
    const id = +ctx.params.id;
    checkPasswordPolicy(ctx.body.password);
    update(ctx, 'users', id, {
      password_hash: hashPassword(ctx.body.password), must_change_password: 1, failed_logins: 0, locked_until: null,
    }, { summary: 'Password reset by administrator (user must change at next sign-in)' });
    run('DELETE FROM sessions WHERE user_id = ?', id);
    return { ok: true };
  }, { perm: 'users.manage' });

  // ---------- Training / method qualifications ----------
  r.get('/api/qualifications', () => ({
    users: all(`SELECT id, full_name, initials, role, title FROM users
      WHERE active = 1 AND role IN (${ph(rolesWith('tests.perform'))}) ORDER BY role DESC, full_name`, ...rolesWith('tests.perform')),
    methods: all(`
      SELECT m.code, m.title, m.technique, m.status FROM methods m
      WHERE m.version = (SELECT MAX(version) FROM methods x WHERE x.code = m.code) AND m.status != 'Retired'
      ORDER BY m.code`),
    qualifications: all(`
      SELECT q.*, t.full_name AS trained_by_name FROM qualifications q
      LEFT JOIN users t ON t.id = q.trained_by WHERE q.revoked = 0`),
  }));

  r.post('/api/qualifications', (ctx) => {
    const b = clean(ctx.body, {
      user_id: { type: 'id', ref: 'users', required: true },
      method_code: { required: true, label: 'method' },
      qualified_at: { type: 'date', default: today },
      expires_at: { type: 'date' },
      trained_by: { type: 'id', ref: 'users' },
      notes: { type: 'text' },
    });
    if (!get('SELECT 1 FROM methods WHERE code = ?', b.method_code)) throw bad('Unknown method');
    if (b.user_id === ctx.user.id) throw forbidden('Your own training must be signed off by someone else');
    const existing = get('SELECT * FROM qualifications WHERE user_id = ? AND method_code = ?', b.user_id, b.method_code);
    const who = get('SELECT full_name FROM users WHERE id = ?', b.user_id).full_name;
    if (existing) {
      update(ctx, 'qualifications', existing.id, { ...b, revoked: 0 }, { summary: `${who} qualified on ${b.method_code}` });
      return { id: existing.id };
    }
    return { id: insert(ctx, 'qualifications', { ...b, trained_by: b.trained_by ?? ctx.user.id }, { code: b.method_code, summary: `${who} qualified on ${b.method_code}` }) };
  }, { perm: 'qualifications.manage' });

  r.post('/api/qualifications/:id/revoke', (ctx) => {
    const q = get('SELECT q.*, u.full_name FROM qualifications q JOIN users u ON u.id = q.user_id WHERE q.id = ?', +ctx.params.id);
    if (!q) throw notFound('Qualification');
    if (!ctx.body.reason) throw bad('A reason is required', 'REASON_REQUIRED');
    update(ctx, 'qualifications', q.id, { revoked: 1 }, { summary: `${q.full_name} — qualification on ${q.method_code} revoked`, reason: ctx.body.reason });
    return { ok: true };
  }, { perm: 'qualifications.manage' });

  // ---------- Settings ----------
  r.get('/api/settings', () => getSettings());
  r.put('/api/settings', (ctx) => {
    const patch = {};
    for (const k of Object.keys(DEFAULTS)) if (k in ctx.body) patch[k] = ctx.body[k];
    for (const k of ['tax_rate', 'rush_surcharge_pct', 'urgent_surcharge_pct', 'payment_terms_days', 'session_idle_minutes']) {
      if (k in patch && !Number.isFinite(Number(patch[k]))) throw bad(`${k.replace(/_/g, ' ')} must be a number`);
    }
    if ('session_idle_minutes' in patch && (Number(patch.session_idle_minutes) < 5 || Number(patch.session_idle_minutes) > 720)) {
      throw bad('Idle timeout must be between 5 and 720 minutes');
    }
    return setSettings(ctx, patch);
  }, { perm: 'settings.edit' });

  // ---------- Audit trail ----------
  r.get('/api/audit', (ctx) => {
    const q = ctx.query;
    const where = [];
    const params = [];
    if (q.entity) { where.push('a.entity = ?'); params.push(q.entity); }
    if (q.entity_id) { where.push('a.entity_id = ?'); params.push(+q.entity_id); }
    if (q.user_id) { where.push('a.user_id = ?'); params.push(+q.user_id); }
    if (q.action) { where.push('a.action = ?'); params.push(q.action); }
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
    if ((q.from && !isDate(q.from)) || (q.to && !isDate(q.to))) throw bad('Dates must be in YYYY-MM-DD format');
    if (q.from) { where.push('a.at >= ?'); params.push(new Date(`${q.from}T00:00:00`).toISOString()); }
    if (q.to) { where.push('a.at < ?'); params.push(new Date(`${addDays(q.to, 1)}T00:00:00`).toISOString()); }
    if (q.q) {
      where.push(`(a.entity_code LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR a.changes LIKE ? ESCAPE '\\' OR a.reason LIKE ? ESCAPE '\\' OR a.username LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\')`);
      const t = likeTerm(q.q);
      params.push(t, t, t, t, t, t);
    }
    const limit = limitParam(q.limit, 300, 2000);
    return all(`SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT ${limit}`, ...params);
  }, { perm: 'audit.view' });

  // Per-record history is visible to whoever can see the record; money fields only to billing roles.
  r.get('/api/history/:entity/:id', (ctx) => {
    const rule = RECORD_ACCESS[ctx.params.entity];
    const allowed = rule ? rule.view === null || rule.view.some((p) => can(ctx.user, p)) : can(ctx.user, 'audit.view');
    if (!allowed) throw forbidden();
    const rows = all(`
      SELECT a.id, a.at, a.username, a.action, a.summary, a.changes, a.reason, u.full_name
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC LIMIT 200`, ctx.params.entity, +ctx.params.id);
    if (!can(ctx.user, 'billing.view')) {
      for (const row of rows) {
        if (!row.changes) continue;
        const c = JSON.parse(row.changes);
        for (const k of MONEY_FIELDS) delete c[k];
        row.changes = Object.keys(c).length ? JSON.stringify(c) : null;
      }
    }
    return rows;
  });

  r.get('/api/audit/verify', (ctx) => {
    const result = verifyChain();
    audit(ctx, { action: 'VERIFY', entity: 'audit_log', summary: result.ok ? `Audit trail integrity verified (${result.count} entries)` : `Audit trail integrity FAILED at entry #${result.brokenAt}` });
    return result;
  }, { perm: 'audit.view' });

  // ---------- Global search (also handles barcode scans: an exact code match returns `exact`) ----------
  r.get('/api/search', (ctx) => {
    const q = String(ctx.query.q || '').trim();
    if (q.length < 2) return { results: [] };
    const t = likeTerm(q);
    const L = 6;
    const results = [];
    const push = (type, query, map) => query().forEach((row) => results.push({ type, ...map(row) }));
    push('Sample', () => all(`SELECT s.id, s.code, s.description, s.batch_no, s.status, c.name AS client FROM samples s JOIN clients c ON c.id = s.client_id
      WHERE s.code LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\' OR s.batch_no LIKE ? ESCAPE '\\' OR s.client_ref LIKE ? ESCAPE '\\' ORDER BY s.id DESC LIMIT ${L}`, t, t, t, t),
    (x) => ({ code: x.code, title: x.description, meta: [x.client, x.batch_no && `Batch ${x.batch_no}`, x.status].filter(Boolean).join(' · '), href: `/samples/${x.id}` }));
    push('Test', () => all(`SELECT t.id, t.code, t.status, m.title, s.code AS sample FROM tests t JOIN methods m ON m.id = t.method_id JOIN samples s ON s.id = t.sample_id
      WHERE t.code LIKE ? ESCAPE '\\' ORDER BY t.id DESC LIMIT ${L}`, t),
    (x) => ({ code: x.code, title: x.title, meta: `${x.sample} · ${x.status}`, href: `/tests/${x.id}` }));
    push('Project', () => all(`SELECT p.id, p.code, p.title, p.status, c.name AS client FROM projects p JOIN clients c ON c.id = p.client_id
      WHERE p.code LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\' OR p.po_number LIKE ? ESCAPE '\\' ORDER BY p.id DESC LIMIT ${L}`, t, t, t),
    (x) => ({ code: x.code, title: x.title, meta: `${x.client} · ${x.status}`, href: `/projects/${x.id}` }));
    push('Client', () => all(`SELECT id, code, name FROM clients WHERE code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR contact_name LIKE ? ESCAPE '\\' LIMIT ${L}`, t, t, t),
      (x) => ({ code: x.code, title: x.name, meta: 'Client', href: `/clients/${x.id}` }));
    push('Method', () => all(`SELECT id, code, version, title, status FROM methods WHERE code LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY code, version DESC LIMIT ${L}`, t, t),
      (x) => ({ code: `${x.code} v${x.version}`, title: x.title, meta: x.status, href: `/methods/${x.id}` }));
    push('Instrument', () => all(`SELECT id, code, name, status FROM instruments WHERE code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR serial_no LIKE ? ESCAPE '\\' LIMIT ${L}`, t, t, t),
      (x) => ({ code: x.code, title: x.name, meta: x.status, href: `/instruments/${x.id}` }));
    push('Inventory', () => all(`SELECT id, code, name, lot_no, category FROM inventory WHERE code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR lot_no LIKE ? ESCAPE '\\' LIMIT ${L}`, t, t, t),
      (x) => ({ code: x.code, title: x.name, meta: [x.category, x.lot_no && `Lot ${x.lot_no}`].filter(Boolean).join(' · '), href: `/inventory/${x.id}` }));
    push('Notebook', () => all(`SELECT id, code, title, status FROM notebook_entries WHERE code LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ${L}`, t, t, t),
      (x) => ({ code: x.code, title: x.title, meta: x.status, href: `/notebook/${x.id}` }));
    push('Investigation', () => all(`SELECT id, code, title, status FROM investigations WHERE code LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ${L}`, t, t),
      (x) => ({ code: x.code, title: x.title, meta: x.status, href: `/investigations/${x.id}` }));
    if (can(ctx.user, 'billing.view')) {
      push('Invoice', () => all(`SELECT i.id, i.code, i.status, c.name AS client FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.code LIKE ? ESCAPE '\\' LIMIT ${L}`, t),
        (x) => ({ code: x.code, title: x.client, meta: x.status, href: `/invoices/${x.id}` }));
    }
    const exact = results.find((x) => x.code.toLowerCase() === q.toLowerCase());
    return { results, exact: exact?.href ?? null };
  });
}
