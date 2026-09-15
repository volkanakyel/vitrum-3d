## This pass: material

The form is right. Replace the flat placeholders with the kit's **PBR families**, one object per spec material, reused by every part that references it.

- Map each spec material to its builder: `fabric` → `kit.fabric({ color, weave, sheen, contrast, roughness })`, `leather` → `kit.leather({ color, grain, gloss })`, `wood` → `kit.wood({ color, grain, tone, gloss })`, lacquer → `kit.paintedMetal({ color, gloss })`, steel or aluminium → `kit.brushedMetal({ color, roughness })`, moulded plastic → `kit.plastic({ color, gloss })`, glazing → `kit.glass({ tint })`.
- Families with no builder of their own: `stone` and concrete have no stone builder — use `kit.plastic({ color, gloss: 0.1 })` with the spec's albedo and say so in `notes`; a bare `metal` that reads as painted or lacquered goes to `paintedMetal`, a brushed or bare steel one to `brushedMetal`.
- Use the spec's `baseColor` exactly, and its `roughness`, `sheen` and `clearcoat` to pick the builder's parameters: a high-sheen fabric gets `sheen` near 1, a satin lacquer a lower `gloss` than a wet one.
- Scale the procedural pattern to the **real part size**: the spec's `pattern.scale` is in metres, so a weave sized for a 0.8 m cushion must not be reused unchanged on a 0.05 m button — a texture at the wrong scale is the single most common reason a correct model reads as a toy.
- Metalness is 0 for every dielectric, 1 for raw metal; nothing in between.
- Change **no geometry** here. If a material makes a shape look wrong, say so in `notes` rather than fixing it.

You are done when every surface's family, tone and finish match the reference under the render light.
