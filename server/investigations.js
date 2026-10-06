// What each person may do to an Investigation.

import { bad, forbidden } from './http.js';
import { can } from './auth.js';

export const INVESTIGATION_RULES = {
  attach(v, me) {
    if (!can(me, 'investigations.raise') && !can(me, 'investigations.close')) return forbidden();
    if (v.status === 'Closed') return bad('Closed investigations are locked');
  },
};
