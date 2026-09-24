/**
 * Tinted amber glass slab desk — BLOCKOUT pass.
 *
 * Macro masses only: the inverted-U of three flat slabs (top slab + two end
 * panels). Brackets (meso) and glide pads (micro) are deliberately omitted;
 * they arrive in later passes. Flat plastic materials keep the review honest
 * about proportion rather than tint.
 */
function createModel(kit, THREE, options) {
  // One material object per spec material id, created once and shared.
  // Blockout rule: flat colour from each material's baseColor.
  const glassAmberTop = kit.plastic({ color: '#A85F2A' })
  const glassAmberPanel = kit.plastic({ color: '#A0561F' })

  // --- Macro: the two end panels (the ground-bearing masses) --------------
  // 0.015 m thick glass fins, 0.725 m tall, 0.60 m deep; bottoms at y = 0
  // (the 0.002 m glide lift is a micro detail, ignored this pass).
  // x = ±0.6425 puts the outer faces 1.300 m apart and the inner faces
  // 1.270 m apart, per mustMatch.
  const panelLeft = kit.part(
    'panel-left',
    kit.box(0.015, 0.725, 0.6),
    glassAmberPanel,
    { position: [-0.6425, 0.3625, 0], rotation: [0, 0, 0] },
  )

  const panelRight = kit.part(
    'panel-right',
    kit.box(0.015, 0.725, 0.6),
    glassAmberPanel,
    { position: [0.6425, 0.3625, 0], rotation: [0, 0, 0] },
  )

  // --- Macro: the tinted glass top slab -----------------------------------
  // 1.40 x 0.015 x 0.70 m. Placed at the spec's y = 0.7325 (panel top 0.725
  // plus half the 0.015 m glass thickness) so the total height is 0.740 m.
  // Overhang falls out of the geometry: 1.40 vs 1.30 outer faces = 0.050 m
  // each end in x; 0.70 vs 0.60 panel depth = 0.050 m front and back in z.
  const topSlab = kit.part(
    'top-slab',
    kit.box(1.4, 0.015, 0.7),
    glassAmberTop,
    { position: [0, 0.7325, 0], rotation: [0, 0, 0] },
  )

  // The spec's rests-on contact (panels -> top-slab, overlap 0) is seated in
  // the load-bearing direction: the slab butts down onto the panel top edges,
  // zero overlap so the 0.015 m butt line stays crisp. Seating the panels onto
  // the slab instead would stack them above it and double the desk height.
  kit.restOn(topSlab, panelLeft, 0)

  return kit.root([panelLeft, panelRight, topSlab])
}
