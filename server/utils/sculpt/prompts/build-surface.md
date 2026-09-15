## This pass: surface

The form and the materials are right. Add the **identity details** — the marks that make this object this object rather than a generic member of its class. Nothing structural changes in this pass.

- Work the spec's `localFeatures`, component by component, and build each one:
  - sewn seams and fold lines → `kit.seam(geometry, from, to, { width, depth })`, pressed between two points on the surface it belongs to
  - corded piping along an edge → `kit.piping(points, radius)` with a radius of 0.004–0.01 m
  - upholstery buttons → `kit.button(radius, { depth })`, repeated through `kit.instanced` when there is a grid of them
  - tufting → `kit.tuft(geometry, { nx, ny, depth })` on the face that is actually tufted
  - grooves, panel lines and stitch runs → a shallow `kit.seam`, not a painted line, whenever the reference shows a shadow in the line
- Set each material's wear and dirt from the spec's `wear` values. Keep them low for a clean product shot: edge wear reads on the corners it can catch, dirt in the cavities. Over-dirtying is as wrong as a sterile surface.
- Keep every detail at its measured size and position from the evidence. A seam in the wrong place is worse than no seam.
- Do not move, resize or re-material any part. If a detail cannot sit where the spec puts it, note why.

You are done when every inventory detail is visible in the render at the reference camera.
