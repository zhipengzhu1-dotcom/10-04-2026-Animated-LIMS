// Clients, projects and invoicing — the money side of the lab.

import { all, get, run, ph, tx } from '../db.js';
import { insert, update, nextCode, mustGet } from '../repo.js';
import { bad, forbidden, guard, flags } from '../http.js';
import { assertCan, can } from '../auth.js';
import { getNumber } from '../settings.js';
import { PROJECT_TYPES, PROJECT_START_STATUSES, SAMPLE_OPEN } from '../lookups.js';
import { clean, nowIso, today, addDays, round } from '../util.js';
import { TEST_SELECT, TEST_OPEN } from '../workflow.js';

const yearStart = () => `${today().slice(0, 4)}-01-01`;
const NET = `(SELECT COALESCE(SUM(l.quantity * l.unit_price), 0) FROM invoice_lines l WHERE l.invoice_id = i.id)`;

// ---------------------------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------------------------

const clientSchema = {
  code: { required: true, max: 12 },
  name: { required: true },
  contact_name: { label: 'contact name' },
  contact_email: { type: 'email', label: 'contact email' },
  phone: {},
  address: { type: 'text' },
  payment_terms_days: { type: 'int', min: 0, label: 'payment terms' },
  notes: { type: 'text' },
  active: { type: 'bool' },
};

export const CLIENT_RULES = {
  attach(c, me) {
    if (!can(me, 'clients.edit')) return forbidden();
  },
};

export function createClient(ctx, body) {
  assertCan(ctx, 'clients.edit');
  const b = clean(body, clientSchema);
  b.code = b.code.toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(b.code)) throw bad('Client code may contain letters, numbers and dashes only');
  if (get('SELECT 1 FROM clients WHERE code = ?', b.code)) throw bad(`Client code ${b.code} is already used`);
  return { id: insert(ctx, 'clients', { ...b, payment_terms_days: b.payment_terms_days ?? getNumber('payment_terms_days'), active: 1, created_at: nowIso() }, { summary: 'Client created' }) };
}

// ---------------------------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------------------------

const PROJECT_STATS = `
  (SELECT COUNT(*) FROM samples s WHERE s.project_id = p.id) AS sample_count,
  (SELECT COUNT(*) FROM tests t JOIN samples s ON s.id = t.sample_id WHERE s.project_id = p.id AND t.status != 'Cancelled') AS test_count,
  (SELECT COUNT(*) FROM tests t JOIN samples s ON s.id = t.sample_id WHERE s.project_id = p.id AND t.status = 'Approved') AS tests_done,
  (SELECT COALESCE(SUM(t.price), 0) FROM tests t JOIN samples s ON s.id = t.sample_id WHERE s.project_id = p.id AND t.status = 'Approved' AND t.invoice_id IS NULL) AS unbilled,
  (SELECT COALESCE(SUM(l.quantity * l.unit_price), 0) FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id WHERE i.project_id = p.id AND i.status IN ('Sent','Paid')) AS invoiced`;

const projectSchema = {
  client_id: { type: 'id', ref: 'clients', required: true },
  title: { required: true },
  type: { type: 'enum', values: PROJECT_TYPES, required: true },
  status: { type: 'enum', values: PROJECT_START_STATUSES, default: 'Active' },
  lead_id: { type: 'id', ref: 'users', label: 'project lead' },
  po_number: { label: 'PO number' },
  budget: { type: 'num', min: 0 },
  start_date: { type: 'date' },
  due_date: { type: 'date' },
  description: { type: 'text' },
};

const CLOSED_PROJECT = ['Completed', 'Cancelled'];
// A Project's status changes, one action each. A Cancelled Project never moves again; a client coming back gets a new one.
const PROJECT_MOVES = {
  activate: { from: ['Quoted', 'On Hold'], to: 'Active', done: 'made active' },
  hold: { from: ['Active'], to: 'On Hold', done: 'put on hold' },
  complete: { from: ['Active'], to: 'Completed', done: 'completed' },
  cancel: { from: ['Quoted', 'Active', 'On Hold'], to: 'Cancelled', done: 'cancelled' },
  reopen: { from: ['Completed'], to: 'Active', done: 'reopened' },
};

