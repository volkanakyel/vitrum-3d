import { domCanvas, gaussianBlur, srgbToLinear } from './raster'

/**
 * Surface maps for the Color finish, read from the picture itself. A photo carries three things
 * a renderer wants apart: its colour, the light that fell on it, and its grain. This splits
 * them the way a hand-authored PBR material would:
 *
 * - **albedo**: the picture with its baked lighting divided out (`flatten`), so the studio's
 *   own lights shade the volume instead of re-lighting a shadow that is already painted on.
 * - **normal**: a tangent-space map from the high-pass luminance, so weave, brush marks and
 *   pores catch the light at any grid resolution without costing a vertex.
 * - **roughness**: the same grain as a gloss variation: bright thread tops a touch glossier,
 *   the way fabric and paper read (three multiplies it by the material's roughness).
 *
 * The maths is pure array work so it runs in a test and could move to a worker; the canvas
 * wrapper at the bottom is the only DOM-bound part.
 */
export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface SurfaceOptions {
  /** 0..1: how much of the picture's own shading is divided out of the albedo. */
  flatten: number
  /** 0..1: strength of the grain in the normal and roughness maps. */
  grain: number
}

/** sRGB → linear lookup for 8-bit channels. */
const TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255))
/** The strongest lift `delightGain` gives a shadow; the gain canvas stores gain / MAX_GAIN. */
const MAX_GAIN = 2.5

const toSRGB = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

/** Linear-light luminance per pixel, transparent pixels composited over white. */
export function luminanceField(r: Raster): Float32Array {
  const px = r.data
  const lum = new Float32Array(r.width * r.height)
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const a = px[p + 3]! / 255
    const l = 0.2126 * TO_LINEAR[px[p]!]! + 0.7152 * TO_LINEAR[px[p + 1]!]! + 0.0722 * TO_LINEAR[px[p + 2]!]!
    lum[i] = l * a + (1 - a)
  }
  return lum
}

/**
 * Per-pixel gain that flattens the low-frequency lighting: the mean brightness over the local
 * brightness, blended toward 1 by `1 - amount`. Radius is a share of the picture so a small
 * fold darkens the albedo (it is detail) while the broad side-to-side falloff is removed.
 */
export function delightGain(lum: Float32Array, w: number, h: number, amount: number): Float32Array {
  const low = Float32Array.from(lum)
  gaussianBlur(low, w, h, Math.max(2, Math.max(w, h) / 18))
  let mean = 0
  for (let i = 0; i < low.length; i++) mean += low[i]!
  mean /= low.length
  const gain = new Float32Array(low.length)
  for (let i = 0; i < low.length; i++) {
    const g = mean / Math.max(low[i]!, 0.02)
    // Deep shadows would blow out; a 2.5× lift is as far as a photo's noise floor allows.
    gain[i] = 1 + (Math.min(MAX_GAIN, Math.max(0.5, g)) - 1) * amount
  }
  return gain
}

/** Multiply the colour of every pixel by `gain` (same size), in linear light, in place. */
export function applyGain(r: Raster, gain: Float32Array): void {
  const px = r.data
  for (let i = 0, p = 0; i < gain.length; i++, p += 4) {
    const g = gain[i]!
    if (Math.abs(g - 1) < 1e-3) continue
    for (let c = 0; c < 3; c++) {
      const v = Math.min(1, TO_LINEAR[px[p + c]!]! * g)
      px[p + c] = Math.round(toSRGB(v) * 255)
    }
  }
}

/**
 * Luminance minus its 1.5 px blur: the grain, with the shading taken out. Steps of one 8-bit
 * level (the banding of a smooth gradient) fall under a small floor so they do not turn into
 * stripes in the normal map.
 */
export function highpass(lum: Float32Array, w: number, h: number, floor = 0.0035): Float32Array {
  const low = Float32Array.from(lum)
  gaussianBlur(low, w, h, 1.5)
  const hp = new Float32Array(lum.length)
  for (let i = 0; i < hp.length; i++) {
    const d = lum[i]! - low[i]!
    hp[i] = Math.abs(d) <= floor ? 0 : d - Math.sign(d) * floor
  }
  return hp
}

/**
 * Tangent-space normal map from the grain as a height field, Sobel-filtered, +Y up in UV space
 * (the geometry's V runs up while image rows run down, so the y slope flips). RGBA bytes.
 */
export function grainNormal(hp: Float32Array, w: number, h: number, strength: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4)
  // Grain is a few percent of luminance; scale it into a slope that reads at `strength` 1.
  const k = strength * 40
  for (let y = 0; y < h; y++) {
    const yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1)
    for (let x = 0; x < w; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1)
      const tl = hp[yu * w + xl]!, t = hp[yu * w + x]!, tr = hp[yu * w + xr]!
      const l = hp[y * w + xl]!, r = hp[y * w + xr]!
      const bl = hp[yd * w + xl]!, b = hp[yd * w + x]!, br = hp[yd * w + xr]!
      const dx = (tr + 2 * r + br - tl - 2 * l - bl) / 8
      const dy = (bl + 2 * b + br - tl - 2 * t - tr) / 8
      const nx = -dx * k, ny = dy * k
      const len = Math.hypot(nx, ny, 1)
      const o = (y * w + x) * 4
      out[o] = Math.round((nx / len * 0.5 + 0.5) * 255)
      out[o + 1] = Math.round((ny / len * 0.5 + 0.5) * 255)
      out[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255)
      out[o + 3] = 255
    }
  }
  return out
}

