// The helix sculpture: a solid DNA double helix modelled in Blender and exported to /assets/helix.glb. Shared by the
// lock screen and the Full HUD backdrop. three.js and the model load lazily, so screens without the sculpture never
// fetch them. Without WebGL (or under a failed load) the canvas is swapped for a still line drawing.
//   const h = await createHelix(canvas, { cx: 0.5, cy: 0.5, span: 1.8, bleed: false, tilt: 0.32, colours: { ink, ink2, ink3, paper, signal, alarm } });
//   h.setMode('idle' | 'verify' | 'denied' | 'granted');  h.pulse();  const { handoff, landed } = h.flyIn();  h.settle();  h.destroy();
// flyIn replays replication ahead of the camera: the middle melts into a bubble, two forks run out to the ends snapping
// the hydrogen bonds and overwinding the duplex ahead of them, the unwound strands splay up and down off screen, and the
// camera dives through the gap they leave. `handoff` resolves mid-dive, once the strands have parted toward the edges, so
// the next screen can rise beneath them as they sweep off; `landed` resolves when the dive is over.
// `colours` names the CSS custom properties to read each colour from (Aliquot passes HELIX_TOKENS from lock.js).
// CSS custom properties on the canvas (--helix-cx, --helix-cy, --helix-span, --helix-bleed) override the placement
// options, so media queries can move the sculpture.

const TAU = Math.PI * 2;
const TURNS = 4.5;
const PULSES = 8;
const FLY_MS = 1250;
const HANDOFF_MS = 760;
// The fly-in as phases on one clock in milliseconds, each eased over its own window (smoothstep unless it names a curve).
// The forks finish running at 1000 ms; the splay and the dive end with the fly-in.
// The dive accelerates to the end, so the camera is still moving as it passes between the strands.
const FLY = {
  melt: { start: 0, end: 250 },
  run: { start: 125, end: 1000 },
  splay: { start: 500, end: FLY_MS },
  dive: { start: 190, end: FLY_MS, curve: (x) => x ** 3 },
  level: { start: 0, end: 750 },
};
const phasesAt = (ms) => Object.fromEntries(Object.entries(FLY).map(([name, { start, end, curve = ease }]) => [
  name, curve(Math.min(1, Math.max(0, (ms - start) / (end - start)))),
]));
// Along the helix in |y| / half-length: the melted bubble, how far behind a fork the strands take to part fully, and the
// band ahead of a fork where the duplex is overwound.
const BUBBLE = 0.12;
const FRONT = 0.3;
const BAND = 0.15;
// The extra turn the band carries. The duplex ahead swivels to take up the twist the parted strands shed, as it does in
// replication, so only this residual strain shows, the same however far the fork has run.
const OVERWIND = Math.PI / 2;
// Model units: how far the parted strands stand off, then splay further as the camera arrives.
const GAP = 0.5;
const SPLAY = 0.6;
// The camera's distance from the origin when the fly-in ends, inside the gap the strands leave.
const DIVE_TO = 1.2;
// Around the axis at y = 0, the direction that points from one strand of the model to the other. The strands sit
// 0.8π apart there, the first at −TURNS·π.
const ACROSS = (0.1 - TURNS) * Math.PI;
const FOV = 32;
const MODEL = '/assets/helix.glb';

const MODES = {
  idle: { speed: 1, tint: 0, hue: 'signal' },
  verify: { speed: 3.4, tint: 0.62, hue: 'signal' },
  denied: { speed: 0.22, tint: 1, hue: 'alarm' },
  granted: { speed: 2.2, tint: 0.5, hue: 'signal' },
};

// How each part of the model is drawn, keyed by its glTF material name. The model's own colours are ignored so the
// sculpture follows the theme tokens; `lit` is how far faces turned from the light recede toward the page colour, and
// `snaps` marks the parts that vanish when the helix breaks open instead of travelling with a strand.
const ROLES = {
  'Helix Rail': { colour: 'ink', lit: 1, snaps: 0 },
  'Helix Louvre': { colour: 'ink2', lit: 1, snaps: 0 },
  'Helix Base': { colour: 'ink3', lit: 1, snaps: 0 },
  'Hydrogen Bond': { colour: 'signal', lit: 0, snaps: 1 },
};
const roleOf = (material) => ROLES[material] ?? ROLES['Helix Louvre'];

