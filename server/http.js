import { CLOUDFLARE_TUNNEL } from './config.js';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const isLoopback = (ip) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

/** The visitor's address. Behind the tunnel, Cloudflare's header is trusted only on connections from this computer. */
export function clientIp(req) {
  const socket = req.socket.remoteAddress;
  const visitor = req.headers['cf-connecting-ip'];
  return CLOUDFLARE_TUNNEL && visitor && isLoopback(socket) ? String(visitor).slice(0, 64) : socket;
}

export const bad = (message, code) => new HttpError(400, message, code);
export const forbidden = (message = 'You do not have permission to do that.') => new HttpError(403, message, 'FORBIDDEN');
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`, 'NOT_FOUND');
export const conflict = (message) => new HttpError(409, message, 'CONFLICT');

// A rule takes a record and a person and returns nothing when the action is allowed, else the refusal it throws.

export function guard(refusal) {
  if (refusal) throw refusal;
}

/** The `can` object for `record`: one boolean per rule in `rules`. */
export const flags = (rules, record, person) => Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, !rule(record, person)]));

/** The `locks` object for `record`: each named rule's refusal message, or null when it allows the action. */
export const locks = (rules, record, person, ...names) => Object.fromEntries(names.map((name) => [name, rules[name](record, person)?.message ?? null]));

/** The records of `queue`'s stage on which `person` is offered the rule it names in `rules`, in the stage's order. */
export const queued = (rules, queue, person) => queue.stage().filter((record) => !rules[queue.rule](record, person));

/** `queued` for the Queue a list's `work` filter names; an unknown name is refused. */
export function workQueue(rules, queues, name, person) {
  if (!Object.hasOwn(queues, name)) throw bad(`Work filter must be one of: ${Object.keys(queues).join(', ')}`);
  return queued(rules, queues[name], person);
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const source = pattern.replace(/\/:(\w+)/g, (_, key) => {
      keys.push(key);
      return '/([^/]+)';
    });
    this.routes.push({ method, re: new RegExp(`^${source}/?$`), keys, handler, opts });
  }

  get(p, h, o) { this.add('GET', p, h, o); }
  post(p, h, o) { this.add('POST', p, h, o); }
  put(p, h, o) { this.add('PUT', p, h, o); }
  del(p, h, o) { this.add('DELETE', p, h, o); }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, `Upload too large (limit ${Math.round(limit / 1048576)} MB)`));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
