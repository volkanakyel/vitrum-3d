import { contours as d3Contours } from 'd3-contour'
import { gaussianBlur, makeCanvas, rasterizeOutline, sourceSize } from './raster'

export type SourceMode = 'auto' | 'dark' | 'light' | 'alpha' | 'color'
export type ResolvedMode = Exclude<SourceMode, 'auto'>

export interface TraceOptions {
  /** Longest side of the working raster, in px. */
  resolution: number
  /** Which pixels count as the logo. */
  mode: SourceMode
  /** Iso value in [0,1] used to cut the grayscale field. */
  threshold: number
  /** Ramer–Douglas–Peucker tolerance in working-raster pixels. */
  simplify: number
  /** Regions smaller than this share of the traced area are dropped as noise (0..0.2). */
  minRegion: number
  /** Ignore holes (counters) inside shapes. */
  fillHoles: boolean
  /**
   * Stack: trace the whole object (a tile, a badge, a sticker) as the base and every colour
   * region inside it as a raised layer, instead of isolating one artwork silhouette.
   */
  stack: boolean
  /** Stack: how many colours to separate the picture into (2..6). */
  stackLayers: number
}

export type Ring = [number, number][]

/** One solid region: exterior ring + hole rings, in working-raster pixel space (y down). */
export interface TracedPolygon {
  exterior: Ring
  holes: Ring[]
}

/** One colour region of a stacked trace, raised above the base. */
export interface TraceLayer {
  polygons: TracedPolygon[]
  /** Mean colour of the region, CSS hex. */
  color: string
  /** Fraction of the base area. */
  area: number
}

/** Axis-aligned box in raster px. */
export interface PixelBox { minX: number; minY: number; maxX: number; maxY: number }

export interface TraceResult {
  polygons: TracedPolygon[]
  /** Stack traces only: colour regions to raise above the base (`polygons`). */
  layers?: TraceLayer[]
  /** The page holds an object larger than the artwork (an icon on its tile); Stack suits it. */
  hasTile: boolean
  /** Working raster size. */
  width: number
  height: number
  /** Bounding box of the traced polygons in raster px. */
  bbox: PixelBox
  /** Mode actually used (resolved when `auto`). */
  resolvedMode: ResolvedMode
  /** Iso value the contour was cut at, after contrast normalisation. */
  threshold: number
  /** Estimated page background (0..255 RGB), sampled from the raster border. */
  background: [number, number, number]
  /** Fraction of the raster covered by the traced polygons. */
  coverage: number
  /** Region of the source image the raster covers, as fractions of the source (0..1). */
  crop: Crop
  /** Typical stroke width of the artwork in raster px (2·area / perimeter); guides bevel size. */
  strokeWidth: number
  /** Total vertex count after simplification. */
  vertexCount: number
  /** Distinct colours holding at least 0.1% of the pixels each; a logo has a handful, a photo dozens. */
  palette: number
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  resolution: 1024,
  mode: 'auto',
  threshold: 0.5,
  simplify: 0.6,
  minRegion: 0.002,
  fillHoles: false,
  stack: false,
  stackLayers: 3,
}

/**
 * Anything the tracer can rasterize. An image or a canvas on the main thread (the landing page
 * traces its drawn samples), an `ImageBitmap` inside the trace worker (bitmaps are transferable;
 * image elements are not).
 */
export type TraceSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap

export async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Could not decode image'))
      img.src = url
    })
  } finally {
    // Revoke after decode; the element keeps its bitmap.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/** A region of the source, as fractions of its size (0..1). */
export interface Crop { x: number; y: number; w: number; h: number }
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 }

