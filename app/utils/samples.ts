/**
 * Sample sources drawn in code. Vitrum ships no art packs: every example on the landing page
 * and every "Try sample" in the studio is an SVG path rasterised at runtime, then pushed
 * through the same trace → build pipeline as an uploaded file.
 */

import { LOGOS, type Logo } from './logos'

export interface Sample {
  id: string
  label: string
  /** Material preset id from `MATERIAL_PRESETS` that suits the mark. */
  preset: string
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

/** A brand mark from `logos.ts`, fitted into the frame at its own aspect ratio, drawn flat. */
function logo(l: Logo) {
  return (ctx: CanvasRenderingContext2D, size: number) => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    const [x, y, w, h] = l.viewBox
    const k = (size * 0.72) / Math.max(w, h)
    ctx.save()
    ctx.translate((size - w * k) / 2 - x * k, (size - h * k) / 2 - y * k)
    ctx.scale(k, k)
    ctx.fillStyle = '#0d0e12'
    for (const p of l.paths) ctx.fill(new Path2D(p.d), l.evenodd ? 'evenodd' : 'nonzero')
    ctx.restore()
  }
}

/** Default finish for each brand sample when it opens from the landing page. */
const LOGO_FINISH: Record<string, string> = {
  github: 'chrome', figma: 'rose', framer: 'gold', linear: 'obsidian',
  discord: 'sapphire', spotify: 'emerald', apple: 'silver', stripe: 'amber',
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

/** Original rounded interface icons, drawn as thick strokes that retain their counters in 3D. */
function interfaceIcon(kind: 'camera' | 'chat') {
  return (ctx: CanvasRenderingContext2D, size: number) => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    ctx.save()
    ctx.translate(size * 0.12, size * 0.12)
    ctx.scale(size * 0.0076, size * 0.0076)
    ctx.strokeStyle = ctx.fillStyle = '#0d0e12'
    ctx.lineWidth = 9
    ctx.lineJoin = ctx.lineCap = 'round'
    if (kind === 'camera') {
      ctx.stroke(new Path2D('M22 28 H31 L38 17 H62 L69 28 H78 Q91 28 91 41 V73 Q91 86 78 86 H22 Q9 86 9 73 V41 Q9 28 22 28 Z'))
      ctx.beginPath()
      ctx.arc(50, 56, 16, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(76, 41, 3.5, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.stroke(new Path2D('M29 15 H71 Q89 15 89 33 V62 Q89 80 71 80 H47 L27 92 V79 Q11 77 11 61 V33 Q11 15 29 15 Z'))
      ctx.lineWidth = 8
      ctx.stroke(new Path2D('M31 38 H68 M31 57 H54'))
    }
    ctx.restore()
  }
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

export const SAMPLES: Sample[] = [
  { id: 'vitrum', label: 'Vitrum mark', preset: 'crystal', draw: brand },
  { id: 'camera', label: 'Camera', preset: 'sapphire', draw: interfaceIcon('camera') },
  { id: 'chat', label: 'Conversation', preset: 'emerald', draw: interfaceIcon('chat') },
  { id: 'spark', label: 'Sparkle', preset: 'amber', draw: mark('M47 10 Q50 0 53 10 C58 32 68 42 90 47 Q100 50 90 53 C68 58 58 68 53 90 Q50 100 47 90 C42 68 32 58 10 53 Q0 50 10 47 C32 42 42 32 47 10 Z') },
  {
    id: 'heart', label: 'Heart', preset: 'rose',
    draw: mark('M50 88 L18 58 C6 46 8 26 24 18 C34 13 45 17 50 26 C55 17 66 13 76 18 C92 26 94 46 82 58 Z'),
  },
  {
    id: 'bolt', label: 'Bolt', preset: 'gold',
    draw: mark('M58 4 L20 56 L46 56 L40 96 L80 40 L54 40 Z'),
  },
  { id: 'star', label: 'Star', preset: 'chrome', draw: mark(starPath()) },
  {
    id: 'play', label: 'Play tile', preset: 'satin',
    draw: mark('M40 30 L72 50 L40 70 Z', { ink: '#ffffff', tile: '#2f6fed' }),
  },
  {
    id: 'leaf', label: 'Leaf', preset: 'emerald',
    draw: mark('M18 84 C16 44 42 16 88 14 C90 58 62 86 18 84 Z M18 84 C34 62 52 46 74 30 C52 48 36 66 24 84 Z', { evenodd: true }),
  },
  {
    id: 'ring', label: 'Ring', preset: 'obsidian',
    draw: mark('M50 6 A44 44 0 1 0 50 94 A44 44 0 1 0 50 6 Z M50 26 A24 24 0 1 1 50 74 A24 24 0 1 1 50 26 Z', { evenodd: true }),
  },
  ...LOGOS.map(l => ({ id: l.id, label: l.name, preset: LOGO_FINISH[l.id] ?? 'crystal', draw: logo(l) })),
]

/** The landing hero's centre object; its finish follows the page's swatches. */
export const HERO_STORY = 'github'

/** Brand marks. Their fine details (tails, stripes, bars) need a small bevel to survive. */
export const LOGO_SAMPLE_IDS = new Set(LOGOS.map(l => l.id))

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
