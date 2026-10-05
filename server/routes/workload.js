// Workload: each analyst's open tests and the projects they are on, for the people who assign work.

import { all, get, ph } from '../db.js';
import { can } from '../auth.js';
import { forbidden } from '../http.js';
import { rolesWith } from '../lookups.js';
import { today, addDays } from '../util.js';
import { TEST_EDITABLE, TEST_OPEN, TEST_RETURNED } from '../workflow.js';

const CLOSED_PROJECT = ['Completed', 'Cancelled'];

export default function routes(r) {
  r.get('/api/workload', (ctx) => {
    if (!can(ctx.user, 'tests.assign') && !can(ctx.user, 'work.oversee')) throw forbidden();
    const t = today();
    const performers = rolesWith('tests.perform');
    const isOpen = `t.status IN (${ph(TEST_EDITABLE)})`;

    const analysts = all(`SELECT u.id, u.full_name, u.initials, u.title, u.role,
        SUM(CASE WHEN t.status = 'Pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN t.status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN ${isOpen} THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN ${isOpen} AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN ${isOpen} AND t.due_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS due_week,
        SUM(CASE WHEN t.status = 'In Progress' AND EXISTS (SELECT 1 FROM signatures g WHERE g.entity = 'tests' AND g.entity_id = t.id AND g.meaning IN (${ph(TEST_RETURNED)})) THEN 1 ELSE 0 END) AS returned,
        SUM(CASE WHEN t.status IN ('Submitted','Reviewed') THEN 1 ELSE 0 END) AS awaiting_review
      FROM users u LEFT JOIN tests t ON t.analyst_id = u.id AND t.status IN (${ph(TEST_OPEN)})
      WHERE u.active = 1 AND u.role IN (${ph(performers)})
      GROUP BY u.id ORDER BY open DESC, u.full_name`,
    ...TEST_EDITABLE, ...TEST_EDITABLE, t, ...TEST_EDITABLE, t, addDays(t, 7), ...TEST_RETURNED, ...TEST_OPEN, ...performers);

    const byId = new Map(analysts.map((a) => [a.id, { ...a, projects: [] }]));
    const links = all(`SELECT x.user_id, p.id, p.code, p.title, c.code AS client_code, p.status, p.due_date, MAX(x.lead) AS lead, SUM(x.open_tests) AS open_tests,
        (SELECT COUNT(*) FROM tests pt JOIN samples ps ON ps.id = pt.sample_id WHERE ps.project_id = p.id AND pt.status != 'Cancelled') AS test_count,
        (SELECT COUNT(*) FROM tests pt JOIN samples ps ON ps.id = pt.sample_id WHERE ps.project_id = p.id AND pt.status = 'Approved') AS tests_done
      FROM (
        SELECT lead_id AS user_id, id AS project_id, 1 AS lead, 0 AS open_tests FROM projects WHERE lead_id IS NOT NULL AND status NOT IN (${ph(CLOSED_PROJECT)})
        UNION ALL
        SELECT t.analyst_id, s.project_id, 0, COUNT(*) FROM tests t JOIN samples s ON s.id = t.sample_id
        WHERE ${isOpen} AND t.analyst_id IS NOT NULL AND s.project_id IS NOT NULL GROUP BY t.analyst_id, s.project_id
      ) x
      JOIN projects p ON p.id = x.project_id JOIN clients c ON c.id = p.client_id
      GROUP BY x.user_id, p.id
      ORDER BY lead DESC, p.due_date IS NULL, p.due_date, p.id`, ...CLOSED_PROJECT, ...TEST_EDITABLE);
    for (const { user_id, lead, ...project } of links) byId.get(user_id)?.projects.push({ ...project, lead: !!lead });

    return {
      unassigned: get(`SELECT COUNT(*) AS n FROM tests WHERE analyst_id IS NULL AND status = 'Pending'`).n,
      analysts: [...byId.values()],
    };
  });
}
