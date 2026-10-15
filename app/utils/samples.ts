/**
 * Sample sources drawn in code. Vitrum ships no art packs: every example on the landing page
 * and every "Try sample" in the studio is an SVG path rasterised at runtime, then pushed
 * through the same trace → build pipeline as an uploaded file.
 */

import { LOGOS, type Logo } from './logos'
import { domCanvas } from './raster'

export interface Sample {
  id: string
  label: string
  /** Material preset id from `MATERIAL_PRESETS` that suits the mark. */
  preset: string
  /** Draws the source onto a square canvas of `size` px. Must be called on the client. */
  draw: (ctx: CanvasRenderingContext2D, size: number) => void
  /** How the studio first shows the built object, when it has a pose of its own. */
  pose?: SamplePose
}

/**
 * A display-only pose: the object turned `spinDeg` in its own plane and the Angle view looking
 * along `view`. The exported geometry stays upright.
 */
export interface SamplePose {
  spinDeg: number
  view: [number, number, number]
}

/** Samples are dark ink on a white page, the way most marks are exported. */
const PAGE = '#ffffff'
const INK = '#0d0e12'

/** A 100×100 SVG path drawn to fill the canvas with `pad` px of page around it. */
function mark(d: string, opts: { evenodd?: boolean; ink?: string; tile?: string } = {}): Sample['draw'] {
  return (ctx: CanvasRenderingContext2D, size: number) => {
    ctx.fillStyle = PAGE
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
    ctx.fillStyle = opts.ink ?? INK
    ctx.fill(new Path2D(d), opts.evenodd ? 'evenodd' : 'nonzero')
    ctx.restore()
  }
}

/** A brand mark from `logos.ts`, fitted into the frame at its own aspect ratio, drawn flat. */
function logo(l: Logo): Sample['draw'] {
  return (ctx: CanvasRenderingContext2D, size: number) => {
    ctx.fillStyle = PAGE
    ctx.fillRect(0, 0, size, size)
    const [x, y, w, h] = l.viewBox
    const k = (size * 0.72) / Math.max(w, h)
    ctx.save()
    ctx.translate((size - w * k) / 2 - x * k, (size - h * k) / 2 - y * k)
    ctx.scale(k, k)
    ctx.fillStyle = INK
    for (const p of l.paths) ctx.fill(new Path2D(p.d), l.evenodd ? 'evenodd' : 'nonzero')
    ctx.restore()
  }
}

/** Default finish for each brand sample when it opens from the landing page. Neutral finishes only,
    so the studio opens in the same graphite, silver and glass as the site. */