// Resolves on the clock, not on frames: a hidden tab or an off-screen canvas must not hold up the sign-in.
const flight = (handoffMs, landedMs) => {
  const at = (ms) => new Promise((done) => setTimeout(done, ms));
  return { handoff: at(handoffMs), landed: at(landedMs) };
};
// With no sculpture to fly, the sign-in still holds on "Access granted" for a beat, unless motion is reduced.
const BEAT_MS = 900;
export const noHelix = Object.freeze({
  setMode() {}, pulse() {}, settle() {}, destroy() {},
  flyIn: () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? flight(0, 0) : flight(BEAT_MS, BEAT_MS)),
});

const VERTEX = `
uniform float uTime;
uniform float uNear;
uniform float uFar;
uniform float uHalfLen;
uniform float uTwist;
uniform float uFork;
uniform float uSplitTurn;
uniform float uOverwind;
uniform float uSplay;
uniform float uPulse[${PULSES}];
varying vec3 vN;
varying float vDepth;
varying float vU;
varying float vHot;
varying float vOpen;
varying float vFork;
void main() {
  float u = abs(position.y) / uHalfLen;
  vec3 rad = normalize(vec3(position.x, 0.0, position.z) + 1e-5);
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
  vec3 p = position + rad * disp * 0.05;
  vec3 n = normal;
  float turn = ${ACROSS.toFixed(5)} + uTwist * position.y;
  float side = sign(dot(position.xz, vec2(cos(turn), sin(turn))));
  // Behind a fork every height turns onto the split, which straightens the strands; ahead of it the duplex turns rigidly
  // with the fork's height, plus the overwind bump across the band. Equal at y = 0 and at the fork, so nothing tears.
  float fork = max(uFork, 0.0);
  float held = sign(position.y) * min(u, fork) * uHalfLen;
  float ahead = smoothstep(0.0, 1.0, (u - fork) / ${BAND.toFixed(3)});
  float a = uSplitTurn - uTwist * held + sign(uTwist * position.y) * uOverwind * ahead;
  float unwound = smoothstep(0.0, 1.0, (uFork + ${BAND.toFixed(3)} - u) / ${BAND.toFixed(3)});
  float open = smoothstep(0.0, 1.0, (uFork - u) / ${FRONT.toFixed(3)});
  mat2 r = mat2(cos(a), sin(a), -sin(a), cos(a));
  p.xz = r * p.xz;
  n.xz = r * n.xz;
  float split = ${ACROSS.toFixed(5)} + uSplitTurn;
  p.xz += vec2(cos(split), sin(split)) * side * open * (${GAP.toFixed(3)} + uSplay);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalMatrix * n;
  vDepth = smoothstep(uNear, uFar, -mv.z);
  vU = u;
  vHot = clamp(hot, 0.0, 1.0);
  vOpen = open;
  vFork = unwound * (1.0 - smoothstep(0.0, 0.5, open));
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = `
const vec3 KEY = normalize(vec3(-0.5, 0.6, 0.6));
const float SHADE = 0.55;
const float FAR_ALPHA = 0.25;
uniform float uReveal;
uniform vec3 uBase;
uniform float uLit;
uniform float uSnaps;
uniform vec3 uTint;
uniform float uTintAmt;
uniform vec3 uPaper;
varying vec3 vN;
varying float vDepth;
varying float vU;
varying float vHot;
varying float vOpen;
varying float vFork;
void main() {
  if (vU > uReveal) discard;
  float diffuse = dot(normalize(vN), KEY) * 0.5 + 0.5;
  vec3 col = mix(uBase, uTint, clamp(uTintAmt + vHot * 0.7 + vFork, 0.0, 1.0));
  col = mix(col, uPaper, uLit * SHADE * (1.0 - diffuse));
  float snapped = uSnaps * smoothstep(0.1, 0.5, vOpen);
  gl_FragColor = vec4(col, mix(1.0, FAR_ALPHA, vDepth) * (1.0 - snapped));
}`;

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMPONENTS = { 5123: Uint16Array, 5125: Uint32Array };

/**
 * Reads a static, untextured glTF binary (what Blender exports for this model) into [{ material, geometry }], with
 * every node transform baked into its geometry. Throws on anything else, so the caller falls back to the still drawing.
 */
function readGLB(THREE, buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) throw new Error('not a glTF 2 binary');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error('glTF JSON chunk missing');
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const binAt = 20 + jsonLength;
  if (view.getUint32(binAt + 4, true) !== CHUNK_BIN) throw new Error('glTF BIN chunk missing');
  const bin = binAt + 8;

  const read = (index, Type, size) => {
    const acc = gltf.accessors[index];
    const bv = gltf.bufferViews[acc.bufferView];
    if (acc.sparse || bv.buffer !== 0) throw new Error('unsupported glTF accessor');
    if (bv.byteStride && bv.byteStride !== size * Type.BYTES_PER_ELEMENT) throw new Error('interleaved glTF buffer');
    return new Type(buffer, bin + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0), acc.count * size);
  };
  const vec3 = (index) => {
    const acc = gltf.accessors[index];
    if (acc.componentType !== 5126 || acc.type !== 'VEC3') throw new Error('glTF attribute is not a float VEC3');
    return new THREE.BufferAttribute(read(index, Float32Array, 3), 3);
  };
  const indices = (index) => {
    const Type = COMPONENTS[gltf.accessors[index].componentType];
    if (!Type) throw new Error('unsupported glTF index type');
    return new THREE.BufferAttribute(read(index, Type, 1), 1);
  };

  const parts = [];
  const visit = (index, parent) => {
    const node = gltf.nodes[index];
    const local = node.matrix
      ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(
        new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(node.scale ?? [1, 1, 1])),
      );
    const world = parent.clone().multiply(local);
    for (const prim of node.mesh === undefined ? [] : gltf.meshes[node.mesh].primitives) {
      if ((prim.mode ?? 4) !== 4) throw new Error('glTF primitive is not triangles');
      if (prim.indices === undefined) throw new Error('glTF primitive has no indices');
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', vec3(prim.attributes.POSITION));
      geometry.setAttribute('normal', vec3(prim.attributes.NORMAL));
      geometry.setIndex(indices(prim.indices));
      geometry.applyMatrix4(world);
      parts.push({ material: gltf.materials?.[prim.material]?.name, geometry });
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const index of gltf.scenes[gltf.scene ?? 0].nodes) visit(index, new THREE.Matrix4());
  if (!parts.length) throw new Error('glTF has no meshes');
  return parts;
}

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
  const pick = (name, fallbackHex) => (name && css.getPropertyValue(name).trim()) || fallbackHex;
  const ink = pick(names.ink, '#131312');
  return {
    ink,
    ink2: pick(names.ink2, ink),
    ink3: pick(names.ink3, ink),
    paper: pick(names.paper, '#e7e5df'),
    signal: pick(names.signal, '#c4f135'),
    alarm: pick(names.alarm, '#ff5b14'),
  };
}

const fetchModel = async () => {
  const res = await fetch(MODEL);
  if (!res.ok) throw new Error(`${MODEL} → ${res.status}`);
  return res.arrayBuffer();
};

export async function createHelix(canvas, opts = {}) {
  if (!hasWebGL2()) return fallback(canvas);
  let THREE;
  let parts;
  let renderer;
  try {
    let model;
    [THREE, model] = await Promise.all([import('/vendor/three/three.module.min.js'), fetchModel()]);
    parts = readGLB(THREE, model);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return fallback(canvas);
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const box = new THREE.Box3();
  for (const { geometry } of parts) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
  }
  const halfLen = (box.max.y - box.min.y) / 2;
  const radius = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);

  const uniforms = {
    uTime: { value: 0 },
    uReveal: { value: reduced ? 1.1 : 0 },
    uNear: { value: 1 },
    uFar: { value: 10 },
    uPulse: { value: new Array(PULSES).fill(0) },
    uTint: { value: new THREE.Vector3() },
    uTintAmt: { value: 0 },
    uPaper: { value: new THREE.Vector3() },
    uHalfLen: { value: halfLen },
    uTwist: { value: (-TURNS * TAU) / (2 * halfLen) },
    uFork: { value: -BAND },
    uSplitTurn: { value: 0 },
    uOverwind: { value: 0 },
    uSplay: { value: 0 },
  };
  const materials = new Map();
  const materialFor = (role) => {
    if (!materials.has(role)) {
      materials.set(role, new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { ...uniforms, uBase: { value: new THREE.Vector3() }, uLit: { value: role.lit }, uSnaps: { value: role.snaps } },
        transparent: true,
        depthWrite: true,
        depthTest: true,
      }));
    }
    return materials.get(role);
  };
  const spin = new THREE.Group();
  for (const { material, geometry } of parts) spin.add(new THREE.Mesh(geometry, materialFor(roleOf(material))));
  const tilt = new THREE.Group();
  tilt.add(spin);
  const lean = opts.tilt ?? 0.32;
  const up = new THREE.Vector3();
  const toSpin = new THREE.Quaternion();
  const scene = new THREE.Scene();
  scene.add(tilt);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100);

  // Colours are uploaded as raw sRGB triples: the shader writes them straight out, so no colour management applies.
  const colours = {};
  const rgb = { r: 0, g: 0, b: 0 };
  const scratch = new THREE.Color();
  function applyColours() {
    const c = readColours(canvas, opts.colours);
    for (const key of Object.keys(c)) {
      scratch.setStyle(c[key], THREE.SRGBColorSpace).getRGB(rgb, THREE.SRGBColorSpace);
      (colours[key] ??= new THREE.Vector3()).set(rgb.r, rgb.g, rgb.b);
    }
    for (const [role, material] of materials) material.uniforms.uBase.value.copy(colours[role.colour]);
    uniforms.uPaper.value.copy(colours.paper);
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
  let split = ACROSS;
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
    const span = num('--helix-span', opts.span ?? 1.8);
    const bleed = num('--helix-bleed', opts.bleed ? 1 : 0);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    // Far enough that the helix spans `span` of the width and never overflows the height.
    const halfHeight = halfLen * Math.sin(lean) + radius;
    distance = Math.max(halfLen / (span * tanHalf * camera.aspect), halfHeight / (0.92 * tanHalf));
    // With `bleed`, close enough that both ends run off the canvas, so the helix reads as endless: an end is gone once
    // its tip, a radius past the axis, clears the nearer of its side and top or bottom edge. The leaning helix runs from
    // top left to bottom right; 0.9 keeps the pointer's tilt from swinging a tip back into view.
    if (bleed) {
      const along = halfLen * Math.cos(lean) - radius;
      const down = halfLen * Math.sin(lean) - radius;
      const off = (side, edge) => Math.max(along / (side * tanHalf * camera.aspect), down / (edge * tanHalf));
      distance = Math.min(distance, 0.9 * Math.min(off(2 * (1 - cx), 2 * (1 - cy)), off(2 * cx, 2 * cy)));
    }
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
    const at = phasesAt(fly ? now - fly.start : 0);
    tilt.rotation.x = pointer.y * 0.12;
    tilt.rotation.y = pointer.x * 0.2;
    tilt.rotation.z = Math.PI / 2 - lean * (1 - at.level);
    tilt.position.x = jolt * 0.08;
    uniforms.uFork.value = -BAND + (BAND + BUBBLE) * at.melt + (1 + FRONT - BUBBLE) * at.run;
    uniforms.uSplay.value = SPLAY * at.splay;
    uniforms.uOverwind.value = OVERWIND * at.melt;
    if (fly) {
      // The model direction that shows as screen-up, so the strands part vertically however the duplex has spun. The
      // split is a line, so it stays on the end nearest last frame's: on the first frame, the shortest turn at the origin.
      spin.getWorldQuaternion(toSpin).invert();
      up.set(0, 1, 0).applyQuaternion(toSpin);
      const drift = Math.atan2(up.z, up.x) - split;
      split += drift - Math.PI * Math.round(drift / Math.PI);
    }
    // The melt swings the duplex onto the split, so the bubble opens without a jump.
    uniforms.uSplitTurn.value = (split - ACROSS) * at.melt;
    // Distance falls geometrically, so equal steps of the dive zoom by equal ratios all the way into the gap.
    camera.position.set(0, 0, distance * (DIVE_TO / distance) ** at.dive);
    uniforms.uNear.value = camera.position.z - radius - 0.4;
    uniforms.uFar.value = camera.position.z + radius + 0.6;
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
      if (reduced || destroyed || settled) return flight(0, 0);
      fly = { start: performance.now() };
      sync();
      return flight(HANDOFF_MS, FLY_MS);
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
      for (const { geometry } of parts) geometry.dispose();
      for (const material of materials.values()) material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
