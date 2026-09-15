/**
 * Sculpt kit — procedural materials.
 *
 * Every map is painted into a `Uint8ClampedArray` and uploaded with a single
 * `putImageData`, so the only 2D-context calls the kit makes are
 * `createImageData` / `putImageData` and the canvas can be a lightweight stub
 * in tests. Normals are derived from the painted height field with a Sobel
 * pass, so albedo, roughness and normal always agree.
 */

import type { ThreeNS } from './geometry'

type Texture = import('three').Texture
type MeshPhysicalMaterial = import('three').MeshPhysicalMaterial

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas

export interface PaintContext {
  size: number
  rand: () => number
  /** RGBA albedo bytes */
  albedo: Uint8ClampedArray
  /** RGBA roughness modulation bytes (255 = leave the material roughness alone) */
  rough: Uint8ClampedArray
  /** RGBA ambient-occlusion bytes (255 = unoccluded) */
  ao: Uint8ClampedArray
  /** height field in 0..1, the source of the normal map */
  height: Float32Array
}

export type Painter = (context: PaintContext) => void

export interface MapSet {
  map: Texture
  roughnessMap: Texture
  normalMap: Texture
  aoMap: Texture
}

/* -------------------------------------------------------------- utilities */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

export function srgbBytes(THREE: ThreeNS, color: string): [number, number, number] {
  const hex = new THREE.Color(color).getHex(THREE.SRGBColorSpace)
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
}

function fillRGBA(target: Uint8ClampedArray, r: number, g: number, b: number): void {
  for (let i = 0; i < target.length; i += 4) {
    target[i] = r
    target[i + 1] = g
    target[i + 2] = b
    target[i + 3] = 255
  }
}

function toTexture(
  THREE: ThreeNS,
  canvasFactory: CanvasFactory,
  size: number,
  data: Uint8ClampedArray,
  srgb: boolean,
  repeat: number,
): Texture {
  const canvas = canvasFactory(size, size)
  const context = (canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null
  if (context) {
    const image = context.createImageData(size, size)
    image.data.set(data)
    context.putImageData(image, 0, 0)
  }
  const texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.anisotropy = 8
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

function normalFromHeight(height: Float32Array, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4)
  const scale = (strength * size) / 512
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size
    const down = ((y + 1) % size) * size
    const row = y * size
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size
      const right = (x + 1) % size
      const dx = ((height[row + left] ?? 0) - (height[row + right] ?? 0)) * scale
      const dy = ((height[up + x] ?? 0) - (height[down + x] ?? 0)) * scale
      const length = Math.hypot(dx, dy, 1)
      const i = (row + x) * 4
      out[i] = clamp255(((dx / length) * 0.5 + 0.5) * 255)
      out[i + 1] = clamp255(((dy / length) * 0.5 + 0.5) * 255)
      out[i + 2] = clamp255(((1 / length) * 0.5 + 0.5) * 255)
      out[i + 3] = 255
    }
  }
  return out
}

/** Paint albedo / roughness / AO / height, then derive the normal map. */
export function paintMaps(
  THREE: ThreeNS,
  canvasFactory: CanvasFactory,
  size: number,
  rand: () => number,
  painters: Painter[],
  options: { normalStrength?: number, repeat?: number } = {},
): MapSet {
  const pixels = size * size
  const albedo = new Uint8ClampedArray(pixels * 4)
  const rough = new Uint8ClampedArray(pixels * 4)
  const ao = new Uint8ClampedArray(pixels * 4)
  const height = new Float32Array(pixels)
  fillRGBA(albedo, 255, 255, 255)
  fillRGBA(rough, 255, 255, 255)
  fillRGBA(ao, 255, 255, 255)
  height.fill(0.5)

  const context: PaintContext = { size, rand, albedo, rough, ao, height }
  for (const painter of painters) painter(context)

  const repeat = options.repeat ?? 1
  return {
    map: toTexture(THREE, canvasFactory, size, albedo, true, repeat),
    roughnessMap: toTexture(THREE, canvasFactory, size, rough, false, repeat),
    normalMap: toTexture(THREE, canvasFactory, size, normalFromHeight(height, size, options.normalStrength ?? 1), false, repeat),
    aoMap: toTexture(THREE, canvasFactory, size, ao, false, repeat),
  }
}

