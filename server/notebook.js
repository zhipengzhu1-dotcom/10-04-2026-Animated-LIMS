// Notebook entries: what each person may do to one. The notebook routes, its documents and WebDAV all ask this module.

import { all } from './db.js';
import { bad, forbidden } from './http.js';
import { can } from './auth.js';

export const ENTRY_RULES = {
  edit(n, me) {
    if (!can(me, 'notebook.write')) return forbidden();
    if (n.author_id !== me.id) return forbidden('Only the author can edit this entry');
    if (n.status !== 'Draft') return bad('Signed entries are locked — add an addendum instead');
  },
  sign(n, me) {
    if (!can(me, 'notebook.write')) return forbidden();
    if (n.author_id !== me.id) return forbidden('Only the author can sign this entry');
    if (n.status !== 'Draft') return bad('This entry has already been signed');
  },
  witness(n, me) {
    if (!can(me, 'notebook.witness')) return forbidden();
    if (n.author_id === me.id) return forbidden('You cannot witness your own entry');
    if (n.status !== 'Signed') return bad('Only signed entries can be witnessed');
  },
  addendum(n, me) {
    if (!can(me, 'notebook.write')) return forbidden();
    if (n.status === 'Draft') return bad('Edit the draft directly instead of adding an addendum');
  },
  attach(n, me) {
    if (!can(me, 'notebook.write')) return forbidden();
    if (n.author_id !== me.id) return forbidden('Only the author can attach files to this entry');
    if (n.status !== 'Draft') return bad('Signed notebook entries are locked — add an addendum instead');
  },
};

// Every column a rule may read, with its author and Project for the lists; the body stays on the entry's page.
const ENTRY_STAGE = `SELECT n.id, n.code, n.title, n.status, n.author_id, n.project_id, n.sample_id, n.method_id, n.tags, n.signed_at,
    n.witness_id, n.witnessed_at, n.created_at, n.updated_at, u.full_name AS author_name, p.code AS project_code
  FROM notebook_entries n JOIN users u ON u.id = n.author_id LEFT JOIN projects p ON p.id = n.project_id`;

// Each Queue names the rule it derives from and its stage: the entries at that point of the work, in the Queue's order,
// narrowed by status only. Every surface reads a person's Queue through `queued`.
export const ENTRY_QUEUES = {
  witness: { rule: 'witness', stage: () => all(`${ENTRY_STAGE} WHERE n.status = 'Signed' ORDER BY n.signed_at, n.id`) },
  drafts: { rule: 'edit', stage: () => all(`${ENTRY_STAGE} WHERE n.status = 'Draft' ORDER BY n.updated_at DESC, n.id DESC`) },
};
