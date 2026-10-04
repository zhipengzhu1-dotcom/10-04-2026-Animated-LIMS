// The ∞ ribbon sculpture: a louvred band drawn on a 2D canvas (no WebGL, no libraries).
// Shared by the sign-in lock screen, the client portal and the staff app's Full HUD backdrop.
// The curve is kept as its Fourier series, so it blooms from its fundamental, and each keystroke launches a pair of
// dispersive wave packets (d'Alembert: one each way) that ripple the band as they travel. On sign-in the camera flies
// into the crossing of the ∞; `focus()` gives that vanishing point so the page around it can zoom by the same law.
// The canvas may run under a side column: `--ribbon-inset` on it (px) centres the sculpture in the area beside it.
//   const r = createRibbon(canvas, { cx: 0.5, cy: 0.5, scale: 0.42 });
//   r.pulse();  r.setMode('verify' | 'denied' | 'idle');  await r.dissolve();  r.focus();  r.destroy();

const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) / 2;
const LIME = [196, 241, 53];
const ORANGE = [255, 91, 20];
const BLOOM_MS = 1794;
const FOLD_MS = 685;
const DOLLY = 8;
const LEVELS = 11;
// Wave packets: group speed (loops/s), carrier wavenumber, starting width, spreading time. Deep-water dispersion, so the
// crests run at twice the group speed and slip forward through their envelope.
const CG = 0.16;
const K0 = TAU / 0.022;
const SIG0 = 0.03;
const TD = 0.8;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// The same damped sinusoid as the stylesheet's --wobble.
const wobble = (s) => (s >= 1 ? 0 : (Math.exp(-3.22 * s) * Math.sin(6 * Math.PI * s)) / 0.986);

// Bernoulli's lemniscate as z(t) = Σ c_k e^{ikt}, from a 512-point DFT taken once. Its spectrum is geometric,
// |c_k| = (√2 − 1)^|k|, so ten harmonic pairs hold the curve to a twentieth of a pixel.
const SPECTRUM = (() => {
  const M = 512;
  const out = [];
  for (let k = -10; k <= 10; k++) {
    if (!k) continue;
    let re = 0;
    let im = 0;
    for (let m = 0; m < M; m++) {
      const t = (m / M) * TAU;
      const s = Math.sin(t);
      const c = Math.cos(t);
      const x = c / (1 + s * s);
      const y = (s * c) / (1 + s * s);
      re += x * Math.cos(k * t) + y * Math.sin(k * t);
      im += y * Math.cos(k * t) - x * Math.sin(k * t);
    }
    out.push({ k, re: re / M, im: im / M });
  }
  return out;
})();

/** One exact step of a critically damped spring toward `to`, so smoothing is the same at 30 or 120 fps. */
function damp(s, to, w, dt) {
  const e = s.x - to;
  const temp = (s.v + w * e) * dt;
  const ex = Math.exp(-w * dt);
  s.v = (s.v - w * temp) * ex;
  s.x = to + (e + temp) * ex;
}

