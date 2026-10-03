// Lightweight SVG charts: column, line and horizontal bar. Single-series by design (one hue,
// no legend needed — the card title names the series). Thin marks, 4px rounded data ends,
// hairline grid, hover/focus tooltips; every chart also ships a "View as table" fallback.
import { esc } from './html.js';

// Charts are shorter in the default compact density.
const chartHeight = () => (document.documentElement.getAttribute('data-density') === 'comfortable' ? 200 : 168);

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.setAttribute('role', 'tooltip');
    tip.innerHTML = '<strong></strong><span></span>';
    document.body.append(tip);
  }
  return tip;
}

function showTip(evt, value, label) {
  const t = tooltip();
  t.querySelector('strong').textContent = value;
  t.querySelector('span').textContent = label;
  t.style.display = 'block';
  const rect = evt.target.getBoundingClientRect?.() || { left: evt.clientX, top: evt.clientY, width: 0 };
  const x = evt.clientX ?? rect.left + rect.width / 2;
  const y = evt.clientY ?? rect.top;
  const w = t.offsetWidth;
  t.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
  t.style.top = `${Math.max(8, y - t.offsetHeight - 12)}px`;
}
const hideTip = () => { if (tip) tip.style.display = 'none'; };

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

function ticks(min, max, count = 4) {
  if (max === min) max = min + 1;
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const compact = (v) => (Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : `${+v.toFixed(2)}`);

function columnPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function attachHover(svg, data, fmt) {
  svg.addEventListener('pointermove', (e) => {
    const hit = e.target.closest('[data-i]');
    svg.querySelectorAll('.hot').forEach((n) => n.classList.remove('hot'));
    if (!hit) return hideTip();
    const d = data[Number(hit.dataset.i)];
    svg.querySelectorAll(`[data-mark="${hit.dataset.i}"]`).forEach((n) => n.classList.add('hot'));
    showTip(e, fmt(d.value), d.tip || d.label);
  });
  svg.addEventListener('pointerleave', () => { hideTip(); svg.querySelectorAll('.hot').forEach((n) => n.classList.remove('hot')); });
  svg.addEventListener('focusin', (e) => {
    const hit = e.target.closest('[data-i]');
    if (!hit) return;
    const d = data[Number(hit.dataset.i)];
    const r = hit.getBoundingClientRect();
    showTip({ clientX: r.left + r.width / 2, clientY: r.top, target: hit }, fmt(d.value), d.tip || d.label);
  });
  svg.addEventListener('focusout', hideTip);
}

function responsive(el, draw) {
  let last = 0;
  const ro = new ResizeObserver(() => {
    const w = el.clientWidth;
    if (w && Math.abs(w - last) > 4) {
      last = w;
      draw(w);
    }
  });
  ro.observe(el);
  draw(el.clientWidth || 600);
  last = el.clientWidth;
}

function tableFallback(data, fmt, labelHead, valueHead) {
  return `<details class="viz-table"><summary>View as table</summary><table class="table compact"><thead><tr><th>${esc(labelHead)}</th><th class="right">${esc(valueHead)}</th></tr></thead><tbody>${data.map((d) => `<tr><td>${esc(d.tip || d.label)}</td><td class="right num">${esc(fmt(d.value))}</td></tr>`).join('')}</tbody></table></details>`;
}

/** Vertical columns over a category axis (e.g. months). data: [{ label, value, tip? }] */
export function columnChart(el, { data, format = compact, height = chartHeight(), labelHead = 'Period', valueHead = 'Value', highlightLast = true }) {
  const fmt = format;
  el.classList.add('viz');
  const draw = (W) => {
    const pad = { t: 16, r: 8, b: 26, l: 44 };
    const max = Math.max(0, ...data.map((d) => d.value || 0));
    const ys = ticks(0, max || 1, 4);
    const top = ys[ys.length - 1];
    const iw = W - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const band = iw / data.length;
    const bw = Math.min(24, band * 0.6);
    const y = (v) => pad.t + ih - (v / top) * ih;
    let s = `<svg width="${W}" height="${height}" role="img" aria-label="${esc(valueHead)} by ${esc(labelHead)}">`;
    for (const t of ys) s += `<line class="grid${t === 0 ? ' base' : ''}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(compact(t))}</text>`;
    const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 46)));
    data.forEach((d, i) => {
      const cx = pad.l + band * i + band / 2;
      const h = ((d.value || 0) / top) * ih;
      const last = highlightLast && i === data.length - 1;
      s += `<g data-i="${i}" tabindex="0" class="hit"><rect x="${cx - band / 2}" y="${pad.t}" width="${band}" height="${ih}" fill="transparent"/>`;
      s += `<path data-mark="${i}" class="mark${last ? ' current' : ''}" d="${columnPath(cx - bw / 2, y(d.value || 0), bw, h)}"/></g>`;
      if (i % every === 0 || i === data.length - 1) s += `<text class="tick" x="${cx}" y="${height - 8}" text-anchor="middle">${esc(d.label)}</text>`;
    });
    const li = data.length - 1;
    if (li >= 0 && data[li].value) s += `<text class="value-label" x="${pad.l + band * li + band / 2}" y="${y(data[li].value) - 6}" text-anchor="middle">${esc(fmt(data[li].value))}</text>`;
    s += '</svg>';
    el.innerHTML = s + tableFallback(data, fmt, labelHead, valueHead);
    attachHover(el.querySelector('svg'), data, fmt);
  };
  responsive(el, draw);
}

