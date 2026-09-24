/**
 * Blockout pass — "Tinted amber glass slab desk" (amber-glass-slab-desk).
 * Three macro plates only: one horizontal slab and two X-normal end panels.
 * Flat plastic colour stands in for the tinted glass so the review judges
 * proportion, not material.
 */
function createModel(kit, THREE, options) {
  // One material per spec material id. Only 'glass-amber' is used by macro parts;
  // bronze bracket materials belong to the later meso/micro passes.
  const glassAmber = kit.plastic({ color: '#A05224' })

  // --- Macro masses -------------------------------------------------------
  // Overall envelope: 1.400 w x 0.740 h (upper face) x 0.700 d.

  // Near (-X) end panel: 0.012 thick, 0.640 deep, 0.728 tall, X-normal,
  // bottom edge flat on the floor (y = 0) so centre sits at h/2 = 0.364.
  // x = -0.664 puts its outer face at -0.670, i.e. 0.030 inboard of the slab end.
  const panelNear = kit.part(
    'panel-near',
    kit.box(0.012, 0.728, 0.64),
    glassAmber,
    { position: [-0.664, 0.364, 0], rotation: [0, 0, 0] },
  )

  // Far (+X) end panel: identical plate mirrored in plan; authored explicitly
  // because the spec lists it as its own macro component id.
  const panelFar = kit.part(
    'panel-far',
    kit.box(0.012, 0.728, 0.64),
    glassAmber,
    { position: [0.664, 0.364, 0], rotation: [0, 0, 0] },
  )

  // Amber glass top slab, 1.400 x 0.012 x 0.700, overhanging the panels by
  // 0.030 on all four sides (panels are 0.640 deep inside a 0.700 deep slab).
  const topSlab = kit.part(
    'top-slab',
    kit.box(1.4, 0.012, 0.7),
    glassAmber,
    { position: [0, 0.734, 0], rotation: [0, 0, 0] },
  )

  // The spec records the contact as panel "rests-on" top-slab, but physically
  // the slab is the child of the pair of panels: seat it on the panel top edge
  // with zero sink so the slab underside lands on y = 0.728 and its upper face
  // on the required 0.740.
  kit.restOn(topSlab, panelNear, 0)

  return kit.root([panelNear, panelFar, topSlab])
}
