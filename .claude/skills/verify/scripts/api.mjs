#!/usr/bin/env node
// Calls this run's Aliquot API as a demo person, to read back the state a UI action should have changed.
// Usage: .claude/skills/verify/scripts/api.mjs <run-name> <username> <METHOD> <path> [json-body]
//   e.g. api.mjs verify daniel.okafor GET /api/audit?limit=5
// Signs in with demo1234 once per person and keeps the cookie in .verify/runs/<run-name>/cookie-<username>.
// Prints {status, data} as JSON. Use it to read state; drive the change itself through the browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const [name, username, method, url, body] = process.argv.slice(2);
if (!url) {
  console.error('usage: api.mjs <run-name> <username> <METHOD> <path> [json-body]');
  process.exit(2);
}
const run = path.join(ROOT, '.verify/runs', name);
const base = fs.readFileSync(path.join(run, 'base'), 'utf8').trim();
const jar = path.join(run, `cookie-${username}`);

const call = async (m, u, b, cookie) => {
  const res = await fetch(base + u, {
    method: m,
    headers: {
      'X-Requested-With': 'aliquot',
      ...(b ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: b ? JSON.stringify(b) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
};

let cookie = fs.existsSync(jar) ? fs.readFileSync(jar, 'utf8') : '';
if (!cookie || (await call('GET', '/api/auth/me', null, cookie)).status !== 200) {
  const login = await call('POST', '/api/auth/login', { username, password: 'demo1234' });
  if (login.status !== 200) {
    console.error(`sign-in as ${username} failed: ${JSON.stringify(login.data)}`);
    process.exit(1);
  }
  cookie = login.setCookie.split(';')[0];
  fs.writeFileSync(jar, cookie);
}
const { status, data } = await call(method.toUpperCase(), url, body ? JSON.parse(body) : null, cookie);
console.log(JSON.stringify({ status, data }, null, 2));
process.exit(status < 400 ? 0 : 1);
