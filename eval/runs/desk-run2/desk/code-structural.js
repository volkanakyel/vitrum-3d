/**
 * Structure pass — "Tinted amber glass slab desk" (amber-glass-slab-desk).
 *
 * Macro (carried from the blockout):
 *   - top-slab   1.400 x 0.015 x 0.650 m, top face 0.72 m off the floor
 *   - end-panel  0.015 x 0.702 x 0.600 m, mirrored across x
 * Meso / micro:
 *   - bracket    bronze L-plate, one per inner top corner (4 discrete meshes)
 *   - foot-pad   frosted glide under each panel bottom corner (4 via mirrors)
 * No apron, stretcher, leg or drawer exists anywhere — the spec forbids them.
 */
function createModel(kit, THREE, options) {
  // One flat material per spec material id. Flat plastic stand-ins for the
  // tinted glass and the bronze so this pass is judged on structure, not tint.
  const glassAmberTop = kit.plastic({ color: '#B26A33' })
  const glassAmberPanel = kit.plastic({ color: '#A0521F' })
  const metalBronze = kit.plastic({ color: '#3B2A1D' })
  const plasticPad = kit.plastic({ color: '#C6BCAC' })

  // Spec dimensions, named once so the thin-glass numbers cannot drift.
  // GLASS_T is the uniform 0.015 m glass thickness used by both the slab
  // (its height) and the panels (their width).
  const GLASS_T = 0.015
  const SLAB_W = 1.400
  const SLAB_D = 0.650
  const PANEL_H = 0.702
  const PANEL_D = 0.600
  const PANEL_X = 0.6575 // mid-plane: outer face 0.035 m inboard of the slab end
  const PANEL_Y = 0.354 // spec centre: panel bottom at 0.003 m (pad thickness)
  const SLAB_CENTRE_Y = 0.7125 // panel top 0.705 + GLASS_T / 2
  const PANEL_BOTTOM_Y = PANEL_Y - PANEL_H / 2 // 0.003 m
  const PANEL_TOP_Y = PANEL_Y + PANEL_H / 2 // 0.705 m — the slab underside
  const PANEL_INNER_X = PANEL_X - GLASS_T / 2 // 0.650 m: inner face of the near panel

  // Near (-X) end panel: 0.015 m glass fin, 0.702 m tall, 0.60 m deep.
  // Mid-plane at x = -0.6575 m so its outer face sits 0.035 m inboard of the
  // slab end (the spec's top-overhang); 0.60 m depth stays centred in the
  // 0.65 m slab depth, i.e. 0.025 m set back from both long edges.
  const endPanel = kit.part(
    'end-panel',
    kit.box(GLASS_T, PANEL_H, PANEL_D),
    glassAmberPanel,
    { position: [-PANEL_X, PANEL_Y, 0], rotation: [0, 0, 0] },
  )

  // Top slab: 1.40 x 0.65 m plate of glass, height exactly GLASS_T = 0.015 m.
  // No bevel, no edge radius, no seam mesh and no second stacked box — the
  // rendered band must be this one 0.015 m box and nothing else.
  const topSlab = kit.part(
    'top-slab',
    kit.box(SLAB_W, GLASS_T, SLAB_D),
    glassAmberTop,
    { position: [0, SLAB_CENTRE_Y, 0], rotation: [0, 0, 0] },
  )

  // The spec lists the rests-on contact as panel-on-slab, but the real load
  // path (and the silhouette) is slab-on-panel, so the contact is seated that
  // way round: slab bottom on the panel top edge, zero overlap.
  kit.restOn(topSlab, endPanel, 0)
  // Restate the spec centre after seating so the slab's 0.015 m band cannot
  // end up anywhere but 0.705–0.720 m (restOn yields the same value).
  topSlab.position.set(0, SLAB_CENTRE_Y, 0)

  /**
   * L-bracket plate, authored in a local frame whose origin is the plate's top
   * outer arris: outline +x runs inboard, +y up, extruded 0.030 m along z
   * (the plate's width along the panel depth).
   *   vertical leg 0.130 m down the panel inner face,
   *   horizontal leg 0.100 m inboard under the slab,
   *   uniform 0.005 m plate thickness, per mustMatch.
   * Wound counter-clockwise, no bevel requested.
   */
  const BRACKET_V = 0.130
  const BRACKET_H = 0.100
  const BRACKET_T = 0.005
  const BRACKET_W = 0.030
  const BRACKET_SINK = 0.002 // "bolted" overlap: plate face sunk into the panel
  const bracketOutline = [
    [0, -BRACKET_V], // bottom of the vertical leg, outer face (against the panel)
    [BRACKET_T, -BRACKET_V], // bottom of the vertical leg, inner face
    [BRACKET_T, -BRACKET_T], // inside corner of the L
    [BRACKET_H, -BRACKET_T], // horizontal leg tip, lower face
    [BRACKET_H, 0], // horizontal leg tip, hard against the slab underside
    [0, 0], // top outer arris — flush with slab underside and panel face
  ]

  // Outline extents, read off the outline itself so they follow the constants.
  let outMinX = bracketOutline[0][0]
  let outMaxX = bracketOutline[0][0]
  let outMinY = bracketOutline[0][1]
  let outMaxY = bracketOutline[0][1]
  for (const [ox, oy] of bracketOutline) {
    outMinX = Math.min(outMinX, ox)
    outMaxX = Math.max(outMaxX, ox)
    outMinY = Math.min(outMinY, oy)
    outMaxY = Math.max(outMaxY, oy)
  }

  // The kit documents its primitive builders as centred on the origin, but the
  // bracket is a 0.005 m sliver and the seating has to be exact, so the
  // convention is measured once with a clean rectangular probe instead of
  // assumed. Anything the probe cannot answer falls back to "centred".
  let extrudeCentredX = true
  let extrudeCentredY = true
  let extrudeCentredZ = true
  const probeGeo = kit.extrude([[0, 0], [0.2, 0], [0.2, 0.3], [0, 0.3]], 0.1)
  probeGeo.computeBoundingBox()
  const probeBox = probeGeo.boundingBox
  if (probeBox) {
    extrudeCentredX = probeBox.min.x < -0.05
    extrudeCentredY = probeBox.min.y < -0.075
    extrudeCentredZ = probeBox.min.z < -0.025
  }

  // Analytic local box of one bracket plate: exactly 0.100 x 0.130 x 0.030 m,
  // expressed in whatever frame kit.extrude hands back.
  const outCentreX = (outMinX + outMaxX) / 2
  const outCentreY = (outMinY + outMaxY) / 2
  const localMinX = extrudeCentredX ? outMinX - outCentreX : outMinX
  const localMaxX = extrudeCentredX ? outMaxX - outCentreX : outMaxX
  const localMinY = extrudeCentredY ? outMinY - outCentreY : outMinY
  const localMaxY = extrudeCentredY ? outMaxY - outCentreY : outMaxY
  const localMinZ = extrudeCentredZ ? -BRACKET_W / 2 : 0
  const localMaxZ = extrudeCentredZ ? BRACKET_W / 2 : BRACKET_W
  const localMidZ = (localMinZ + localMaxZ) / 2

  /**
   * DEFECT FIX (both bracket defects): clamp every extruded vertex into the
   * plate's analytic 0.100 x 0.130 x 0.030 m box. A thin L extruded with any
   * bevel offset can throw inverted spikes far outside its outline — upward
   * through the tabletop (the ~0.05 m black spike above y = 0.7125 m) and
   * inboard across the opening (the fake ~1.3 m apron band in the front view).
   * Clamping makes both physically impossible: no bracket vertex can exist
   * above the slab underside at y = 0.705 m, and none can reach further than
   * 0.100 m inboard of its own panel, so the middle 1.1 m of the underside
   * stays empty.
   */
  function clampToPlate(geo) {
    const attr = geo.getAttribute('position')
    if (attr) {
      const n = attr.count
      for (let i = 0; i < n; i++) {
        const vx = attr.getX(i)
        const vy = attr.getY(i)
        const vz = attr.getZ(i)
        if (vx < localMinX) attr.setX(i, localMinX)
        else if (vx > localMaxX) attr.setX(i, localMaxX)
        if (vy < localMinY) attr.setY(i, localMinY)
        else if (vy > localMaxY) attr.setY(i, localMaxY)
        if (vz < localMinZ) attr.setZ(i, localMinZ)
        else if (vz > localMaxZ) attr.setZ(i, localMaxZ)
      }
      attr.needsUpdate = true
      geo.computeVertexNormals()
      geo.computeBoundingBox()
    }
    return geo
  }

  // Plate outer face against the panel inner face, sunk in by the 0.002 m
  // bolted overlap so it does not z-fight with the glass.
  const bracketFaceX = PANEL_INNER_X + BRACKET_SINK // 0.652 m
  const bracketY = PANEL_TOP_Y - localMaxY // top arris exactly at y = 0.705 m

  // Near (-X) panel, front corner: local +x already runs inboard (towards +x).
  const bracketNearFront = kit.part(
    'bracket',
    clampToPlate(kit.extrude(bracketOutline, BRACKET_W)),
    metalBronze,
    { position: [-bracketFaceX - localMinX, bracketY, 0.20 - localMidZ], rotation: [0, 0, 0] },
  )

  /**
   * DEFECT FIX (far-panel transform): the far pair is no longer the third link
   * of a mirror-of-a-mirror-of-a-mirror chain, whose stacked negative scales
   * were the suspect transform. It is an independently authored plate with its
   * own geometry, yawed 180 degrees so its local +x (inboard) points towards
   * -x, seated by the same measured numbers. Four separate, non-merged extrude
   * meshes at x = ±0.650, z = ±0.20, with nothing between them.
   */
  const bracketFarFront = kit.part(
    'bracket-far-front',
    clampToPlate(kit.extrude(bracketOutline, BRACKET_W)),
    metalBronze,
    {
      position: [bracketFaceX + localMinX, bracketY, 0.20 + localMidZ],
      rotation: [0, Math.PI, 0],
    },
  )

  // repetition "bracket-fb": each panel carries a second bracket 0.40 m behind
  // the front one (z = -0.20 m), taken as a z-mirror of the authored plate.
  const bracketNearBack = kit.mirror(bracketNearFront, 'z')
  const bracketFarBack = kit.mirror(bracketFarFront, 'z')

  // Frosted glide on the panel bottom edge, front corner. 0.030 m long, its
  // front end 0.025 m inboard of the panel front corner (0.300 - 0.025 -
  // 0.030/2 = 0.260 m), adhered up into the panel by the 0.0005 m overlap so
  // there is no seam gap; root re-seats the whole model on y = 0.
  const PAD_H = 0.003
  const padY = PANEL_BOTTOM_Y + 0.0005 - PAD_H / 2
  const footPad = kit.part(
    'foot-pad',
    kit.roundedBox(GLASS_T, PAD_H, 0.030, 0.001),
    plasticPad,
    { position: [-PANEL_X, padY, 0.260], rotation: [0, 0, 0] },
  )
  // repetition "pad-fb": matching glide at the panel's back bottom corner.
  const footPadBack = kit.mirror(footPad, 'z')

  return kit.root([
    topSlab,
    endPanel,
    // repetition "panel-pair": the +X end panel is the mirror of the near one.
    kit.mirror(endPanel, 'x'),
    bracketNearFront,
    bracketNearBack,
    bracketFarFront,
    bracketFarBack,
    footPad,
    footPadBack,
    // repetition "pad-lr": the two glides under the far (+X) panel.
    kit.mirror(footPad, 'x'),
    kit.mirror(footPadBack, 'x'),
  ])
}
