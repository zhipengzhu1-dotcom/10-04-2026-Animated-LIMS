// Makes a complete, consistent backup of Aliquot's data (database + attached files), safe to run while the server is up.
// Usage:  node scripts/backup.js [destination-folder]
// Default destination: data/backups/manual-<timestamp>/
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../server/config.js';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.resolve(process.argv[2] || path.join(DATA_DIR, 'backups', `manual-${stamp}`));
const dbFile = path.join(DATA_DIR, 'aliquot.db');
if (!fs.existsSync(dbFile)) {
  console.error(`No database found at ${dbFile}`);
  process.exit(1);
}
fs.mkdirSync(dest, { recursive: true });
const db = new DatabaseSync(dbFile, { readOnly: true });
db.prepare('VACUUM INTO ?').run(path.join(dest, 'aliquot.db'));
db.close();
const files = path.join(DATA_DIR, 'files');
if (fs.existsSync(files)) fs.cpSync(files, path.join(dest, 'files'), { recursive: true });
console.log(`Backup complete: ${dest}`);
console.log('To restore: stop Aliquot, copy aliquot.db and the files/ folder back into the data folder, start Aliquot.');
