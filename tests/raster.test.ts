import { describe, expect, it } from 'vitest'
import { distanceToEdge, gaussianBlur, pathPolygons, srgbToLinear } from '~/utils/raster'

describe('raster primitives', () => {
  it('srgbToLinear maps the ends to themselves and darkens the middle', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1, 6)
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3)
  })

  it('gaussianBlur keeps a flat field flat and spreads a spike without losing mass', () => {
    const flat = new Float32Array(16 * 16).fill(0.4)
    gaussianBlur(flat, 16, 16, 2)
    for (const v of flat) expect(v).toBeCloseTo(0.4, 5)

    const spike = new Float32Array(31 * 31)
    spike[15 * 31 + 15] = 1
    gaussianBlur(spike, 31, 31, 2)
    const sum = spike.reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 4)
    expect(spike[15 * 31 + 15]!).toBeLessThan(1)
    expect(spike[15 * 31 + 16]!).toBeGreaterThan(0)
  })

  it('distanceToEdge measures to the nearest outside pixel or border', () => {
    const w = 9, h = 9
    const mask = new Uint8Array(w * h).fill(1)
    mask[4 * w + 0] = 0
    const d = distanceToEdge(mask, w, h)
    expect(d[4 * w + 0]).toBe(0)
    expect(d[4 * w + 1]).toBeCloseTo(1, 5)
    // The centre is four pixels from the outside pixel on its row and one past the border.
    expect(d[4 * w + 4]).toBeCloseTo(4, 5)
  })

  it('pathPolygons closes every ring and scales its points', () => {
    const calls: string[] = []
    const sink = {
      moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`L${x},${y}`),
      closePath: () => calls.push('Z'),
    }
    pathPolygons(sink, [{ exterior: [[0, 0], [2, 0], [2, 2]], holes: [[[1, 1], [1, 2], [2, 1]]] }], 2, 3)
    expect(calls).toEqual(['M0,0', 'L4,0', 'L4,6', 'Z', 'M2,3', 'L2,6', 'L4,3', 'Z'])
  })
})