/* ---------------------------------------------------------------- painters */

/** Soft broad blotches that stop a flat colour reading as plastic. */
function mottle(context: PaintContext, count: number, amount: number): void {
  const { size, rand, albedo, ao } = context
  for (let blob = 0; blob < count; blob += 1) {
    const cx = rand() * size
    const cy = rand() * size
    const radius = size * (0.05 + rand() * 0.1)
    const sign = rand() > 0.5 ? 1 : -1
    const x0 = Math.max(0, Math.floor(cx - radius))
    const x1 = Math.min(size - 1, Math.ceil(cx + radius))
    const y0 = Math.max(0, Math.floor(cy - radius))
    const y1 = Math.min(size - 1, Math.ceil(cy + radius))
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot(x - cx, y - cy) / radius
        if (d >= 1) continue
        const falloff = (1 - d) * (1 - d)
        const delta = sign * amount * falloff
        const i = (y * size + x) * 4
        albedo[i] = clamp255((albedo[i] ?? 0) + delta)
        albedo[i + 1] = clamp255((albedo[i + 1] ?? 0) + delta)
        albedo[i + 2] = clamp255((albedo[i + 2] ?? 0) + delta)
        if (sign < 0) {
          const occ = clamp255(255 - falloff * amount * 0.5)
          ao[i] = occ
          ao[i + 1] = occ
          ao[i + 2] = occ
        }
      }
    }
  }
}

/**
 * Woven upholstery: two thread directions in a checkerboard over/under with
 * per-thread lightness noise, thread tops slightly glossier than the gaps.
 * Ported from the orange-chair-bed reference recipe.
 */
export function fabricPainter(rgb: [number, number, number], weave: number, contrast: number): Painter {
  return (context) => {
    const { size, rand, albedo, rough, ao, height } = context
    const [r, g, b] = rgb
    fillRGBA(albedo, r, g, b)
    fillRGBA(rough, 255, 255, 255)
    fillRGBA(ao, 255, 255, 255)
    height.fill(0.5)

    const cell = Math.max(2, Math.round(size / (120 + weave * 260)))
    for (let cy = 0; cy < size; cy += cell) {
      for (let cx = 0; cx < size; cx += cell) {
        const over = ((cx / cell | 0) + (cy / cell | 0)) % 2 === 0
        const jitter = (rand() - 0.5) * 16 * contrast
        const lightness = (over ? 8 : -10) * contrast + jitter
        const tr = clamp255(r + lightness)
        const tg = clamp255(g + lightness * 0.8)
        const tb = clamp255(b + lightness * 0.7)
        const roughValue = over ? 240 : 255
        const occlusion = over ? 255 : 226
        const h = over ? 0.72 : 0.3
        const yMax = Math.min(size, cy + cell)
        const xMax = Math.min(size, cx + cell)
        for (let y = cy; y < yMax; y += 1) {
          for (let x = cx; x < xMax; x += 1) {
            const p = y * size + x
            const i = p * 4
            albedo[i] = tr
            albedo[i + 1] = tg
            albedo[i + 2] = tb
            rough[i] = roughValue
            rough[i + 1] = roughValue
            rough[i + 2] = roughValue
            ao[i] = occlusion
            ao[i + 1] = occlusion
            ao[i + 2] = occlusion
            height[p] = h
          }
        }
      }
    }
    mottle(context, 40, 10 * contrast)
  }
}

/** Long-axis wood grain: warped ring bands plus fine fibre. */
export function woodPainter(rgb: [number, number, number], grain: number, tone: number): Painter {
  return (context) => {
    const { size, rand, albedo, rough, ao, height } = context
    const [r, g, b] = rgb
    const warp = new Float32Array(size)
    let value = rand()
    for (let y = 0; y < size; y += 1) {
      value += (rand() - 0.5) * 0.12
      value = Math.max(-1, Math.min(1, value))
      warp[y] = value
    }
    const rings = 6 + Math.round(grain * 26)
    for (let y = 0; y < size; y += 1) {
      const w = warp[y] ?? 0
      for (let x = 0; x < size; x += 1) {
        const u = x / size
        const band = 0.5 + 0.5 * Math.sin(u * rings * Math.PI * 2 + w * 3)
        const fibre = (rand() - 0.5) * 0.12 * grain
        const t = Math.max(0, Math.min(1, band ** 2 + fibre))
        const shade = (t - 0.5) * 46 * tone
        const p = y * size + x
        const i = p * 4
        albedo[i] = clamp255(r + shade)
        albedo[i + 1] = clamp255(g + shade * 0.9)
        albedo[i + 2] = clamp255(b + shade * 0.75)
        const roughValue = clamp255(255 - t * 22 * grain)
        rough[i] = roughValue
        rough[i + 1] = roughValue
        rough[i + 2] = roughValue
        const occlusion = clamp255(255 - t * 14)
        ao[i] = occlusion
        ao[i + 1] = occlusion
        ao[i + 2] = occlusion
        height[p] = 0.5 + (t - 0.5) * 0.4 * grain
      }
    }
  }
}

