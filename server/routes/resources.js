// Methods (with versioning + spec limits), instruments (calibration & maintenance logbook) and inventory
// (reference standards, reagents, columns — with expiry tracking).

import { all, get, run, tx } from '../db.js';
import { insert, update, nextCode, mustGet } from '../repo.js';
import { bad, forbidden, notFound } from '../http.js';
import { assertCan, can, verifySignature, applySignature } from '../auth.js';
import {
  TECHNIQUES, INSTRUMENT_TYPES, INSTRUMENT_STATUSES, INSTRUMENT_LOG_KINDS, INVENTORY_CATEGORIES, INVENTORY_STATUSES,
} from '../lookups.js';
import { clean, nowIso, today, addDays, likeTerm } from '../util.js';
import { isShipped } from '../config.js';
import { TEST_SELECT } from './lab.js';

// ---------------------------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------------------------

const EDITABLE_METHOD = ['Draft', 'In Development', 'In Validation'];
const TRANSITIONS = {
  Draft: ['In Development', 'In Validation', 'Effective'],
  'In Development': ['Draft', 'In Validation', 'Effective'],
  'In Validation': ['In Development', 'Effective'],
  Effective: ['Retired'],
  Retired: [],
};

const methodSchema = {
  title: { required: true },
  technique: { type: 'enum', values: TECHNIQUES, required: true },
  client_id: { type: 'id', ref: 'clients', label: 'client' },
  owner_id: { type: 'id', ref: 'users', label: 'owner' },
  scope: { type: 'text' },
  procedure: { type: 'text' },
  reference: {},
  price: { type: 'num', min: 0, default: 0, required: true, label: 'price per test' },
  tat_days: { type: 'int', min: 1, default: 5, required: true, label: 'turnaround (days)' },
};

function cleanAnalytes(list) {
  if (!Array.isArray(list)) return null;
  const rows = list
    .filter((a) => a && String(a.name || '').trim())
    .map((a, i) => {
      const x = clean(a, {
        name: { required: true, label: `parameter ${i + 1} name` },
        unit: { max: 30 },
        result_type: { type: 'enum', values: ['numeric', 'text'], default: 'numeric' },
        spec_min: { type: 'num', label: `${a.name} lower limit` },
        spec_max: { type: 'num', label: `${a.name} upper limit` },
        spec_text: {},
        decimals: { type: 'int', min: 0, default: 2 },
      });
      if (x.decimals == null) x.decimals = 2;
      if (x.decimals > 6) throw bad('Use at most 6 decimal places');
      if (x.spec_min != null && x.spec_max != null && x.spec_min > x.spec_max) throw bad(`${x.name}: lower limit is above the upper limit`);
      if (x.result_type === 'text') { x.spec_min = null; x.spec_max = null; } else x.spec_text = null;
      return { ...x, sort_order: i };
    });
  return rows;
}

const analyteSummary = (rows) => rows.map((a) => `${a.name}${a.unit ? ` [${a.unit}]` : ''}: ${a.result_type === 'text' ? a.spec_text || 'report' : `${a.spec_min ?? ''}…${a.spec_max ?? ''}`}`).join('; ');

