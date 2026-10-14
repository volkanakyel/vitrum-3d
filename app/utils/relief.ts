import * as THREE from 'three'
import { distanceToEdge, gaussianBlur, rasterizeOutline, srgbToLinear, type Outline } from './raster'
import { rasterize, type Crop, type PixelBox, type TraceSource } from './trace'

/**
 * Relief: a per-pixel height field read straight from the picture, so any image (a photo, a
 * painting, a gradient logo) becomes a detailed solid without a silhouette trace deciding what
 * is "logo" and what is not. The colours stay on the surface as a texture.
 */
export type HeightSource = 'luminance' | 'layers' | 'flat'

export interface ReliefOptions {
  /** Longest side of the height grid in px: one vertex per pixel. */
  resolution: number
  /**
   * Inflate: the silhouette is puffed into a rounded volume (front and mirrored back) from its
   * distance field, so a photographed object reads as a solid from every angle. Off: a relief
   * on a slab.
   */
  inflate: boolean
  /** Inflate: share of the half-width over which the rim rounds off; 1 = full dome, 0.3 = pillow. */
  roundness: number
  /** Inflate: how much the picture's shading dents the surface (0..1). */
  detail: number
  source: HeightSource
  /** Dark pixels rise instead of light ones. */
  invert: boolean
  /** Gaussian smoothing radius in grid px; 0 keeps every pixel. */
  smooth: number
  /** Gamma on the height: <1 lifts the mid-tones, >1 pushes them down. */
  contrast: number
  /** Number of steps for the `layers` source (2..16). */
  layers: number
  /** Cut the solid to the traced silhouette (needs a trace); off keeps the whole picture. */
  cutout: boolean
}

export const DEFAULT_RELIEF_OPTIONS: ReliefOptions = {
  resolution: 512,
  inflate: false,
  roundness: 0.6,
  detail: 0.35,
  source: 'luminance',
  invert: false,
  smooth: 1,
  contrast: 1,
  layers: 6,
  cutout: false,
}

/** What the worker sends back: a height grid plus which grid points belong to the model. */
export interface ReliefData {
  width: number
  height: number
  /** Height in [0,1] per grid point, row-major, y down like the image. */
  heights: Float32Array
  /** 1 where the point is part of the model. `null` = everything. */
  mask: Uint8Array | null
  /** Grid-point bounds of the model (the mask's box, or the whole grid). */
  bbox: PixelBox
  /** Source region the grid covers (fractions of the source). */
  crop: Crop
  /** Back face mirrors the front (inflated volume) instead of being flat. */
  mirror: boolean
}

/** The silhouette, in the trace raster's pixel space, used to cut the relief. */
export type ReliefMask = Outline

export function computeRelief(
  img: TraceSource,
  opts: ReliefOptions,
  crop: Crop,
  mask: ReliefMask | null,
): ReliefData {
  const data = rasterize(img, opts.resolution, crop)
  if (opts.inflate && mask && mask.polygons.length) return inflate(data, opts, crop, mask)
  const { width: w, height: h } = data
  const heights = new Float32Array(w * h)
  if (opts.source !== 'flat') {
    linearLuminance(data.data, heights, opts.invert)
    if (opts.smooth > 0) gaussianBlur(heights, w, h, opts.smooth)
    stretch(heights)
    const gamma = opts.contrast
    if (Math.abs(gamma - 1) > 1e-3) for (let i = 0; i < heights.length; i++) heights[i] = Math.pow(heights[i]!, gamma)
    if (opts.source === 'layers') {
      const n = Math.max(2, Math.round(opts.layers))
      for (let i = 0; i < heights.length; i++) heights[i] = Math.min(n - 1, Math.floor(heights[i]! * n)) / (n - 1)
    }
  }

  let maskGrid: Uint8Array | null = null
  if (opts.cutout && mask && mask.polygons.length) {
    maskGrid = rasterizeOutline(mask, w, h)
    for (let i = 0; i < heights.length; i++) if (!maskGrid[i]) heights[i] = 0
  }
  return { width: w, height: h, heights, mask: maskGrid, bbox: maskBounds(maskGrid, w, h), crop, mirror: false }
}