/**
 * Roughness multiplier map around 1: bright grain (thread tops, paper fibres) a little glossier,
 * dark grain rougher. Written to every channel; three reads the green one.
 */
export function grainRoughness(hp: Float32Array, w: number, h: number, strength: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4)
  const k = strength * 6
  for (let i = 0, o = 0; i < hp.length; i++, o += 4) {
    const v = Math.round(Math.min(1, Math.max(0.4, 1 - hp[i]! * k)) * 255)
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255
  }
  return out
}

export interface SurfaceCanvases {
  /** The albedo with its lighting flattened; the input canvas itself when `flatten` is 0. */
  albedo: HTMLCanvasElement
  normal: HTMLCanvasElement | null
  roughness: HTMLCanvasElement | null
}

/**
 * Build the maps from an albedo canvas. Grain maps are made at ≤ `grainSize` px (micro detail
 * needs no more and it keeps the build under ~100 ms); the flattened albedo keeps the input's
 * own resolution, with the low-pass gain upsampled through the canvas.
 */
export function buildSurfaceCanvases(albedo: HTMLCanvasElement, opts: SurfaceOptions, grainSize = 1024): SurfaceCanvases {
  const k = Math.min(1, grainSize / Math.max(albedo.width, albedo.height))
  const sw = Math.max(2, Math.round(albedo.width * k)), sh = Math.max(2, Math.round(albedo.height * k))
  const small = domCanvas(sw, sh)
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(albedo, 0, 0, sw, sh)
  const lum = luminanceField(sctx.getImageData(0, 0, sw, sh))

  let normal: HTMLCanvasElement | null = null
  let roughness: HTMLCanvasElement | null = null
  if (opts.grain > 0) {
    const hp = highpass(lum, sw, sh)
    normal = toCanvas(grainNormal(hp, sw, sh, opts.grain), sw, sh)
    roughness = toCanvas(grainRoughness(hp, sw, sh, opts.grain), sw, sh)
  }

  let out = albedo
  if (opts.flatten > 0) {
    // Gain at grain size as a grey canvas, then stretched over the full albedo: the blur is
    // the size of the picture, so nothing is lost in the resample.
    const gainBytes = greyBytes(delightGain(lum, sw, sh, opts.flatten), v => Math.round((v / MAX_GAIN) * 255))
    const gc = domCanvas(albedo.width, albedo.height)
    const gctx = gc.getContext('2d', { willReadFrequently: true })!
    gctx.imageSmoothingQuality = 'high'
    gctx.drawImage(toCanvas(gainBytes, sw, sh), 0, 0, gc.width, gc.height)
    const gpx = gctx.getImageData(0, 0, gc.width, gc.height).data
    const full = new Float32Array(gc.width * gc.height)
    for (let i = 0, o = 0; i < full.length; i++, o += 4) full[i] = (gpx[o]! / 255) * MAX_GAIN

    out = domCanvas(albedo.width, albedo.height)
    const octx = out.getContext('2d', { willReadFrequently: true })!
    octx.drawImage(albedo, 0, 0)
    const img = octx.getImageData(0, 0, out.width, out.height)
    applyGain(img, full)
    octx.putImageData(img, 0, 0)
  }
  return { albedo: out, normal, roughness }
}

/**
 * Blur a colour canvas by `amount` (0..1 → up to 2.5% of its longer side), on the GPU through
 * the canvas filter. Returns the input untouched at 0. Blur *after* the silhouette is padded,
 * or the page colour around the object bleeds into its edge.
 */
export function softenCanvas(src: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  if (amount <= 0) return src
  const r = amount * 0.025 * Math.max(src.width, src.height)
  const out = domCanvas(src.width, src.height)
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  ctx.filter = `blur(${r.toFixed(2)}px)`
  // The blur samples transparent black past the edge; draw the edges first so it samples colour.
  ctx.drawImage(src, -r, -r, src.width + 2 * r, src.height + 2 * r)
  ctx.drawImage(src, 0, 0)
  ctx.filter = 'none'
  return out
}

function toCanvas(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): HTMLCanvasElement {
  const c = domCanvas(w, h)
  c.getContext('2d')!.putImageData(new ImageData(rgba, w, h), 0, 0)
  return c
}

/** A grey, opaque RGBA image with one byte per value. */
function greyBytes(values: ArrayLike<number>, toByte: (v: number) => number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(values.length * 4)
  for (let i = 0, o = 0; i < values.length; i++, o += 4) {
    const v = toByte(values[i]!)
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255
  }
  return out
}