function writeAnalytes(methodId, rows) {
  run('DELETE FROM method_analytes WHERE method_id = ?', methodId);
  for (const a of rows) {
    run('INSERT INTO method_analytes (method_id, name, unit, result_type, spec_min, spec_max, spec_text, decimals, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      methodId, a.name, a.unit, a.result_type, a.spec_min, a.spec_max, a.spec_text, a.decimals, a.sort_order);
  }
}

export function createMethod(ctx, body) {
  assertCan(ctx, 'methods.edit');
  const b = clean(body, methodSchema);
  let code = String(body.code || '').trim().toUpperCase();
  if (code && !/^[A-Z0-9][A-Z0-9._-]{1,30}$/.test(code)) throw bad('Method code may contain letters, numbers, dots and dashes only');
  if (code && get('SELECT 1 FROM methods WHERE code = ?', code)) throw bad(`${code} already exists — create a new version of it instead`);
  const analytes = cleanAnalytes(body.analytes) || [];
  return tx(() => {
    if (!code) do code = nextCode('ATM', { year: false }); while (get('SELECT 1 FROM methods WHERE code = ?', code));
    const status = ['Draft', 'In Development'].includes(body.status) ? body.status : 'Draft';
    const id = insert(ctx, 'methods', { code, version: 1, ...b, status, owner_id: b.owner_id ?? ctx.user.id, created_at: nowIso() }, { summary: 'Method created' });
    writeAnalytes(id, analytes);
    return { id, code };
  });
}

export function setMethodStatus(ctx, id, body) {
  const m = mustGet('SELECT * FROM methods WHERE id = ?', id, 'Method');
  const target = body.status;
  if (!TRANSITIONS[m.status]?.includes(target)) throw bad(`A method can't move from ${m.status} to ${target}`);
  const needsApproval = ['Effective', 'Retired'].includes(target);
  assertCan(ctx, needsApproval ? 'methods.approve' : 'methods.edit');
  if (target === 'Effective' && !get('SELECT 1 FROM method_analytes WHERE method_id = ?', id)) throw bad('Define at least one result parameter before making the method effective');
  if (target === 'Effective' && m.owner_id === ctx.user.id) throw forbidden('The method owner cannot approve their own method — another manager or QA must sign');
  if (needsApproval) verifySignature(ctx, body.password);
  tx(() => {
    if (target === 'Effective') {
      for (const old of all(`SELECT id FROM methods WHERE code = ? AND status = 'Effective' AND id != ?`, m.code, id)) {
        update(ctx, 'methods', old.id, { status: 'Retired' }, { action: 'STATUS', summary: `Superseded by ${m.code} v${m.version}` });
      }
      applySignature(ctx, 'methods', id, 'Approved for use', { comment: body.comment || null, code: m.code });
      update(ctx, 'methods', id, { status: target, effective_date: today(), approved_by: ctx.user.id }, { action: 'STATUS', summary: `Method → ${target}` });
    } else {
      if (target === 'Retired') applySignature(ctx, 'methods', id, 'Retired', { comment: body.comment || null, code: m.code });
      update(ctx, 'methods', id, { status: target }, { action: 'STATUS', summary: `Method → ${target}`, reason: body.comment || null });
    }
  });
  return { ok: true };
}

export function newMethodVersion(ctx, methodId) {
  assertCan(ctx, 'methods.edit');
  const m = mustGet('SELECT * FROM methods WHERE id = ?', methodId, 'Method');
  const latest = get('SELECT MAX(version) v FROM methods WHERE code = ?', m.code).v;
  if (latest !== m.version) throw bad(`v${latest} already exists — open the latest version`);
  return tx(() => {
    const { id: _, status, effective_date, approved_by, created_at, version, supersedes_id, ...copy } = m;
    const id = insert(ctx, 'methods', { ...copy, version: m.version + 1, status: 'Draft', supersedes_id: m.id, created_at: nowIso() }, { summary: `New version drafted from v${m.version}` });
    writeAnalytes(id, all('SELECT * FROM method_analytes WHERE method_id = ? ORDER BY sort_order, id', m.id));
    return { id };
  });
}

// ---------------------------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------------------------

function calState(i) {
  if (!i.calibration_due) return 'n/a';
  if (i.calibration_due < today()) return 'overdue';
  if (i.calibration_due <= addDays(today(), 14)) return 'due_soon';
  return 'ok';
}

const instrumentSchema = {
  code: { required: true, max: 40 },
  name: { required: true },
  type: { type: 'enum', values: INSTRUMENT_TYPES, required: true },
  manufacturer: {}, model: {}, serial_no: { label: 'serial number' }, location: {},
  status: { type: 'enum', values: INSTRUMENT_STATUSES, default: 'Available' },
  calibration_interval_days: { type: 'int', min: 1, label: 'calibration interval' },
  last_calibrated: { type: 'date' },
  calibration_due: { type: 'date' },
  notes: { type: 'text' },
};

export function createInstrument(ctx, body) {
  assertCan(ctx, 'instruments.edit');
  const b = clean(body, instrumentSchema);
  b.code = b.code.toUpperCase();
  if (get('SELECT 1 FROM instruments WHERE code = ?', b.code)) throw bad(`Instrument ${b.code} already exists`);
  if (!b.calibration_due && b.last_calibrated && b.calibration_interval_days) b.calibration_due = addDays(b.last_calibrated, b.calibration_interval_days);
  return { id: insert(ctx, 'instruments', { ...b, created_at: nowIso() }, { summary: 'Instrument registered' }) };
}

export function logInstrument(ctx, id, body) {
  assertCan(ctx, 'instruments.log');
  const inst = mustGet('SELECT * FROM instruments WHERE id = ?', id, 'Instrument');
  const b = clean(body, {
    kind: { type: 'enum', values: INSTRUMENT_LOG_KINDS, required: true },
    performed_at: { type: 'date', default: today },
    description: { type: 'text', required: true },
    outcome: { type: 'enum', values: ['Pass', 'Fail', 'n/a'], default: 'n/a' },
    next_due: { type: 'date' },
    status: { type: 'enum', values: INSTRUMENT_STATUSES },
  });
  if (b.performed_at > today()) throw bad('The date performed cannot be in the future');
  const mayChangeStatus = can(ctx.user, 'instruments.edit');
  if (b.status && b.status !== inst.status && !mayChangeStatus) throw forbidden('Only a lab manager or scientist can change an instrument\'s status');
  return tx(() => {
    const logId = insert(ctx, 'instrument_logs', { instrument_id: id, ...b, status: undefined, user_id: ctx.user.id, created_at: nowIso() }, { code: inst.code, summary: `${b.kind} logged` });
    const patch = {};
    if (['Calibration', 'Qualification (IQ/OQ/PQ)'].includes(b.kind) && b.outcome === 'Pass') {
      patch.last_calibrated = b.performed_at;
      patch.calibration_due = b.next_due || (inst.calibration_interval_days ? addDays(b.performed_at, inst.calibration_interval_days) : inst.calibration_due);
      if (['Out of Service', 'Maintenance'].includes(inst.status) && !b.status && mayChangeStatus) patch.status = 'Available';
    }
    if (b.outcome === 'Fail') patch.status = 'Out of Service'; // anyone may take an instrument out of service
    if (b.status && mayChangeStatus) patch.status = b.status;
    if (Object.keys(patch).length) update(ctx, 'instruments', id, patch, { summary: `Updated from ${b.kind.toLowerCase()} record` });
    return { id: logId };
  });
}

// ---------------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------------

const INVENTORY_FLAGS = `
  CASE WHEN expiry_date IS NOT NULL AND expiry_date < ? THEN 1 ELSE 0 END AS expired,
  CASE WHEN expiry_date IS NOT NULL AND expiry_date >= ? AND expiry_date <= ? THEN 1 ELSE 0 END AS expiring,
  CASE WHEN min_quantity IS NOT NULL AND quantity IS NOT NULL AND quantity <= min_quantity THEN 1 ELSE 0 END AS low_stock`;
const flagParams = () => [today(), today(), addDays(today(), 30)];

const inventorySchema = {
  name: { required: true },
  category: { type: 'enum', values: Object.keys(INVENTORY_CATEGORIES), required: true },
  supplier: {}, catalog_no: { label: 'catalogue number' }, lot_no: { label: 'lot number' }, potency: { label: 'purity / potency' },
  quantity: { type: 'num', min: 0 }, unit: { max: 20 }, min_quantity: { type: 'num', min: 0, label: 'reorder level' },
  location: {}, storage: {},
  received_date: { type: 'date' }, opened_date: { type: 'date' }, expiry_date: { type: 'date' },
  status: { type: 'enum', values: INVENTORY_STATUSES, default: 'Active' },
  notes: { type: 'text' },
};

export function createInventory(ctx, body) {
  assertCan(ctx, 'inventory.edit');
  const b = clean(body, inventorySchema);
  return tx(() => {
    const code = nextCode(INVENTORY_CATEGORIES[b.category], { year: false });
    const id = insert(ctx, 'inventory', { code, ...b, created_at: nowIso() }, { summary: `${b.category} received into inventory` });
    if (b.quantity != null) run('INSERT INTO inventory_txns (inventory_id, delta, balance, reason, user_id, at) VALUES (?, ?, ?, ?, ?, ?)', id, b.quantity, b.quantity, 'Received', ctx.user.id, nowIso());
    return { id, code };
  });
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

export default function routes(r) {
  // ----- Methods -----
  r.get('/api/methods', (ctx) => {
    const latestOnly = !ctx.query.all;
    const usable = ctx.query.usable;
    return all(`
      SELECT m.*, u.full_name AS owner_name, c.name AS client_name,
        (SELECT COUNT(*) FROM method_analytes a WHERE a.method_id = m.id) AS analyte_count,
        (SELECT COUNT(*) FROM tests t WHERE t.method_id = m.id AND t.status != 'Cancelled') AS usage_count,
        (SELECT COUNT(*) FROM qualifications q WHERE q.method_code = m.code AND q.revoked = 0) AS qualified_count,
        (SELECT MAX(version) FROM methods x WHERE x.code = m.code) AS latest_version
      FROM methods m LEFT JOIN users u ON u.id = m.owner_id LEFT JOIN clients c ON c.id = m.client_id
      WHERE ${usable ? `m.status IN ('In Development','In Validation','Effective')` : latestOnly ? 'm.version = (SELECT MAX(version) FROM methods x WHERE x.code = m.code)' : '1'}
      ORDER BY m.code, m.version DESC`);
  });

  r.get('/api/methods/:id', (ctx) => {
    const id = +ctx.params.id;
    const method = mustGet(`SELECT m.*, u.full_name AS owner_name, c.name AS client_name, ap.full_name AS approved_by_name
      FROM methods m LEFT JOIN users u ON u.id = m.owner_id LEFT JOIN clients c ON c.id = m.client_id LEFT JOIN users ap ON ap.id = m.approved_by
      WHERE m.id = ?`, id, 'Method');
    const stats = get(`SELECT COUNT(*) AS runs, COALESCE(SUM(oos), 0) AS oos,
        AVG(CASE WHEN approved_at IS NOT NULL AND started_at IS NOT NULL THEN julianday(approved_at) - julianday(started_at) END) AS avg_days
      FROM tests WHERE method_id IN (SELECT id FROM methods WHERE code = ?) AND status = 'Approved'`, method.code);
    return {
      method,
      analytes: all('SELECT * FROM method_analytes WHERE method_id = ? ORDER BY sort_order, id', id),
      versions: all(`SELECT m.id, m.version, m.status, m.effective_date, m.created_at, u.full_name AS approved_by_name FROM methods m LEFT JOIN users u ON u.id = m.approved_by WHERE m.code = ? ORDER BY m.version DESC`, method.code),
      ...(isShipped('team') && { qualified: all(`SELECT q.*, u.full_name, u.initials, u.role FROM qualifications q JOIN users u ON u.id = q.user_id WHERE q.method_code = ? AND q.revoked = 0 ORDER BY u.full_name`, method.code) }),
      ...(isShipped('samples') && { recentTests: all(`${TEST_SELECT} WHERE t.method_id = ? ORDER BY t.id DESC LIMIT 15`, id) }),
      ...(isShipped('notebook') && { notebook: all(`SELECT n.id, n.code, n.title, n.status, u.full_name AS author_name, n.created_at FROM notebook_entries n JOIN users u ON u.id = n.author_id WHERE n.method_id = ? ORDER BY n.id DESC`, id) }),
      signatures: all(`SELECT * FROM signatures WHERE entity = 'methods' AND entity_id = ? ORDER BY id`, id),
      stats,
      transitions: TRANSITIONS[method.status] || [],
      can: {
        edit: can(ctx.user, 'methods.edit') && EDITABLE_METHOD.includes(method.status),
        approve: can(ctx.user, 'methods.approve'),
        status: can(ctx.user, 'methods.edit') || can(ctx.user, 'methods.approve'),
        newVersion: can(ctx.user, 'methods.edit') && method.version === Math.max(...all('SELECT version FROM methods WHERE code = ?', method.code).map((x) => x.version)),
      },
    };
  }, { module: 'methods' });

  r.post('/api/methods', (ctx) => createMethod(ctx, ctx.body), { module: 'methods' });

  r.put('/api/methods/:id', (ctx) => {
    assertCan(ctx, 'methods.edit');
    const id = +ctx.params.id;
    const m = mustGet('SELECT * FROM methods WHERE id = ?', id, 'Method');
    if (!EDITABLE_METHOD.includes(m.status)) throw bad(`${m.status} methods are locked. Create a new version to make changes.`);
    const b = clean(ctx.body, methodSchema, { partial: true });
    const analytes = cleanAnalytes(ctx.body.analytes);
    tx(() => {
      const extra = {};
      if (analytes) {
        const before = analyteSummary(all('SELECT * FROM method_analytes WHERE method_id = ? ORDER BY sort_order, id', id));
        const after = analyteSummary(analytes);
        if (before !== after) {
          extra.parameters = [before, after];
          writeAnalytes(id, analytes);
        }
      }
      update(ctx, 'methods', id, b, { summary: 'Method edited', extraChanges: extra, reason: ctx.body.reason || null });
    });
    return { ok: true };
  }, { module: 'methods' });

  r.post('/api/methods/:id/status', (ctx) => setMethodStatus(ctx, +ctx.params.id, ctx.body), { module: 'methods' });

  r.post('/api/methods/:id/new-version', (ctx) => newMethodVersion(ctx, +ctx.params.id), { module: 'methods' });

  // ----- Instruments -----
  r.get('/api/instruments', () => all(`
    SELECT i.*,
      (SELECT COUNT(*) FROM tests t WHERE t.instrument_id = i.id AND t.started_at >= ?) AS tests_30d,
      (SELECT MAX(performed_at) FROM instrument_logs l WHERE l.instrument_id = i.id AND l.kind = 'Preventive Maintenance') AS last_pm
    FROM instruments i ORDER BY i.status = 'Retired', i.code`, addDays(today(), -30)).map((i) => ({ ...i, cal_state: calState(i) })));

  r.get('/api/instruments/:id', (ctx) => {
    const id = +ctx.params.id;
    const instrument = mustGet('SELECT * FROM instruments WHERE id = ?', id, 'Instrument');
    instrument.cal_state = calState(instrument);
    return {
      instrument,
      logs: all('SELECT l.*, u.full_name FROM instrument_logs l LEFT JOIN users u ON u.id = l.user_id WHERE l.instrument_id = ? ORDER BY l.performed_at DESC, l.id DESC', id),
      ...(isShipped('samples') && { recentTests: all(`${TEST_SELECT} WHERE t.instrument_id = ? ORDER BY t.id DESC LIMIT 20`, id) }),
      ...(isShipped('investigations') && { investigations: all('SELECT id, code, title, status FROM investigations WHERE instrument_id = ? ORDER BY id DESC', id) }),
      can: { edit: can(ctx.user, 'instruments.edit'), log: can(ctx.user, 'instruments.log') },
    };
  }, { module: 'instruments' });

  r.post('/api/instruments', (ctx) => createInstrument(ctx, ctx.body), { module: 'instruments' });

  r.put('/api/instruments/:id', (ctx) => {
    assertCan(ctx, 'instruments.edit');
    const { code, ...schema } = instrumentSchema;
    const b = clean(ctx.body, schema, { partial: true });
    update(ctx, 'instruments', +ctx.params.id, b, { summary: 'Instrument details edited', reason: ctx.body.reason || null });
    return { ok: true };
  }, { module: 'instruments' });

  r.post('/api/instruments/:id/logs', (ctx) => logInstrument(ctx, +ctx.params.id, ctx.body), { module: 'instruments' });

  // ----- Inventory -----
  r.get('/api/inventory', (ctx) => {
    const q = ctx.query;
    const where = [];
    const params = [];
    if (q.category) { where.push('category = ?'); params.push(q.category); }
    if (q.status && q.status !== 'all') { where.push('status = ?'); params.push(q.status); }
    if (q.q) { const t = likeTerm(q.q); where.push(`(code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR lot_no LIKE ? ESCAPE '\\' OR supplier LIKE ? ESCAPE '\\')`); params.push(t, t, t, t); }
    return all(`SELECT *, ${INVENTORY_FLAGS} FROM inventory ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY status != 'Active', expiry_date IS NULL, expiry_date, code`, ...flagParams(), ...params);
  }, { module: 'inventory' });

  r.get('/api/inventory/:id', (ctx) => {
    const id = +ctx.params.id;
    const item = get(`SELECT *, ${INVENTORY_FLAGS} FROM inventory WHERE id = ?`, ...flagParams(), id);
    if (!item) throw notFound('Inventory item');
    return {
      item,
      txns: all('SELECT x.*, u.full_name FROM inventory_txns x LEFT JOIN users u ON u.id = x.user_id WHERE x.inventory_id = ? ORDER BY x.at DESC, x.id DESC', id),
      ...(isShipped('samples') && { tests: all(`${TEST_SELECT} WHERE t.id IN (SELECT test_id FROM test_materials WHERE inventory_id = ?) ORDER BY t.id DESC LIMIT 50`, id) }),
      can: { edit: can(ctx.user, 'inventory.edit') || can(ctx.user, 'inventory.release'), stock: can(ctx.user, 'inventory.edit') },
    };
  }, { module: 'inventory' });

  r.post('/api/inventory', (ctx) => createInventory(ctx, ctx.body), { module: 'inventory' });

  r.put('/api/inventory/:id', (ctx) => {
    if (!can(ctx.user, 'inventory.edit') && !can(ctx.user, 'inventory.release')) throw forbidden();
    const id = +ctx.params.id;
    const item = get('SELECT * FROM inventory WHERE id = ?', id);
    if (!item) throw notFound('Inventory item');
    const { quantity, category, ...schema } = inventorySchema;
    const b = clean(ctx.body, schema, { partial: true });
    const statusChange = 'status' in b && b.status !== item.status;
    const expiryChange = 'expiry_date' in b && (b.expiry_date ?? null) !== (item.expiry_date ?? null);
    // Putting material back into use (release from quarantine, extending expiry) is a quality decision.
    const releasing = statusChange && b.status === 'Active';
    const extending = expiryChange && (b.expiry_date == null || (item.expiry_date && b.expiry_date > item.expiry_date));
    if ((releasing || extending) && !can(ctx.user, 'inventory.release')) throw forbidden('Releasing material or extending its expiry needs Quality Assurance or the lab manager');
    const reason = String(ctx.body.reason || '').trim();
    if ((statusChange || expiryChange) && !reason) throw bad('Give a reason for changing the status or expiry', 'REASON_REQUIRED');
    update(ctx, 'inventory', id, b, { summary: 'Inventory item edited', reason: reason || null });
    return { ok: true };
  }, { module: 'inventory' });

  r.post('/api/inventory/:id/adjust', (ctx) => {
    assertCan(ctx, 'inventory.edit');
    const id = +ctx.params.id;
    const item = mustGet('SELECT * FROM inventory WHERE id = ?', id, 'Item');
    const b = clean(ctx.body, { delta: { type: 'num', required: true, label: 'quantity change' }, reason: { required: true } });
    if (b.delta === 0) throw bad('Enter a non-zero quantity');
    const balance = Math.round(((item.quantity || 0) + b.delta) * 1e6) / 1e6;
    if (balance < 0) throw bad(`Only ${item.quantity ?? 0} ${item.unit || ''} left`);
    tx(() => {
      run('INSERT INTO inventory_txns (inventory_id, delta, balance, reason, user_id, at) VALUES (?, ?, ?, ?, ?, ?)', id, b.delta, balance, b.reason, ctx.user.id, nowIso());
      const patch = { quantity: balance };
      if (balance === 0 && item.status === 'Active') patch.status = 'Consumed';
      if (b.delta > 0 && item.status === 'Consumed') patch.status = 'Active';
      if (!item.opened_date && b.delta < 0) patch.opened_date = today();
      update(ctx, 'inventory', id, patch, { summary: `Stock ${b.delta > 0 ? 'added' : 'used'}: ${b.delta > 0 ? '+' : ''}${b.delta} ${item.unit || ''}`, reason: b.reason });
    });
    return { ok: true, balance };
  }, { module: 'inventory' });
}