export function rasterize(img: TraceSource, resolution: number, crop: Crop = FULL): ImageData {
  const [iw, ih] = sourceSize(img)
  const sx = crop.x * iw, sy = crop.y * ih, sw = crop.w * iw, sh = crop.h * ih
  const scale = resolution / Math.max(sw, sh)
  const w = Math.max(2, Math.round(sw * scale))
  const h = Math.max(2, Math.round(sh * scale))
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * Trace an image in two passes. The first pass finds the artwork anywhere on the page; when
 * it occupies a small part of the raster (a wordmark on a big card), the source is cropped to
 * that region and traced again at full working resolution, so outline detail scales with the
 * artwork rather than the page. The print texture follows the same crop.
 */
export function traceImage(img: TraceSource, opts: TraceOptions): TraceResult {
  const [iw, ih] = sourceSize(img)
  if (opts.stack) return traceStack(img, opts)
  // Detection at a quarter of the work: it only has to find where the artwork is and which
  // field isolates it. Every candidate field is contoured here, none at full resolution.
  const detectRes = Math.min(opts.resolution, 512)
  const detect = rasterize(img, detectRes)
  const first = traceImageData(detect, opts, undefined, detectRes / Math.max(iw, ih))
  if (!first.polygons.length) return first
  // Is the artwork sitting on something bigger (a tile, a card)? Then Stack is the geometry
  // that keeps the whole object.
  const artworkArea = first.coverage * first.width * first.height
  const outer = findOuter(detect, first.background, detectRes / Math.max(iw, ih))
  first.hasTile = !!outer && Math.abs(ringArea(outer.exterior)) > artworkArea * 1.3
  const bw = first.bbox.maxX - first.bbox.minX
  const bh = first.bbox.maxY - first.bbox.minY
  const longest = Math.max(first.width, first.height)
  let crop: Crop = FULL
  if (Math.max(bw, bh) <= longest * 0.62) {
    // Crop with a margin so the final pass still sees a little page around the artwork.
    const margin = Math.max(bw, bh) * 0.08 + 4
    const x0 = Math.max(0, first.bbox.minX - margin) / first.width
    const y0 = Math.max(0, first.bbox.minY - margin) / first.height
    const x1 = Math.min(first.width, first.bbox.maxX + margin) / first.width
    const y1 = Math.min(first.height, first.bbox.maxY + margin) / first.height
    crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }
  // Final pass: the resolved field only, at full working resolution, on the artwork region.
  const final = traceImageData(
    rasterize(img, opts.resolution, crop),
    { ...opts, mode: first.resolvedMode },
    first.background,
    opts.resolution / Math.max(crop.w * iw, crop.h * ih),
  )
  if (!final.polygons.length) return first
  final.crop = crop
  final.hasTile = first.hasTile
  return final
}

/**
 * The largest thing on the page that is not the page: alpha where the PNG has it, otherwise
 * any colour at all off the page colour (an absolute 2% threshold, so a near-white tile on a
 * white page still counts), blurred a little so anti-aliasing does not fray it. Border-touching
 * regions are the page itself and are dropped; holes are ignored (this is the outer outline).
 */
function findOuter(data: ImageData, background: [number, number, number], upscale: number): TracedPolygon | null {
  const { width, height } = data
  const alphaOk = hasUsefulAlpha(data)
  const raw = buildField(data, alphaOk ? 'alpha' : 'color', background, false)
  const field = blurField(raw, width, height, Math.max(1, (upscale - 1) * 0.28))
  // A thin band at the edge is always page: an object cropped tight on one side (an icon
  // exported to its bounds) then closes along that side instead of being thrown out as page.
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.015))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < band || y < band || x >= width - band || y >= height - band) field[y * width + x] = 0
    }
  }
  let best: TracedPolygon | null = null, bestArea = 0
  for (const poly of contourAt(field, width, height, alphaOk ? 0.5 : 0.02)) {
    const exterior = poly[0] as Ring
    if (!exterior || exterior.length < 4) continue
    const a = Math.abs(ringArea(exterior))
    if (a > bestArea) { bestArea = a; best = { exterior, holes: [] } }
  }
  return bestArea >= width * height * 0.01 ? best : null
}

/**
 * Stack trace: the whole object as the base, its colour regions as raised layers. One pass at
 * working resolution over the full picture (the base is usually most of it). The base is the
 * outer outline when the page holds one, else the artwork silhouette; the picture inside it is
 * split into `stackLayers` colours by k-means, the biggest colour is the base's own face, and
 * every other colour is contoured into a layer.
 */
