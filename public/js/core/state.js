// Session-wide state: who is signed in, what they may do, lab settings and controlled vocabularies.
export const state = {
  me: null,
  permissions: new Set(),
  modules: new Set(),
  settings: {},
  lookups: null,
  nav: {},
};

export const can = (perm) => state.permissions.has(perm);
/** Is this module part of the release? The server's current-user response is the only source. */
export const shipped = (module) => state.modules.has(module);
export const userById = (id) => state.lookups?.users?.find((u) => u.id === id) || null;
export const activeUsers = (roles) => (state.lookups?.users || []).filter((u) => u.active && (!roles || roles.includes(u.role)));
export const roleLabel = (role) => state.lookups?.roles?.[role]?.label || role;
