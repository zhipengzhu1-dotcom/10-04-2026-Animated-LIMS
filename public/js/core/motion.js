// Motion for a screen the user is already on: switching tabs, filtering, the refresh after a save. Arriving somewhere new
// earns an entrance; staying put doesn't. Nothing re-enters and nothing travels: only the blocks whose content changed
// lift from a dimmed state, in place. Movement in the corner of the eye pulls attention; a brief change of opacity doesn't.
// Shared by the staff app and the client portal.

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