/** Worley-style cellular grain: leather pebbling with darkened creases. */
export function leatherPainter(rgb: [number, number, number], grain: number): Painter {
  return (context) => {
    const { size, rand, albedo, rough, ao, height } = context
    const [r, g, b] = rgb
    const cells = Math.max(4, Math.round(12 + grain * 40))
    const cell = size / cells
    const seeds = new Float32Array(cells * cells * 2)
    for (let i = 0; i < cells * cells; i += 1) {
      seeds[i * 2] = rand()
      seeds[i * 2 + 1] = rand()
    }
    for (let y = 0; y < size; y += 1) {
      const gy = Math.floor(y / cell)
      for (let x = 0; x < size; x += 1) {
        const gx = Math.floor(x / cell)
        let nearest = Infinity
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const cxi = (gx + ox + cells) % cells
            const cyi = (gy + oy + cells) % cells
            const si = (cyi * cells + cxi) * 2
            const sx = (gx + ox + (seeds[si] ?? 0.5)) * cell
            const sy = (gy + oy + (seeds[si + 1] ?? 0.5)) * cell
            const d = Math.hypot(x - sx, y - sy)
            if (d < nearest) nearest = d
          }
        }
        const t = Math.max(0, Math.min(1, 1 - nearest / cell))
        const p = y * size + x
        const i = p * 4
        const shade = (t - 0.5) * 26
        albedo[i] = clamp255(r + shade)
        albedo[i + 1] = clamp255(g + shade)
        albedo[i + 2] = clamp255(b + shade)
        const roughValue = clamp255(255 - (1 - t) * 26)
        rough[i] = roughValue
        rough[i + 1] = roughValue
        rough[i + 2] = roughValue
        const occlusion = clamp255(255 - (1 - t) * 40)
        ao[i] = occlusion
        ao[i + 1] = occlusion
        ao[i + 2] = occlusion
        height[p] = 0.35 + t * 0.5
      }
    }
    mottle(context, 24, 6)
  }
}

/** Anisotropic-looking brush streaks running along U. */
export function brushedPainter(rgb: [number, number, number], spread: number): Painter {
  return (context) => {
    const { size, rand, albedo, rough, ao, height } = context
    const [r, g, b] = rgb
    const streak = new Float32Array(size)
    for (let y = 0; y < size; y += 1) streak[y] = rand()
    for (let y = 0; y < size; y += 1) {
      const a = streak[(y - 1 + size) % size] ?? 0.5
      const c = streak[y] ?? 0.5
      const d = streak[(y + 1) % size] ?? 0.5
      const s = (a + c * 2 + d) / 4 - 0.5
      const shade = s * 18
      const roughValue = clamp255(255 + s * 90 * spread)
      for (let x = 0; x < size; x += 1) {
        const p = y * size + x
        const i = p * 4
        albedo[i] = clamp255(r + shade)
        albedo[i + 1] = clamp255(g + shade)
        albedo[i + 2] = clamp255(b + shade)
        rough[i] = roughValue
        rough[i + 1] = roughValue
        rough[i + 2] = roughValue
        ao[i] = 255
        ao[i + 1] = 255
        ao[i + 2] = 255
        height[p] = 0.5 + s * 0.08
      }
    }
  }
}

/* --------------------------------------------------------------- materials */

