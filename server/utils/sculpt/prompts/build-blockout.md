## This pass: blockout

The goal is the **silhouette and the proportions**, nothing else. Seen from the reference camera, the outline of the render should already read as this object.

- Build the **macro components only**. Ignore every meso and micro component in the spec; they arrive in later passes.
- Use `kit.box` for hard masses and `kit.pillow` for soft ones, at the spec's exact dimensions and positions. No `roundedBox`, no lathes, no tubes.
- Give every part the spec's rotation, and seat every `rests-on` contact with `kit.restOn` so the stack of masses has the right total height.
- One material per spec material, all flat: `kit.plastic({ color })` using that material's `baseColor`. Do not call `fabric`, `wood`, `leather` or `brushedMetal` yet — flat colour keeps the review honest about shape.
- Skip seams, buttons, piping, tufting, wear, edge radii and texture entirely. A blockout that reaches for detail hides the proportion errors this pass exists to find.

You are done when the macro masses are present, correctly sized, correctly stacked, and the object's overall width, height and depth match the spec. Note in `notes` any proportion you had to infer because the spec left it ambiguous.