function traceStack(img: TraceSource, opts: TraceOptions): TraceResult {
  const [iw, ih] = sourceSize(img)
  const data = rasterize(img, opts.resolution)
  const { width, height } = data
  const upscale = opts.resolution / Math.max(iw, ih)
  const background = estimateBackground(data)
  const artwork = traceImageData(data, { ...opts, stack: false }, background, upscale)
  const outer = findOuter(data, background, upscale)
  const artworkArea = artwork.coverage * width * height
  const useOuter = !!outer && Math.abs(ringArea(outer.exterior)) > artworkArea * 1.15
  const base: TracedPolygon[] = useOuter
    ? [{ exterior: simplifyRing(outer!.exterior, opts.simplify), holes: [] }]
    : artwork.polygons
  if (!base.length) return { ...artwork, layers: [] }

  // Base mask at raster resolution.
  const inside = rasterizeOutline({ polygons: base, width, height }, width, height)
  let baseArea = 0
  for (let i = 0; i < inside.length; i++) baseArea += inside[i]!

  // Colours inside the base, composited over the page.
  const px = data.data
  const rgb = new Float32Array(width * height * 3)
  for (let i = 0, p = 0; i < inside.length; i++, p += 4) {
    const a = px[p + 3]! / 255
    rgb[i * 3] = px[p]! * a + background[0] * (1 - a)
    rgb[i * 3 + 1] = px[p + 1]! * a + background[1] * (1 - a)
    rgb[i * 3 + 2] = px[p + 2]! * a + background[2] * (1 - a)
  }
  const k = Math.max(2, Math.min(6, Math.round(opts.stackLayers)))
  const assign = kmeans(rgb, inside, k)
  // Biggest colour is the base face; every other colour rises as a layer.
  const counts = new Array<number>(k).fill(0)
  const sums = Array.from({ length: k }, (): [number, number, number] => [0, 0, 0])
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue
    const c = assign[i]!
    counts[c]!++
    sums[c]![0] += rgb[i * 3]!; sums[c]![1] += rgb[i * 3 + 1]!; sums[c]![2] += rgb[i * 3 + 2]!
  }
  const order = counts.map((n, i) => i).sort((a, b) => counts[b]! - counts[a]!)
  const layers: TraceLayer[] = []
  const dropBelow = Math.max(baseArea * Math.max(opts.minRegion, 0.001), 12)
  for (const c of order.slice(1)) {
    if (!counts[c]) continue
    const field = new Float32Array(width * height)
    for (let i = 0; i < field.length; i++) field[i] = inside[i] && assign[i] === c ? 1 : 0
    // A touch of blur rounds the pixel staircase of a hard colour boundary before contouring.
    const smooth = blurField(field, width, height, Math.max(0.8, (upscale - 1) * 0.28))
    const polygons: TracedPolygon[] = []
    let area = 0
    for (const poly of contourAt(smooth, width, height, 0.5)) {
      const exterior = poly[0] as Ring
      if (!exterior || exterior.length < 4) continue
      const a = Math.abs(ringArea(exterior))
      if (a < dropBelow) continue
      const holes = (poly.slice(1) as Ring[]).filter(h => Math.abs(ringArea(h)) >= dropBelow).map(h => simplifyRing(h, opts.simplify)).filter(h => h.length >= 3)
      polygons.push({ exterior: simplifyRing(exterior, opts.simplify), holes: opts.fillHoles ? [] : holes })
      area += a - holesArea(holes)
    }
    if (!polygons.length) continue
    // A colour that is only ever a thin ring is the anti-aliasing between two real colours, not
    // a layer of the object: its stroke width (2·area / perimeter) is a pixel or two of source.
    const perim = perimeterOf(polygons)
    if (perim > 0 && (2 * area) / perim < upscale * 1.5) continue
    const n = counts[c]!
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0')
    layers.push({ polygons, color: `#${hex(sums[c]![0])}${hex(sums[c]![1])}${hex(sums[c]![2])}`, area: area / baseArea })
  }

  const stats = polygonStats(base)
  let vertexCount = stats.vertexCount
  for (const l of layers) for (const p of l.polygons) for (const ring of [p.exterior, ...p.holes]) vertexCount += ring.length
  return {
    polygons: base,
    layers,
    hasTile: useOuter,
    width,
    height,
    bbox: stats.bbox,
    resolvedMode: useOuter ? (hasUsefulAlpha(data) ? 'alpha' : 'color') : artwork.resolvedMode,
    threshold: opts.threshold,
    background,
    coverage: baseArea / (width * height),
    crop: { ...FULL },
    strokeWidth: stats.strokeWidth,
    vertexCount,
    palette: countPalette(data, upscale),
  }
}

