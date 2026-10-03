// JSON API client. Every mutating request carries the X-Requested-With header the server
// requires (CSRF defence). 401s bounce the user to the sign-in screen.

export class Cancelled extends Error {
  constructor() { super('cancelled'); this.cancelled = true; }
}

const hooks = { onAuthLost: null, onPasswordChange: null, onReasonRequired: null };
export const setApiHooks = (h) => Object.assign(hooks, h);

export async function request(path, { method = 'GET', body, headers = {}, rawBody } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'aliquot', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw Object.assign(new Error('Cannot reach the Aliquot server. Check your network connection.'), { status: 0 });
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status, code: data?.code });
    if (res.status === 401 && err.code === 'AUTH' && !path.startsWith('/api/auth/')) hooks.onAuthLost?.(err.message);
    if (err.code === 'PASSWORD_CHANGE_REQUIRED') hooks.onPasswordChange?.();
    throw err;
  }
  return data;
}

/** Sends a change; if the server asks for a reason (GxP change control), prompts for one and retries. */
async function send(method, path, body = {}) {
  try {
    return await request(path, { method, body });
  } catch (e) {
    if (e.code === 'REASON_REQUIRED' && !body.reason && hooks.onReasonRequired) {
      const reason = await hooks.onReasonRequired(e.message);
      if (!reason) throw new Cancelled();
      return send(method, path, { ...body, reason });
    }
    throw e;
  }
}

export const api = {
  get: (path, params) => {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
    return request(qs ? `${path}?${qs}` : path);
  },
  post: (path, body) => send('POST', path, body),
  put: (path, body) => send('PUT', path, body),
  upload: (path, file) => request(path, {
    method: 'POST',
    rawBody: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
  }),
};
