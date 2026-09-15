/**
 * Reference fixture: the orange chair-bed, built entirely on the sculpt kit.
 * This is the shape of the code the model is asked to write — one top-level
 * `createModel(kit, THREE, options)` that returns `kit.root([...])`.
 */
function createModel(kit, THREE, options) {
  const shell = kit.fabric({ color: '#e0431c', weave: 0.55, contrast: 1.1 })
  const lacquer = kit.paintedMetal({ color: '#b8161c' })

  // Folded mattress block, with the fold seam pressed across its front face.
  const baseShape = kit.pillow(0.80, 0.30, 0.75, { radius: 0.05, bulge: 0.012 })
  kit.seam(baseShape, [-0.40, 0.0, 0.39], [0.40, 0.0, 0.39], { width: 0.014, depth: 0.007 })
  const base = kit.part('base', baseShape, shell, { position: [0, 0.20, 0] })

  // Seat cushion sinking into the base.
  const seat = kit.part(
    'seat',
    kit.pillow(0.78, 0.22, 0.70, { radius: 0.07, bulge: 0.018 }),
    shell,
    { position: [0, 0, 0.01] },
  )
  kit.restOn(seat, base, 0.012)

  // Backrest, reclined about 7 degrees, resting on the rear of the seat.
  const backrest = kit.part(
    'backrest',
    kit.pillow(0.78, 0.55, 0.20, { radius: 0.08, bulge: 0.020 }),
    shell,
    { position: [0, 0, -0.245], rotation: [-0.12, 0, 0] },
  )
  kit.restOn(backrest, seat, 0.02)

  // Glossy bent rail running under the front of the block.
  const rail = kit.part(
    'rail',
    kit.bentTube(
      [[-0.34, 0.02, -0.18], [-0.34, 0.02, 0.32], [0.34, 0.02, 0.32], [0.34, 0.02, -0.18]],
      0.020,
      0.065,
    ),
    lacquer,
  )

  // Side strap across the seat/backrest junction, with two buttons. It has to
  // stand clear of the backrest's bulged flank (~0.408 m at this height) or it
  // z-fights with it and swallows the buttons.
  const strapOutline = [
    [-0.030, -0.150],
    [0.030, -0.150],
    [0.030, 0.150],
    [-0.030, 0.150],
  ]
  const strapY = backrest.position.y - 0.10
  const strap = kit.part(
    'strap',
    kit.extrude(strapOutline, 0.012, { bevel: 0.002 }),
    lacquer,
    { position: [0.409, strapY, -0.240], rotation: [0, Math.PI / 2, 0] },
  )

  const buttonUpper = kit.part(
    'button-upper',
    kit.button(0.016, { depth: 0.005 }),
    lacquer,
    { position: [0.417, strapY + 0.085, -0.240], rotation: [0, 0, -Math.PI / 2] },
  )
  const buttonLower = kit.part(
    'button-lower',
    kit.button(0.016, { depth: 0.005 }),
    lacquer,
    { position: [0.417, strapY - 0.085, -0.240], rotation: [0, 0, -Math.PI / 2] },
  )

  return kit.root([
    base,
    seat,
    backrest,
    rail,
    strap,
    buttonUpper,
    buttonLower,
    kit.mirror(strap, 'x'),
    kit.mirror(buttonUpper, 'x'),
    kit.mirror(buttonLower, 'x'),
  ])
}
