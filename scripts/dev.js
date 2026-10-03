// Starts a development copy of Aliquot with its own data folder (data-dev/), on port 3001, reachable from this
// computer only, so trying changes never touches the lab's real database in data/. Restarts when server code changes.
// Usage:  npm run dev
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.ALIQUOT_DATA ||= path.join(ROOT, 'data-dev');
process.env.PORT ||= '3001';
process.env.HOST ||= '127.0.0.1';

if (path.resolve(process.env.ALIQUOT_DATA) === path.join(ROOT, 'data')) {
  console.error('npm run dev refuses to use data/ (the lab\'s real data). Unset ALIQUOT_DATA or point it at another folder.');
  process.exit(1);
}

await import('../server.js');
