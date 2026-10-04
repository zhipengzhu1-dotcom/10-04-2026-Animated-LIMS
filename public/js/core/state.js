// Session-wide state: who is signed in, what they may do, lab settings and controlled vocabularies.
export const state = {
  me: null,
  permissions: new Set(),
  settings: {},
  lookups: null,
  nav: {},
};

export const can = (perm) => state.permissions.has(perm);
export const userById = (id) => state.lookups?.users?.find((u) => u.id === id) || null;
export const activeUsers = (roles) => (state.lookups?.users || []).filter((u) => u.active && (!roles || roles.includes(u.role)));
export const roleLabel = (role) => state.lookups?.roles?.[role]?.label || role;
