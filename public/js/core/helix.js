// The helix sculpture: a DNA double helix of two louvred strands drawn in fine hatch lines, with sparse base-pair rungs.
// Shared by the lock screen and the Full HUD backdrop. three.js loads lazily from /vendor, so screens without the
// sculpture never fetch it. Without WebGL (or under a failed load) the canvas is swapped for a still line drawing.
//   const h = await createHelix(canvas, { cx: 0.5, cy: 0.5, span: 0.9, tilt: 0.32, colours: { ink, signal, alarm } });
//   h.setMode('idle' | 'verify' | 'denied' | 'granted');  h.pulse();  await h.flyIn();  h.settle();  h.destroy();
// `colours` names the CSS custom properties to read each colour from (Aliquot passes HELIX_TOKENS from lock.js).
// CSS custom properties on the canvas (--helix-cx, --helix-cy, --helix-span) override the placement options, so media
// queries can move the sculpture.

const TAU = Math.PI * 2;
const LEN = 7.2;
const R = 1;
const HALF_W = 0.26;
const TURNS = 2.25;
const HATCH = 520;
const RUNGS = 30;
const PULSES = 8;
const FLY_MS = 900;
const FOV = 32;

const MODES = {
  idle: { speed: 1, tint: 0, hue: 'signal' },
  verify: { speed: 3.4, tint: 0.62, hue: 'signal' },
  denied: { speed: 0.22, tint: 1, hue: 'alarm' },
  granted: { speed: 2.2, tint: 0.5, hue: 'signal' },
};

export const noHelix = Object.freeze({ setMode() {}, pulse() {}, flyIn: async () => {}, settle() {}, destroy() {} });

const VERTEX = `
attribute float aS;
attribute float aKind;
attribute vec3 aRad;
uniform float uTime;
uniform float uReveal;
uniform float uNear;
uniform float uFar;
uniform float uPulse[${PULSES}];
varying float vA;
varying float vHot;
void main() {
  float u = abs(aS - 0.5) * 2.0;
  float disp = 0.0;
  float hot = 0.0;
  for (int i = 0; i < ${PULSES}; i++) {
    float t = uTime - uPulse[i];
    if (uPulse[i] > 0.0 && t > 0.0 && t < 3.0) {
      float front = t * 0.85;
      float g = exp(-pow((u - front) / 0.07, 2.0)) * exp(-t * 1.2);
      disp += g * sin((u - front) * 64.0);
      hot += g;
    }
  }
  vec3 p = position + aRad * disp * 0.05;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = smoothstep(uNear, uFar, -mv.z);
  float ends = smoothstep(1.0, 0.84, u);
  float reveal = 1.0 - smoothstep(uReveal - 0.05, uReveal, u);
  float kind = aKind < 0.5 ? 0.42 : (aKind < 1.5 ? 0.9 : 0.5);
  vA = kind * mix(1.0, 0.1, depth) * ends * reveal;
  vHot = clamp(hot, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = `
