import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { fitExternal } from '../app/utils/externalFit'

describe('fitExternal', () => {
  it('scales a metre-sized model to the studio width and stands it on the floor', () => {
    // 0.8 × 0.9 × 0.7 m, sitting 0.1 m above its own origin and centred on x/z.
    const box = new THREE.Box3(new THREE.Vector3(-0.4, 0.1, -0.35), new THREE.Vector3(0.4, 1, 0.35))
    const { scale, offset } = fitExternal(box, 100)
    expect(scale).toBeCloseTo(125, 10)
    expect(offset.y).toBeCloseTo(-box.min.y * 125, 10)
    expect(offset.x).toBeCloseTo(0, 10)
    expect(offset.z).toBeCloseTo(0, 10)
  })

  it('centres an off-centre footprint on x and z', () => {
    const box = new THREE.Box3(new THREE.Vector3(1, -0.2, 2), new THREE.Vector3(2, 0.8, 3))
    const { scale, offset } = fitExternal(box, 50)
    expect(scale).toBeCloseTo(50, 10)
    expect(offset.x).toBeCloseTo(-1.5 * 50, 10)
    expect(offset.y).toBeCloseTo(0.2 * 50, 10)
    expect(offset.z).toBeCloseTo(-2.5 * 50, 10)
  })

  it('keeps a model with no width at 1:1 instead of scaling to infinity', () => {
    const flat = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 1))
    expect(fitExternal(flat, 100).scale).toBe(1)
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1))
    expect(fitExternal(box, 0).scale).toBe(1)
  })
})
