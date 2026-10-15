import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildExtrudeGeometry, roundSharpCorners } from '~/utils/extrude'
import type { TraceResult } from '~/utils/trace'

function square(size = 100): TraceResult {
  const s = size
  return {
    polygons: [{ exterior: [[0, 0], [s, 0], [s, s], [0, s]], holes: [] }],
    hasTile: false,
    width: s,
    height: s,
    bbox: { minX: 0, minY: 0, maxX: s, maxY: s },
    resolvedMode: 'dark',
    threshold: 0.5,
    background: [255, 255, 255],
    coverage: 1,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    strokeWidth: s / 2,
    vertexCount: 4,
    palette: 2,
  }
}

describe('buildExtrudeGeometry', () => {
  it('builds a centred solid exactly widthMm wide and depthMm deep', () => {
    const built = buildExtrudeGeometry(square(), { widthMm: 50, depthMm: 8, bevelMm: 1, bevelSegments: 3, layerMm: 2, stack: false })!
    expect(built).not.toBeNull()
    const bb = built.geometry.boundingBox!
    const size = bb.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(50, 3)
    expect(size.y).toBeCloseTo(50, 3)
    expect(size.z).toBeCloseTo(8, 3)
    const centre = bb.getCenter(new THREE.Vector3())
    expect(centre.length()).toBeLessThan(1e-6)
    expect(built.frame.scale).toBeCloseTo(0.5)
  })

  it('returns null for an empty trace', () => {
    expect(buildExtrudeGeometry({ ...square(), polygons: [] }, { widthMm: 50, depthMm: 8, bevelMm: 1, bevelSegments: 3, layerMm: 2, stack: false })).toBeNull()
  })

  it('caps the bevel at half the depth instead of inverting the solid', () => {
    const built = buildExtrudeGeometry(square(), { widthMm: 50, depthMm: 2, bevelMm: 10, bevelSegments: 2, layerMm: 2, stack: false })!
    const size = built.geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(size.z).toBeCloseTo(2, 3)
    expect(size.x).toBeCloseTo(50, 3)
  })

  it('raises stack layers above the base face', () => {
    const t = square()
    t.layers = [{ polygons: [{ exterior: [[25, 25], [75, 25], [75, 75], [25, 75]], holes: [] }], color: '#ff0000', area: 0.25 }]
    const flat = buildExtrudeGeometry(t, { widthMm: 50, depthMm: 8, bevelMm: 1, bevelSegments: 2, layerMm: 3, stack: false })!
    const stacked = buildExtrudeGeometry(t, { widthMm: 50, depthMm: 8, bevelMm: 1, bevelSegments: 2, layerMm: 3, stack: true })!
    const dz = stacked.geometry.boundingBox!.getSize(new THREE.Vector3()).z - flat.geometry.boundingBox!.getSize(new THREE.Vector3()).z
    expect(dz).toBeGreaterThan(2.5)
    expect(dz).toBeLessThanOrEqual(3)
  })
})

describe('roundSharpCorners', () => {
  it('leaves right angles alone', () => {
    const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(10, 0), new THREE.Vector2(10, 10), new THREE.Vector2(0, 10)]
    expect(roundSharpCorners(pts, 1)).toHaveLength(4)
  })
  it('replaces a sharp tip with an arc that stays inside the corner', () => {
    const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(40, 2), new THREE.Vector2(0, 4)]
    const out = roundSharpCorners(pts, 1)
    expect(out.length).toBeGreaterThan(3)
    for (const p of out) expect(p.x).toBeLessThanOrEqual(40)
  })
})
