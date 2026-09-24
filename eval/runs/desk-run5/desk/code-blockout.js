/**
 * Blockout pass — "Tinted amber glass slab desk" (amber-glass-slab-desk).
 *
 * Macro masses only: the horizontal top slab and the two vertical end panels.
 * Everything meso/micro in the spec (bronze L-brackets, glide pads, polished
 * edge bands, tint gradients, etched mark) is deliberately skipped this pass —
 * this file exists to prove the silhouette and the proportions.
 */
function createModel(kit, THREE, options) {
  // One flat material per spec material id. Flat plastic on purpose: the
  // blockout must be judged on shape, not on glass transmission.
  const glassAmberTop = kit.plastic({ color: '#9C5A28' })   // glass-amber-top
  const glassAmberPanel = kit.plastic({ color: '#8E4A1C' }) // glass-amber-panel

  // --- Macro: end panels (the structure everything else references) --------
  // 0.015 m thick, 0.712 m tall, 0.600 m deep, standing straight on the floor
  // (bottom edge at y = 0, so centre y = 0.356). Outer faces at x = ±0.660,
  // i.e. 0.040 m inboard of the top slab's ends (1.400 / 2 = 0.700) — that
  // inset is what produces the cantilever shadow gap called out in mustMatch.
  const panelLeft = kit.part(
    'panel-left',
    kit.box(0.015, 0.712, 0.600),
    glassAmberPanel,
    { position: [-0.6525, 0.356, 0], rotation: [0, 0, 0] },
  )

  const panelRight = kit.part(
    'panel-right',
    kit.box(0.015, 0.712, 0.600),
    glassAmberPanel,
    { position: [0.6525, 0.356, 0], rotation: [0, 0, 0] },
  )

  // --- Macro: top slab ----------------------------------------------------
  // 1.400 x 0.018 x 0.680. Spec lists the contact as panel "rests-on" top-slab,
  // but gravity runs the other way here: the slab is the lid seated on the two
  // panels. Seating the slab keeps the stack height honest — panel top 0.712
  // + 0.018 slab = 0.730 m upper face, exactly the desk height in mustMatch.
  const topSlab = kit.part(
    'top-slab',
    kit.box(1.400, 0.018, 0.680),
    glassAmberTop,
    { position: [0, 0.721, 0], rotation: [0, 0, 0] },
  )

  // Butt glass-to-glass joint: overlap 0 so the 0.712 m of exposed panel face
  // and the 0.730 m top surface both survive the seating.
  kit.restOn(topSlab, panelLeft, 0)
  kit.restOn(topSlab, panelRight, 0)

  return kit.root([
    topSlab,
    panelLeft,
    panelRight,
  ])
}
