/**
 * Placing an externally built model (the sculpt parts model) on the studio's stage.
 *
 * The generated model is in metres and the studio works in millimetres, so the
 * group carries one uniform scale and one offset: the width becomes `widthMm`,
 * the bottom sits on the floor (y = 0) and the footprint is centred on x/z —
 * exactly where the carved mesh stands.
 *
 * Kept out of `glassScene.ts` so it can be unit-tested without a WebGL context.
 */

import * as THREE from 'three'

export interface ExternalFit {
  /** Uniform group scale: metres in, millimetres out. */
  scale: number
  /** Group position, applied after the scale. */
  offset: THREE.Vector3
}

/**
 * `box` is the group's own (unscaled) bounding box. A degenerate width — an
 * empty box, or a model with no extent across x — keeps the model at 1:1
 * rather than blowing it up to infinity.
 */
export function fitExternal(box: THREE.Box3, widthMm: number): ExternalFit {
  const size = box.getSize(new THREE.Vector3())
  const scale = size.x > 1e-9 && widthMm > 0 ? widthMm / size.x : 1
  const centre = box.getCenter(new THREE.Vector3())
  return {
    scale,
    offset: new THREE.Vector3(-centre.x * scale, -box.min.y * scale, -centre.z * scale),
  }
}