/** Starts drawing into `canvas` (sized to its CSS box) and returns controls for the lock-screen states. */
export function createRibbon(canvas, opts = {}) {
  const o = { cx: 0.5, cy: 0.5, scale: 0.4, slats: 400, fps: 60, tilt: 0.42, ...opts };
  const ctx = canvas.getContext('2d');
  const N = o.slats;
  const basis = SPECTRUM.map(({ k }) => {
    const cos = new Float32Array(N);
    const sin = new Float32Array(N);
    for (let i = 0; i < N; i++) { cos[i] = Math.cos((k * i * TAU) / N); sin[i] = Math.sin((k * i * TAU) / N); }
    return { cos, sin };
  });
  const pulses = [];
  let mode = 'idle';
  let tone = 'paper';
  let w = 0;
  let h = 0;
  let dpr = 1;
  let inset = 0;
  let raf = 0;
  let last = 0;
  const t0 = performance.now();
  let spin = 0;
  let speed = 1;
  let agitation = 0;
  let deniedAt = 0;
  let foldAt = 0;
  let foldDone = null;
  let lastPulseAt = 0;
  let frame = 0;
  const mouse = { x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, tx: 0, ty: 0 };

  function readTone() {
    tone = getComputedStyle(canvas).getPropertyValue('--ribbon-tone').trim() || (getComputedStyle(document.documentElement).colorScheme === 'dark' ? 'night' : 'paper');
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, r.width);
    h = Math.max(1, r.height);
    inset = Math.min(w / 2, parseFloat(getComputedStyle(canvas).getPropertyValue('--ribbon-inset')) || 0);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    if (!raf) draw(performance.now());
  }

  function shade(b, infl, denied) {
    let c;
    if (denied) c = [mix(34, 196, b), mix(16, 74, b), mix(10, 34, b)];
    else if (tone === 'night') c = [mix(38, 168, b), mix(38, 165, b), mix(36, 158, b)];
    else c = [mix(150, 252, b), mix(147, 250, b), mix(140, 244, b)];
    const hot = denied ? ORANGE : LIME;
    return c.map((v, k) => Math.round(mix(v, hot[k], Math.min(1, infl * 0.85))));
  }

  function draw(now) {
    frame++;
    if (frame % 40 === 1) readTone();
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    const still = reducedMotion();
    const time = still ? 0 : (now - t0) / 1000;
    const follow = 1 - Math.exp(-dt / 0.27);
    speed = mix(speed, mode === 'verify' ? 3.2 : mode === 'denied' ? 0.35 : 1, follow);
    agitation = mix(agitation, mode === 'verify' ? 1 : 0, follow);
    if (!still) spin += dt * 0.16 * speed;
    if (mode === 'verify' && !still && now - lastPulseAt > 220) pulse(0.45);
    damp(mouse.x, mouse.tx, 6, dt);
    damp(mouse.y, mouse.ty, 6, dt);

    const denied = mode === 'denied';
    // Harmonics enter in order of frequency as the sculpture blooms.
    const level = (still ? 1 : smooth((now - t0) / BLOOM_MS)) * LEVELS;
    // Signing in dollies the camera toward the crossing: distance falls as DOLLY^(−t²), so the screen plane grows as DOLLY^(t²).
    const fold = foldAt ? Math.min(1, (now - foldAt) / FOLD_MS) : 0;
    const camera = 3.4 * DOLLY ** -(fold * fold);
    const lift = smooth(level / 2);
    const coef = SPECTRUM.map(({ k, re, im }, j) => {
      // While verifying, each mode drifts in phase at its own deep-water frequency (ω ∝ √k); the fundamental holds still.
      const a = agitation * 0.45 * (1 - 1 / Math.abs(k)) * Math.sin(time * 2.4 * Math.sqrt(Math.abs(k)) + k);
      const wk = smooth((level - Math.abs(k) + 1) / 2);
      return { j, k, re: wk * (re * Math.cos(a) - im * Math.sin(a)), im: wk * (re * Math.sin(a) + im * Math.cos(a)) };
    }).filter((c) => c.re || c.im);

    const jolt = deniedAt && !still ? wobble((now - deniedAt) / FOLD_MS) : 0;
    const S = Math.min(w - inset, h * 1.9) * o.scale * (1 - 0.035 * jolt);
    const cx = inset + (w - inset) * o.cx;
    const cy = h * o.cy;
    // Yaw and pitch sway at periods in the golden ratio, so the pose never exactly repeats.
    const ry = Math.sin(spin) * 0.55 + mouse.x.x * 0.25;
    const rx = o.tilt + Math.cos(spin / PHI) * 0.12 + mouse.y.x * 0.15;
    const cyR = Math.cos(ry), syR = Math.sin(ry), cxR = Math.cos(rx), sxR = Math.sin(rx);
    const light = [-0.35, -0.62, 0.7];

    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.age += dt;
      p.sigma = SIG0 * Math.sqrt(1 + (p.age / TD) ** 2);
      p.amp = p.strength * Math.exp(-p.age * 1.5) * Math.sqrt(SIG0 / p.sigma);
      if (p.age > 3.2) pulses.splice(i, 1);
    }

    const pts = new Array(N);
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const t = u * TAU;
      let x = 0, y = 0, dx = 0, dy = 0;
      for (const c of coef) {
        const { cos, sin } = basis[c.j];
        const re = c.re * cos[i] - c.im * sin[i];
        const im = c.re * sin[i] + c.im * cos[i];
        x += re; y += im;
        dx -= c.k * im; dy += c.k * re;
      }
      const P = [x, y, 0.34 * lift * Math.sin(t)];
      const T = [dx, dy, 0.34 * lift * Math.cos(t)];
      const tl = Math.hypot(...T) || 1;
      T[0] /= tl; T[1] /= tl; T[2] /= tl;
      const B = [T[1], -T[0], 0];
      const bl = Math.hypot(...B) || 1;
      B[0] /= bl; B[1] /= bl;
      const Nn = [B[1] * T[2], -B[0] * T[2], B[0] * T[1] - B[1] * T[0]];
      const th = 2 * t + time * 0.25;
      const W = [Math.cos(th) * Nn[0] + Math.sin(th) * B[0], Math.cos(th) * Nn[1] + Math.sin(th) * B[1], Math.cos(th) * Nn[2]];
      let glow = 0;
      let ripple = 0;
      for (const p of pulses) {
        for (const dir of [-1, 1]) {
          let d = dir * (u - p.s0) - CG * p.age;
          d -= Math.round(d);
          if (Math.abs(d) > 4 * p.sigma) continue;
          const env = p.amp * Math.exp(-((d / p.sigma) ** 2));
          const crest = Math.cos(K0 * (d - CG * p.age));
          ripple += env * crest;
          glow += env * (0.5 + 0.5 * crest);
        }
      }
      // A slow travelling swell whose depth beats at 1/φ of its speed: quasi-periodic, never on a loop.
      const breath = 1 + 0.06 * Math.sin(2 * t - 0.9 * time) * Math.sin((0.9 * time) / PHI);
      const hw = 0.15 * lift * breath * Math.max(0.3, 1 + 0.28 * ripple + 0.2 * glow);
      pts[i] = { P, T, W, hw, infl: glow };
    }

    const project = ([x, y, z]) => {
      const x1 = x * cyR + z * syR;
      const z1 = -x * syR + z * cyR;
      const y1 = y * cxR - z1 * sxR;
      const z2 = y * sxR + z1 * cxR;
      const f = 3.4 / Math.max(0.02, camera - z2);
      return [cx + x1 * S * f, cy + y1 * S * f, z2];
    };
    const rot = (v) => {
      const x1 = v[0] * cyR + v[2] * syR;
      const z1 = -v[0] * syR + v[2] * cyR;
      return [x1, v[1] * cxR - z1 * sxR, v[1] * sxR + z1 * cxR];
    };

    const edges = pts.map((p) => [
      project([p.P[0] - p.W[0] * p.hw, p.P[1] - p.W[1] * p.hw, p.P[2] - p.W[2] * p.hw]),
      project([p.P[0] + p.W[0] * p.hw, p.P[1] + p.W[1] * p.hw, p.P[2] + p.W[2] * p.hw]),
    ]);

    const quads = [];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const p = pts[i];
      const n = rot([p.T[1] * p.W[2] - p.T[2] * p.W[1], p.T[2] * p.W[0] - p.T[0] * p.W[2], p.T[0] * p.W[1] - p.T[1] * p.W[0]]);
      const b = 0.12 + 0.88 * Math.abs(n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) ** 0.8;
      const [L0, R0] = edges[i];
      const [L1, R1] = edges[j];
      if (Math.max(L0[2], R0[2], L1[2], R1[2]) > camera - 0.08) continue;
      quads.push({ L0, R0, L1, R1, z: (L0[2] + R0[2] + L1[2] + R1[2]) / 4, b, infl: p.infl });
    }
    quads.sort((a, b) => a.z - b.z);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1 - smooth(fold * 1.4 - 0.4);
    ctx.lineJoin = 'round';
    for (const q of quads) {
      const fog = 0.55 + 0.45 * Math.min(1, Math.max(0, (q.z + 1.2) / 2));
      const [r, gg, bb] = shade(q.b * fog, q.infl, denied);
      ctx.fillStyle = `rgb(${r},${gg},${bb})`;
      ctx.beginPath();
      ctx.moveTo(q.L0[0], q.L0[1]);
      ctx.lineTo(q.R0[0], q.R0[1]);
      ctx.lineTo(q.R1[0], q.R1[1]);
      ctx.lineTo(q.L1[0], q.L1[1]);
      ctx.closePath();
      ctx.fill();
      // The fins: a darker hairline across the band and along both rails.
      const d = denied ? 'rgba(255,91,20,' : tone === 'night' ? 'rgba(0,0,0,' : 'rgba(60,56,50,';
      ctx.strokeStyle = `${d}${denied ? 0.15 + q.b * 0.5 : 0.16 + (1 - q.b) * 0.42})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(q.L0[0], q.L0[1]);
      ctx.lineTo(q.R0[0], q.R0[1]);
      ctx.moveTo(q.L0[0], q.L0[1]);
      ctx.lineTo(q.L1[0], q.L1[1]);
      ctx.moveTo(q.R0[0], q.R0[1]);
      ctx.lineTo(q.R1[0], q.R1[1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (fold >= 1 && foldDone) { foldDone(); foldDone = null; }
    raf = 0;
    if (!still && !document.hidden && canvas.isConnected) schedule();
  }

  function schedule() {
    if (raf) return;
    const minGap = 1000 / o.fps - 2;
    raf = requestAnimationFrame(function tick(now) {
      if (now - last < minGap) { raf = requestAnimationFrame(tick); return; }
      draw(now);
    });
  }

  function pulse(strength = 1) {
    lastPulseAt = performance.now();
    if (reducedMotion()) return;
    pulses.push({ s0: Math.random(), age: 0, strength, sigma: SIG0, amp: strength });
    if (pulses.length > 14) pulses.shift();
    schedule();
  }

  const onMove = (e) => {
    mouse.tx = (e.clientX / innerWidth - 0.5) * 2;
    mouse.ty = (e.clientY / innerHeight - 0.5) * 2;
  };
  const onVisible = () => { if (!document.hidden) { last = performance.now(); schedule(); } };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('visibilitychange', onVisible);
  readTone();
  resize();
  schedule();

  return {
    pulse,
    setMode(m) {
      if (m === 'denied' && mode !== 'denied') deniedAt = performance.now();
      mode = m;
      readTone();
      if (!raf) draw(performance.now());
    },
    refresh() { readTone(); if (!raf) draw(performance.now()); },
    focus: () => ({ x: inset + (w - inset) * o.cx, y: h * o.cy }),
    dissolve() {
      if (reducedMotion()) return Promise.resolve();
      foldAt = performance.now();
      schedule();
      return new Promise((r) => { foldDone = r; });
    },
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