/**
 * k-means on RGB over the masked pixels: centres seeded along the luminance range so a black
 * mark on a white tile splits on the first pass, eight refinement rounds on a subsample, then
 * one full assignment. Returns the cluster index per pixel (0 outside the mask).
 */
function kmeans(rgb: Float32Array, mask: Uint8Array, k: number): Uint8Array {
  const n = mask.length
  const idx: number[] = []
  for (let i = 0; i < n; i++) if (mask[i]) idx.push(i)
  const step = Math.max(1, Math.floor(idx.length / 40000))
  const sample = idx.filter((_, j) => j % step === 0)
  const lum = (i: number) => 0.2126 * rgb[i * 3]! + 0.7152 * rgb[i * 3 + 1]! + 0.0722 * rgb[i * 3 + 2]!
  const sorted = [...sample].sort((a, b) => lum(a) - lum(b))
  const centres: [number, number, number][] = []
  for (let c = 0; c < k; c++) {
    const i = sorted[Math.min(sorted.length - 1, Math.floor(((c + 0.5) / k) * sorted.length))]!
    centres.push([rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!])
  }
  const nearest = (i: number) => {
    let best = 0, bd = Infinity
    for (let c = 0; c < k; c++) {
      const dr = rgb[i * 3]! - centres[c]![0], dg = rgb[i * 3 + 1]! - centres[c]![1], db = rgb[i * 3 + 2]! - centres[c]![2]
      const d = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db
      if (d < bd) { bd = d; best = c }
    }
    return best
  }
  for (let round = 0; round < 8; round++) {
    const acc = new Float64Array(k * 4)
    for (const i of sample) {
      const c = nearest(i) * 4
      acc[c] = acc[c]! + rgb[i * 3]!
      acc[c + 1] = acc[c + 1]! + rgb[i * 3 + 1]!
      acc[c + 2] = acc[c + 2]! + rgb[i * 3 + 2]!
      acc[c + 3] = acc[c + 3]! + 1
    }
    for (let c = 0; c < k; c++) {
      const n = acc[c * 4 + 3]!
      if (n) centres[c] = [acc[c * 4]! / n, acc[c * 4 + 1]! / n, acc[c * 4 + 2]! / n]
    }
  }
  const out = new Uint8Array(n)
  for (const i of idx) out[i] = nearest(i)
  return out
}

/**
 * Estimate the page background from the outer 2px frame of the raster: the median of each
 * channel, so a logo touching one edge cannot pull the estimate toward itself.
 */
function estimateBackground(data: ImageData): [number, number, number] {
  const { width, height } = data
  const px = data.data
  const r: number[] = [], g: number[] = [], b: number[] = []
  const take = (x: number, y: number) => {
    const p = (y * width + x) * 4
    if (px[p + 3]! < 128) return
    r.push(px[p]!); g.push(px[p + 1]!); b.push(px[p + 2]!)
  }
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.01))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < band || y < band || x >= width - band || y >= height - band) take(x, y)
    }
  }
  const median = (a: number[]) => {
    if (!a.length) return 255
    a.sort((p, q) => p - q)
    return a[a.length >> 1]!
  }
  return [median(r), median(g), median(b)]
}

/**
 * Stretch a field so its 1st percentile maps to 0 and its maximum to 1. Low-contrast sources
 * (grey on off-white, faint scans) then cut cleanly at the default threshold instead of needing
 * a hand-tuned iso value. The top anchor is the maximum, not a high percentile: a wordmark can
 * be well under 1% of the page, and a percentile below it would stretch the page's own
 * texture (a card's lighter border ring) up into logo range. Alpha is absolute and left alone.
 */
function normalize(field: Float32Array): Float32Array {
  const bins = 1024
  const hist = new Uint32Array(bins)
  let max = 0
  for (let i = 0; i < field.length; i++) {
    const v = field[i]!
    const bin = Math.min(bins - 1, (v * (bins - 1)) | 0)
    hist[bin] = hist[bin]! + 1
    if (v > max) max = v
  }
  const n = field.length
  let lo = 0, acc = 0
  for (let i = 0; i < bins; i++) { acc += hist[i]!; if (acc >= n * 0.01) { lo = i; break } }
  const a = lo / (bins - 1), b = max
  if (b - a < 0.05) return field
  const k = 1 / (b - a)
  for (let i = 0; i < field.length; i++) field[i] = Math.min(1, Math.max(0, (field[i]! - a) * k))
  return field
}

