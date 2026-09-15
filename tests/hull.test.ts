import { describe, expect, it } from 'vitest'
import { buildHull, cameraBasis, estimateCameraSide, paintHull, prepareCarve, projectHull, type HullData, type HullView } from '~/utils/hull'
import type { ReliefMask } from '~/utils/relief'
import type { DepthMap } from '~/utils/depth'

const poly = (pts: [number, number][], size = 100): ReliefMask => ({ polygons: [{ exterior: pts, holes: [] }], width: size, height: size })
const rect = (x: number, y: number, w: number, h: number) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
const circle = (r = 40) => {
  const ring: [number, number][] = []
  for (let i = 0; i < 64; i++) ring.push([50 + Math.cos((i / 64) * Math.PI * 2) * r, 50 + Math.sin((i / 64) * Math.PI * 2) * r])
  return poly(ring)
}
/** A chair seen from its left side: an L, seat along the bottom, backrest up the left, front on the right. */
const chairSide = () => poly([[10, 10], [40, 10], [40, 60], [90, 60], [90, 90], [10, 90]])
const front = (mask: ReliefMask, yaw = 0, pitch = 0): HullView => ({ mask, source: 'front', yaw, pitch })
const side = (mask: ReliefMask): HullView => ({ mask, source: 'side', yaw: -90, pitch: 0 })
const top = (mask: ReliefMask): HullView => ({ mask, source: 'top', yaw: 0, pitch: 90 })
const opts = (o: Partial<Parameters<typeof buildHull>[1]> = {}) => ({ resolution: 24, roundness: 0, depthRatio: 0.5, symmetric: false, ...o })
const bounds = (p: Float32Array) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, p[i + a]!); hi[a] = Math.max(hi[a]!, p[i + a]!) }
  return { lo, hi }
}

describe('cameraBasis', () => {
  it('front camera looks down −z with x right and y up; side camera at yaw −90 sees +z on its right', () => {
    const f = cameraBasis(0, 0)
    expect(f.d.map(v => +v.toFixed(6))).toEqual([0, 0, 1])
    expect(f.r.map(v => +v.toFixed(6))).toEqual([1, 0, 0])
    expect(f.up.map(v => +v.toFixed(6))).toEqual([0, 1, 0])
    const s = cameraBasis(-90, 0)
    expect(s.d.map(v => +v.toFixed(6))).toEqual([-1, 0, 0])
    expect(s.r.map(v => +v.toFixed(6))).toEqual([0, 0, 1])
    const t = cameraBasis(0, 90)
    expect(t.d.map(v => +v.toFixed(6))).toEqual([0, 1, 0])
    expect(t.up.map(v => +v.toFixed(6))).toEqual([0, 0, -1])
  })
})

