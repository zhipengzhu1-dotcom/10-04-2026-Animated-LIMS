import { get } from './db.js';
import { HttpError } from './http.js';

// The clock can be pinned (used only when generating demo history); everything else uses real time.
let pinned = null;
export const setClock = (d) => { pinned = d ? new Date(d) : null; };
export const now = () => (pinned ? new Date(pinned) : new Date());
export const nowIso = () => now().toISOString();

const z = (n) => String(n).padStart(2, '0');
export const localDate = (d = now()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
export const today = () => localDate(now());
export const dateOf = (iso) => (iso ? localDate(new Date(iso)) : null);

export function addDays(date, n) {
  const d = new Date(`${String(date).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

/** Adds working days (Mon–Fri); turnaround times are quoted in working days. */
export function addBusinessDays(date, n) {
  const d = new Date(`${String(date).slice(0, 10)}T12:00:00`);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return localDate(d);
}

export function diffDays(from, to) {
  const a = Date.parse(`${String(from).slice(0, 10)}T12:00:00`);
  const b = Date.parse(`${String(to).slice(0, 10)}T12:00:00`);
  return Math.round((b - a) / 86400000);
}

export const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
export const sameValue = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));

/** Formats a number to a fixed number of decimals, the way results are reported. */
export const fixed = (n, d = 2) => (n == null ? '' : Number(n).toFixed(d));

/** Human-readable specification, e.g. "98.0 – 102.0 %", "≤ 0.10 %", "Conforms". */
export function specText(r) {
  const d = r.decimals ?? 2;
  const unit = r.unit ? ` ${r.unit}` : '';
  if (r.result_type !== 'numeric') return r.spec_text || 'Report';
  if (r.spec_min != null && r.spec_max != null) return `${fixed(r.spec_min, d)} – ${fixed(r.spec_max, d)}${unit}`;
  if (r.spec_min != null) return `≥ ${fixed(r.spec_min, d)}${unit}`;
  if (r.spec_max != null) return `≤ ${fixed(r.spec_max, d)}${unit}`;
  return 'Report result';
}

export function initialsOf(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Validates and normalises request input against a small schema.
 * Empty strings become null. With { partial: true } only keys present in the input are returned.
 */
export function clean(input, schema, { partial = false } = {}) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  for (const [key, spec] of Object.entries(schema)) {
    const label = cap(spec.label || key.replace(/_id$/, '').replace(/_/g, ' '));
    if (!(key in src)) {
      if (partial) continue;
      if (spec.default !== undefined) {
        out[key] = typeof spec.default === 'function' ? spec.default() : spec.default;
        continue;
      }
      if (spec.required) throw new HttpError(400, `${label} is required`);
      continue;
    }
    let v = src[key];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;
    if (v === null) {
      if (spec.required) throw new HttpError(400, `${label} is required`);
      out[key] = null;
      continue;
    }
    switch (spec.type || 'str') {
      case 'str':
      case 'text': {
        v = String(v);
        const max = spec.max || (spec.type === 'text' ? 200000 : 500);
        if (v.length > max) throw new HttpError(400, `${label} is too long (max ${max} characters)`);
        break;
      }
      case 'num': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number`);
        if (spec.min != null && n < spec.min) throw new HttpError(400, `${label} must be at least ${spec.min}`);
        if (spec.max != null && n > spec.max) throw new HttpError(400, `${label} must be at most ${spec.max}`);
        v = n;
        break;
      }
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n)) throw new HttpError(400, `${label} must be a whole number`);
        if (spec.min != null && n < spec.min) throw new HttpError(400, `${label} must be at least ${spec.min}`);
        v = n;
        break;
      }
      case 'id': {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label.toLowerCase()}`);
        if (spec.ref && !get(`SELECT 1 FROM ${spec.ref} WHERE id = ?`, n)) throw new HttpError(400, `${label} not found`);
        v = n;
        break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${label} must be a valid date`);
        break;
      case 'datetime': {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} must be a valid date and time`);
        v = d.toISOString();
        break;
      }
      case 'bool':
        v = v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0;
        break;
      case 'enum':
        if (!spec.values.includes(v)) throw new HttpError(400, `${label} must be one of: ${spec.values.join(', ')}`);
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) throw new HttpError(400, `${label} is not a valid email address`);
        break;
      default:
        throw new Error(`Unknown schema type ${spec.type}`);
    }
    out[key] = v;
  }
  return out;
}

/** A safe positive integer row limit for list endpoints. */
export function limitParam(v, fallback, max) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

export const idList = (v) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

export function likeTerm(q) {
  return `%${String(q).trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}