/**
 * Separable blur (three box passes ≈ Gaussian) on a field. Used when the source is upscaled
 * into the working raster: the interpolated pixel grid would otherwise print its staircase into
 * every curve of the outline, and no amount of simplification straightens that honestly.
 */
function blurField(field: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma >= 0.4) gaussianBlur(field, w, h, sigma)
  return field
}

/** The iso-line of a field at `threshold`, smoothed, as d3's multipolygon coordinates. */
function contourAt(field: Float32Array, w: number, h: number, threshold: number): number[][][][] {
  const [multi] = d3Contours().size([w, h]).smooth(true).thresholds([threshold])(Array.from(field))
  return multi?.coordinates ?? []
}

/** Build a scalar field in [0,1] where 1 = "logo" for the given mode. */
function buildField(
  data: ImageData,
  mode: ResolvedMode,
  background: [number, number, number],
  stretch = true,
): Float32Array {
  const { width, height } = data
  const px = data.data
  const field = new Float32Array(width * height)
  const [br, bg, bb] = background
  // Perceptual-ish channel weights; a 0..1 distance where 1 = maximally different colour.
  const norm = 1 / Math.sqrt(0.3 * 255 * 255 + 0.59 * 255 * 255 + 0.11 * 255 * 255)
  for (let i = 0, p = 0; i < field.length; i++, p += 4) {
    const a = px[p + 3]! / 255
    if (mode === 'alpha') {
      field[i] = a
      continue
    }
    // Composite over the page first: a half-transparent edge pixel with white RGB (common at
    // rounded PNG corners) must read as mostly page, not as a bright speck.
    const r = px[p]! * a + br * (1 - a)
    const g = px[p + 1]! * a + bg * (1 - a)
    const b = px[p + 2]! * a + bb * (1 - a)
    let v: number
    if (mode === 'color') {
      const dr = r - br, dg = g - bg, db = b - bb
      v = Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db) * norm * 2.2
      if (v > 1) v = 1
    } else {
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      v = mode === 'dark' ? 1 - lum : lum
    }
    // Fully transparent pixels never count as logo, whatever the page colour.
    field[i] = a < 0.02 ? 0 : v
  }
  return stretch && mode !== 'alpha' ? normalize(field) : field
}

function hasUsefulAlpha(data: ImageData): boolean {
  const px = data.data
  let transparent = 0
  let opaque = 0
  for (let p = 3; p < px.length; p += 4) {
    if (px[p]! < 16) transparent++
    else if (px[p]! > 240) opaque++
  }
  const n = px.length / 4
  return transparent > n * 0.005 && opaque > n * 0.001
}

function ringArea(ring: Ring): number {
  let s = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]!
    const [x2, y2] = ring[(i + 1) % n]!
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

function holesArea(holes: readonly Ring[]): number {
  return holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0)
}

/** Summed edge length of every ring, exteriors and holes. */
function perimeterOf(polygons: readonly TracedPolygon[]): number {
  let perim = 0
  for (const p of polygons) for (const ring of [p.exterior, ...p.holes]) for (let i = 0; i < ring.length; i++) perim += Math.sqrt(dist2(ring[i]!, ring[(i + 1) % ring.length]!))
  return perim
}

/**
 * Bounds, vertex count and typical stroke width (2·area / perimeter) of traced polygons. An
 * empty set has an inverted (infinite) box; callers decide what that means.
 */
