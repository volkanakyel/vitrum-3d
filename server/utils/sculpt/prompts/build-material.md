## This pass: material

The form is right. Replace the flat placeholder materials with the kit's **PBR families**, one object per spec material, reused by every part that references it.

- Map each spec material to its kit builder: `fabric` → `kit.fabric({ color, weave, sheen, contrast, roughness })`, `leather` → `kit.leather({ color, grain, gloss })`, `wood` → `kit.wood({ color, grain, tone, gloss })`, lacquer and painted metal → `kit.paintedMetal({ color, gloss })`, bare steel or aluminium → `kit.brushedMetal({ color, roughness })`, moulded plastic → `kit.plastic({ color, gloss })`, glazing → `kit.glass({ tint })`.
- Use the spec's `baseColor` exactly, and its `roughness`, `sheen` and `clearcoat` to pick the builder's parameters: a high sheen fabric gets `sheen` near 1, a satin lacquer a lower `gloss` than a wet one.
- Scale the procedural pattern to the **real part size**: the spec's `pattern.scale` is in metres, so a weave sized for a 0.8 m cushion must not be reused unchanged on a 0.05 m button — a texture at the wrong scale is the single most common reason a correct model reads as a toy.
- Metalness is 0 for every dielectric and 1 for raw metal. Nothing sits in between.
- Change **no geometry** in this pass. If a material makes a shape look wrong, say so in `notes`; do not fix it here.

You are done when every surface's family, tone and finish match the reference under the render light.