export interface MaterialBuilders {
  fabric: (o: { color: string, weave?: number, sheen?: number, roughness?: number, contrast?: number }) => MeshPhysicalMaterial
  leather: (o: { color: string, grain?: number, gloss?: number }) => MeshPhysicalMaterial
  wood: (o: { color: string, grain?: number, tone?: number, gloss?: number }) => MeshPhysicalMaterial
  paintedMetal: (o: { color: string, gloss?: number }) => MeshPhysicalMaterial
  brushedMetal: (o: { color?: string, roughness?: number }) => MeshPhysicalMaterial
  plastic: (o: { color: string, gloss?: number }) => MeshPhysicalMaterial
  glass: (o?: { tint?: string }) => MeshPhysicalMaterial
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)

export function createMaterials(
  THREE: ThreeNS,
  canvasFactory: CanvasFactory,
  size: number,
  rand: () => number,
): MaterialBuilders {
  const paint = (painter: Painter, normalStrength: number, repeat: number): MapSet =>
    paintMaps(THREE, canvasFactory, size, rand, [painter], { normalStrength, repeat })

  return {
    fabric(o) {
      const weave = clamp01(o.weave ?? 0.5)
      const contrast = o.contrast ?? 1
      const maps = paint(fabricPainter(srgbBytes(THREE, o.color), weave, contrast), 1.4, 2)
      const material = new THREE.MeshPhysicalMaterial({
        map: maps.map,
        roughnessMap: maps.roughnessMap,
        normalMap: maps.normalMap,
        aoMap: maps.aoMap,
        roughness: o.roughness ?? 0.88,
        metalness: 0,
      })
      material.normalScale.set(0.7, 0.7)
      material.aoMapIntensity = 0.8
      material.sheen = o.sheen ?? 1
      material.sheenRoughness = 0.6
      material.sheenColor = new THREE.Color(o.color)
      return material
    },

    leather(o) {
      const grain = clamp01(o.grain ?? 0.5)
      const maps = paint(leatherPainter(srgbBytes(THREE, o.color), grain), 1.8, 2)
      const material = new THREE.MeshPhysicalMaterial({
        map: maps.map,
        roughnessMap: maps.roughnessMap,
        normalMap: maps.normalMap,
        aoMap: maps.aoMap,
        roughness: 0.55 - (o.gloss ?? 0) * 0.2,
        metalness: 0,
        clearcoat: (o.gloss ?? 0) * 0.4,
        clearcoatRoughness: 0.4,
      })
      material.normalScale.set(0.9, 0.9)
      material.aoMapIntensity = 0.9
      material.sheen = 0.25
      material.sheenRoughness = 0.7
      return material
    },

    wood(o) {
      const grain = clamp01(o.grain ?? 0.5)
      const tone = o.tone ?? 1
      const maps = paint(woodPainter(srgbBytes(THREE, o.color), grain, tone), 0.8, 1)
      const material = new THREE.MeshPhysicalMaterial({
        map: maps.map,
        roughnessMap: maps.roughnessMap,
        normalMap: maps.normalMap,
        aoMap: maps.aoMap,
        roughness: 0.6 - (o.gloss ?? 0) * 0.25,
        metalness: 0,
        clearcoat: (o.gloss ?? 0) * 0.6,
        clearcoatRoughness: 0.2,
      })
      material.normalScale.set(0.5, 0.5)
      material.aoMapIntensity = 0.6
      return material
    },

    paintedMetal(o) {
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(o.color),
        roughness: 0.3 - (o.gloss ?? 0) * 0.2,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
      })
    },

    brushedMetal(o) {
      const color = o.color ?? '#b9bcc0'
      const maps = paint(brushedPainter(srgbBytes(THREE, color), 1), 0.35, 1)
      const material = new THREE.MeshPhysicalMaterial({
        map: maps.map,
        roughnessMap: maps.roughnessMap,
        normalMap: maps.normalMap,
        roughness: o.roughness ?? 0.35,
        metalness: 1,
      })
      material.normalScale.set(0.25, 0.25)
      return material
    },

    plastic(o) {
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(o.color),
        roughness: 0.4 - (o.gloss ?? 0) * 0.3,
        metalness: 0,
        clearcoat: (o.gloss ?? 0) * 0.5,
        clearcoatRoughness: 0.25,
      })
    },

    glass(o) {
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(o?.tint ?? '#ffffff'),
        roughness: 0.05,
        metalness: 0,
        transmission: 1,
        thickness: 0.01,
        ior: 1.5,
        transparent: true,
      })
    },
  }
}
