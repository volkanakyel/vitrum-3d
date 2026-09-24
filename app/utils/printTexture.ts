import type { Crop, Ring, TraceResult } from './trace'
import { distanceToEdge } from './relief'

/** The source region as it is, at native resolution (capped): the Relief without a cutout. */
export function buildCropTexture(img: HTMLImageElement, crop: Crop, maxSize = 2048): HTMLCanvasElement {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const sx = crop.x * iw, sy = crop.y * ih, sw = crop.w * iw, sh = crop.h * ih
  const k = Math.min(1, maxSize / Math.max(sw, sh))
  const c = document.createElement('canvas')
  c.width = Math.max(2, Math.round(sw * k))
  c.height = Math.max(2, Math.round(sh * k))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  // Composite over white so transparent PNG areas print as page, not black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height)
  return c
}

/** Any traced outline: the print trace or a view's relief mask. */
export interface Outline {
  polygons: { exterior: Ring; holes: Ring[] }[]
  width: number
  height: number
}

/**
 * Texture for the Print finish: the source image at native resolution, with the traced
 * silhouette's colours pushed outward into the page so extrusion walls and bevels that sample
 * near the outline never pick up a white or transparent fringe.
 */
export function buildPrintTexture(img: HTMLImageElement, trace: TraceResult, maxSize = 2048): HTMLCanvasElement {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  // The texture covers the same region the trace raster does (the artwork crop when the tracer
  // zoomed in), at the source's own pixels, never upsampled past a sensible cap.
  const c = trace.crop
  const sx = c.x * iw, sy = c.y * ih, sw = c.w * iw, sh = c.h * ih
  const k = Math.min(1, maxSize / Math.max(sw, sh))
  const w = Math.max(2, Math.round(sw * k))
  const h = Math.max(2, Math.round(sh * k))

  const src = document.createElement('canvas')
  src.width = w
  src.height = h
  const sctx = src.getContext('2d', { willReadFrequently: true })!
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
  return padSilhouette(src, trace).canvas
}

/** The outline rasterised at a canvas's size: 1 inside (even-odd, so counters are holes). */
export function rasterizeOutline(outline: Outline, w: number, h: number): Uint8Array {
  const mctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  mctx.canvas.width = w
  mctx.canvas.height = h
  const kx = w / outline.width, ky = h / outline.height
  const path = new Path2D()
  for (const poly of outline.polygons) {
    for (const ring of [poly.exterior, ...poly.holes]) {
      ring.forEach(([x, y], i) => (i ? path.lineTo(x * kx, y * ky) : path.moveTo(x * kx, y * ky)))
      path.closePath()
    }
  }
  mctx.fillStyle = '#000'
  mctx.fill(path, 'evenodd')
  const mpx = mctx.getImageData(0, 0, w, h).data
  const mask = new Uint8Array(w * h)
  for (let i = 0, p = 3; i < mask.length; i++, p += 4) mask[i] = mpx[p]! > 127 ? 1 : 0
  return mask
}

/**
 * Push a silhouette's colours outward into the page. The mask is the outline itself, eroded by
 * ~5 trace pixels so anti-aliased edge pixels, JPEG ringing and the edge's own shadow line fall
 * outside and get padded over with clean interior colour. The padding is done on the GPU via canvas compositing: the masked
 * image is stamped under itself in rings of growing radius, then flattened onto the average
 * silhouette colour for anything further away. Returns the padded canvas and the mask of where
 * its colour is trustworthy (the outline plus the padding's reach).
 */
export function padSilhouette(src: HTMLCanvasElement, outline: Outline): { canvas: HTMLCanvasElement; inside: Uint8Array } {
  const w = src.width, h = src.height
  const sctx = src.getContext('2d', { willReadFrequently: true })!
  const data = sctx.getImageData(0, 0, w, h)
  const mask = rasterizeOutline(outline, w, h)
  const px = data.data
  // A traced outline can wrap a few page pixels (a jagged bottom edge over a floor shadow).
  // Anything the colour of the page's corners is page, wherever the outline put it.
  const page = pageColour(px, w, h)
  if (page) {
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      if (mask[i] && Math.abs(px[p]! - page[0]) < 12 && Math.abs(px[p + 1]! - page[1]) < 12 && Math.abs(px[p + 2]! - page[2]) < 12) mask[i] = 0
    }
  }
  // Five trace px: a photographed edge carries a shadow line and anti-aliasing that thick.
  const erodePx = Math.max(2, Math.round((w / outline.width) * 5))
  const eroded = erode(mask, w, h, erodePx)

  // Average silhouette colour, used as the far-field fill.
  let sr = 0, sg = 0, sb = 0, n = 0
  for (let i = 0, p = 0; i < eroded.length; i++, p += 4) {
    if (!eroded[i]) continue
    sr += px[p]!; sg += px[p + 1]!; sb += px[p + 2]!; n++
  }
  const avg = n ? `rgb(${Math.round(sr / n)},${Math.round(sg / n)},${Math.round(sb / n)})` : '#808080'

  // Masked image: alpha = eroded mask.
  const masked = document.createElement('canvas')
  masked.width = w
  masked.height = h
  for (let i = 0, p = 3; i < eroded.length; i++, p += 4) px[p] = eroded[i] ? 255 : 0
  masked.getContext('2d')!.putImageData(data, 0, 0)

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.drawImage(masked, 0, 0)
  // Rings of offsets stamped underneath: 16 directions per radius, radii growing geometrically.
  ctx.globalCompositeOperation = 'destination-over'
  const radii = [1, 2, 3, 5, 8, 12, 18, 27, 40].map(r => Math.round(r * (w / 1024))).filter(r => r >= 1)
  for (const r of radii) {
    for (let d = 0; d < 16; d++) {
      const a = (d / 16) * Math.PI * 2
      ctx.drawImage(masked, Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r))
    }
  }
  ctx.fillStyle = avg
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
  // Where the padded colour can be trusted: the outline grown by the padding's reach. A vertex
  // that lands on the outline itself reads padded interior
  // colour instead of being refused, which drew the outline's raster steps onto the surface.
  const inside = dilate(mask, w, h, Math.max(erodePx, Math.round(w * 0.03)))
  return { canvas: out, inside }
}

/** The page colour when the four corners agree (within a little noise); null for a busy background. */
function pageColour(px: Uint8ClampedArray, w: number, h: number): [number, number, number] | null {
  const at = (x: number, y: number) => { const p = (y * w + x) * 4; return [px[p]!, px[p + 1]!, px[p + 2]!] }
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)]
  const mean = [0, 1, 2].map(c => corners.reduce((a, k) => a + k[c]!, 0) / 4) as [number, number, number]
  const agree = corners.every(k => k.every((v, c) => Math.abs(v! - mean[c]!) < 16))
  return agree ? mean : null
}

/** Morphology through the exact distance transform: one pass whatever the radius. */
function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const d = distanceToEdge(mask, w, h)
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < out.length; i++) out[i] = d[i]! > r ? 1 : 0
  return out
}

function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1
  const d = distanceToEdge(inv, w, h)
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < out.length; i++) out[i] = d[i]! <= r ? 1 : 0
  return out
}
