import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = path.resolve(process.env.ALIQUOT_DATA || path.join(ROOT, 'data'));
export const PORT = Number(process.env.PORT || 3000);
export const HOST = process.env.HOST || '0.0.0.0';
// Every module of the full product, by its sidebar key. SHIPPED_MODULES=samples,methods,… ships only those; unset ships all.
export const MODULES = ['dashboard', 'samples', 'worklist', 'reviews', 'notebook', 'methods', 'instruments', 'inventory', 'investigations', 'audit', 'clients', 'projects', 'invoices', 'portal', 'insights', 'team', 'settings'];
export const SHIPPED_MODULES = shippedModules(process.env.SHIPPED_MODULES);
export const isShipped = (module) => SHIPPED_MODULES.includes(module);
// Set SECURE_COOKIES=1 when the app is served over HTTPS (e.g. behind a reverse proxy).
export const SECURE_COOKIES = process.env.SECURE_COOKIES === '1';
export const SESSION_MAX_HOURS = 12;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const BACKUP_KEEP = 14;

function shippedModules(value) {
  if (!value?.trim()) return MODULES;
  const keys = value.split(',').map((k) => k.trim()).filter(Boolean);
  const unknown = keys.filter((k) => !MODULES.includes(k));
  if (unknown.length) {
    console.error(`SHIPPED_MODULES has an unknown module key: ${unknown.join(', ')}. Known keys: ${MODULES.join(', ')}.`);
    process.exit(1);
  }
  return MODULES.filter((k) => keys.includes(k));
}