/**
 * Puff the silhouette: every point rises with its distance from the outline on a circular
 * profile (`sqrt(1 - (1 - t)²)`, t = distance / rounding radius), which is what a real rounded
 * object's cross-section looks like. The picture's shading then dents the surface a little so
 * a drawn crease or a shadowed fold reads as a crease or a fold. The back mirrors the front.
 */
function inflate(data: ImageData, opts: ReliefOptions, crop: Crop, mask: ReliefMask): ReliefData {
  const { width: w, height: h } = data
  const maskGrid = rasterizeOutline(mask, w, h)
  const dist = distanceToEdge(maskGrid, w, h)
  const bbox = maskBounds(maskGrid, w, h)
  // Rounding radius: a share of the object's half-width, so a thin handle and a fat body on the
  // same object both round over their own width, not the slab's.
  let dMax = 0
  for (let i = 0; i < dist.length; i++) if (dist[i]! > dMax) dMax = dist[i]!
  const radius = Math.max(1, dMax * Math.max(0.05, Math.min(1, opts.roundness)))
  const heights = new Float32Array(w * h)
  for (let i = 0; i < heights.length; i++) {
    if (!maskGrid[i]) continue
    const t = Math.min(1, dist[i]! / radius)
    heights[i] = Math.sqrt(1 - (1 - t) * (1 - t))
  }
  if (opts.detail > 0) {
    // Shading as dents: dark pixels sink by up to `detail` × 30% of the local height.
    const lum = linearLuminance(data.data, new Float32Array(w * h))
    if (opts.smooth > 0) gaussianBlur(lum, w, h, opts.smooth)
    stretch(lum)
    const k = 0.3 * opts.detail
    for (let i = 0; i < heights.length; i++) heights[i] = heights[i]! * (1 - k * (1 - lum[i]!))
  }
  return { width: w, height: h, heights, mask: maskGrid, bbox, crop, mirror: true }
}

function maskBounds(mask: Uint8Array | null, w: number, h: number): PixelBox {
  if (!mask) return { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 }
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX < 0) return { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 }
  return { minX, minY, maxX, maxY }
}

/**
 * Linear-light luminance per pixel into `out` (optionally inverted), transparent pixels
 * composited over white, the most common page. Linear light maps gradients and shading to
 * height evenly.
 */
function linearLuminance(px: Uint8ClampedArray, out: Float32Array, invert = false): Float32Array {
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = px[p + 3]! / 255
    const r = px[p]! * a + 255 * (1 - a)
    const g = px[p + 1]! * a + 255 * (1 - a)
    const b = px[p + 2]! * a + 255 * (1 - a)
    const lum = 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255)
    out[i] = invert ? 1 - lum : lum
  }
  return out
}

/** Stretch to [0,1] between the 0.5th and 99.5th percentile so one hot pixel cannot flatten the rest. */
function stretch(f: Float32Array) {
  const bins = 2048
  const hist = new Uint32Array(bins)
  for (let i = 0; i < f.length; i++) {
    const bin = Math.min(bins - 1, Math.max(0, (f[i]! * (bins - 1)) | 0))
    hist[bin] = hist[bin]! + 1
  }
  const n = f.length
  let lo = 0, hi = bins - 1, acc = 0
  for (let i = 0; i < bins; i++) { acc += hist[i]!; if (acc >= n * 0.005) { lo = i; break } }
  acc = 0
  for (let i = bins - 1; i >= 0; i--) { acc += hist[i]!; if (acc >= n * 0.005) { hi = i; break } }
  const a = lo / (bins - 1), b = hi / (bins - 1)
  if (b - a < 0.02) return
  const k = 1 / (b - a)
  for (let i = 0; i < f.length; i++) f[i] = Math.min(1, Math.max(0, (f[i]! - a) * k))
}

