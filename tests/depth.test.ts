import { describe, expect, it } from 'vitest'
import { normaliseDepth, padDepth, sampleNear, shrinkDepth } from '~/utils/depth'

/** A w×h mask with a centred square inside. */
function square(w: number, h: number, inset: number): Uint8Array {
  const m = new Uint8Array(w * h)
  for (let y = inset; y < h - inset; y++) for (let x = inset; x < w - inset; x++) m[y * w + x] = 1
  return m
}

describe('normaliseDepth', () => {
  it('maps the inside to 0..1 with the nearest at 1 and leaves the outside at 0', () => {
    const w = 8, h = 8, mask = square(w, h, 2)
    const raw = new Float32Array(w * h)
    for (let i = 0; i < raw.length; i++) raw[i] = mask[i] ? 10 + (i % w) : 999
    const near = normaliseDepth(raw, w, h, mask, 0)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < near.length; i++) {
      if (mask[i]) { lo = Math.min(lo, near[i]!); hi = Math.max(hi, near[i]!) } else expect(near[i]).toBe(0)
    }
    expect(lo).toBeCloseTo(0, 6)
    expect(hi).toBeCloseTo(1, 6)
    // Bigger raw value = nearer = closer to 1.
    expect(near[3 * w + 5]!).toBeGreaterThan(near[3 * w + 2]!)
  })

  it('clips the percentile tails so one spike does not flatten the rest', () => {
    const w = 10, h = 10, mask = square(w, h, 0)
    // A ramp 0..99 with one spike: without clipping the ramp would be squashed into 0..0.1.
    const raw = new Float32Array(w * h)
    for (let i = 0; i < raw.length; i++) raw[i] = i
    raw[0] = 1000
    const near = normaliseDepth(raw, w, h, mask, 0.02)
    expect(near[0]).toBe(1)
    expect(Math.abs(near[50]! - 0.5)).toBeLessThan(0.05)
  })

  it('a flat map (no range) is all 1 inside so the carve is a no-op', () => {
    const w = 6, h = 6, mask = square(w, h, 1)
    const raw = new Float32Array(w * h).fill(3)
    const near = normaliseDepth(raw, w, h, mask, 0.01)
    for (let i = 0; i < near.length; i++) expect(near[i]).toBe(mask[i] ? 1 : 0)
    expect(near.some(v => Number.isNaN(v))).toBe(false)
  })
})

describe('padDepth', () => {
  it('fills outside pixels with the nearest inside value', () => {
    const w = 9, h = 9, mask = square(w, h, 3)
    const near = new Float32Array(w * h)
    // Inside: left column of the square 0.2, right column 0.8, middle 0.5.
    for (let y = 3; y < 6; y++) { near[y * w + 3] = 0.2; near[y * w + 4] = 0.5; near[y * w + 5] = 0.8 }
    padDepth(near, w, h, mask)
    expect(near[4 * w + 0]).toBeCloseTo(0.2, 6)
    expect(near[4 * w + 8]).toBeCloseTo(0.8, 6)
    expect(near[0 * w + 4]).toBeCloseTo(0.5, 6)
    // Inside untouched.
    expect(near[4 * w + 4]).toBeCloseTo(0.5, 6)
    expect(near.some(v => Number.isNaN(v))).toBe(false)
  })

  it('an empty mask leaves the map untouched', () => {
    const w = 4, h = 4
    const near = new Float32Array(w * h).fill(0.3)
    padDepth(near, w, h, new Uint8Array(w * h))
    for (let i = 0; i < near.length; i++) expect(near[i]).toBeCloseTo(0.3, 6)
  })
})

describe('shrinkDepth', () => {
  it('box-averages to at most `max` on the long side and keeps the mean', () => {
    const w = 40, h = 20
    const near = new Float32Array(w * h)
    for (let i = 0; i < near.length; i++) near[i] = (i % w) / (w - 1)
    const map = shrinkDepth(near, w, h, 10)
    expect(map.w).toBe(10)
    expect(map.h).toBe(5)
    expect(map.near.length).toBe(50)
    const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length
    expect(mean(map.near)).toBeCloseTo(mean(near), 2)
    // Still increases left to right.
    expect(map.near[9]!).toBeGreaterThan(map.near[0]!)
  })

  it('returns the input as is when already small enough', () => {
    const near = new Float32Array(6).fill(0.5)
    const map = shrinkDepth(near, 3, 2, 256)
    expect(map.near).toBe(near)
    expect(map.w).toBe(3)
    expect(map.h).toBe(2)
  })
})

describe('sampleNear', () => {
  it('interpolates bilinearly and clamps at the border', () => {
    const map = { w: 2, h: 2, near: Float32Array.from([0, 1, 0, 1]) }
    expect(sampleNear(map, 0.5, 0.5)).toBeCloseTo(0.5, 6)
    expect(sampleNear(map, -5, -5)).toBeCloseTo(0, 6)
    expect(sampleNear(map, 50, 50)).toBeCloseTo(1, 6)
  })
})