uniform vec3 uInk;
uniform vec3 uTint;
uniform float uTintAmt;
varying float vA;
varying float vHot;
void main() {
  gl_FragColor = vec4(mix(uInk, uTint, clamp(uTintAmt + vHot * 0.7, 0.0, 1.0)), vA);
}`;

// Line segments as flat arrays: hatch lines across each strand (kind 0), the strand edges (kind 1) and the rungs (kind 2).
function buildHelix() {
  const pos = [];
  const s = [];
  const kind = [];
  const rad = [];
  const seg = (a, b, sa, sb, k, ra, rb) => { pos.push(...a, ...b); s.push(sa, sb); kind.push(k, k); rad.push(...ra, ...rb); };
  const centre = (t, phase) => {
    const th = t * TURNS * TAU + phase;
    return { th, c: [R * Math.cos(th), (t - 0.5) * LEN, R * Math.sin(th)], r: [Math.cos(th), 0, Math.sin(th)] };
  };
  // Phases 0.8π apart, not π: the offset gives the helix its major and minor grooves.
  const phases = [0, Math.PI * 0.8];
  phases.forEach((phase, k) => {
    const edges = [[], []];
    for (let i = 0; i < HATCH; i++) {
      const t = i / (HATCH - 1);
      const { th, c, r } = centre(t, phase);
      const w = TURNS * TAU * R / LEN;
      const tan = norm([-Math.sin(th) * w, 1, Math.cos(th) * w]);
      const bi = cross(tan, r);
      const phi = t * TAU * 1.1 + k * 1.3;
      const dir = r.map((v, j) => v * Math.cos(phi) + bi[j] * Math.sin(phi));
      const a = c.map((v, j) => v - dir[j] * HALF_W);
      const b = c.map((v, j) => v + dir[j] * HALF_W);
      seg(a, b, t, t, 0, r, r);
      edges[0].push([a, t, r]);
      edges[1].push([b, t, r]);
    }
    for (const edge of edges) for (let i = 1; i < edge.length; i++) seg(edge[i - 1][0], edge[i][0], edge[i - 1][1], edge[i][1], 1, edge[i - 1][2], edge[i][2]);
  });
  for (let j = 0; j < RUNGS; j++) {
    const t = (j + 0.5) / RUNGS;
    const a = centre(t, phases[0]);
    const b = centre(t, phases[1]);
    const mid = a.c.map((v, i) => (v + b.c[i]) / 2);
    const gap = (from, to) => from.map((v, i) => v + (to[i] - v) * 0.9);
    seg(a.c, gap(a.c, mid), t, t, 2, a.r, a.r);
    seg(b.c, gap(b.c, mid), t, t, 2, b.r, b.r);
  }
  return { pos: new Float32Array(pos), s: new Float32Array(s), kind: new Float32Array(kind), rad: new Float32Array(rad) };
}

const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// The still drawing used when WebGL is missing: the same helix flattened to two sine strands with hatch and rungs.
const STATIC_SVG = (() => {
  const W = 600;
  const H = 300;
  const amp = 74;
  const k = (TURNS * TAU) / W;
  const y = (x, ph) => H / 2 + amp * Math.sin(x * k + ph);
  const strands = [0, Math.PI * 0.8].map((ph) => {
    let line = '';
    let hatch = '';
    for (let x = 0; x <= W; x += 3) {
      line += `${x ? 'L' : 'M'}${x} ${y(x, ph).toFixed(1)}`;
      const len = 6 + 12 * Math.abs(Math.cos(x * k * 0.8 + ph));
      hatch += `M${x} ${(y(x, ph) - len).toFixed(1)}V${(y(x, ph) + len).toFixed(1)}`;
    }
    return `<path d="${line}" stroke-width="1.2"/><path d="${hatch}" stroke-width="0.5" opacity="0.55"/>`;
  }).join('');
  let rungs = '';
  for (let x = 12; x < W; x += 23) rungs += `M${x} ${y(x, 0).toFixed(1)}V${y(x, Math.PI * 0.8).toFixed(1)}`;
  return `<svg class="helix-static" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" aria-hidden="true">${strands}<path d="${rungs}" stroke-width="0.6" stroke-dasharray="2 3" opacity="0.5"/></svg>`;
})();

function fallback(canvas) {
  canvas.hidden = true;
  canvas.insertAdjacentHTML('afterend', STATIC_SVG);
  const svg = canvas.nextElementSibling;
  return { ...noHelix, destroy() { svg.remove(); canvas.hidden = false; } };
}

let webgl2;
function hasWebGL2() {
  if (webgl2 === undefined) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      webgl2 = !!gl;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { webgl2 = false; }
  }
  return webgl2;
}

function readColours(el, names) {
  const css = getComputedStyle(el);
  const pick = (name, fallbackHex) => css.getPropertyValue(name).trim() || fallbackHex;
  return { ink: pick(names.ink, '#131312'), signal: pick(names.signal, '#c4f135'), alarm: pick(names.alarm, '#ff5b14') };
}

