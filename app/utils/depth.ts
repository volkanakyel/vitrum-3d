/**
 * Monocular depth as the carve wants it. The model returns relative inverse depth (bigger =
 * nearer) at the photo's resolution; the carve wants a small map of *nearness* in 0..1 aligned to
 * the front trace raster, defined everywhere (bilinear samples stray past the outline) and free
 * of the model's edge spikes. Pure array maths: it runs in the worker and in node tests.
 */
export interface DepthMap {
  /** Nearness, 1 nearest .. 0 farthest, row-major, `w * h`. */
  near: Float32Array
  w: number
  h: number
}

/**
 * Normalise raw relative depth to 0..1 over the silhouette, clipping `clipPct` of each tail
 * (models spike at edges). Outside the mask is 0. A flat map (no range) becomes 1 inside so the
 * carve term is a no-op rather than a cliff.
 */
export function normaliseDepth(raw: Float32Array, w: number, h: number, mask: Uint8Array, clipPct = 0.01): Float32Array {
  const n = w * h
  const inside: number[] = []
  for (let i = 0; i < n; i++) if (mask[i]) inside.push(raw[i]!)
  const near = new Float32Array(n)
  if (!inside.length) return near
  const sorted = Float32Array.from(inside).sort()
  const lo = sorted[Math.min(sorted.length - 1, Math.floor(clipPct * sorted.length))]!
  const hi = sorted[Math.max(0, Math.ceil((1 - clipPct) * sorted.length) - 1)]!
  const range = hi - lo
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    near[i] = range < 1e-6 ? 1 : Math.min(1, Math.max(0, (raw[i]! - lo) / range))
  }
  return near
}

/**
 * Fill every outside pixel with the value of the nearest inside pixel (multi-source breadth-first
 * flood, 4-connected), in place, so the map continues smoothly past the outline. The silhouette
 * term owns the outline itself; this only stops bilinear samples falling off a cliff.
 */
export function padDepth(near: Float32Array, w: number, h: number, mask: Uint8Array): void {
  const n = w * h
  const queue = new Int32Array(n)
  const seen = new Uint8Array(n)
  let head = 0, tail = 0
  for (let i = 0; i < n; i++) if (mask[i]) { seen[i] = 1; queue[tail++] = i }
  if (!tail) return
  while (head < tail) {
    const i = queue[head++]!
    const x = i % w, y = (i - x) / w
    const v = near[i]!
    if (x > 0 && !seen[i - 1]) { seen[i - 1] = 1; near[i - 1] = v; queue[tail++] = i - 1 }
    if (x < w - 1 && !seen[i + 1]) { seen[i + 1] = 1; near[i + 1] = v; queue[tail++] = i + 1 }
    if (y > 0 && !seen[i - w]) { seen[i - w] = 1; near[i - w] = v; queue[tail++] = i - w }
    if (y < h - 1 && !seen[i + w]) { seen[i + w] = 1; near[i + w] = v; queue[tail++] = i + w }
  }
}

/** Box-average down by an integer factor until the long side is ≤ `max`. Returns the input when it already is. */
export function shrinkDepth(near: Float32Array, w: number, h: number, max: number): DepthMap {
  const f = Math.ceil(Math.max(w, h) / max)
  if (f <= 1) return { near, w, h }
  const ow = Math.ceil(w / f), oh = Math.ceil(h / f)
  const out = new Float32Array(ow * oh)
  for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) {
    let sum = 0, cnt = 0
    for (let y = oy * f; y < Math.min(h, oy * f + f); y++) for (let x = ox * f; x < Math.min(w, ox * f + f); x++) { sum += near[y * w + x]!; cnt++ }
    out[oy * ow + ox] = sum / cnt
  }
  return { near: out, w: ow, h: oh }
}

/** Bilinear sample at a fractional column/row, clamped to the map. */
export function sampleNear(map: DepthMap, col: number, row: number): number {
  const { w, h, near } = map
  const x = Math.min(w - 1, Math.max(0, col)), y = Math.min(h - 1, Math.max(0, row))
  const x0 = Math.min(w - 1, x | 0), y0 = Math.min(h - 1, y | 0)
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const a = near[y0 * w + x0]!, b = near[y0 * w + x1]!, c = near[y1 * w + x0]!, d = near[y1 * w + x1]!
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
}
