import { describe, expect, it } from 'vitest'
import { applyGain, delightGain, grainNormal, grainRoughness, highpass, luminanceField, type Raster } from '~/utils/surface'

/** A w×h raster from a per-pixel grey function (0..255), opaque. */
function raster(w: number, h: number, f: (x: number, y: number) => number): Raster {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = f(x, y), o = (y * w + x) * 4
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255
  }
  return { width: w, height: h, data }
}
const mean = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s / a.length }

describe('surface maps', () => {
  it('flattens a left-to-right lighting ramp toward a uniform albedo', () => {
    const w = 96, h = 32
    const r = raster(w, h, x => 120 + (x / (w - 1)) * 100)
    const before = luminanceField(r)
    const gain = delightGain(before, w, h, 1)
    applyGain(r, gain)
    const after = luminanceField(r)
    const spread = (f: Float32Array) => {
      const row = Array.from(f.subarray(w * 16, w * 17))
      return Math.max(...row) - Math.min(...row)
    }
    expect(spread(after)).toBeLessThan(spread(before) * 0.35)
  })

  it('leaves the picture alone at flatten 0 and keeps its mean brightness at 1', () => {
    const w = 64, h = 64
    const r = raster(w, h, x => 40 + (x % 8) * 20)
    const lum = luminanceField(r)
    const none = delightGain(lum, w, h, 0)
    expect(none.every(g => Math.abs(g - 1) < 1e-6)).toBe(true)
    const copy = { ...r, data: Uint8ClampedArray.from(r.data) }
    applyGain(copy, delightGain(lum, w, h, 1))
    expect(Math.abs(mean(luminanceField(copy)) - mean(lum))).toBeLessThan(0.08)
  })

  it('normal map is flat (0.5, 0.5, 1) on a flat picture and tilts across a grain ridge', () => {
    const w = 32, h = 32
    const flat = grainNormal(highpass(luminanceField(raster(w, h, () => 128)), w, h), w, h, 1)
    expect(flat[0]).toBe(128)
    expect(flat[1]).toBe(128)
    expect(flat[2]).toBe(255)
    // A vertical bright stripe: left flank faces +x (r > 128), right flank faces -x (r < 128).
    const ridge = grainNormal(highpass(luminanceField(raster(w, h, x => (x === 16 ? 220 : 100))), w, h), w, h, 1)
    const px = (x: number, y: number) => ridge[(y * w + x) * 4]!
    expect(px(15, 16)).toBeLessThan(128)
    expect(px(17, 16)).toBeGreaterThan(128)
    expect(px(15, 16) + px(17, 16)).toBeCloseTo(256, -1)
  })

  it('roughness map goes glossier on bright grain and stays 1 when there is none', () => {
    const w = 16, h = 16
    const none = grainRoughness(highpass(luminanceField(raster(w, h, () => 90)), w, h), w, h, 1)
    expect(none[1]).toBe(255)
    const dots = grainRoughness(highpass(luminanceField(raster(w, h, (x, y) => ((x + y) % 2 ? 200 : 60))), w, h), w, h, 1)
    const bright = dots[(8 * w + 7) * 4 + 1]!, dark = dots[(8 * w + 8) * 4 + 1]!
    expect(bright).toBeLessThan(dark)
  })
})
