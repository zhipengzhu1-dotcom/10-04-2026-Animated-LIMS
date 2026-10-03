// Navigation helpers usable from any view without importing the app shell.
export const navigate = (path, { replace = false } = {}) => window.dispatchEvent(new CustomEvent('aq:navigate', { detail: { path, replace } }));
export const refreshNav = () => window.dispatchEvent(new Event('aq:nav-refresh'));

export function setQuery(patch) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '' || v === false) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  return url.pathname + (url.search ? url.search : '');
}
