// Dashboard (what needs attention today) and Insights (how the business is doing).

import { all, get, ph } from '../db.js';
import { can } from '../auth.js';
import { SAMPLE_OPEN, rolesWith } from '../lookups.js';
import { today, addDays, now, localDate } from '../util.js';
import { queued } from '../http.js';
import { TEST_SELECT, TEST_EDITABLE, TEST_OPEN, TEST_QUEUES, TEST_RULES, TEST_RETURNED } from '../workflow.js';
import { INVESTIGATION_OPEN } from '../investigations.js';

function monthsBack(n) {
  const out = [];
  const d = now();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function lastMonthStart(date) {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00`);
  d.setMonth(d.getMonth() - 1);
  return localDate(d);
}

const [RETURNED_SQL, ...RETURNED_PARAMS] = TEST_RETURNED;
const fillMonths = (months, rows, key = 'v') => months.map((m) => ({ month: m, value: rows.find((r) => r.month === m)?.[key] ?? 0 }));

export default function routes(r) {
  r.get('/api/dashboard', (ctx) => {
    const me = ctx.user;
    const t = today();
    const money = can(me, 'billing.view');
    const since90 = addDays(t, -90);

    const kpis = get(`SELECT
      (SELECT COUNT(*) FROM samples WHERE status IN (${ph(SAMPLE_OPEN)})) AS samples_in_lab,
      (SELECT COUNT(*) FROM samples WHERE received_at >= ?) AS received_7d,
      (SELECT COUNT(*) FROM tests WHERE status IN (${ph(TEST_EDITABLE)})) AS tests_open,
      (SELECT COUNT(*) FROM tests WHERE status IN (${ph(TEST_OPEN)}) AND due_date < ?) AS tests_overdue,
      (SELECT COUNT(*) FROM tests WHERE status = 'Submitted') AS awaiting_review,
      (SELECT COUNT(*) FROM tests WHERE status = 'Reviewed') AS awaiting_approval,
      (SELECT COUNT(*) FROM tests WHERE analyst_id IS NULL AND status = 'Pending') AS unassigned,
      (SELECT COUNT(*) FROM investigations v WHERE ${INVESTIGATION_OPEN}) AS open_investigations,
      (SELECT COUNT(*) FROM samples WHERE reported_at >= ?) AS reported_90d,
      (SELECT COUNT(*) FROM samples WHERE reported_at >= ? AND substr(reported_at, 1, 10) <= due_date) AS on_time_90d,
      (SELECT AVG(julianday(reported_at) - julianday(received_at)) FROM samples WHERE reported_at >= ?) AS avg_tat_90d`,
    ...SAMPLE_OPEN, new Date(Date.parse(`${addDays(t, -7)}T00:00:00`)).toISOString(), ...TEST_EDITABLE, ...TEST_OPEN, t, since90, since90, since90);

    if (money) {
      const monthStart = `${t.slice(0, 7)}-01`;
      Object.assign(kpis, get(`SELECT
        (SELECT COALESCE(SUM(l.quantity * l.unit_price), 0) FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id WHERE i.status IN ('Sent','Paid') AND i.issued_date >= ?) AS revenue_mtd,
        (SELECT COALESCE(SUM(l.quantity * l.unit_price), 0) FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id WHERE i.status IN ('Sent','Paid') AND i.issued_date >= ? AND i.issued_date < ?) AS revenue_last_month,
        (SELECT COALESCE(SUM(price), 0) FROM tests WHERE status = 'Approved' AND invoice_id IS NULL) AS unbilled,
        (SELECT COALESCE(SUM(price), 0) FROM tests WHERE status IN (${ph(TEST_OPEN)})) AS wip_value,
        (SELECT COALESCE(SUM(l.quantity * l.unit_price * (1 + i.tax_rate / 100.0)), 0) FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id WHERE i.status = 'Sent') AS outstanding,
        (SELECT COALESCE(SUM(l.quantity * l.unit_price * (1 + i.tax_rate / 100.0)), 0) FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id WHERE i.status = 'Sent' AND i.due_date < ?) AS overdue_receivables`,
      monthStart, lastMonthStart(t), monthStart, ...TEST_OPEN, t));
    }

    const alerts = [];
    for (const i of all(`SELECT id, code, name, calibration_due, status FROM instruments WHERE status != 'Retired' AND calibration_due IS NOT NULL AND calibration_due <= ? ORDER BY calibration_due`, addDays(t, 14))) {
      alerts.push({ level: i.calibration_due < t ? 'red' : 'amber', kind: 'Instrument', href: `/instruments/${i.id}`, code: i.code, text: i.calibration_due < t ? `Calibration overdue since ${i.calibration_due} — locked for testing` : `Calibration due ${i.calibration_due}` });
    }
    for (const i of all(`SELECT id, code, name, status FROM instruments WHERE status IN ('Out of Service','Maintenance')`)) {
      alerts.push({ level: 'amber', kind: 'Instrument', href: `/instruments/${i.id}`, code: i.code, text: `${i.name} is ${i.status.toLowerCase()}` });
    }
    for (const m of all(`SELECT id, code, name, expiry_date FROM inventory WHERE status = 'Active' AND expiry_date IS NOT NULL AND expiry_date <= ? ORDER BY expiry_date`, addDays(t, 30))) {
      alerts.push({ level: m.expiry_date < t ? 'red' : 'amber', kind: 'Inventory', href: `/inventory/${m.id}`, code: m.code, text: m.expiry_date < t ? `${m.name} expired ${m.expiry_date}` : `${m.name} expires ${m.expiry_date}` });
    }
    for (const m of all(`SELECT id, code, name, quantity, unit FROM inventory WHERE status = 'Active' AND min_quantity IS NOT NULL AND quantity <= min_quantity`)) {
      alerts.push({ level: 'amber', kind: 'Inventory', href: `/inventory/${m.id}`, code: m.code, text: `Low stock: ${m.name} (${m.quantity} ${m.unit || ''} left)` });
    }
    for (const v of all(`SELECT v.id, v.code, v.title, v.due_date FROM investigations v WHERE ${INVESTIGATION_OPEN} AND v.due_date < ?`, t)) {
      alerts.push({ level: 'red', kind: 'Investigation', href: `/investigations/${v.id}`, code: v.code, text: `Past due (${v.due_date}): ${v.title}` });
    }
    for (const q of all(`SELECT q.method_code, q.expires_at, u.full_name, u.id FROM qualifications q JOIN users u ON u.id = q.user_id WHERE q.revoked = 0 AND u.active = 1 AND q.expires_at IS NOT NULL AND q.expires_at <= ?`, addDays(t, 30))) {
      alerts.push({ level: q.expires_at < t ? 'red' : 'amber', kind: 'Training', href: `/team/${q.id}`, code: q.method_code, text: `${q.full_name}'s qualification ${q.expires_at < t ? 'expired' : 'expires'} ${q.expires_at}` });
    }
    alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));

    return {
      kpis,
      // The assigned Queue is already in priority and due-date order.
      myTests: queued(TEST_RULES, TEST_QUEUES.assigned, me).slice(0, 12),
      myReturned: all(`${TEST_SELECT} WHERE t.analyst_id = ? AND ${RETURNED_SQL}`, me.id, ...RETURNED_PARAMS).map((x) => x.id),
      myDrafts: all(`SELECT id, code, title, updated_at FROM notebook_entries WHERE author_id = ? AND status = 'Draft' ORDER BY updated_at DESC LIMIT 5`, me.id),
      alerts,
      pipeline: all(`SELECT status, COUNT(*) AS n FROM tests WHERE status IN (${ph(TEST_OPEN)}) GROUP BY status`, ...TEST_OPEN),
      workload: all(`SELECT u.id, u.full_name, u.initials,
          SUM(CASE WHEN t.status IN (${ph(TEST_EDITABLE)}) THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN t.status IN (${ph(TEST_EDITABLE)}) AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue
        FROM users u LEFT JOIN tests t ON t.analyst_id = u.id
        WHERE u.active = 1 AND u.role IN (${ph(rolesWith('tests.perform'))})
        GROUP BY u.id ORDER BY open DESC, u.full_name`, ...TEST_EDITABLE, ...TEST_EDITABLE, t, ...rolesWith('tests.perform')),
      dueSoon: all(`SELECT s.id, s.code, s.description, s.due_date, s.status, s.priority, c.code AS client_code,
          (SELECT COUNT(*) FROM tests x WHERE x.sample_id = s.id AND x.status != 'Cancelled') AS test_count,
          (SELECT COUNT(*) FROM tests x WHERE x.sample_id = s.id AND x.status = 'Approved') AS tests_approved
        FROM samples s JOIN clients c ON c.id = s.client_id
        WHERE s.status IN ('Received','In Testing','In Review') AND s.due_date <= ? ORDER BY s.due_date, s.id LIMIT 10`, addDays(t, 3)),
      activity: all(`SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.entity_code, a.summary, a.user_id, u.full_name, u.initials
        FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.action = 'SIGN' OR (a.action = 'CREATE' AND a.entity IN ('samples','investigations','notebook_entries','projects','clients','methods'))
        ORDER BY a.id DESC LIMIT 12`),
      revenueTrend: money ? fillMonths(monthsBack(6), all(`SELECT substr(i.issued_date, 1, 7) AS month, SUM(l.quantity * l.unit_price) AS v
        FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id WHERE i.status IN ('Sent','Paid') AND i.issued_date >= ? GROUP BY month`, `${monthsBack(6)[0]}-01`)) : null,
    };
  });

  r.get('/api/insights', (ctx) => {
    const months = monthsBack(12);
    const from = `${months[0]}-01`;
    const fromIso = new Date(`${from}T00:00:00`).toISOString();
    const money = can(ctx.user, 'billing.view');
    return {
      months,
      revenueByMonth: money ? fillMonths(months, all(`SELECT substr(i.issued_date, 1, 7) AS month, SUM(l.quantity * l.unit_price) AS v
        FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id WHERE i.status IN ('Sent','Paid') AND i.issued_date >= ? GROUP BY month`, from)) : null,
      completedByMonth: fillMonths(months, all(`SELECT substr(approved_at, 1, 7) AS month, COUNT(*) AS v FROM tests WHERE status = 'Approved' AND approved_at >= ? GROUP BY month`, fromIso)),
      receivedByMonth: fillMonths(months, all(`SELECT substr(received_at, 1, 7) AS month, COUNT(*) AS v FROM samples WHERE received_at >= ? GROUP BY month`, fromIso)),
      tatByMonth: fillMonths(months, all(`SELECT substr(reported_at, 1, 7) AS month, AVG(julianday(reported_at) - julianday(received_at)) AS v FROM samples WHERE reported_at >= ? GROUP BY month`, fromIso)),
      onTimeByMonth: fillMonths(months, all(`SELECT substr(reported_at, 1, 7) AS month, 100.0 * SUM(CASE WHEN substr(reported_at, 1, 10) <= due_date THEN 1 ELSE 0 END) / COUNT(*) AS v
        FROM samples WHERE reported_at >= ? GROUP BY month`, fromIso)),
      revenueByClient: money ? all(`SELECT c.id, c.code, c.name, SUM(l.quantity * l.unit_price) AS value
        FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id JOIN clients c ON c.id = i.client_id
        WHERE i.status IN ('Sent','Paid') AND i.issued_date >= ? GROUP BY c.id ORDER BY value DESC`, from) : null,
      valueByTechnique: money ? all(`SELECT m.technique AS label, SUM(t.price) AS value, COUNT(*) AS tests
        FROM tests t JOIN methods m ON m.id = t.method_id WHERE t.status = 'Approved' AND t.approved_at >= ? GROUP BY m.technique ORDER BY value DESC`, fromIso) : null,
      oosByMethod: all(`SELECT m.code, MAX(m.title) AS title, COUNT(*) AS runs, SUM(t.oos) AS oos
        FROM tests t JOIN methods m ON m.id = t.method_id WHERE t.submitted_at >= ? AND t.status != 'Cancelled' GROUP BY m.code HAVING runs > 0 ORDER BY 1.0 * SUM(t.oos) / COUNT(*) DESC, runs DESC`, fromIso),
      throughput: all(`SELECT u.id, u.full_name, u.initials, COUNT(t.id) AS approved
        FROM users u LEFT JOIN tests t ON t.analyst_id = u.id AND t.status = 'Approved' AND t.approved_at >= ?
        WHERE u.active = 1 AND u.role IN (${ph(rolesWith('tests.perform'))}) GROUP BY u.id ORDER BY approved DESC`, new Date(`${addDays(today(), -90)}T00:00:00`).toISOString(), ...rolesWith('tests.perform')),
      generatedAt: localDate(now()),
    };
  }, { perm: 'insights.view' });
}