function polygonStats(polygons: readonly TracedPolygon[]): { bbox: PixelBox; vertexCount: number; strokeWidth: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let vertexCount = 0, areaSum = 0
  for (const p of polygons) {
    areaSum += Math.abs(ringArea(p.exterior)) - holesArea(p.holes)
    for (const ring of [p.exterior, ...p.holes]) {
      vertexCount += ring.length
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const perim = perimeterOf(polygons)
  return { bbox: { minX, minY, maxX, maxY }, vertexCount, strokeWidth: perim > 0 ? (2 * areaSum) / perim : 0 }
}

function touchesBorder(ring: Ring, w: number, h: number): boolean {
  const eps = 0.51
  for (const [x, y] of ring) {
    if (x <= eps || y <= eps || x >= w - eps || y >= h - eps) return true
  }
  return false
}

/** Ramer–Douglas–Peucker on a closed ring. */
function simplifyRing(ring: Ring, tol: number): Ring {
  if (tol <= 0 || ring.length < 4) return ring
  const pts = ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]
    ? ring.slice(0, -1)
    : ring
  if (pts.length < 4) return pts
  // Anchor on the two farthest-apart points so the closed loop simplifies symmetrically.
  let b = 0, best = -1
  for (let i = 0; i < pts.length; i++) {
    const d = dist2(pts[0]!, pts[i]!)
    if (d > best) { best = d; b = i }
  }
  const part1 = rdp(pts.slice(0, b + 1), tol)
  const part2 = rdp([...pts.slice(b), pts[0]!], tol)
  const out = [...part1.slice(0, -1), ...part2.slice(0, -1)]
  return out.length >= 3 ? out : pts
}

function dist2(p: [number, number], q: [number, number]): number {
  const dx = p[0] - q[0], dy = p[1] - q[1]
  return dx * dx + dy * dy
}

function rdp(pts: Ring, tol: number): Ring {
  if (pts.length < 3) return pts
  const first = pts[0]!, last = pts[pts.length - 1]!
  let idx = -1, maxD = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i]!, first, last)
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD > tol && idx > 0) {
    const l = rdp(pts.slice(0, idx + 1), tol)
    const r = rdp(pts.slice(idx), tol)
    return [...l.slice(0, -1), ...r]
  }
  return [first, last]
}

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.sqrt(dist2(p, a))
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  const px = a[0] + t * dx, py = a[1] + t * dy
  return Math.sqrt(dist2(p, [px, py]))
}

interface Candidate {
  mode: ResolvedMode
  polygons: TracedPolygon[]
  area: number
  /** Field the contour was cut from; used to score the candidate against the page colour. */
  field: Float32Array
}

function traceMode(
  data: ImageData,
  mode: ResolvedMode,
  threshold: number,
  dropBorder: boolean,
  background: [number, number, number],
  blur: number,
): Candidate {
  const { width, height } = data
  const field = blurField(buildField(data, mode, background), width, height, blur)
  const polygons: TracedPolygon[] = []
  const bordered: TracedPolygon[] = []
  let area = 0, borderedArea = 0
  for (const poly of contourAt(field, width, height, threshold)) {
    const exterior = poly[0] as Ring
    if (!exterior || exterior.length < 4) continue
    const holes = poly.slice(1) as Ring[]
    const a = Math.abs(ringArea(exterior)) - holesArea(holes)
    if (a < 4) continue
    if (dropBorder && touchesBorder(exterior, width, height)) {
      bordered.push({ exterior, holes })
      borderedArea += a
      continue
    }
    polygons.push({ exterior, holes })
    area += a
  }
  // Nothing survived the border filter: fall back to the border-touching regions without a
  // second contour pass.
  if (!polygons.length && bordered.length) return { mode, polygons: bordered, area: borderedArea, field }
  return { mode, polygons, area, field }
}

/**
 * Mean colour distance from the page background over the pixels a candidate claims. A region
 * that is really page colour (the white counters of a black logo, a light halo around a
 * badge) scores near zero and is not a logo, whatever its size.
 */
function distinctness(c: Candidate, colorField: Float32Array, threshold: number): number {
  let sum = 0, n = 0
  for (let i = 0; i < c.field.length; i++) {
    if (c.field[i]! >= threshold) { sum += colorField[i]!; n++ }
  }
  return n ? sum / n : 0
}

/**
 * @param upscale Working-raster px per source px. Above 1 the field is blurred by half that
 *   many px so interpolated source pixels do not stamp their grid into the outline.
 */
