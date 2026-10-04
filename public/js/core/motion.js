// Motion for a screen the user is already on: switching tabs, filtering, the refresh after a save. Arriving somewhere new
// earns an entrance; staying put doesn't. Nothing re-enters and nothing travels: only the blocks whose content changed
// lift from a dimmed state, in place. Movement in the corner of the eye pulls attention; a brief change of opacity doesn't.
// Also the sign-in fly-in. Shared by the staff app and the client portal.

const seen = new WeakMap();

/** The top-level blocks of a mounted view as they were rendered, to compare the next render of the same screen against. */
export const snapshot = (view) => (view ? [...view.children].map((c) => seen.get(c) ?? c.outerHTML) : []);

/** Records `view`'s blocks; with `still`, also marks it a same-screen update and flags the blocks that differ from `before`. */
export function settle(view, before, { still = false } = {}) {
  if (!view) return;
  view.classList.toggle('still', still);
  [...view.children].forEach((c, i) => {
    const markup = c.outerHTML;
    seen.set(c, markup);
    // Tab and segment bars never dim: the active state moving is the feedback, and they sit right under the pointer.
    if (still && markup !== before[i] && !c.matches('.tabs, .segmented, .seg')) c.classList.add('changed');
  });
}

/** The sign-in fly-in: every child of `container` (but `skip`) grows as 8^(t²) about the ribbon's vanishing point (x, y),
    the same law as the ribbon's own dolly, defocusing as it passes and gone before it would fill the view. */
export function flyIn(container, { x, y }, skip = '') {
  const frames = Array.from({ length: 13 }, (_, i) => {
    const t = i / 12;
    return { offset: t, scale: String(8 ** (t * t)), opacity: Math.max(0, 1 - Math.max(0, t - 0.12) / 0.5), filter: `blur(${(6 * t * t).toFixed(2)}px)` };
  });
  for (const el of container.children) {
    if (skip && el.matches(skip)) continue;
    el.style.transformOrigin = `${x - el.offsetLeft}px ${y - el.offsetTop}px`;
    el.animate(frames, { duration: 685, easing: 'linear', fill: 'forwards' });
  }
}
