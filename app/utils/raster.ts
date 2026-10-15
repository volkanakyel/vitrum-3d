import type { TraceSource, TracedPolygon } from './trace'

/**
 * Raster primitives shared by the tracer, the relief, the surface maps and the print texture.
 * Everything here runs on the main thread and inside the trace worker (no `document` there).
 */

/** Any traced outline in its raster's pixel space: the print trace or a relief cut mask. */
export interface Outline {
  polygons: TracedPolygon[]
  width: number
  height: number
}

/** Pixel size of a trace source; an image element reports its intrinsic size. */
export function sourceSize(img: TraceSource): [number, number] {
  if ('naturalWidth' in img) return [img.naturalWidth || img.width, img.naturalHeight || img.height]
  return [img.width, img.height]
}

/** A sized `<canvas>`; main thread only. */
export function domCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** A 2D canvas that works on the main thread and inside a worker. */
export function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof document !== 'undefined' ? domCanvas(w, h) : new OffscreenCanvas(w, h)
}

/** sRGB-encoded channel (0..1) to linear light. */
export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** The minimal path API shared by a 2D context and `Path2D`. */
interface PathSink {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
}

/** Add every ring of `polygons` to a path as closed subpaths, each point scaled by `kx`/`ky`. */
export function pathPolygons(sink: PathSink, polygons: readonly TracedPolygon[], kx = 1, ky = 1): void {
  for (const poly of polygons) {
    for (const ring of [poly.exterior, ...poly.holes]) {
      ring.forEach(([x, y], i) => (i ? sink.lineTo(x * kx, y * ky) : sink.moveTo(x * kx, y * ky)))
      sink.closePath()
    }
  }
}

/** The outline filled into a w×h grid (even-odd, so counters are holes): 1 inside, 0 outside. */
export function rasterizeOutline(outline: Outline, w: number, h: number): Uint8Array {
  const ctx = makeCanvas(w, h).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ctx.beginPath()
  pathPolygons(ctx, outline.polygons, w / outline.width, h / outline.height)
  ctx.fillStyle = '#000'
  ctx.fill('evenodd')
  const alpha = ctx.getImageData(0, 0, w, h).data
  const out = new Uint8Array(w * h)
  for (let i = 0, p = 3; i < out.length; i++, p += 4) out[i] = alpha[p]! > 127 ? 1 : 0
  return out
}

/** Three box passes ≈ Gaussian, separable, in place. */
export function gaussianBlur(f: Float32Array, w: number, h: number, sigma: number): void {
  const r = Math.max(1, Math.round(sigma * 0.9))
  const tmp = new Float32Array(f.length)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w
      let acc = 0
      for (let x = -r; x <= r; x++) acc += f[row + Math.min(w - 1, Math.max(0, x))]!
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (2 * r + 1)
        acc += f[row + Math.min(w - 1, x + r + 1)]! - f[row + Math.max(0, x - r)]!
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!
      for (let y = 0; y < h; y++) {
        f[y * w + x] = acc / (2 * r + 1)
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!
      }
    }
  }
}

/**
 * Exact Euclidean distance from every inside point to the nearest outside point (Felzenszwalb &
 * Huttenlocher's separable parabola transform). Outside points and the grid border count as
 * distance 0 so a silhouette touching the edge still rounds off there.
 */
export function distanceToEdge(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e12
  const f = new Float32Array(w * h)
  for (let i = 0; i < f.length; i++) f[i] = mask[i] ? INF : 0
  const n = Math.max(w, h)
  const d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1), g = new Float32Array(n)
  const edt1d = (len: number, stride: number, offset: number) => {
    for (let q = 0; q < len; q++) g[q] = f[offset + q * stride]!
    // Border pixel sees the outside right next to it.
    g[0] = Math.min(g[0]!, 1); g[len - 1] = Math.min(g[len - 1]!, 1)
    let k = 0
    v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < len; q++) {
      let s = ((g[q]! + q * q) - (g[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
      while (s <= z[k]!) { k--; s = ((g[q]! + q * q) - (g[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!) }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < len; q++) {
      while (z[k + 1]! < q) k++
      d[q] = (q - v[k]!) * (q - v[k]!) + g[v[k]!]!
    }
    for (let q = 0; q < len; q++) f[offset + q * stride] = d[q]!
  }
  for (let y = 0; y < h; y++) edt1d(w, 1, y * w)
  for (let x = 0; x < w; x++) edt1d(h, w, x)
  for (let i = 0; i < f.length; i++) f[i] = Math.sqrt(f[i]!)
  return f
}
