/**
 * Structural pass — "Tinted amber glass slab desk" (amber-glass-slab-desk).
 *
 * This revision addresses exactly the two measured defects:
 *   1. panel-right / panel-left read as a leaning trapezoid — the panels are
 *      now explicit kit.roundedBox slabs of constant 0.015 m thickness and
 *      0.600 m depth through their full height, rotation [0, 0, 0], no taper,
 *      no skew, no restOn applied to the panels themselves.
 *   2. a bronze blade poking above the tabletop at the right-rear corner —
 *      the bracket's y is now derived so the vertical arm's TOP is exactly the
 *      top-slab underside (0.712 m) and never higher, and every mirrored plate
 *      has its transform re-derived from bracket-front-left's own position so a
 *      compounded mirror can no longer lift a plate above the slab.
 *
 * Materials stay flat (kit.plastic) on purpose: this pass is judged on shape
 * and contact, not on glass transmission or bronze patina.
 */
function createModel(kit, THREE, options) {
  // One flat material per spec material id, created once and shared.
  const glassAmberTop = kit.plastic({ color: '#9C5A28' })   // glass-amber-top
  const glassAmberPanel = kit.plastic({ color: '#8E4A1C' }) // glass-amber-panel
  const metalBronzeDark = kit.plastic({ color: '#3A2416' }) // metal-bronze-dark

  // Shared dimensions, so a later pass changing one number moves everything
  // that was derived from it.
  const slabW = 1.400
  const slabH = 0.018
  const slabD = 0.680
  const panelT = 0.015
  const panelH = 0.712
  const panelD = 0.600
  const panelEdge = 0.002                             // spec edge.radius on the panels
  const panelInset = 0.040 // top overhangs each panel face by this much
  const panelOuterX = slabW / 2 - panelInset          // 0.660
  const panelCentreX = panelOuterX - panelT / 2       // 0.6525

  // --- Macro: end panels (the structure everything else references) --------
  // Plain roundedBox: constant w = 0.015 and d = 0.600 from y = 0 to y = 0.712,
  // rotation [0, 0, 0], so each outer face is a single vertical plane and the
  // two outer faces stay 1.305 m apart top to bottom. No taper, lean or
  // rotation is applied anywhere, and the panels are never re-seated by
  // restOn — their bottom edge is authored flat on the floor at y = 0.
  const panelLeft = kit.part(
    'panel-left',
    kit.roundedBox(panelT, panelH, panelD, panelEdge),
    glassAmberPanel,
    { position: [-panelCentreX, panelH / 2, 0], rotation: [0, 0, 0] },
  )

  const panelRight = kit.part(
    'panel-right',
    kit.roundedBox(panelT, panelH, panelD, panelEdge),
    glassAmberPanel,
    { position: [panelCentreX, panelH / 2, 0], rotation: [0, 0, 0] },
  )

  // --- Macro: top slab ----------------------------------------------------
  // 1.400 x 0.018 x 0.680. Spec lists the contact as panel "rests-on"
  // top-slab, but gravity runs the other way here: the slab is the lid seated
  // on the two panels. Seating the slab keeps the stack height honest —
  // panel top 0.712 + 0.018 slab = 0.730 m upper face, the desk height in
  // mustMatch.
  const topSlab = kit.part(
    'top-slab',
    kit.roundedBox(slabW, slabH, slabD, 0.002),
    glassAmberTop,
    { position: [0, panelH + slabH / 2, 0], rotation: [0, 0, 0] },
  )

  // Butt glass-to-glass joint: overlap 0 so the 0.712 m of exposed panel face
  // and the 0.730 m top surface both survive the seating. Only the slab moves.
  kit.restOn(topSlab, panelLeft, 0)
  kit.restOn(topSlab, panelRight, 0)

  // --- Meso: bronze L-brackets, one per panel top corner ------------------
  // L profile in the XY plane, extruded 0.035 m along z. Vertical arm 0.100 m
  // tall lying on the panel's inner face, horizontal arm 0.060 m long lying
  // under the slab, plate 0.005 m thick, fold at the top outboard corner.
  const plateT = 0.005
  const armVertical = 0.100
  const armHorizontal = 0.060
  const bracketWidth = 0.035
  const bracketOutline = [
    [0, 0],                                  // bottom of the vertical arm
    [plateT, 0],
    [plateT, armVertical - plateT],          // inner side of the fold
    [armHorizontal, armVertical - plateT],   // underside of the horizontal arm
    [armHorizontal, armVertical],            // inboard tip, against the slab
    [0, armVertical],
  ]
  // No bevel: a 0.001 m bevel on a 0.005 m plate insets the thin arms to
  // 0.003 m. Sharp folds are also what the evidence describes.
  const bracketGeometry = kit.extrude(bracketOutline, bracketWidth)

  // kit.extrude re-centres on the origin, so the part position is the centre
  // of the L's 0.060 x 0.100 x 0.035 bounding box.
  const panelInnerX = -panelCentreX + panelT / 2       // -0.645, the bolted face
  const bracketSink = 0.001                            // buried into the panel, kills coplanar z-fight
  const slabUnderside = topSlab.position.y - slabH / 2 // 0.712
  // x: vertical arm's back face sunk 0.001 m into the panel so 0.004 of the
  // 0.005 plate still stands proud and reads as hardware.
  const bracketX = panelInnerX - bracketSink + armHorizontal / 2 // -0.616
  // y: TOP of the vertical arm is the slab underside exactly — the plate hangs
  // 0.100 m below it and can never rise above y = 0.712. This is the spec's
  // own 0.662 centre height.
  const bracketY = slabUnderside - armVertical / 2               // 0.662
  const bracketZ = 0.250 // front corner; the pair on a panel is 0.500 m apart

  const bracketFrontLeft = kit.part(
    'bracket-front-left',
    bracketGeometry,
    metalBronzeDark,
    { position: [bracketX, bracketY, bracketZ], rotation: [0, 0, 0] },
  )

  // r-bracket-mirror-z: the rear twin on the same panel, 0.500 m behind.
  const bracketRearLeft = kit.mirror(bracketFrontLeft, 'z')
  // r-bracket-mirror-x: the matching pair on the right panel.
  const bracketFrontRight = kit.mirror(bracketFrontLeft, 'x')
  const bracketRearRight = kit.mirror(bracketRearLeft, 'x')

  // Re-derive every mirrored plate's placement straight from bracket-front-left
  // and clamp its height to bracketY, so no compounded mirror transform can
  // lift a blade above the top-slab underside (the back-right nub defect).
  const mirroredBracketX = -bracketFrontLeft.position.x
  const mirroredBracketZ = -bracketFrontLeft.position.z
  bracketRearLeft.position.set(bracketFrontLeft.position.x, bracketY, mirroredBracketZ)
  bracketFrontRight.position.set(mirroredBracketX, bracketY, bracketFrontLeft.position.z)
  bracketRearRight.position.set(mirroredBracketX, bracketY, mirroredBracketZ)

  return kit.root([
    topSlab,
    panelLeft,
    panelRight,
    bracketFrontLeft,
    bracketRearLeft,
    bracketFrontRight,
    bracketRearRight,
  ])
}