describe('buildHull', () => {
  it('front only: a square becomes a slab of the requested depth, 1 wide and centred', () => {
    const h = buildHull([front(rect(20, 20, 60, 60))], opts({ roundness: 0.2 }))
    expect(h.positions.length % 9).toBe(0)
    const { lo, hi } = bounds(h.positions)
    expect(hi[0]! - lo[0]!).toBeCloseTo(1, 5)
    expect(hi[2]! - lo[2]!).toBeCloseTo(0.5, 1)
    expect(Math.abs(lo[0]! + hi[0]!)).toBeLessThan(1e-6)
    expect(h.size[2]).toBeCloseTo(0.5, 1)
  })

  it('a box photographed at yaw 30 with symmetry comes back as a box of the right proportions', () => {
    // A 60 × 40 (W × D) × 50 tall box seen from yaw 30: silhouette width = 60cos30 + 40sin30 ≈ 72.
    const yaw = 30, W = 60, D = 40, Ht = 50
    const S = W * Math.cos(yaw * Math.PI / 180) + D * Math.sin(yaw * Math.PI / 180)
    // The silhouette of a box from the side, pitch 0, is a rectangle S wide, Ht tall.
    const h = buildHull([front(rect(50 - S / 2, 25, S, Ht), yaw)], opts({ depthRatio: D / W, symmetric: true, resolution: 32 }))
    expect(h.size[1]).toBeCloseTo(Ht / W, 1)
    expect(h.size[2]).toBeCloseTo(D / W, 1)
    // Corners at the box's corners: the plan is a rectangle, not a rhombus (the box clip works).
    const { lo, hi } = bounds(h.positions)
    let atCorner = 0
    for (let i = 0; i < h.positions.length; i += 3) {
      if (Math.abs(h.positions[i]! - hi[0]!) < 0.03 && Math.abs(h.positions[i + 2]! - hi[2]!) < 0.03) atCorner++
    }
    expect(atCorner).toBeGreaterThan(0)
    expect(lo[0]).toBeCloseTo(-0.5, 5)
  })

  it('side view sets the depth and carves the profile: no volume above the seat behind the backrest', () => {
    const h = buildHull([front(rect(20, 10, 60, 80)), side(chairSide())], opts({ resolution: 32 }))
    expect(h.size[2]).toBeCloseTo(80 / 60, 1)
    const Hh = h.size[1], Dd = h.size[2]
    let above = 0
    for (let i = 0; i < h.positions.length; i += 3) {
      const y = h.positions[i + 1]! + Hh / 2, z = h.positions[i + 2]! + Dd / 2
      if (z > Dd * 0.6 && y > Hh * 0.55) above++
    }
    expect(above).toBe(0)
  })

  it('three circles: every normal points away from the centre', () => {
    const h = buildHull([front(circle()), side(circle()), top(circle())], opts({ resolution: 20, depthRatio: 1 }))
    let bad = 0, n = 0
    for (let i = 0; i < h.positions.length; i += 3) {
      const dot = h.positions[i]! * h.normals[i]! + h.positions[i + 1]! * h.normals[i + 1]! + h.positions[i + 2]! * h.normals[i + 2]!
      n++
      if (dot <= 0) bad++
    }
    expect(n).toBeGreaterThan(100)
    expect(bad).toBe(0)
    const { lo, hi } = bounds(h.positions)
    expect(hi[1]! - lo[1]!).toBeCloseTo(1, 1)
    expect(hi[2]! - lo[2]!).toBeCloseTo(1, 1)
  })

  it('triangles are wound so the face normal agrees with the vertex normal', () => {
    const h = buildHull([front(circle())], opts({ resolution: 16, roundness: 0.5, depthRatio: 0.6 }))
    let bad = 0
    const P = h.positions, N = h.normals
    for (let t = 0; t < P.length; t += 9) {
      const ax = P[t + 3]! - P[t]!, ay = P[t + 4]! - P[t + 1]!, az = P[t + 5]! - P[t + 2]!
      const bx = P[t + 6]! - P[t]!, by = P[t + 7]! - P[t + 1]!, bz = P[t + 8]! - P[t + 2]!
      const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx
      if (fx * N[t]! + fy * N[t + 1]! + fz * N[t + 2]! < 0) bad++
    }
    expect(bad).toBe(0)
  })
})