export interface ReliefBuild {
  /** Width of the model itself (the mask's box, not the picture around it). */
  widthMm: number
  /** Thickness of the flat slab under the relief; ignored when the back mirrors the front. */
  baseMm: number
  /** Height of the relief above the slab (or above the mid-plane, mirrored) at height 1. */
  reliefMm: number
}

/** Millimetres per grid step so the model's own box is exactly `widthMm` wide. */
export function reliefScale(d: ReliefData, widthMm: number): number {
  return widthMm / Math.max(1, d.bbox.maxX - d.bbox.minX)
}

/** Height / width of the model's box. */
export function reliefAspect(d: ReliefData): number {
  return Math.max(1, d.bbox.maxY - d.bbox.minY) / Math.max(1, d.bbox.maxX - d.bbox.minX)
}

/**
 * A watertight solid from the height grid: displaced top, flat bottom, and walls wherever the
 * mask (or the grid edge) ends. Top normals come from the height field itself, so shading is
 * as fine as the grid; walls carry their own vertices so the rim stays crisp.
 */
export function buildReliefGeometry(d: ReliefData, b: ReliefBuild): THREE.BufferGeometry {
  const { width: w, height: h, heights, mask, mirror } = d
  const sx = reliefScale(d, b.widthMm), sy = sx
  const W = sx * (w - 1), H = sy * (h - 1)
  const inside = (x: number, y: number) => (mask ? mask[y * w + x]! === 1 : true)
  // A cell is solid when all four of its corners are.
  const cw = w - 1, ch = h - 1
  const cell = new Uint8Array(cw * ch)
  let cells = 0
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    if (inside(x, y) && inside(x + 1, y) && inside(x, y + 1) && inside(x + 1, y + 1)) { cell[y * cw + x] = 1; cells++ }
  }
  const cellAt = (x: number, y: number) => x >= 0 && y >= 0 && x < cw && y < ch && cell[y * cw + x] === 1

  // Walls: every cell edge with a solid cell on exactly one side.
  let walls = 0
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    if (!cell[y * cw + x]) continue
    if (!cellAt(x - 1, y)) walls++
    if (!cellAt(x + 1, y)) walls++
    if (!cellAt(x, y - 1)) walls++
    if (!cellAt(x, y + 1)) walls++
  }

  const n = w * h
  const vCount = n * 2 + walls * 4
  const pos = new Float32Array(vCount * 3)
  const nor = new Float32Array(vCount * 3)
  const uv = new Float32Array(vCount * 2)
  const idx = new Uint32Array(cells * 12 + walls * 6)

  const zTop = (i: number) => (mirror ? 0 : b.baseMm) + heights[i]! * b.reliefMm
  const zBot = (i: number) => (mirror ? -heights[i]! * b.reliefMm : 0)
  // Top and bottom vertices, one per grid point.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const px = -W / 2 + x * sx, py = H / 2 - y * sy
      const u = x / (w - 1), v = 1 - y / (h - 1)
      const t = i * 3, bt = (n + i) * 3
      pos[t] = px; pos[t + 1] = py; pos[t + 2] = zTop(i)
      pos[bt] = px; pos[bt + 1] = py; pos[bt + 2] = zBot(i)
      uv[i * 2] = u; uv[i * 2 + 1] = v
      uv[(n + i) * 2] = u; uv[(n + i) * 2 + 1] = v
      // Height-field normal by central differences (one-sided at the rim).
      const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x
      const yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y
      const dzdx = (zTop(y * w + xr) - zTop(y * w + xl)) / ((xr - xl) * sx || 1)
      const dzdy = (zTop(yu * w + x) - zTop(yd * w + x)) / ((yd - yu) * sy || 1)
      const len = Math.hypot(dzdx, dzdy, 1)
      nor[t] = -dzdx / len; nor[t + 1] = -dzdy / len; nor[t + 2] = 1 / len
      // The back is the front mirrored through the mid-plane: same in-plane tilt, z flipped.
      if (mirror) { nor[bt] = -dzdx / len; nor[bt + 1] = -dzdy / len; nor[bt + 2] = -1 / len }
      else { nor[bt] = 0; nor[bt + 1] = 0; nor[bt + 2] = -1 }
    }
  }

  let k = 0
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (!cell[y * cw + x]) continue
      const a = y * w + x, bb = a + 1, c = a + w, dd = c + 1
      // Split along the diagonal with the smaller height difference: ridges and creases in
      // the picture then follow the triangle edges instead of being sawn across.
      const ad = Math.abs(heights[a]! - heights[dd]!), bc = Math.abs(heights[bb]! - heights[c]!)
      if (ad <= bc) {
        idx[k++] = a; idx[k++] = c; idx[k++] = dd
        idx[k++] = a; idx[k++] = dd; idx[k++] = bb
        idx[k++] = n + a; idx[k++] = n + dd; idx[k++] = n + c
        idx[k++] = n + a; idx[k++] = n + bb; idx[k++] = n + dd
      } else {
        idx[k++] = a; idx[k++] = c; idx[k++] = bb
        idx[k++] = bb; idx[k++] = c; idx[k++] = dd
        idx[k++] = n + a; idx[k++] = n + bb; idx[k++] = n + c
        idx[k++] = n + bb; idx[k++] = n + dd; idx[k++] = n + c
      }
    }
  }

  // Walls: a quad from the top edge down to the bottom edge, facing the missing neighbour.
  let wv = n * 2
  const wall = (p: number, q: number, ox: number, oy: number) => {
    // p→q is the top edge; outward normal is (ox, oy, 0) in the plane, tilted by nothing.
    const verts = [p, q, n + q, n + p]
    for (let j = 0; j < 4; j++) {
      const src = verts[j]! * 3, dst = (wv + j) * 3
      pos[dst] = pos[src]!; pos[dst + 1] = pos[src + 1]!; pos[dst + 2] = pos[src + 2]!
      nor[dst] = ox; nor[dst + 1] = oy; nor[dst + 2] = 0
      const su = verts[j]! * 2, du = (wv + j) * 2
      uv[du] = uv[su]!; uv[du + 1] = uv[su + 1]!
    }
    // Winding so the face normal agrees with (ox, oy).
    const ax = pos[(wv + 1) * 3]! - pos[wv * 3]!, ay = pos[(wv + 1) * 3 + 1]! - pos[wv * 3 + 1]!
    // (q - p) × (q_bottom - p) ∝ (-ay, ax, 0); flip when that points into the solid.
    const flip = -ay * ox + ax * oy < 0
    if (!flip) {
      idx[k++] = wv; idx[k++] = wv + 1; idx[k++] = wv + 2
      idx[k++] = wv; idx[k++] = wv + 2; idx[k++] = wv + 3
    } else {
      idx[k++] = wv; idx[k++] = wv + 2; idx[k++] = wv + 1
      idx[k++] = wv; idx[k++] = wv + 3; idx[k++] = wv + 2
    }
    wv += 4
  }
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (!cell[y * cw + x]) continue
      const a = y * w + x, bb = a + 1, c = a + w, dd = c + 1
      if (!cellAt(x - 1, y)) wall(a, c, -1, 0)
      if (!cellAt(x + 1, y)) wall(bb, dd, 1, 0)
      if (!cellAt(x, y - 1)) wall(a, bb, 0, 1)
      if (!cellAt(x, y + 1)) wall(c, dd, 0, -1)
    }
  }

  // Grid points outside the mask own no triangle; park them on a used point so the bounding
  // box (which reads every vertex) hugs the model, not the whole picture.
  if (mask) {
    let anchor = -1
    for (let i = 0; i < n && anchor < 0; i++) if (mask[i]) anchor = i
    if (anchor >= 0) {
      for (let i = 0; i < n; i++) {
        if (mask[i]) continue
        for (const j of [i, n + i]) {
          const s = (j < n ? anchor : n + anchor) * 3, t = j * 3
          pos[t] = pos[s]!; pos[t + 1] = pos[s + 1]!; pos[t + 2] = pos[s + 2]!
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, k), 1))
  geo.computeBoundingBox()
  return geo
}
