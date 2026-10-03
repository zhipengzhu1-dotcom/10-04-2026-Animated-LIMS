import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = path.resolve(process.env.ALIQUOT_DATA || path.join(ROOT, 'data'));
export const PORT = Number(process.env.PORT || 3000);
export const HOST = process.env.HOST || '0.0.0.0';
// Set SECURE_COOKIES=1 when the app is served over HTTPS (e.g. behind a reverse proxy).
export const SECURE_COOKIES = process.env.SECURE_COOKIES === '1';
export const SESSION_MAX_HOURS = 12;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const BACKUP_KEEP = 14;
