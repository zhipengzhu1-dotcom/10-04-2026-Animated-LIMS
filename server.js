// Aliquot — LIMS + ELN for contract analytical laboratories.
// Start with:  node server.js      (requires Node.js 22.13 or newer; no npm install needed)

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, backupTo, run } from './server/db.js';
import { Router, HttpError, clientIp, readBody, sendJson } from './server/http.js';
import { authenticate, can } from './server/auth.js';
import { PORT, HOST, PUBLIC_DIR, DATA_DIR, BACKUP_KEEP } from './server/config.js';
import { localDate, nowIso } from './server/util.js';
import coreRoutes from './server/routes/core.js';
import labRoutes from './server/routes/lab.js';
import resourceRoutes from './server/routes/resources.js';
import businessRoutes from './server/routes/business.js';
import qualityRoutes from './server/routes/quality.js';
import attachmentRoutes from './server/routes/attachments.js';
import dashboardRoutes from './server/routes/dashboard.js';
import documentRoutes, { handleDav } from './server/routes/documents.js';
import portalRoutes from './server/routes/portal.js';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Aliquot needs Node.js 22.13 or newer (you have ${process.versions.node}). Download it from https://nodejs.org`);
  process.exit(1);
}

openDb();

const router = new Router();
for (const register of [coreRoutes, labRoutes, resourceRoutes, businessRoutes, qualityRoutes, attachmentRoutes, dashboardRoutes, documentRoutes, portalRoutes]) register(router);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.webmanifest': 'application/manifest+json',
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

async function handleApi(req, res, url) {
  const ctx = { req, res, url, ip: clientIp(req), query: Object.fromEntries(url.searchParams), body: {}, user: null };
  try {
    const match = router.match(req.method, url.pathname);
    if (!match) throw new HttpError(404, 'Not found');
    if (match.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
    const { route, params } = match;
    ctx.params = params;
    // CSRF defence: browsers cannot attach this custom header cross-site without a CORS preflight, which we never grant.
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'aliquot') throw new HttpError(403, 'Request blocked');
    if (route.opts.auth !== false) {
      ctx.user = authenticate(ctx);
      if (ctx.user.must_change_password && !route.opts.allowPasswordChange) throw new HttpError(403, 'Please choose a new password first', 'PASSWORD_CHANGE_REQUIRED');
      if (route.opts.perm && !can(ctx.user, route.opts.perm)) throw new HttpError(403, 'You do not have permission to do that.', 'FORBIDDEN');
    }
    if (route.opts.raw) {
      ctx.rawBody = await readBody(req, route.opts.limit);
    } else if (req.method !== 'GET') {
      const buf = await readBody(req, 2 * 1024 * 1024);
      try {
        ctx.body = buf.length ? JSON.parse(buf.toString('utf8')) : {};
      } catch {
        throw new HttpError(400, 'Malformed request');
      }
      if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) throw new HttpError(400, 'Malformed request');
    }
    const result = await route.handler(ctx);
    if (!res.headersSent) sendJson(res, 200, result ?? { ok: true });
  } catch (e) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (e instanceof HttpError) {
      sendJson(res, e.status, { error: e.message, code: e.code });
    } else if (e?.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(e.message)) {
      sendJson(res, 409, { error: 'A record with that code or name already exists', code: 'CONFLICT' });
    } else if (e?.code === 'ERR_SQLITE_ERROR' && /NOT NULL constraint failed: \w+\.(\w+)/.test(e.message)) {
      const field = /NOT NULL constraint failed: \w+\.(\w+)/.exec(e.message)[1].replace(/_id$/, '').replace(/_/g, ' ');
      sendJson(res, 400, { error: `${field.charAt(0).toUpperCase()}${field.slice(1)} is required` });
    } else if (e?.code === 'ERR_SQLITE_ERROR' && /append-only/.test(e.message)) {
      sendJson(res, 403, { error: 'GxP records cannot be altered or deleted', code: 'FORBIDDEN' });
    } else {
      console.error(`[${nowIso()}] ${req.method} ${url.pathname}`, e);
      sendJson(res, 500, { error: 'Something went wrong on the server. The error has been logged.' });
    }
  }
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(400).end();
    return;
  }
  let stat = await fs.promises.stat(file).catch(() => null);
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = await fs.promises.stat(file).catch(() => null);
  }
  if (!stat) {
    // Client-side routes (e.g. /samples/12) all load the app shell.
    if (path.extname(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    file = path.join(PUBLIC_DIR, 'index.html');
    stat = await fs.promises.stat(file);
  }
  const ext = path.extname(file);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'Last-Modified': stat.mtime.toUTCString(),
  };
  if (ext === '.html') {
    headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  }
  if (req.headers['if-modified-since'] === headers['Last-Modified']) {
    res.writeHead(304).end();
    return;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  const dav = url.pathname === '/dav' || url.pathname.startsWith('/dav/');
  if (url.pathname.startsWith('/api/')) handleApi(req, res, url);
  // Desktop Word/Excel open and save notebook documents over WebDAV (see server/routes/documents.js).
  else if (dav || req.method === 'OPTIONS') handleDav(req, res, url);
  else serveStatic(req, res, url).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.writeHead(500).end();
  });
});

// ----- Automatic daily backups (a consistent snapshot of the live database) -----
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
function dailyBackup() {
  try {
    const file = path.join(BACKUP_DIR, `aliquot-${localDate()}.db`);
    if (fs.existsSync(file)) return;
    backupTo(file);
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^aliquot-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -BACKUP_KEEP);
    for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f));
    console.log(`Backup written: ${file}`);
  } catch (e) {
    console.error('Backup failed:', e.message);
  }
}
setInterval(dailyBackup, 60 * 60 * 1000).unref();
setTimeout(dailyBackup, 5000).unref();

// Expired sessions and Office edit links are cleaned up hourly.
setInterval(() => {
  run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
  run('DELETE FROM document_edit_links WHERE expires_at < ?', nowIso());
}, 60 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  // PORT=0 lets the system pick a free port; tests read it back from this banner.
  const { port } = server.address();
  // Team addresses only apply when listening on every interface (not e.g. HOST=127.0.0.1).
  const addresses = !['0.0.0.0', '::'].includes(HOST) ? [] : Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => `http://${a.address}:${port}`);
  console.log('');
  console.log('  Aliquot is running');
  console.log(`  On this computer:   http://localhost:${port}`);
  for (const a of addresses) console.log(`  For your team:      ${a}`);
  console.log(`  Data folder:        ${DATA_DIR}`);
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