describe('prepareCarve depth', () => {
  /** A 100×100 map matching the mask raster: top half halfway back (0.5), bottom half nearest (1). */
  const stepMap = (): DepthMap => {
    const near = new Float32Array(100 * 100).fill(0.5)
    for (let y = 50; y < 100; y++) for (let x = 0; x < 100; x++) near[y * 100 + x] = 1
    return { near, w: 100, h: 100 }
  }

  it('cuts the top half back to its near surface and keeps the bottom half whole', () => {
    const view: HullView = { ...front(rect(20, 20, 60, 60)), depth: stepMap() }
    const c = prepareCarve([view], opts({ depth: 1 }))
    // Camera on +z. Top half (y > 0) reads 0.5: its near surface is the z = 0 plane, so the front of the box is cut.
    expect(c.field(0, 15, 0.05 * c.D)).toBeLessThan(0)
    expect(c.field(0, 15, -0.05 * c.D)).toBeGreaterThan(0)
    // Bottom half (y < 0) reads 1: nothing cut, the front stays.
    expect(c.field(0, -15, 0.45 * c.D)).toBeGreaterThan(0)
    // Silhouette unchanged: outside the square stays outside.
    expect(c.field(c.W / 2 + 5, 0, 0)).toBeLessThan(0)
  })

  it('strength 0 leaves the field exactly as without a map', () => {
    const plain = prepareCarve([front(rect(20, 20, 60, 60))], opts())
    const withMap = prepareCarve([{ ...front(rect(20, 20, 60, 60)), depth: stepMap() }], opts({ depth: 0 }))
    for (const [x, y, z] of [[0, 0, 0], [0, 15, 0], [10, -20, 5], [-25, 25, -10]] as const) {
      expect(withMap.field(x, y, z)).toBe(plain.field(x, y, z))
    }
  })

  it('half strength cuts half as deep', () => {
    const mask = rect(20, 20, 60, 60)
    const full = prepareCarve([{ ...front(mask), depth: stepMap() }], opts({ depth: 1 }))
    const half = prepareCarve([{ ...front(mask), depth: stepMap() }], opts({ depth: 0.5 }))
    // Top half reads 0.5: at full strength its near surface sits at z = 0, at half strength at z = D/4.
    expect(half.field(0, 15, 0.2 * half.D)).toBeGreaterThan(0)
    expect(half.field(0, 15, 0.3 * half.D)).toBeLessThan(0)
    expect(full.field(0, 15, 0.2 * full.D)).toBeLessThan(0)
  })

  it('the mirror view carries the front map too', () => {
    const c = prepareCarve([{ ...front(rect(20, 20, 60, 60), 30), depth: stepMap() }], opts({ symmetric: true, depth: 1 }))
    expect(c.placed.length).toBe(2)
    expect(c.placed.every(p => p.view.depth)).toBe(true)
    expect(c.placed[1]!.view.mirror).toBe(true)
  })
})

describe('paintHull', () => {
  const solid = (r: number, g: number, b: number) => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < 16; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255 }
    return { data: { width: 4, height: 4, data } }
  }

  it('front-facing vertices take the front photo, side-facing the side photo', () => {
    // Raw marching cubes: the test reads axis-aligned normals, which smoothing would tilt at the edges.
    const h = buildHull([front(rect(10, 10, 80, 80)), side(rect(10, 10, 80, 80))], opts({ resolution: 16, depthRatio: 1, smoothing: 0 }))
    const colors = paintHull(h, { front: solid(255, 0, 0), side: solid(0, 0, 255), top: null })
    let frontRed = 0, frontN = 0, sideBlue = 0, sideN = 0
    for (let i = 0; i < h.normals.length; i += 3) {
      if (h.normals[i + 2]! > 0.95) { frontN++; if (colors[i]! > 0.9 && colors[i + 2]! < 0.1) frontRed++ }
      if (Math.abs(h.normals[i]!) > 0.95) { sideN++; if (colors[i + 2]! > 0.9 && colors[i]! < 0.1) sideBlue++ }
    }
    expect(frontN).toBeGreaterThan(0)
    expect(sideN).toBeGreaterThan(0)
    expect(frontRed).toBe(frontN)
    expect(sideBlue).toBe(sideN)
  })

  it('samples the photo where the camera saw the vertex: a two-tone front photo lands on the right half', () => {
    // Left half of the photo red, right half blue.
    const data = new Uint8ClampedArray(8 * 8 * 4)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const o = (y * 8 + x) * 4; data[o] = x < 4 ? 255 : 0; data[o + 2] = x < 4 ? 0 : 255; data[o + 3] = 255 }
    const h = buildHull([front(rect(10, 10, 80, 80))], opts({ resolution: 16 }))
    const colors = paintHull(h, { front: { data: { width: 8, height: 8, data } }, side: null, top: null })
    let ok = 0, n = 0
    for (let i = 0; i < h.normals.length; i += 3) {
      if (h.normals[i + 2]! < 0.95 || Math.abs(h.positions[i]!) < 0.2) continue
      n++
      const red = colors[i]! > 0.9, blue = colors[i + 2]! > 0.9
      if ((h.positions[i]! < 0 && red) || (h.positions[i]! > 0 && blue)) ok++
    }
    expect(n).toBeGreaterThan(0)
    expect(ok).toBe(n)
  })
})