const moveRule = ({ from, done }) => (p, me) => {
  if (!can(me, 'projects.edit')) return forbidden();
  if (!from.includes(p.status)) return bad(`The project is ${p.status.toLowerCase()} — it can't be ${done}`);
};

export const PROJECT_RULES = {
  edit(p, me) {
    if (!can(me, 'projects.edit')) return forbidden();
    if (p.status === 'Completed') return bad('The project is completed — reopen it to make changes');
    if (p.status === 'Cancelled') return bad('The project is cancelled and can no longer be changed');
  },
  ...Object.fromEntries(Object.entries(PROJECT_MOVES).map(([action, move]) => [action, moveRule(move)])),
  receive(p, me) {
    if (!can(me, 'samples.receive')) return forbidden();
    if (p.status === 'Completed') return bad('That project is completed — reopen it before adding samples to it');
    if (p.status === 'Cancelled') return bad('That project is cancelled — samples can\'t be added to it');
  },
  attach(p, me) {
    if (!can(me, 'projects.edit')) return forbidden();
    if (CLOSED_PROJECT.includes(p.status)) return bad(`The project is ${p.status.toLowerCase()} — attachments are locked`);
  },
};

export function createProject(ctx, body) {
  assertCan(ctx, 'projects.edit');
  const b = clean(body, projectSchema);
  return tx(() => {
    const code = nextCode('P', { pad: 3 });
    return { id: insert(ctx, 'projects', { code, ...b, start_date: b.start_date ?? today(), created_at: nowIso() }, { summary: 'Project created' }), code };
  });
}

