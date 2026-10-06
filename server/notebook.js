// Notebook entries: what each person may do to one. The notebook routes, its documents and WebDAV all ask this module.

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