const LOGO_FINISH: Record<string, string> = {
  github: 'chrome', figma: 'ceramic', framer: 'champagne', linear: 'obsidian',
  discord: 'milk', spotify: 'titanium', apple: 'silver', stripe: 'frosted',
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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
function interfaceIcon(kind: 'camera' | 'chat'): Sample['draw'] {
  return (ctx: CanvasRenderingContext2D, size: number) => {
    ctx.fillStyle = PAGE
    ctx.fillRect(0, 0, size, size)
    ctx.save()
    ctx.translate(size * 0.12, size * 0.12)
    ctx.scale(size * 0.0076, size * 0.0076)
    ctx.strokeStyle = ctx.fillStyle = INK
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

/**
 * The Vitrum glyph: a squircle with a round counter, in the 100×100 frame. The brand mark
 * (`BrandMark.vue`) is this same glyph built as a glass tile and drawn from `VITRUM_POSE`, so
 * "Try the mark" opens on the logo's own angle.
 */
export const VITRUM_GLYPH = 'M30 0H70A30 30 0 0 1 100 30V70A30 30 0 0 1 70 100H30A30 30 0 0 1 0 70V30A30 30 0 0 1 30 0ZM50 30A20 20 0 1 0 50 70A20 20 0 1 0 50 30Z'

/** Turned 30° in its plane, seen from 45° below: the camera the brand mark is drawn with. */
export const VITRUM_POSE: SamplePose = { spinDeg: 30, view: [0, -Math.SQRT1_2, Math.SQRT1_2] }

export const SAMPLES: Sample[] = [
  { id: 'vitrum', label: 'Vitrum mark', preset: 'clear', draw: mark(VITRUM_GLYPH, { evenodd: true }), pose: VITRUM_POSE },
  { id: 'camera', label: 'Camera', preset: 'frosted', draw: interfaceIcon('camera') },
  { id: 'chat', label: 'Conversation', preset: 'milk', draw: interfaceIcon('chat') },
  { id: 'spark', label: 'Sparkle', preset: 'silver', draw: mark('M47 10 Q50 0 53 10 C58 32 68 42 90 47 Q100 50 90 53 C68 58 58 68 53 90 Q50 100 47 90 C42 68 32 58 10 53 Q0 50 10 47 C32 42 42 32 47 10 Z') },
  {
    id: 'heart', label: 'Heart', preset: 'ceramic',
    draw: mark('M50 88 L18 58 C6 46 8 26 24 18 C34 13 45 17 50 26 C55 17 66 13 76 18 C92 26 94 46 82 58 Z'),
  },
  {
    id: 'bolt', label: 'Bolt', preset: 'titanium',
    draw: mark('M58 4 L20 56 L46 56 L40 96 L80 40 L54 40 Z'),
  },
  { id: 'star', label: 'Star', preset: 'chrome', draw: mark(starPath()) },
  {
    id: 'play', label: 'Play tile', preset: 'satin',
    draw: mark('M40 30 L72 50 L40 70 Z', { ink: '#ffffff', tile: '#26282e' }),
  },
  {
    id: 'leaf', label: 'Leaf', preset: 'smoke',
    draw: mark('M18 84 C16 44 42 16 88 14 C90 58 62 86 18 84 Z M18 84 C34 62 52 46 74 30 C52 48 36 66 24 84 Z', { evenodd: true }),
  },
  {
    id: 'ring', label: 'Ring', preset: 'obsidian',
    draw: mark('M50 6 A44 44 0 1 0 50 94 A44 44 0 1 0 50 6 Z M50 26 A24 24 0 1 1 50 74 A24 24 0 1 1 50 26 Z', { evenodd: true }),
  },
  ...LOGOS.map(l => ({ id: l.id, label: l.name, preset: LOGO_FINISH[l.id] ?? 'clear', draw: logo(l) })),
]

/** The landing hero's centre object; its finish follows the page's swatches. */
export const HERO_STORY = 'github'
/** The hero's opening finish; the landing stays monochrome so the shapes, not the colours, lead. */
export const HERO_FINISH = 'chrome'
/**
 * Where the hero's objects sit, in screen space, so they frame the copy on any screen: x and y are
 * fractions of the half-width and half-height from the centre (up is +), size is px on a
 * 1440 × 900 screen. Wide screens hold the copy between them. Narrow ones gather the marks in the
 * band between the copy and the finish bar: there y is 0 at the band's top and 1 at its bottom
 * (`null` leaves one out). `story` is the centre object whose finish the page switches.
 */
export interface HeroSpot {
  id: string
  preset?: string
  size: number
  z: number
  wide: readonly [number, number]
  narrow: readonly [number, number] | null
}
// One arc under and around the copy, mirrored left to right: an outer pair at headline height, an
// inner pair at the buttons, the switchable GitHub mark at the bottom centre. Each pair shares a
// size and depth; black and chrome alternate across the diagonal so neither side reads heavier.
export const HERO_SPOTS: readonly HeroSpot[] = [
  { id: 'story', size: 160, z: 24, wide: [0, -0.56], narrow: [0, 0.6] },
  { id: 'figma', preset: 'black', size: 100, z: 0, wide: [-0.68, 0.2], narrow: [-0.64, 0.22] },
  { id: 'framer', preset: 'chrome', size: 100, z: 0, wide: [0.68, 0.2], narrow: [0.64, 0.22] },
  { id: 'apple', preset: 'chrome', size: 112, z: 10, wide: [-0.5, -0.38], narrow: [-0.66, 0.88] },
  { id: 'spotify', preset: 'black', size: 112, z: 10, wide: [0.5, -0.38], narrow: [0.66, 0.88] },
]

/** Brand marks. Their fine details (tails, stripes, bars) need a small bevel to survive. */
export const LOGO_SAMPLE_IDS = new Set(LOGOS.map(l => l.id))

export function sampleById(id: string): Sample | undefined {
  return SAMPLES.find(s => s.id === id)
}

/** Rasterise a sample onto a fresh canvas. */
export function drawSample(sample: Sample, size = 512): HTMLCanvasElement {
  const c = domCanvas(size, size)
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
