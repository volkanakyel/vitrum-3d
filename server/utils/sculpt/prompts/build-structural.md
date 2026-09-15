## This pass: structure

The macro masses are in place. Add the **meso components** that carry the object's structure, and get every contact right.

- Add each `meso` component from the spec: rails, legs, frames, arms, straps, brackets, stretchers.
- Frames, rails and bent legs are `kit.bentTube(points, radius, cornerRadius)` — lay the polyline out directly in model space, with a real corner radius (0.02–0.1 m), not a chain of cylinders. A smooth curve with no corners is `kit.tube`; a true ring is `kit.torus`. Straight posts and legs are `kit.cylinder`, with `topRadius` when they taper.
- Flat straps, plates and brackets are `kit.extrude(outline, depth, { bevel })`.
- Resolve **every** attachment: `rests-on` through `kit.restOn(child, parent, overlap)`, inserted parts sunk into their parent by the spec's overlap, wrapped parts offset clear of the parent's surface so they do not z-fight. Nothing may float above the floor or hover off its parent.
- Create each mirrored pair from `repetition` with `kit.mirror(part, 'x')`; build the visible instance, mirror the other.
- Materials stay **flat** (`kit.plastic({ color })`) — this pass is judged on structure, not surface. Keep edge radii at their blockout values.

You are done when every macro and meso component exists, sits on something, and the part count matches the spec.
