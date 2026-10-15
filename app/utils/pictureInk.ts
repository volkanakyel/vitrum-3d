/**
 * The colours a picture actually puts on the model: up to three, top-left first. The Color
 * finish paints the model with the picture itself, so its swatches must be drawn from these, not
 * from a stock colour the model will never take.
 *
 * Transparent pixels are skipped; on an opaque picture the backdrop (read off the border) is
 * skipped too, since the traced outline cuts it away.
 */
export function pictureInk(img: HTMLImageElement): string[] {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return []
  const k = 48 / Math.max(iw, ih)
  const w = Math.max(1, Math.round(iw * k))
  const h = Math.max(1, Math.round(ih * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data

  let opaque = 0
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 200) opaque++
  // An opaque picture: the backdrop is whatever runs round its border.
  let bg: [number, number, number] | null = null
  if (opaque > w * h * 0.97) {
    const s = [0, 0, 0]
    let n = 0
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const i = (y * w + x) * 4; s[0]! += d[i]!; s[1]! += d[i + 1]!; s[2]! += d[i + 2]!; n++ }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const i = (y * w + x) * 4; s[0]! += d[i]!; s[1]! += d[i + 1]!; s[2]! += d[i + 2]!; n++ }
    bg = [s[0]! / n, s[1]! / n, s[2]! / n]
  }

  // A coarse histogram (4 bits a channel), each bucket keeping the mean of what fell in it.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number; y: number }>()
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! <= 200) continue
    const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!
    if (bg && Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < 48) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, y: 0 }
    // x + y: distance along the swatch's 135° split, so the top-left colour leads.
    const px = (i >> 2) % w, py = (i >> 2) / w | 0
    e.n++; e.r += r; e.g += g; e.b += b; e.y += px / w + py / h
    buckets.set(key, e)
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n).map(e => ({ n: e.n, at: e.y / e.n, rgb: [e.r / e.n, e.g / e.n, e.b / e.n] as const }))
  const picked: (typeof ranked)[number][] = []
  for (const e of ranked) {
    if (picked.length === 3 || (picked.length && e.n < picked[0]!.n * 0.12)) break
    if (picked.every(p => Math.hypot(p.rgb[0] - e.rgb[0], p.rgb[1] - e.rgb[1], p.rgb[2] - e.rgb[2]) > 64)) picked.push(e)
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  // Laid out as they sit in the picture, top-left first, so the sphere reads like the model.
  picked.sort((a, b) => a.at - b.at)
  return picked.map(p => `#${hex(p.rgb[0])}${hex(p.rgb[1])}${hex(p.rgb[2])}`)
}

/** True for a black, white or grey: a colour with almost no chroma. */
export function isNeutral(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return Math.max(r, g, b) - Math.min(r, g, b) < 28
}