export function setProjectStatus(ctx, id, action, body = {}) {
  if (!Object.hasOwn(PROJECT_MOVES, action)) throw bad('Unknown action');
  const p = mustGet('SELECT * FROM projects WHERE id = ?', id, 'Project');
  guard(PROJECT_RULES[action](p, ctx.user));
  const { to, done } = PROJECT_MOVES[action];
  update(ctx, 'projects', id, { status: to }, { action: 'STATUS', summary: `Project ${done}`, reason: String(body.reason || '').trim() || null });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------------------------

function invoiceTotals(id, taxRate) {
  const subtotal = round(get('SELECT COALESCE(SUM(quantity * unit_price), 0) s FROM invoice_lines WHERE invoice_id = ?', id).s, 2);
  const tax = round(subtotal * (taxRate || 0) / 100, 2);
  return { subtotal, tax, total: round(subtotal + tax, 2) };
}

/** Groups approved, not-yet-invoiced tests of a project into invoice lines (one line per method & price). */
function unbilledLines(projectId) {
  const tests = all(`${TEST_SELECT} WHERE s.project_id = ? AND t.status = 'Approved' AND t.invoice_id IS NULL ORDER BY m.code, t.id`, projectId);
  const groups = new Map();
  for (const t of tests) {
    const key = `${t.method_id}|${t.price}`;
    if (!groups.has(key)) groups.set(key, { method: `${t.method_code} v${t.method_version} — ${t.method_title}`, price: t.price, tests: [], samples: new Set() });
    const g = groups.get(key);
    g.tests.push(t.id);
    g.samples.add(t.sample_code);
  }
  return [...groups.values()].map((g) => {
    const samples = [...g.samples];
    const list = samples.length > 6 ? `${samples.slice(0, 6).join(', ')} +${samples.length - 6} more` : samples.join(', ');
    return { description: `${g.method} (${list})`, quantity: g.tests.length, unit_price: g.price, testIds: g.tests };
  });
}

function addWorkLine(ctx, invoiceId, line, order) {
  run('INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, sort_order, test_ids) VALUES (?, ?, ?, ?, ?, ?)',
    invoiceId, line.description, line.quantity, line.unit_price, order, JSON.stringify(line.testIds));
  for (const tid of line.testIds) update(ctx, 'tests', tid, { invoice_id: invoiceId }, { summary: 'Added to an invoice' });
}

function releaseTests(ctx, invoiceId, summary, testIds = null) {
  const tests = testIds
    ? all(`SELECT id FROM tests WHERE invoice_id = ? AND id IN (${ph(testIds)})`, invoiceId, ...testIds)
    : all('SELECT id FROM tests WHERE invoice_id = ?', invoiceId);
  for (const t of tests) update(ctx, 'tests', t.id, { invoice_id: null }, { summary });
  return tests.length;
}

const invoiceRule = (from, refusal) => (inv, me) => {
  if (!can(me, 'billing.edit')) return forbidden();
  if (!from.includes(inv.status)) return bad(refusal(inv));
};

export const INVOICE_RULES = {
  edit: invoiceRule(['Draft'], () => 'Issued invoices are locked. Void and re-issue to make changes.'),
  issue: invoiceRule(['Draft'], () => 'Only draft invoices can be issued'),
  paid: invoiceRule(['Sent'], () => 'Only issued invoices can be marked paid'),
  void: invoiceRule(['Draft', 'Sent'], (inv) => `A ${inv.status.toLowerCase()} invoice can't be voided`),
  attach: invoiceRule(['Draft'], () => 'Issued invoices are locked'),
};

export function createInvoice(ctx, body) {
  assertCan(ctx, 'billing.edit');
  const b = clean(body, {
    client_id: { type: 'id', ref: 'clients' },
    project_id: { type: 'id', ref: 'projects' },
    notes: { type: 'text' },
    include_unbilled: { type: 'bool', default: 1 },
  });
  let clientId = b.client_id;
  let project = null;
  if (b.project_id) {
    project = get('SELECT * FROM projects WHERE id = ?', b.project_id);
    clientId = project.client_id;
  }
  if (!clientId) throw bad('Choose a client or project');
  return tx(() => {
    const code = nextCode('INV');
    const id = insert(ctx, 'invoices', {
      code, client_id: clientId, project_id: project?.id ?? null, status: 'Draft', tax_rate: getNumber('tax_rate'),
      po_number: project?.po_number ?? null, notes: b.notes, created_by: ctx.user.id, created_at: nowIso(),
    }, { summary: 'Draft invoice created' });
    if (project && b.include_unbilled) {
      unbilledLines(project.id).forEach((line, i) => addWorkLine(ctx, id, line, i));
    }
    return { id, code };
  });
}

export function setInvoiceStatus(ctx, id, action, body = {}) {
  if (!['issue', 'paid', 'void'].includes(action)) throw bad('Unknown action');
  const inv = mustGet('SELECT i.*, c.payment_terms_days FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?', id, 'Invoice');
  guard(INVOICE_RULES[action](inv, ctx.user));
  tx(() => {
    const dates = clean(body, { issued_date: { type: 'date' }, paid_date: { type: 'date' } }, { partial: true });
    if (action === 'issue') {
      if (!get('SELECT 1 FROM invoice_lines WHERE invoice_id = ?', id)) throw bad('Add at least one line before issuing');
      const issued = dates.issued_date || today();
      update(ctx, 'invoices', id, { status: 'Sent', issued_date: issued, due_date: addDays(issued, inv.payment_terms_days ?? 30) }, { action: 'STATUS', summary: 'Invoice issued to client' });
    } else if (action === 'paid') {
      update(ctx, 'invoices', id, { status: 'Paid', paid_date: dates.paid_date || today() }, { action: 'STATUS', summary: 'Payment received' });
    } else {
      if (!String(body.reason || '').trim()) throw bad('A reason is required to void an invoice', 'REASON_REQUIRED');
      releaseTests(ctx, id, 'Invoice voided — billable again');
      update(ctx, 'invoices', id, { status: 'Void' }, { action: 'STATUS', summary: 'Invoice voided — its tests are billable again', reason: body.reason });
    }
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

export default function routes(r) {
  // ----- Clients -----
  r.get('/api/clients', (ctx) => {
    const showMoney = can(ctx.user, 'billing.view');
    return all(`
      SELECT c.*,
        (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id AND p.status IN ('Quoted','Active','On Hold')) AS open_projects,
        (SELECT COUNT(*) FROM samples s WHERE s.client_id = c.id AND s.status IN (${ph(SAMPLE_OPEN)})) AS samples_in_lab,
        (SELECT MAX(received_at) FROM samples s WHERE s.client_id = c.id) AS last_sample_at
        ${showMoney ? `, (SELECT COALESCE(SUM(l.quantity * l.unit_price), 0) FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
            WHERE i.client_id = c.id AND i.status IN ('Sent','Paid') AND i.issued_date >= ?) AS revenue_ytd` : ''}
      FROM clients c ORDER BY c.active DESC, c.name`, ...SAMPLE_OPEN, ...(showMoney ? [yearStart()] : []));
  });

  r.get('/api/clients/:id', (ctx) => {
    const id = +ctx.params.id;
    const client = mustGet('SELECT * FROM clients WHERE id = ?', id, 'Client');
    const showMoney = can(ctx.user, 'billing.view');
    return {
      client,
      projects: all(`SELECT p.*, u.full_name AS lead_name, ${PROJECT_STATS} FROM projects p LEFT JOIN users u ON u.id = p.lead_id WHERE p.client_id = ? ORDER BY p.status IN ('Completed','Cancelled'), p.id DESC`, id),
      samples: all(`SELECT s.id, s.code, s.description, s.batch_no, s.status, s.priority, s.received_at, s.due_date FROM samples s WHERE s.client_id = ? ORDER BY s.id DESC LIMIT 25`, id),
      methods: all(`SELECT id, code, version, title, status FROM methods WHERE client_id = ? ORDER BY code, version DESC`, id),
      invoices: showMoney ? all(`SELECT i.*, ${NET} AS subtotal FROM invoices i WHERE i.client_id = ? ORDER BY i.id DESC`, id) : null,
      money: showMoney ? get(`SELECT
          (SELECT COALESCE(SUM(l.quantity * l.unit_price), 0) FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id WHERE i.client_id = ? AND i.status IN ('Sent','Paid') AND i.issued_date >= ?) AS revenue_ytd,
          (SELECT COALESCE(SUM(l.quantity * l.unit_price * (1 + i.tax_rate / 100.0)), 0) FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id WHERE i.client_id = ? AND i.status = 'Sent') AS outstanding,
          (SELECT COALESCE(SUM(t.price), 0) FROM tests t JOIN samples s ON s.id = t.sample_id WHERE s.client_id = ? AND t.status = 'Approved' AND t.invoice_id IS NULL) AS unbilled,
          (SELECT COALESCE(SUM(t.price), 0) FROM tests t JOIN samples s ON s.id = t.sample_id WHERE s.client_id = ? AND t.status IN (${ph(TEST_OPEN)})) AS wip`,
      id, yearStart(), id, id, id, ...TEST_OPEN) : null,
      can: { edit: can(ctx.user, 'clients.edit') },
    };
  });

  r.post('/api/clients', (ctx) => createClient(ctx, ctx.body));

  r.put('/api/clients/:id', (ctx) => {
    assertCan(ctx, 'clients.edit');
    const { code, ...schema } = clientSchema;
    update(ctx, 'clients', +ctx.params.id, clean(ctx.body, schema, { partial: true }), { summary: 'Client details edited' });
    return { ok: true };
  });

  // ----- Projects -----
  r.get('/api/projects', (ctx) => {
    const q = ctx.query;
    const where = [];
    const params = [];
    if (q.client_id) { where.push('p.client_id = ?'); params.push(+q.client_id); }
    if (q.status === 'open') where.push(`p.status IN ('Quoted','Active','On Hold')`);
    else if (q.status && q.status !== 'all') { where.push('p.status = ?'); params.push(q.status); }
    const rows = all(`SELECT p.*, c.name AS client_name, c.code AS client_code, u.full_name AS lead_name, ${PROJECT_STATS}
      FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.lead_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.status IN ('Completed','Cancelled'), p.due_date IS NULL, p.due_date, p.id DESC`, ...params);
    if (!can(ctx.user, 'billing.view')) for (const p of rows) { p.budget = null; p.unbilled = null; p.invoiced = null; }
    return rows;
  });

  r.get('/api/projects/:id', (ctx) => {
    const id = +ctx.params.id;
    const project = mustGet(`SELECT p.*, c.name AS client_name, c.code AS client_code, u.full_name AS lead_name, ${PROJECT_STATS}
      FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.lead_id WHERE p.id = ?`, id, 'Project');
    const showMoney = can(ctx.user, 'billing.view');
    if (!showMoney) { project.budget = null; project.unbilled = null; project.invoiced = null; }
    return {
      project,
      samples: all(`SELECT s.*, (SELECT COUNT(*) FROM tests t WHERE t.sample_id = s.id AND t.status != 'Cancelled') AS test_count,
          (SELECT COUNT(*) FROM tests t WHERE t.sample_id = s.id AND t.status = 'Approved') AS tests_approved
        FROM samples s WHERE s.project_id = ? ORDER BY s.id DESC`, id),
      testsByStatus: all(`SELECT t.status, COUNT(*) AS n FROM tests t JOIN samples s ON s.id = t.sample_id WHERE s.project_id = ? GROUP BY t.status`, id),
      notebook: all(`SELECT n.id, n.code, n.title, n.status, n.created_at, u.full_name AS author_name FROM notebook_entries n JOIN users u ON u.id = n.author_id WHERE n.project_id = ? ORDER BY n.id DESC`, id),
      investigations: all('SELECT id, code, type, title, status, severity FROM investigations WHERE project_id = ? ORDER BY id DESC', id),
      invoices: showMoney ? all(`SELECT i.*, ${NET} AS subtotal FROM invoices i WHERE i.project_id = ? ORDER BY i.id DESC`, id) : null,
      can: flags(PROJECT_RULES, project, ctx.user),
    };
  });

  r.post('/api/projects', (ctx) => createProject(ctx, ctx.body));

  r.put('/api/projects/:id', (ctx) => {
    const id = +ctx.params.id;
    guard(PROJECT_RULES.edit(mustGet('SELECT * FROM projects WHERE id = ?', id, 'Project'), ctx.user));
    if (ctx.body?.status !== undefined) throw bad('Change a project\'s status with its own action');
    const { client_id, status, ...schema } = projectSchema;
    const b = clean(ctx.body, schema, { partial: true });
    if ('budget' in b && !can(ctx.user, 'billing.edit')) delete b.budget;
    update(ctx, 'projects', id, b, { summary: 'Project edited' });
    return { ok: true };
  });

  for (const action of Object.keys(PROJECT_MOVES)) r.post(`/api/projects/:id/${action}`, (ctx) => setProjectStatus(ctx, +ctx.params.id, action, ctx.body));

  // ----- Invoices -----
  r.get('/api/invoices', (ctx) => {
    const where = [];
    const params = [];
    if (ctx.query.status && ctx.query.status !== 'all') { where.push('i.status = ?'); params.push(ctx.query.status); }
    if (ctx.query.client_id) { where.push('i.client_id = ?'); params.push(+ctx.query.client_id); }
    return all(`SELECT i.*, c.name AS client_name, c.code AS client_code, p.code AS project_code, p.title AS project_title, ${NET} AS subtotal,
        ROUND(${NET} * (1 + i.tax_rate / 100.0), 2) AS total
      FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.id DESC`, ...params);
  }, { perm: 'billing.view' });

  r.get('/api/invoices/unbilled', () => all(`
    SELECT p.id, p.code, p.title, p.po_number, c.id AS client_id, c.name AS client_name, COUNT(t.id) AS tests, SUM(t.price) AS value, MIN(t.approved_at) AS oldest
    FROM tests t JOIN samples s ON s.id = t.sample_id JOIN projects p ON p.id = s.project_id JOIN clients c ON c.id = p.client_id
    WHERE t.status = 'Approved' AND t.invoice_id IS NULL GROUP BY p.id ORDER BY value DESC`), { perm: 'billing.view' });

  r.get('/api/invoices/:id', (ctx) => {
    const id = +ctx.params.id;
    const invoice = mustGet(`SELECT i.*, c.name AS client_name, c.code AS client_code, c.address AS client_address, c.contact_name, c.contact_email,
        p.code AS project_code, p.title AS project_title, u.full_name AS created_by_name
      FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN projects p ON p.id = i.project_id LEFT JOIN users u ON u.id = i.created_by WHERE i.id = ?`, id, 'Invoice');
    return {
      invoice,
      lines: all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id', id),
      totals: invoiceTotals(id, invoice.tax_rate),
      tests: all(`${TEST_SELECT} WHERE t.invoice_id = ? ORDER BY t.id`, id),
      unbilledAvailable: invoice.project_id ? unbilledLines(invoice.project_id).reduce((n, l) => n + l.quantity, 0) : 0,
      can: flags(INVOICE_RULES, invoice, ctx.user),
    };
  }, { perm: 'billing.view' });

  r.post('/api/invoices', (ctx) => createInvoice(ctx, ctx.body), { perm: 'billing.edit' });

  r.put('/api/invoices/:id', (ctx) => {
    const id = +ctx.params.id;
    guard(INVOICE_RULES.edit(mustGet('SELECT * FROM invoices WHERE id = ?', id, 'Invoice'), ctx.user));
    const b = clean(ctx.body, { notes: { type: 'text' }, tax_rate: { type: 'num', min: 0, max: 100 }, po_number: {} }, { partial: true });
    const existing = all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id', id);
    const byId = new Map(existing.map((l) => [l.id, l]));
    const lines = Array.isArray(ctx.body.lines) ? ctx.body.lines.filter((l) => l && typeof l === 'object' && String(l.description || '').trim()).map((l, i) => {
      const prev = l.id ? byId.get(Number(l.id)) : null;
      const x = clean(l, { description: { required: true, max: 1000 }, quantity: { type: 'num', required: !prev?.test_ids }, unit_price: { type: 'num', required: true, label: 'unit price' } });
      // Lines generated from tests keep their quantity and test links; only wording and price can change.
      return prev?.test_ids ? { ...x, quantity: prev.quantity, test_ids: prev.test_ids, keep: prev.id, sort_order: i } : { ...x, test_ids: null, sort_order: i };
    }) : null;
    let released = 0;
    tx(() => {
      const extra = {};
      if (lines) {
        const fmt = (ls) => ls.map((l) => `${l.quantity} × ${l.unit_price} — ${l.description}`).join(' | ');
        const before = fmt(existing);
        const kept = new Set(lines.map((l) => l.keep).filter(Boolean));
        for (const prev of existing) {
          if (!prev.test_ids || kept.has(prev.id)) continue;
          const ids = JSON.parse(prev.test_ids);
          if (ids.length) released += releaseTests(ctx, id, 'Released from a draft invoice', ids);
        }
        if (before !== fmt(lines) || released) {
          extra.lines = [before, fmt(lines)];
          if (released) extra['tests released to ready-to-bill'] = [null, released];
          run('DELETE FROM invoice_lines WHERE invoice_id = ?', id);
          for (const l of lines) {
            run('INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, sort_order, test_ids) VALUES (?, ?, ?, ?, ?, ?)', id, l.description, l.quantity, l.unit_price, l.sort_order, l.test_ids);
          }
        }
      }
      update(ctx, 'invoices', id, b, { summary: 'Draft invoice edited', extraChanges: extra });
    });
    return { ok: true, released };
  });

  r.post('/api/invoices/:id/add-unbilled', (ctx) => {
    const id = +ctx.params.id;
    const inv = mustGet('SELECT * FROM invoices WHERE id = ?', id, 'Invoice');
    guard(INVOICE_RULES.edit(inv, ctx.user));
    if (!inv.project_id) throw bad('Only project invoices can pull in completed work');
    tx(() => {
      let order = get('SELECT COALESCE(MAX(sort_order), -1) m FROM invoice_lines WHERE invoice_id = ?', id).m;
      const lines = unbilledLines(inv.project_id);
      for (const line of lines) addWorkLine(ctx, id, line, ++order);
      update(ctx, 'invoices', id, {}, { summary: 'Completed work added to invoice', extraChanges: { lines: [null, lines.map((l) => `${l.quantity} × ${l.description}`).join(' | ')] } });
    });
    return { ok: true };
  });

  r.post('/api/invoices/:id/issue', (ctx) => setInvoiceStatus(ctx, +ctx.params.id, 'issue', ctx.body));
  r.post('/api/invoices/:id/paid', (ctx) => setInvoiceStatus(ctx, +ctx.params.id, 'paid', ctx.body));
  r.post('/api/invoices/:id/void', (ctx) => setInvoiceStatus(ctx, +ctx.params.id, 'void', ctx.body));
}