function traceImageData(
  data: ImageData,
  opts: TraceOptions,
  knownBackground?: [number, number, number],
  upscale = 1,
): TraceResult {
  const { width, height } = data
  const total = width * height
  const minArea = total * 0.0015
  const background = knownBackground ?? estimateBackground(data)
  const palette = countPalette(data, upscale)
  // Enough to erase the interpolated pixel grid, never enough to bridge a one-source-pixel gap.
  const blur = Math.min(3, Math.max(0, (upscale - 1) * 0.28))
  const run = (m: ResolvedMode, drop: boolean) => traceMode(data, m, opts.threshold, drop, background, blur)

  let candidates: Candidate[]
  if (opts.mode === 'auto') {
    const alphaOk = hasUsefulAlpha(data)
    // Colour distance covers what luminance cannot: a red mark on a blue page, a photo on
    // white. It is tried alongside dark/light and wins only when it finds a tighter region.
    const modes: ResolvedMode[] = alphaOk ? ['alpha', 'dark', 'light', 'color'] : ['dark', 'light', 'color']
    candidates = modes.map(m => run(m, m !== 'alpha'))
  } else {
    candidates = [run(opts.mode, opts.mode !== 'alpha')]
  }

  // Auto: drop regions that are really page colour, then take the largest of what remains —
  // the whole badge rather than one of its counters or its darkest layer.
  const colorField = buildField(data, 'color', background)
  const tooBig = total * 0.92
  const viable = candidates.filter(c =>
    c.area >= minArea && c.area <= tooBig && distinctness(c, colorField, opts.threshold) >= 0.18,
  )
  const pool = viable.length ? viable : candidates.filter(c => c.polygons.length)
  // Largest wins, but two fields that found the same artwork (within 8%) differ only in the
  // debris one of them picked up: take the one with fewer pieces.
  const chosen = pool.length
    ? pool.reduce((best, c) => {
        const close = Math.abs(c.area - best.area) < Math.max(c.area, best.area) * 0.08
        if (close) return c.polygons.length < best.polygons.length ? c : best
        return c.area > best.area ? c : best
      })
    : { mode: opts.mode === 'auto' ? 'dark' as const : opts.mode, polygons: [], area: 0 }

  // Relative floor for the user's "ignore specks", plus an absolute one: nothing under ~3.5px
  // across at working resolution is ever a feature, however small the artwork.
  const dropBelow = Math.max(chosen.area * opts.minRegion, 12)
  const polygons = chosen.polygons
    .filter(p => Math.abs(ringArea(p.exterior)) >= dropBelow)
    .map(p => ({
      exterior: simplifyRing(p.exterior, opts.simplify),
      holes: opts.fillHoles
        ? []
        : p.holes
          .filter(h => Math.abs(ringArea(h)) >= dropBelow)
          .map(h => simplifyRing(h, opts.simplify))
          .filter(h => h.length >= 3),
    }))

  const stats = polygonStats(polygons)

  return {
    polygons,
    hasTile: false,
    width,
    height,
    bbox: polygons.length ? stats.bbox : { minX: 0, minY: 0, maxX: width, maxY: height },
    resolvedMode: chosen.mode,
    threshold: opts.threshold,
    background,
    coverage: chosen.area / total,
    crop: { ...FULL },
    strokeWidth: stats.strokeWidth,
    vertexCount: stats.vertexCount,
    palette,
  }
}

/**
 * How many distinct colours the picture really uses: 4 bits per channel, counting only bins
 * that hold ≥0.1% of the pixels so anti-aliasing ramps do not count. Flat artwork lands under
 * ~15; photographs and painted illustrations run well past that.
 */
function countPalette(data: ImageData, upscale = 1): number {
  const px = data.data
  const bins = new Uint32Array(4096)
  let n = 0
  // Sample one source pixel per source pixel: an upscaled raster interpolates new in-between
  // colours along every edge, which are not colours the picture has.
  const step = Math.max(1, Math.round(upscale))
  const { width, height } = data
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const p = (y * width + x) * 4
      if (px[p + 3]! < 128) continue
      const bin = ((px[p]! >> 4) << 8) | ((px[p + 1]! >> 4) << 4) | (px[p + 2]! >> 4)
      bins[bin] = bins[bin]! + 1
      n++
    }
  }
  const floor = Math.max(2, n * 0.002)
  let count = 0
  for (let i = 0; i < bins.length; i++) if (bins[i]! >= floor) count++
  return count
}

/** Serialise the traced polygons as an SVG path (raster px space) for previews. */
export function toSvgPath(result: TraceResult): string {
  const parts: string[] = []
  for (const p of result.polygons) {
    for (const ring of [p.exterior, ...p.holes]) {
      parts.push(ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join('') + 'Z')
    }
  }
  return parts.join(' ')
}
