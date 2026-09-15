## This pass: surface

The form and the materials are right. Add the **identity details** — the marks that make this object itself, not a generic member of its class. Nothing structural changes here.

- Work the spec's `localFeatures`, component by component, and build each one:
  - sewn seams and fold lines → `kit.seam(geometry, from, to, { width, depth })`, between two points on the surface it belongs to
  - corded piping along an edge → `kit.piping(points, radius)` with a radius of 0.004–0.01 m
  - upholstery buttons → `kit.button(radius, { depth })`, through `kit.instanced` when there is a grid of them
  - tufting → `kit.tuft(geometry, { nx, ny, depth })` on the face that is actually tufted
  - grooves, panel lines and stitch runs → a shallow `kit.seam`, not a painted line, wherever the reference shows a shadow in the line
- `seam` and `tuft` mutate the geometry they are given, so hoist the geometry into a variable, press the detail into it, then pass that variable to `kit.part` — a geometry created inline in the `kit.part` call cannot be reached afterwards.
- Set each material's wear and dirt from the spec's `wear` values, low for a clean product shot: edge wear on the corners it catches, dirt in the cavities. Over-dirtying is as wrong as a sterile surface.
- Keep every detail at its measured size and position. A seam in the wrong place is worse than no seam.
- Do not move, resize or re-material a part. If a detail cannot sit where the spec puts it, note why.

You are done when every inventory detail is visible at the reference camera.