describe('projectHull', () => {
  const solid = (r: number, g: number, b: number) => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < 16; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255 }
    return { data: { width: 4, height: 4, data } }
  }

  it('weights sum to 1 wherever a camera saw the vertex (0 otherwise) and the front photo owns the front face', () => {
    // Raw marching cubes: the test reads axis-aligned normals, which smoothing would tilt at the edges.
    const h = buildHull([front(rect(10, 10, 80, 80)), side(rect(10, 10, 80, 80))], opts({ resolution: 16, depthRatio: 1, smoothing: 0 }))
    const { weights, colors } = projectHull(h, { front: solid(255, 0, 0), side: solid(0, 0, 255), top: null })
    expect(colors.length).toBe(h.positions.length)
    for (let v = 0; v < weights.length / 3; v++) {
      const sum = weights[v * 3]! + weights[v * 3 + 1]! + weights[v * 3 + 2]!
      // A top or bottom face lies edge-on to both cameras: nobody saw it, so it stays at 0.
      expect(sum < 1e-6 || Math.abs(sum - 1) < 1e-5).toBe(true)
      if (h.normals[v * 3 + 2]! > 0.95) expect(weights[v * 3]!).toBeGreaterThan(0.9)
      if (Math.abs(h.normals[v * 3]!) > 0.95) expect(weights[v * 3 + 1]!).toBeGreaterThan(0.9)
    }
  })

  it('texture coordinates follow the camera: right of the object reads u > 0.5, the top reads v near 1', () => {
    const h = buildHull([front(rect(10, 10, 80, 80))], opts({ resolution: 16 }))
    const { uvs } = projectHull(h, { front: solid(255, 255, 255), side: null, top: null })
    let n = 0
    for (let v = 0; v < h.positions.length / 3; v++) {
      if (h.normals[v * 3 + 2]! < 0.95) continue
      const x = h.positions[v * 3]!, y = h.positions[v * 3 + 1]!
      const u = uvs[v * 6]!, t = uvs[v * 6 + 1]!
      if (x > 0.2) expect(u).toBeGreaterThan(0.5)
      if (x < -0.2) expect(u).toBeLessThan(0.5)
      if (y > 0.2) expect(t).toBeGreaterThan(0.5)
      if (y < -0.2) expect(t).toBeLessThan(0.5)
      n++
    }
    expect(n).toBeGreaterThan(0)
  })
})

describe('estimateCameraSide', () => {
  const poly = (pts: [number, number][]): ReliefMask => ({ polygons: [{ exterior: pts, holes: [] }], width: 100, height: 100 })
  it('reads the camera side from the slant of the top edge', () => {
    // Top edge rising to the right: the right end is far, camera on the left.
    expect(estimateCameraSide(poly([[10, 40], [90, 30], [90, 80], [10, 80]]))).toBe(-1)
    expect(estimateCameraSide(poly([[10, 30], [90, 40], [90, 80], [10, 80]]))).toBe(1)
    expect(estimateCameraSide(poly([[10, 30], [90, 30], [90, 80], [10, 80]]))).toBe(0)
  })
})

describe('smoothSurface', () => {
  it('keeps every vertex inside the raw box, keeps normals unit, and removes the voxel staircase', () => {
    const views = [front(rect(10, 10, 80, 80)), side(rect(10, 10, 80, 80))]
    const raw = buildHull(views, opts({ resolution: 16, depthRatio: 1, smoothing: 0 }))
    const smooth = buildHull(views, opts({ resolution: 16, depthRatio: 1 }))
    expect(smooth.positions.length).toBe(raw.positions.length)
    for (let i = 0; i < smooth.positions.length; i += 3) {
      // Normalised by the (slightly tighter) smoothed width, so allow a cell of slack.
      expect(Math.abs(smooth.positions[i]!)).toBeLessThanOrEqual(0.5 + 1e-6)
      const n = Math.hypot(smooth.normals[i]!, smooth.normals[i + 1]!, smooth.normals[i + 2]!)
      expect(n).toBeCloseTo(1, 5)
    }
    // A box's raw surface has six normal directions; smoothing rounds the edges into many.
    const dirs = (h: HullData) => new Set(Array.from({ length: h.normals.length / 3 }, (_, v) => `${h.normals[v * 3]!.toFixed(1)},${h.normals[v * 3 + 1]!.toFixed(1)},${h.normals[v * 3 + 2]!.toFixed(1)}`)).size
    expect(dirs(smooth)).toBeGreaterThan(dirs(raw))
  })
})
