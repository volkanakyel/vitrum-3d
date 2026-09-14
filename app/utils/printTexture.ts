import type { Crop, TraceResult } from './trace'

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

/**
 * Texture for the Print finish: the source image at native resolution, with the traced
 * silhouette's colours pushed outward into the page so extrusion walls and bevels that sample
 * near the outline never pick up a white or transparent fringe.
 *
 * The padding is done on the GPU via canvas compositing: the masked image is stamped under
 * itself in rings of growing radius, then the whole thing is flattened onto the average
 * silhouette colour for anything further away.
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
  const data = sctx.getImageData(0, 0, w, h)

  // Mask at texture resolution: the traced polygons themselves (even-odd, so counters are
  // holes and "fill holes" is respected), eroded by ~3 trace pixels so anti-aliased edge pixels
  // and JPEG ringing fall outside and get padded over with clean interior colour.
  const mctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  mctx.canvas.width = w
  mctx.canvas.height = h
  const kx = w / trace.width, ky = h / trace.height
  const path = new Path2D()
  for (const poly of trace.polygons) {
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
  const erodePx = Math.max(2, Math.round(kx * 3))
  const eroded = erode(mask, w, h, erodePx)

  // Average silhouette colour, used as the far-field fill.
  let sr = 0, sg = 0, sb = 0, n = 0
  const px = data.data
  for (let i = 0, p = 0; i < eroded.length; i++, p += 4) {
    if (!eroded[i]) continue
    sr += px[p]!; sg += px[p + 1]!; sb += px[p + 2]!; n++
  }
  const avg = n ? `rgb(${Math.round(sr / n)},${Math.round(sg / n)},${Math.round(sb / n)})` : '#808080'

  // Masked image: alpha = eroded mask.
  for (let i = 0, p = 3; i < eroded.length; i++, p += 4) px[p] = eroded[i] ? 255 : 0
  sctx.putImageData(data, 0, 0)

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  // Rings of offsets stamped underneath: 8 directions per radius, radii growing geometrically.
  ctx.globalCompositeOperation = 'destination-over'
  const radii = [1, 2, 3, 5, 8, 12, 18, 27, 40].map(r => Math.round(r * (w / 1024))).filter(r => r >= 1)
  for (const r of radii) {
    for (let d = 0; d < 16; d++) {
      const a = (d / 16) * Math.PI * 2
      ctx.drawImage(src, Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r))
    }
  }
  ctx.fillStyle = avg
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
  return out
}

/** Binary erosion with a square structuring element of the given radius. */
function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = mask
  for (let pass = 0; pass < r; pass++) {
    const next = new Uint8Array(cur.length)
    for (let y = 0; y < h; y++) {
      const up = y > 0 ? y - 1 : y, down = y < h - 1 ? y + 1 : y
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (!cur[i]) continue
        const l = x > 0 ? x - 1 : x, rr = x < w - 1 ? x + 1 : x
        if (cur[up * w + x] && cur[down * w + x] && cur[y * w + l] && cur[y * w + rr]) next[i] = 1
      }
    }
    cur = next
  }
  return cur
}
