import { distanceToEdge, domCanvas, rasterizeOutline, sourceSize, type Outline } from './raster'
import type { Crop, TraceResult } from './trace'

/** What the print textures sample: the imported image, or a sample drawn to a canvas. */
type PrintSource = HTMLImageElement | HTMLCanvasElement

/**
 * The source pixels a crop covers and the canvas size that holds them at native resolution,
 * never upsampled past `maxSize` on the longer side.
 */
function cropRegion(img: PrintSource, crop: Crop, maxSize: number) {
  const [iw, ih] = sourceSize(img)
  const sx = crop.x * iw, sy = crop.y * ih, sw = crop.w * iw, sh = crop.h * ih
  const k = Math.min(1, maxSize / Math.max(sw, sh))
  return { sx, sy, sw, sh, w: Math.max(2, Math.round(sw * k)), h: Math.max(2, Math.round(sh * k)) }
}

/** The source region as it is, at native resolution (capped): the Relief without a cutout. */
export function buildCropTexture(img: PrintSource, crop: Crop, maxSize = 2048): HTMLCanvasElement {
  const { sx, sy, sw, sh, w, h } = cropRegion(img, crop, maxSize)
  const c = domCanvas(w, h)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  // Composite over white so transparent PNG areas print as page, not black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height)
  return c
}

/**
 * Texture for the Print finish: the source image at native resolution, with the traced
 * silhouette's colours pushed outward into the page so extrusion walls and bevels that sample
 * near the outline never pick up a white or transparent fringe.
 */
export function buildPrintTexture(img: PrintSource, trace: TraceResult, maxSize = 2048): HTMLCanvasElement {
  // The texture covers the same region the trace raster does (the artwork crop when the tracer
  // zoomed in), at the source's own pixels.
  const { sx, sy, sw, sh, w, h } = cropRegion(img, trace.crop, maxSize)
  const src = domCanvas(w, h)
  const sctx = src.getContext('2d', { willReadFrequently: true })!
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
  return padSilhouette(src, trace)
}

/**
 * Push a silhouette's colours outward into the page. The mask is the outline itself, eroded by
 * ~5 trace pixels so anti-aliased edge pixels, JPEG ringing and the edge's own shadow line fall
 * outside and get padded over with clean interior colour. The padding is done on the GPU via
 * canvas compositing: the masked image is stamped under itself in rings of growing radius, then
 * flattened onto the average silhouette colour for anything further away.
 */
function padSilhouette(src: HTMLCanvasElement, outline: Outline): HTMLCanvasElement {
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
  const masked = domCanvas(w, h)
  for (let i = 0, p = 3; i < eroded.length; i++, p += 4) px[p] = eroded[i] ? 255 : 0
  masked.getContext('2d')!.putImageData(data, 0, 0)

  const out = domCanvas(w, h)
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
  return out
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
