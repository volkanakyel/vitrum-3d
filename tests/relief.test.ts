import { describe, expect, it } from 'vitest'
import { buildReliefGeometry, type ReliefData } from '~/utils/relief'

/** A dome height grid inside a circular mask: the shape Inflate makes of a disc. */
function dome(n = 33): ReliefData {
  const heights = new Float32Array(n * n)
  const mask = new Uint8Array(n * n)
  const c = (n - 1) / 2
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x - c, y - c) / c
    if (r < 1) { mask[y * n + x] = 1; heights[y * n + x] = Math.sqrt(1 - r * r) }
  }
  return { width: n, height: n, heights, mask, bbox: { minX: 0, minY: 0, maxX: n - 1, maxY: n - 1 }, crop: { x: 0, y: 0, w: 1, h: 1 }, mirror: true }
}

describe('buildReliefGeometry', () => {
  it('inflated back normals point outward, like the front mirrored', () => {
    const d = dome()
    const geo = buildReliefGeometry(d, { widthMm: 40, baseMm: 0, reliefMm: 20 })
    const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal')
    const n = d.width * d.height
    let bad = 0, checked = 0
    for (let i = 0; i < n; i++) {
      if (!d.mask![i] || d.heights[i]! < 0.05) continue
      for (const j of [i, n + i]) {
        // Every vertex of a sphere-ish solid has its outward normal aligned with its position.
        const dot = pos.getX(j) * nor.getX(j) + pos.getY(j) * nor.getY(j) + pos.getZ(j) * nor.getZ(j)
        checked++
        if (dot <= 0) bad++
      }
    }
    expect(checked).toBeGreaterThan(100)
    expect(bad).toBe(0)
  })
})
