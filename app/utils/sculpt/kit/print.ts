/**
 * Sculpt kit — printed artwork. A label, a logo or a line of text on a
 * product is not geometry: it is the photo's own pixels, wrapped onto the
 * part they are printed on. `printMaterial` cuts the plan's crop box out of
 * the uploaded photo, cleans it, and paints it onto a UV atlas whose u runs
 * around the part and v runs up it, so a lathe or cylinder body wears the
 * artwork exactly where the photo shows it, at the aspect the photo shows it.
 */

import type { ThreeNS } from './geometry'

type MeshPhysicalMaterial = import('three').MeshPhysicalMaterial
type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface PrintOptions {
  /** The part's own colour, filling everything the artwork does not cover. */
  color: string
  /** Crop of the photo carrying the artwork: [x0, y0, x1, y1] in 0..1 of the image, origin top-left. */
  photo: [number, number, number, number]
  /** Where the artwork sits on the part, as a share of its height: [bottom, top] in 0..1. */
  band: [number, number]
  /** The part's radius (mean over the band) and height in metres: they set how far the artwork wraps. */
  radius: number
  height: number
  /** `ink` (default): dark print on a plain body — only the printed marks are kept. `photo`: full-colour artwork, lighting flattened. */
  mode?: 'ink' | 'photo'
  /** Plastic gloss 0..1, as `kit.plastic`. */
  gloss?: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The brightness of the unprinted body inside the crop: the 90th percentile, so print and shadow do not pull it down. */
function paperLevel(data: Uint8ClampedArray): number {
  const histogram = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.min(255, Math.round(luminance(data[i]!, data[i + 1]!, data[i + 2]!)))]! += 1
  }
  const total = data.length / 4
  let seen = 0
  for (let level = 0; level < 256; level += 1) {
    seen += histogram[level]!
    if (seen >= total * 0.9) return Math.max(1, level)
  }
  return 255
}

/**
 * Keep the print, drop the body. Every pixel is blended from the base colour
 * toward the photo pixel by how much darker than the paper it is, so the
 * shading the photographer's light left on the body never doubles up with the
 * studio's own light, and the text edges keep their anti-aliasing.
 */
function inkPass(data: Uint8ClampedArray, base: [number, number, number]): void {
  const paper = paperLevel(data)
  for (let i = 0; i < data.length; i += 4) {
    const lum = luminance(data[i]!, data[i + 1]!, data[i + 2]!)
    const ink = clamp01((paper - lum) / (paper * 0.55))
    data[i] = Math.round(base[0] + (data[i]! - base[0]) * ink)
    data[i + 1] = Math.round(base[1] + (data[i + 1]! - base[1]) * ink)
    data[i + 2] = Math.round(base[2] + (data[i + 2]! - base[2]) * ink)
    data[i + 3] = 255
  }
}

/**
 * Full-colour artwork: divide out the left-to-right shading a cylindrical body
 * shows in a photo (each column's mean brightness), clamped so a genuinely
 * dark stripe of artwork is not bleached.
 */
function flattenPass(data: Uint8ClampedArray, width: number, height: number): void {
  const paper = paperLevel(data)
  const column = new Float64Array(width)
  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * 4
      sum += luminance(data[i]!, data[i + 1]!, data[i + 2]!)
    }
    column[x] = sum / height
  }
  for (let x = 0; x < width; x += 1) {
    const gain = Math.min(1.6, Math.max(0.7, paper / Math.max(1, column[x]!)))
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * 4
      data[i] = Math.min(255, Math.round(data[i]! * gain))
      data[i + 1] = Math.min(255, Math.round(data[i + 1]! * gain))
      data[i + 2] = Math.min(255, Math.round(data[i + 2]! * gain))
      data[i + 3] = 255
    }
  }
}

function srgbBytes(THREE: ThreeNS, color: string): [number, number, number] {
  const c = new THREE.Color(color)
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]
}

/** Paints the atlas; exported so the pixels can be tested without a GPU. */
export function paintPrintAtlas(
  THREE: ThreeNS,
  canvasFactory: CanvasFactory,
  photo: CanvasImageSource & { width: number, height: number },
  o: PrintOptions,
  size: number,
): HTMLCanvasElement | OffscreenCanvas {
  const width = size * 2
  const height = size
  const atlas = canvasFactory(width, height)
  const ctx = (atlas as HTMLCanvasElement).getContext('2d') as Context2D | null
  if (!ctx) return atlas
  ctx.fillStyle = o.color
  ctx.fillRect(0, 0, width, height)

  // The crop, in photo pixels.
  const [x0, y0, x1, y1] = o.photo.map(clamp01) as [number, number, number, number]
  const sx = Math.floor(Math.min(x0, x1) * photo.width)
  const sy = Math.floor(Math.min(y0, y1) * photo.height)
  const sw = Math.max(1, Math.round(Math.abs(x1 - x0) * photo.width))
  const sh = Math.max(1, Math.round(Math.abs(y1 - y0) * photo.height))

  // Its place on the part: the band gives the height, the crop's aspect gives
  // the width, the radius turns that width into a share of the way around.
  const [b0, b1] = o.band.map(clamp01) as [number, number]
  const bandBottom = Math.min(b0, b1)
  const bandTop = Math.max(b0, b1)
  const physicalHeight = Math.max(1e-4, (bandTop - bandBottom) * o.height)
  const physicalWidth = physicalHeight * (sw / sh)
  const arc = Math.min(1, physicalWidth / Math.max(1e-4, 2 * Math.PI * o.radius))
  const dw = Math.max(1, Math.round(arc * width))
  const dh = Math.max(1, Math.round((bandTop - bandBottom) * height))
  const dx = Math.round(width / 2 - dw / 2)
  const dy = Math.round((1 - bandTop) * height)

  // Clean the crop at its destination size in a scratch canvas, then blit.
  const scratch = canvasFactory(dw, dh)
  const sctx = (scratch as HTMLCanvasElement).getContext('2d') as Context2D | null
  if (!sctx) return atlas
  sctx.drawImage(photo, sx, sy, sw, sh, 0, 0, dw, dh)
  const image = sctx.getImageData(0, 0, dw, dh)
  if ((o.mode ?? 'ink') === 'ink') inkPass(image.data, srgbBytes(THREE, o.color))
  else flattenPass(image.data, dw, dh)
  sctx.putImageData(image, 0, 0)
  ctx.drawImage(scratch as CanvasImageSource, dx, dy)
  return atlas
}

export function printMaterial(
  THREE: ThreeNS,
  canvasFactory: CanvasFactory,
  photo: (CanvasImageSource & { width: number, height: number }) | null,
  size: number,
  o: PrintOptions,
): MeshPhysicalMaterial {
  const gloss = clamp01(o.gloss ?? 0.35)
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(photo ? '#ffffff' : o.color),
    roughness: 0.4 - gloss * 0.3,
    metalness: 0,
    clearcoat: gloss * 0.5,
    clearcoatRoughness: 0.25,
  })
  // No photo in this sandbox (a stored run reopened without one): the part
  // keeps its plain colour rather than failing the whole model.
  if (!photo) return material

  const atlas = paintPrintAtlas(THREE, canvasFactory, photo, o, size)
  const texture = new THREE.CanvasTexture(atlas as HTMLCanvasElement)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  // Lathe and cylinder UVs start (u = 0) at +Z, the face toward the viewer;
  // the artwork is painted at the atlas's centre, so the seam stays at the back.
  texture.offset.x = 0.5
  texture.anisotropy = 8
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  material.map = texture
  return material
}