export async function createHelix(canvas, opts = {}) {
  if (!hasWebGL2()) return fallback(canvas);
  let THREE;
  let renderer;
  try {
    THREE = await import('/vendor/three/three.module.min.js');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return fallback(canvas);
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const g = buildHelix();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
  geometry.setAttribute('aS', new THREE.BufferAttribute(g.s, 1));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(g.kind, 1));
  geometry.setAttribute('aRad', new THREE.BufferAttribute(g.rad, 3));
  const uniforms = {
    uTime: { value: 0 },
    uReveal: { value: reduced ? 1.1 : 0 },
    uNear: { value: 1 },
    uFar: { value: 10 },
    uPulse: { value: new Array(PULSES).fill(0) },
    uInk: { value: new THREE.Vector3() },
    uTint: { value: new THREE.Vector3() },
    uTintAmt: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, transparent: true, depthWrite: false, depthTest: false });
  const lines = new THREE.LineSegments(geometry, material);
  const spin = new THREE.Group();
  const tilt = new THREE.Group();
  spin.add(lines);
  tilt.add(spin);
  const lean = opts.tilt ?? 0.32;
  tilt.rotation.z = Math.PI / 2 - lean;
  const scene = new THREE.Scene();
  scene.add(tilt);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100);

  // Colours are uploaded as raw sRGB triples: the shader writes them straight out, so no colour management applies.
  const colours = { ink: new THREE.Vector3(), signal: new THREE.Vector3(), alarm: new THREE.Vector3() };
  const rgb = { r: 0, g: 0, b: 0 };
  const scratch = new THREE.Color();
  function applyColours() {
    const c = readColours(canvas, opts.colours);
    for (const key of Object.keys(colours)) {
      scratch.setStyle(c[key], THREE.SRGBColorSpace).getRGB(rgb, THREE.SRGBColorSpace);
      colours[key].set(rgb.r, rgb.g, rgb.b);
    }
    uniforms.uInk.value.copy(colours.ink);
    uniforms.uTint.value.copy(colours[MODES[mode].hue]);
  }

  let mode = 'idle';
  let speed = 1;
  let angle = 0;
  let distance = 10;
  let last = 0;
  let raf = 0;
  let pulseAt = 0;
  let pulseIdx = 0;
  let deniedAt = 0;
  let fly = null;
  let settled = false;
  let destroyed = false;
  let visible = !document.hidden;
  let onScreen = true;
  const t0 = performance.now();
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  function place() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const css = getComputedStyle(canvas);
    const num = (name, d) => { const v = parseFloat(css.getPropertyValue(name)); return Number.isFinite(v) ? v : d; };
    const cx = num('--helix-cx', opts.cx ?? 0.5);
    const cy = num('--helix-cy', opts.cy ?? 0.5);
    const span = num('--helix-span', opts.span ?? 0.9);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    // Far enough that the helix spans `span` of the width and never overflows the height.
    const halfHeight = (LEN / 2) * Math.sin(lean) + R + HALF_W;
    distance = Math.max((LEN / 2) / (span * tanHalf * camera.aspect), halfHeight / (0.92 * tanHalf));
    camera.setViewOffset(w, h, (0.5 - cx) * w, (0.5 - cy) * h, w, h);
    camera.updateProjectionMatrix();
    if (!raf) frame(performance.now());
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    const time = (now - t0) / 1000;
    const m = MODES[mode];
    const follow = 1 - Math.exp(-dt / 0.25);
    speed += (m.speed - speed) * follow;
    uniforms.uTintAmt.value += (m.tint - uniforms.uTintAmt.value) * follow;
    uniforms.uTint.value.lerp(colours[m.hue], follow);
    pointer.x += (pointer.tx - pointer.x) * (1 - Math.exp(-dt * 4));
    pointer.y += (pointer.ty - pointer.y) * (1 - Math.exp(-dt * 4));
    if (!reduced) {
      angle += dt * 0.22 * speed;
      uniforms.uReveal.value = Math.min(1.1, time / 1.4);
      if (mode === 'verify' && now - pulseAt > 320) pulse();
    }
    uniforms.uTime.value = time;
    spin.rotation.y = angle;
    const jolt = deniedAt ? Math.exp(-(now - deniedAt) / 180) * Math.sin((now - deniedAt) / 22) : 0;
    const f = fly ? ease((now - fly.start) / FLY_MS) : 0;
    tilt.rotation.x = pointer.y * 0.12;
    tilt.rotation.y = pointer.x * 0.2 + f * (Math.PI / 2);
    tilt.position.x = jolt * 0.08;
    // Dolly toward the axis: distance falls as 9^(−f²), so the approach accelerates into the helix.
    camera.position.set(0, 0, distance * 9 ** -(f * f) + 0.15 * f);
    uniforms.uNear.value = camera.position.z - R - 0.4;
    uniforms.uFar.value = camera.position.z + R + 0.6;
    renderer.render(scene, camera);
    raf = 0;
    if (running()) raf = requestAnimationFrame(frame);
  }

  const running = () => !destroyed && !reduced && !settled && visible && onScreen;
  function sync() {
    if (running() && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    if (!running() && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function still() { if (!destroyed && !raf) frame(performance.now()); }

  function pulse() {
    if (reduced || destroyed) return;
    pulseAt = performance.now();
    uniforms.uPulse.value[pulseIdx] = (pulseAt - t0) / 1000;
    pulseIdx = (pulseIdx + 1) % PULSES;
  }

  const onVisibility = () => { visible = !document.hidden; sync(); };
  const onPointer = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.tx = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width / 2 || 1)));
    pointer.ty = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height / 2 || 1)));
  };
  const io = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; sync(); });
  const ro = new ResizeObserver(() => place());
  const recolour = () => { applyColours(); still(); };
  // The theme follows the data-theme attribute when set and the operating system otherwise.
  const themeWatch = new MutationObserver(recolour);
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  io.observe(canvas);
  ro.observe(canvas);
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  scheme.addEventListener('change', recolour);
  document.addEventListener('visibilitychange', onVisibility);
  if (!reduced) window.addEventListener('pointermove', onPointer, { passive: true });

  applyColours();
  place();
  sync();

  return {
    setMode(next) {
      if (!MODES[next] || destroyed) return;
      if (next === 'denied' && mode !== 'denied') { deniedAt = performance.now(); pulse(); }
      mode = next;
      if (reduced || settled) { speed = MODES[next].speed; uniforms.uTintAmt.value = MODES[next].tint; uniforms.uTint.value.copy(colours[MODES[next].hue]); still(); }
    },
    pulse,
    flyIn() {
      if (reduced || destroyed || settled) return Promise.resolve();
      fly = { start: performance.now() };
      sync();
      // Resolve on the clock, not on frames: a hidden tab or an off-screen canvas must not hold up the sign-in.
      return new Promise((done) => setTimeout(done, FLY_MS));
    },
    settle() {
      settled = true;
      sync();
      still();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      sync();
      io.disconnect();
      ro.disconnect();
      themeWatch.disconnect();
      scheme.removeEventListener('change', recolour);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointer);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
