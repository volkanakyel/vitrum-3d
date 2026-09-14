/**
 * Sample sources drawn in code. Vitrum ships no art packs: every example on the landing page
 * and every "Try sample" in the studio is an SVG path or a canvas illustration rasterised at
 * runtime, then pushed through the same trace → build pipeline as an uploaded file.
 */

export type SampleKind = 'icon' | 'product'

export interface Sample {
  id: string
  label: string
  kind: SampleKind
  /** Material preset id from `MATERIAL_PRESETS` that suits the object. */
  preset: string
  /** Colour of the flat source when it is a mark; product samples paint their own colours. */
  ink?: string
  /** Draws the source onto a square canvas of `size` px. Must be called on the client. */
  draw: (ctx: CanvasRenderingContext2D, size: number) => void
}

/** A 100×100 SVG path drawn to fill the canvas with `pad` px of page around it. */
function mark(d: string, opts: { evenodd?: boolean; ink?: string; tile?: string } = {}) {
  return (ctx: CanvasRenderingContext2D, size: number) => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    const pad = size * 0.14
    const k = (size - pad * 2) / 100
    ctx.save()
    ctx.translate(pad, pad)
    ctx.scale(k, k)
    if (opts.tile) {
      // An app-icon tile: the mark rides on a rounded square, so the tracer keeps the tile too.
      ctx.fillStyle = opts.tile
      roundRect(ctx, 0, 0, 100, 100, 24)
      ctx.fill()
    }
    ctx.fillStyle = opts.ink ?? '#0d0e12'
    ctx.fill(new Path2D(d), opts.evenodd ? 'evenodd' : 'nonzero')
    ctx.restore()
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function starPath(points = 5, outer = 46, inner = 20, cx = 50, cy = 52): string {
  let d = ''
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer
    const a = -Math.PI / 2 + (i * Math.PI) / points
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)} `
  }
  return d + 'Z'
}

/** The Vitrum mark, scaled from its 1046×1024 box into the 100×100 frame. */
const BRAND = [
  'm7.55,852.64h0c0-94.89,76.93-171.82,171.82-171.82h164.27v-160.43h0c0-94.89-76.93-171.82-171.82-171.82h0C76.93,348.58,0,425.51,0,520.4v328.53c0,69.21,40.94,128.82,99.9,156.04-54.88-28.69-92.35-86.11-92.35-152.33Z',
  'm507.9,680.83H179.37c-94.89,0-171.82,76.93-171.82,171.82h0c0,66.21,37.48,123.64,92.35,152.33,23.77,12.43,50.79,19.49,79.47,19.49h328.53c94.89,0,171.82-76.93,171.82-171.82h0c0-94.89-76.93-171.82-171.82-171.82Zm2.96,319.81c-81.73,0-147.99-66.26-147.99-147.99s66.26-147.99,147.99-147.99,147.99,66.26,147.99,147.99-66.26,147.99-147.99,147.99Z',
  'm1031.27,168.06h0c2.07,94.87-73.15,173.46-168.02,175.53l-164.23,3.59,3.51,160.39h0c2.07,94.87,80.66,170.1,175.53,168.02h0c94.87-2.07,170.1-80.66,168.02-175.53l-3.75-171.78-3.42-156.68c-1.51-69.19-43.74-127.89-103.29-153.82,55.49,27.48,94.21,84.08,95.66,150.27Z',
  'm534.8,350.77l164.23-3.59,164.23-3.59c94.87-2.07,170.1-80.66,168.02-175.53h0c-1.45-66.2-40.17-122.79-95.66-150.27C911.58,5.89,884.41-.59,855.74.04l-328.45,7.18c-94.87,2.07-170.1,80.66-168.02,175.53h0c2.07,94.87,80.66,170.1,175.53,168.02Zm-9.95-319.67c81.71-1.79,149.4,63.01,151.19,144.72,1.79,81.71-63.01,149.4-144.72,151.19-81.71,1.79-149.4-63.01-151.19-144.72s63.01-149.4,144.72-151.19Z',
]

function brand(ctx: CanvasRenderingContext2D, size: number) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  const pad = size * 0.12
  const k = (size - pad * 2) / 1046
  ctx.save()
  ctx.translate(pad, pad + (1046 - 1024) * k * 0.5)
  ctx.scale(k, k)
  ctx.fillStyle = '#0d0e12'
  for (const d of BRAND) ctx.fill(new Path2D(d))
  ctx.restore()
}

/**
 * A shaded armchair: several flat colours with soft gradients so the tracer reads it as an
 * object (isolated subject, rich palette) and opens it inflated in the Color finish.
 */
function armchair(ctx: CanvasRenderingContext2D, size: number) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  const k = size / 100
  ctx.save()
  ctx.scale(k, k)
  const seat = ctx.createLinearGradient(0, 40, 0, 80)
  seat.addColorStop(0, '#d98c5f')
  seat.addColorStop(1, '#b8623a')
  const back = ctx.createLinearGradient(20, 18, 80, 60)
  back.addColorStop(0, '#f0b58a')
  back.addColorStop(1, '#c9764c')
  // Back rest
  ctx.fillStyle = back
  roundRect(ctx, 22, 16, 56, 46, 14)
  ctx.fill()
  // Arms
  const arm = ctx.createLinearGradient(0, 44, 0, 74)
  arm.addColorStop(0, '#e9a074')
  arm.addColorStop(1, '#a9532e')
  ctx.fillStyle = arm
  roundRect(ctx, 10, 44, 18, 30, 8)
  ctx.fill()
  roundRect(ctx, 72, 44, 18, 30, 8)
  ctx.fill()
  // Seat cushion
  ctx.fillStyle = seat
  roundRect(ctx, 26, 52, 48, 22, 9)
  ctx.fill()
  // Cushion crease highlight
  ctx.fillStyle = 'rgba(255,255,255,0.28)'
  roundRect(ctx, 30, 55, 40, 5, 2.5)
  ctx.fill()
  // Legs
  ctx.fillStyle = '#3a2a22'
  roundRect(ctx, 16, 74, 6, 12, 2)
  ctx.fill()
  roundRect(ctx, 78, 74, 6, 12, 2)
  ctx.fill()
  ctx.restore()
}

/** A ceramic mug with a glaze gradient: a second product-mode source. */
function mug(ctx: CanvasRenderingContext2D, size: number) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  const k = size / 100
  ctx.save()
  ctx.scale(k, k)
  const body = ctx.createLinearGradient(20, 0, 70, 0)
  body.addColorStop(0, '#4f7fd9')
  body.addColorStop(0.55, '#7aa6f2')
  body.addColorStop(1, '#3a63b8')
  ctx.fillStyle = '#3a63b8'
  roundRect(ctx, 60, 36, 26, 30, 12)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 66, 41, 14, 20, 7)
  ctx.fill()
  ctx.fillStyle = body
  roundRect(ctx, 20, 22, 48, 60, 8)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  roundRect(ctx, 25, 27, 8, 48, 4)
  ctx.fill()
  ctx.fillStyle = '#e9eef8'
  ctx.beginPath()
  ctx.ellipse(44, 23, 24, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export const SAMPLES: Sample[] = [
  { id: 'vitrum', label: 'Vitrum mark', kind: 'icon', preset: 'crystal', draw: brand },
  {
    id: 'heart', label: 'Heart', kind: 'icon', preset: 'rose',
    draw: mark('M50 88 L18 58 C6 46 8 26 24 18 C34 13 45 17 50 26 C55 17 66 13 76 18 C92 26 94 46 82 58 Z'),
  },
  {
    id: 'bolt', label: 'Bolt', kind: 'icon', preset: 'gold',
    draw: mark('M58 4 L20 56 L46 56 L40 96 L80 40 L54 40 Z'),
  },
  { id: 'star', label: 'Star', kind: 'icon', preset: 'chrome', draw: mark(starPath()) },
  {
    id: 'play', label: 'Play tile', kind: 'icon', preset: 'satin',
    draw: mark('M40 30 L72 50 L40 70 Z', { ink: '#ffffff', tile: '#2f6fed' }),
  },
  {
    id: 'leaf', label: 'Leaf', kind: 'icon', preset: 'emerald',
    draw: mark('M18 84 C16 44 42 16 88 14 C90 58 62 86 18 84 Z M18 84 C34 62 52 46 74 30 C52 48 36 66 24 84 Z', { evenodd: true }),
  },
  {
    id: 'ring', label: 'Ring', kind: 'icon', preset: 'obsidian',
    draw: mark('M50 6 A44 44 0 1 0 50 94 A44 44 0 1 0 50 6 Z M50 26 A24 24 0 1 1 50 74 A24 24 0 1 1 50 26 Z', { evenodd: true }),
  },
  { id: 'armchair', label: 'Armchair', kind: 'product', preset: 'satin', draw: armchair },
  { id: 'mug', label: 'Mug', kind: 'product', preset: 'gloss', draw: mug },
]

export function sampleById(id: string): Sample | undefined {
  return SAMPLES.find(s => s.id === id)
}

/** Rasterise a sample onto a fresh canvas. */
export function drawSample(sample: Sample, size = 512): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  sample.draw(c.getContext('2d')!, size)
  return c
}

/** The sample as a PNG `File`, so the studio can import it like any upload. */
export function sampleFile(sample: Sample, size = 1024): Promise<File> {
  const c = drawSample(sample, size)
  return new Promise((resolve, reject) => {
    c.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not draw the sample.'))
      resolve(new File([blob], `${sample.id}.png`, { type: 'image/png' }))
    }, 'image/png')
  })
}

/** The sample as a data URL for `<img>` previews. */
export function sampleDataUrl(sample: Sample, size = 160): string {
  return drawSample(sample, size).toDataURL('image/png')
}
