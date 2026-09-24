/**
 * Tinted amber glass slab desk — STRUCTURAL pass.
 *
 * Macro masses (top slab + two end panels) carried over from the blockout.
 * Meso layer: the four bronze L-brackets tying each panel top corner to the
 * slab underside, authored once as 'bracket-lf' and mirrored front/back (z)
 * and left/right (x) per the spec's repetition. Micro: the four glide pads
 * that lift the panel bottom edges 0.002 m clear of the floor.
 * Materials stay flat — structure, not surface.
 */
function createModel(kit, THREE, options) {
  // One material object per spec material id, created once and shared.
  // Structural rule: flat colour from each material's baseColor.
  const glassAmberTop = kit.plastic({ color: '#A85F2A' })
  const glassAmberPanel = kit.plastic({ color: '#A0561F' })
  const metalBronze = kit.plastic({ color: '#43291B' })
  const plasticGlide = kit.plastic({ color: '#D8D3CB' })

  // Glide pad geometry: 0.015 x 0.003 x 0.03 m, inserted 0.001 m into the
  // panel bottom edge, so the glass stands 0.002 m clear of the floor.
  const glideThickness = 0.003
  const glideInsert = 0.001
  const panelLift = glideThickness - glideInsert // 0.002 m of pad proud below the glass

  // --- Macro: the two end panels (the ground-bearing masses) --------------
  // 0.015 m thick glass fins, 0.725 m tall, 0.60 m deep; bottoms at
  // y = panelLift = 0.002 because they ride on the glide pads.
  // x = ±0.6425 puts the outer faces 1.300 m apart and the inner faces
  // 1.270 m apart, per mustMatch.
  const panelCentreY = panelLift + 0.725 / 2 // 0.3645
  const panelLeft = kit.part(
    'panel-left',
    kit.box(0.015, 0.725, 0.6),
    glassAmberPanel,
    { position: [-0.6425, panelCentreY, 0], rotation: [0, 0, 0] },
  )

  const panelRight = kit.part(
    'panel-right',
    kit.box(0.015, 0.725, 0.6),
    glassAmberPanel,
    { position: [0.6425, panelCentreY, 0], rotation: [0, 0, 0] },
  )

  // --- Macro: the tinted glass top slab -----------------------------------
  // 1.40 x 0.015 x 0.70 m, seated on the panel top edges below.
  // Overhang falls out of the geometry: 1.40 vs 1.30 outer faces = 0.050 m
  // each end in x; 0.70 vs 0.60 panel depth = 0.050 m front and back in z.
  const topSlab = kit.part(
    'top-slab',
    kit.box(1.4, 0.015, 0.7),
    glassAmberTop,
    { position: [0, panelCentreY + 0.725 / 2 + 0.015 / 2, 0], rotation: [0, 0, 0] },
  )

  // The spec's rests-on contact (panels -> top-slab, overlap 0) is seated in
  // the load-bearing direction: the slab butts down onto the panel top edges,
  // zero overlap so the 0.015 m butt line stays crisp. Seating the panels onto
  // the slab instead would stack them above it and double the desk height.
  kit.restOn(topSlab, panelLeft, 0)

  // --- Meso: bronze L-bracket, left panel front corner --------------------
  // Derived from the boxes rather than eyeballed:
  //   slab underside  = topSlab.position.y - 0.015/2       -> bracket top
  //   panel inner face = -0.6425 + 0.015/2 = -0.635        -> bracket back
  //   panel front edge = +0.60/2           = +0.300        -> bracket front
  // The strap is a flat 0.006 m plate lying against the panel inner face: one
  // 0.16 m arm running down from the corner, one 0.16 m arm running back along
  // the slab underside, mitred at 90 degrees, 0.040 m wide at the mitre and
  // tapering to 0.022 m at each arm end.
  const slabUnderside = topSlab.position.y - 0.015 / 2
  const panelInnerX = panelLeft.position.x + 0.015 / 2
  const panelFrontZ = 0.6 / 2

  // Bracket bounding box is 0.16 x 0.16, so its centre sits half an arm in
  // from the two reference faces it hugs.
  const bracketCentreY = slabUnderside - 0.16 / 2
  const bracketCentreZ = panelFrontZ - 0.16 / 2 // 0.220 -> the z-mirror lands at
  //                                               -0.220, i.e. 0.44 m apart c/c
  // Plate 0.006 thick, buried 0.0015 m into the glass so its back face does not
  // z-fight the panel inner face; 0.0045 m of strap reads proud of the glass.
  const bracketCentreX = panelInnerX + 0.006 / 2 - 0.0015 // -0.6335

  // Outline authored in the plate's own plane, origin at the bracket bbox
  // centre: local +x runs backwards in z (towards the panel's back edge after
  // the +90 degree yaw), local +y is world up, extrusion depth is the plate
  // thickness and ends up along world x.
  const bracketOutline = [
    [-0.08, 0.08], // mitred outer corner, at the panel front edge / slab underside
    [-0.08, -0.08], // vertical arm end, outer edge (0.16 m down the panel face)
    [-0.058, -0.08], // vertical arm end, inner edge -> 0.022 m wide there
    [-0.04, 0.04], // inner mitre point -> 0.040 m strap at the corner
    [0.08, 0.058], // horizontal arm end, inner edge -> 0.022 m tall there
    [0.08, 0.08], // horizontal arm end, top edge against the slab underside
  ]

  const bracketLf = kit.part(
    'bracket-lf',
    kit.extrude(bracketOutline, 0.006, { bevel: 0.002 }),
    metalBronze,
    {
      position: [bracketCentreX, bracketCentreY, bracketCentreZ],
      rotation: [0, Math.PI / 2, 0], // stands the plate up parallel to the panel
    },
  )

  // The 2x2 bracket set is built as a mirror chain so every clone gets its own
  // id: mirroring the original twice (once in z, once in x) would produce two
  // clones both named 'bracket-lf-mirror' and the second would replace the
  // first in the part table — that is why the left-back bracket vanished.
  // Chain: lf -> (z) left-back -> (x) right-back -> (z) right-front.
  const bracketLb = kit.mirror(bracketLf, 'z') // left panel, back corner
  const bracketRb = kit.mirror(bracketLb, 'x') // right panel, back corner
  const bracketRf = kit.mirror(bracketRb, 'z') // right panel, front corner

  // --- Micro: glide pads under each panel bottom corner -------------------
  // Inserted into the panel bottom edge, not rested on anything: pad top is
  // the panel underside + the 0.001 m insert, i.e. y = 0.003, so the pad
  // centre sits at 0.003 - 0.003/2 = 0.0015 and its base is the floor at y = 0.
  // In z the pad's near end is 0.03 m in from the panel front corner:
  //   0.300 - 0.03 - 0.03/2 = 0.255.
  const glideCentreY = panelLift + glideInsert - glideThickness / 2
  const glideCentreZ = panelFrontZ - 0.03 - 0.03 / 2
  const glideLf = kit.part(
    'glide-lf',
    kit.roundedBox(0.015, glideThickness, 0.03, 0.001),
    plasticGlide,
    { position: [panelLeft.position.x, glideCentreY, glideCentreZ], rotation: [0, 0, 0] },
  )

  // Same mirror chain trick as the brackets, so all four pads keep unique ids:
  // lf -> (z) left-back -> (x) right-back -> (z) right-front.
  const glideLb = kit.mirror(glideLf, 'z')
  const glideRb = kit.mirror(glideLb, 'x')
  const glideRf = kit.mirror(glideRb, 'z')

  return kit.root([
    panelLeft,
    panelRight,
    topSlab,
    bracketLf,
    bracketLb,
    bracketRb,
    bracketRf,
    glideLf,
    glideLb,
    glideRb,
    glideRf,
  ])
}
