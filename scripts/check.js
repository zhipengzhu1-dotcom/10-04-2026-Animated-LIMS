// Syntax-checks every JavaScript file in the project with `node --check`. No dependencies needed.
// Usage:  npm run check
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'data', 'data-dev']);

function* jsFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(file);
    else if (entry.name.endsWith('.js')) yield file;
  }
}

let count = 0;
let failed = 0;
for (const file of jsFiles(ROOT)) {
  count++;
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(e.stderr.toString());
  }
}
console.log(failed ? `${failed} of ${count} files have syntax errors` : `Syntax OK (${count} files)`);
process.exit(failed ? 1 : 0);