/** A 2px line with an end marker and crosshair-style hover per point. data: [{ label, value }] (value may be null) */
export function lineChart(el, { data, format = compact, height = chartHeight(), min, max, labelHead = 'Period', valueHead = 'Value', target }) {
  el.classList.add('viz');
  const draw = (W) => {
    const pad = { t: 18, r: 40, b: 26, l: 44 };
    const vals = data.map((d) => d.value).filter((v) => v != null);
    const lo = min ?? Math.min(...vals, target ?? Infinity);
    const hi = max ?? Math.max(...vals, target ?? -Infinity);
    const ys = ticks(Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 1, 4);
    const y0 = ys[0];
    const y1 = ys[ys.length - 1];
    const iw = W - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const x = (i) => pad.l + (data.length === 1 ? iw / 2 : (iw * i) / (data.length - 1));
    const y = (v) => pad.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
    let s = `<svg width="${W}" height="${height}" role="img" aria-label="${esc(valueHead)} by ${esc(labelHead)}">`;
    for (const t of ys) s += `<line class="grid${t === y0 ? ' base' : ''}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(format(t))}</text>`;
    if (target != null) s += `<line class="target" x1="${pad.l}" x2="${W - pad.r}" y1="${y(target)}" y2="${y(target)}"/><text class="tick" x="${W - pad.r + 4}" y="${y(target) + 4}">Target</text>`;
    let d = '';
    let pen = false;
    data.forEach((p, i) => {
      if (p.value == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i)},${y(p.value)}`;
      pen = true;
    });
    s += `<path class="line" d="${d}"/>`;
    const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 46)));
    data.forEach((p, i) => {
      if (i % every === 0 || i === data.length - 1) s += `<text class="tick" x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(p.label)}</text>`;
      const w = data.length > 1 ? iw / (data.length - 1) : iw;
      s += `<g data-i="${i}" tabindex="${p.value == null ? -1 : 0}" class="hit"><rect x="${x(i) - w / 2}" y="${pad.t}" width="${w}" height="${ih}" fill="transparent"/>`;
      if (p.value != null) s += `<line data-mark="${i}" class="crosshair" x1="${x(i)}" x2="${x(i)}" y1="${pad.t}" y2="${pad.t + ih}"/><circle data-mark="${i}" class="dot" cx="${x(i)}" cy="${y(p.value)}" r="4"/>`;
      s += '</g>';
    });
    const lastIdx = data.map((p) => p.value != null).lastIndexOf(true);
    if (lastIdx >= 0) {
      s += `<circle class="end" cx="${x(lastIdx)}" cy="${y(data[lastIdx].value)}" r="4"/>`;
      s += `<text class="value-label" x="${x(lastIdx) + 8}" y="${y(data[lastIdx].value) - 8}">${esc(format(data[lastIdx].value))}</text>`;
    }
    s += '</svg>';
    el.innerHTML = s + tableFallback(data.filter((p) => p.value != null), format, labelHead, valueHead);
    attachHover(el.querySelector('svg'), data, (v) => (v == null ? 'No data' : format(v)));
  };
  responsive(el, draw);
}

/** Horizontal bars with the category on the left and the value at the bar tip. data: [{ label, value, href? }] */
export function barList(el, { data, format = compact, labelHead = 'Item', valueHead = 'Value', max }) {
  el.classList.add('viz', 'barlist');
  const top = max ?? Math.max(1, ...data.map((d) => d.value || 0));
  el.innerHTML = `<ul>${data.map((d, i) => {
    const pct = Math.max(0, Math.min(100, ((d.value || 0) / top) * 100));
    const label = d.href ? `<a href="${esc(d.href)}">${esc(d.label)}</a>` : esc(d.label);
    return `<li data-i="${i}" tabindex="0"><span class="bl-label" title="${esc(d.label)}">${label}</span><span class="bl-track"><span class="bl-bar" style="width:${pct}%"></span></span><span class="bl-value">${esc(format(d.value || 0))}</span></li>`;
  }).join('')}</ul>${tableFallback(data, format, labelHead, valueHead)}`;
}
