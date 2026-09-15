## This pass: form

The parts are all present and correctly attached. Now make each one the **right shape**, and fix the proportion defects the reviewer measured.

- Give every visible edge its spec `edge.radius`: swap `kit.box` for `kit.roundedBox(w, h, d, radius)`. A constant-thickness slab with perfectly sharp edges reads as a cardboard cutout however good the silhouette is.
- Give soft masses their real bulge: `kit.pillow(w, h, d, { radius, bulge })` with the spec's edge radius and a bulge of 0.01–0.04 m. Cushions compress where they meet — a pillow with no bulge reads as a box.
- Turned and revolved parts become `kit.lathe(profile)`, listed bottom-to-top. Tapered posts get a `topRadius`. Anything with a curved spine that narrows to a point becomes `kit.sweep` with a radius function, never a constant-radius `tube`.
- Add the `micro` components: buttons (`kit.button`), knobs, feet, small hardware. Repeated ones go through `kit.instanced`.
- Work the reviewer's defect list one defect at a time, using the measured numbers given. Change the named component's dimension or position, not its neighbours.

Materials stay flat. You are done when every part's cross-section, taper and edge treatment matches the spec and the reference proportions hold.
