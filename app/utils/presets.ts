/**
 * Studio parameters and one-click looks. Kept apart from the renderer so the landing page and
 * the server bundle can read presets without pulling in three.js.
 */
/** All units are millimetres so exported files carry real-world dimensions. */
export type Finish = 'glass' | 'metal' | 'print'
/**
 * Extrude: the traced silhouette as a bevelled slab. Inflate: the silhouette puffed into a
 * rounded volume, front and back. Relief: the picture as a height field on a slab.
 */
export type Geometry = 'extrude' | 'stack' | 'inflate' | 'relief'
/** How the backdrop is filled: one colour, a straight blend between two, or a glow from the centre out. */
export type BackdropFill = 'solid' | 'linear' | 'radial'
/** Where the Color finish takes its colour: the picture's own, or one paint over the whole model. */
export type ColorSource = 'picture' | 'paint'
/** Sway rocks the model gently either side of where it faces; orbit turns it all the way round. */
export type RotateMode = 'sway' | 'orbit'

export interface GlassParams {
  /** Glass renders with refraction passes; metal and print are single-pass PBR surfaces.
   *  Print keeps the source image as a texture on the extruded silhouette. */
  finish: Finish
  geometry: Geometry
  /** Relief only: how far the brightest pixel rises above the base slab (`depthMm`). */
  reliefMm: number
  /** Stack only: how far each colour layer rises above the base. */
  layerMm: number
  /** Metal finish only: 1 = pure metal, lower mixes toward a painted/ceramic solid. */
  metalness: number
  /** Opacity of the shadow (on the wall behind the model, or on the floor) (0..1). */
  shadow: number
  /**
   * Stand the model on a floor with a real cast shadow, as a product shot does. Off, a soft
   * silhouette shadow sits on the wall behind it, which suits a logo.
   */
  floor: boolean
  /** Color finish: how much of the picture's own lighting is divided out of the albedo (0..1). */
  flatten: number
  /** Color finish: grain from the picture as a normal and roughness map (0..1). */
  grain: number
  /** Color finish: cloth-like sheen at grazing angles (0..1). */
  sheen: number
  /**
   * Color finish: a procedural woven bump laid over the surface at a fixed real-world size
   * (0..1). Uniform everywhere, unlike the picture's own grain which stretches where the photo
   * was projected at an angle.
   */
  weave: number
  /** Color finish: blur of the picture on the surface (0..1), so photo noise and stretched pixels melt into a flat colour. */
  soften: number
  widthMm: number
  depthMm: number
  bevelMm: number
  bevelSegments: number
  ior: number
  dispersion: number
  roughness: number
  clearcoat: number
  /** Thin-film fringe strength on grazing edges (0..1). */
  edgeChroma: number
  /** How dark the rims go through fake total internal reflection (0..1). */
  tir: number
  /** Share of light passing through (0..1); lower reads as milky glass. */
  clarity: number
  /** Directional blur of the refraction (0..1). */
  blur: number
  tint: string
  attenuationMm: number
  envIntensity: number
  /** Where the studio's light comes from: the room and its lights turned about the vertical, in degrees. */
  lightAngle: number
  background: string
  backdropFill: BackdropFill
  /** The gradient's second colour: where a linear blend ends, or a radial glow's outer edge. */
  background2: string
  /** Direction of a linear blend in CSS degrees: 0 runs bottom to top, 180 top to bottom. */
  backdropAngle: number
  /** How much darker the backdrop gets toward the corners (0..1). */
  vignette: number
  exposure: number
  fov: number
  /** The Color finish's paint, used when `colorSource` is 'paint'. */
  paint: string
  colorSource: ColorSource
  autoRotate: boolean
  rotateMode: RotateMode
  rotateSpeed: number
}

export const DEFAULT_GLASS_PARAMS: GlassParams = {
  finish: 'glass',
  geometry: 'extrude',
  reliefMm: 4,
  layerMm: 2,
  metalness: 1,
  shadow: 0.5,
  floor: false,
  flatten: 0,
  grain: 0,
  sheen: 0,
  weave: 0,
  soften: 0,
  widthMm: 100,
  depthMm: 14,
  bevelMm: 3.2,
  bevelSegments: 10,
  ior: 1.52,
  dispersion: 0.08,
  roughness: 0.08,
  clearcoat: 1,
  edgeChroma: 0.45,
  tir: 1,
  clarity: 1,
  blur: 0.15,
  tint: '#ffffff',
  attenuationMm: 400,
  envIntensity: 2.2,
  lightAngle: 0,
  // A pale cool wall that falls off to a mid grey: clear glass on a flat pale wall has nothing to
  // bend and washes out; against this tonal sweep it shows its rims, its dispersion and the room
  // it refracts, and the model reads as the brightest, sharpest thing on screen.
  background: '#f4f5f8',
  backdropFill: 'radial',
  background2: '#c9ced8',
  backdropAngle: 180,
  vignette: 0.4,
  exposure: 1,
  fov: 28,
  paint: '#e9e4dc',
  colorSource: 'picture',
  autoRotate: true,
  rotateMode: 'sway',
  rotateSpeed: 1.2,
}

export interface MaterialPreset {
  id: string
  label: string
  group: Finish
  /** CSS background for the swatch. */
  swatch: string
  values: Partial<GlassParams>
}

const glass = (v: Partial<GlassParams>): Partial<GlassParams> => ({
  finish: 'glass', ior: 1.52, dispersion: 0.08, roughness: 0.08, clearcoat: 1, edgeChroma: 0.45, tir: 1,
  clarity: 1, blur: 0.15, tint: '#ffffff', attenuationMm: 400, ...v,
})
const metal = (v: Partial<GlassParams>): Partial<GlassParams> => ({
  finish: 'metal', metalness: 1, roughness: 0.22, clearcoat: 0, tint: '#ffffff', ...v,
})
const print = (v: Partial<GlassParams>): Partial<GlassParams> => ({
  finish: 'print', metalness: 0, roughness: 0.5, clearcoat: 0, tint: '#ffffff', flatten: 0, grain: 0, sheen: 0, weave: 0, soften: 0, paint: '#e9e4dc', ...v,
})

/** One-click looks. Each sets every material key so switching presets is deterministic. */
export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'clear', label: 'Clear', group: 'glass', swatch: 'linear-gradient(135deg,#fff 0%,#dfe3ea 55%,#fff 100%)', values: glass({}) },
  { id: 'crystal', label: 'Crystal', group: 'glass', swatch: 'linear-gradient(135deg,#fff,#cfe1ff 45%,#ffd9c4 55%,#fff)', values: glass({ ior: 1.9, dispersion: 0.18, roughness: 0.02, edgeChroma: 0.6, tir: 1, blur: 0.05, attenuationMm: 600 }) },
  { id: 'frosted', label: 'Frosted', group: 'glass', swatch: 'linear-gradient(135deg,#f6f6f6,#dcdcdc)', values: glass({ ior: 1.45, dispersion: 0.03, roughness: 0.35, clearcoat: 0.4, edgeChroma: 0.1, tir: 0.5, clarity: 0.9, blur: 0.5 }) },
  { id: 'milk', label: 'Milk', group: 'glass', swatch: 'linear-gradient(135deg,#ffffff,#eef0f2)', values: glass({ roughness: 0.25, clarity: 0.55, blur: 0.6, edgeChroma: 0.05, tir: 0.4, clearcoat: 0.8 }) },
  { id: 'smoke', label: 'Smoke', group: 'glass', swatch: 'linear-gradient(135deg,#9a9a9e,#4a4a4f)', values: glass({ tint: '#5c5e66', attenuationMm: 42, edgeChroma: 0.15, tir: 0.9, dispersion: 0.05 }) },
  { id: 'obsidian', label: 'Obsidian', group: 'glass', swatch: 'linear-gradient(135deg,#3a3a3f,#0a0a0c)', values: glass({ tint: '#0b0b0d', attenuationMm: 2, roughness: 0.04, edgeChroma: 0.2, tir: 1, dispersion: 0.03 }) },
  { id: 'sapphire', label: 'Sapphire', group: 'glass', swatch: 'linear-gradient(135deg,#cfe0ff,#3d7bff)', values: glass({ tint: '#7fa8ff', attenuationMm: 45, edgeChroma: 0.2 }) },
  { id: 'emerald', label: 'Emerald', group: 'glass', swatch: 'linear-gradient(135deg,#c9f2dc,#1f9d6a)', values: glass({ tint: '#5fcf9a', attenuationMm: 40, dispersion: 0.1, ior: 1.58 }) },
  { id: 'amber', label: 'Amber', group: 'glass', swatch: 'linear-gradient(135deg,#ffe3b0,#e0851a)', values: glass({ tint: '#f4b054', attenuationMm: 36, dispersion: 0.06, edgeChroma: 0.1 }) },
  { id: 'rose', label: 'Rosé', group: 'glass', swatch: 'linear-gradient(135deg,#ffe4ec,#ff8fb0)', values: glass({ tint: '#ff9ab8', attenuationMm: 45, edgeChroma: 0.25 }) },
  { id: 'amethyst', label: 'Amethyst', group: 'glass', swatch: 'linear-gradient(135deg,#f0e6ff,#9a6cf0)', values: glass({ tint: '#b796ff', attenuationMm: 44, edgeChroma: 0.25 }) },
  { id: 'holo', label: 'Holo', group: 'glass', swatch: 'linear-gradient(135deg,#ffd1f0,#c8e7ff 40%,#d9ffe1 70%,#fff2c2)', values: glass({ edgeChroma: 1, dispersion: 0.3, ior: 1.7, tir: 0.7, blur: 0.1 }) },
  { id: 'gold', label: 'Gold', group: 'metal', swatch: 'linear-gradient(135deg,#fff1b8,#d4a017 55%,#8a6508)', values: metal({ tint: '#e4b84a', roughness: 0.2 }) },
  { id: 'rosegold', label: 'Rose gold', group: 'metal', swatch: 'linear-gradient(135deg,#ffe0d0,#d9946f 55%,#8e5a45)', values: metal({ tint: '#d9a08a', roughness: 0.22 }) },
  { id: 'chrome', label: 'Chrome', group: 'metal', swatch: 'linear-gradient(135deg,#ffffff,#b8bcc4 50%,#5d6169)', values: metal({ tint: '#f2f3f5', roughness: 0.06 }) },
  { id: 'silver', label: 'Brushed', group: 'metal', swatch: 'linear-gradient(135deg,#e6e7ea,#a9acb3 55%,#7d8188)', values: metal({ tint: '#d8d9dc', roughness: 0.42 }) },
  { id: 'champagne', label: 'Champagne', group: 'metal', swatch: 'linear-gradient(135deg,#f4ede3,#c9b394 55%,#8c7558)', values: metal({ tint: '#d9c6a8', roughness: 0.38 }) },
  { id: 'copper', label: 'Copper', group: 'metal', swatch: 'linear-gradient(135deg,#ffc9a8,#c06a3a 55%,#6e3517)', values: metal({ tint: '#c8734a', roughness: 0.26 }) },
  { id: 'titanium', label: 'Titanium', group: 'metal', swatch: 'linear-gradient(135deg,#8f939b,#4f535a 55%,#2a2d32)', values: metal({ tint: '#5f636b', roughness: 0.34 }) },
  { id: 'black', label: 'Black', group: 'metal', swatch: 'linear-gradient(135deg,#3a3b40,#111114)', values: metal({ tint: '#15161a', metalness: 0.35, roughness: 0.32, clearcoat: 0.9 }) },
  { id: 'bronze', label: 'Bronze', group: 'metal', swatch: 'linear-gradient(135deg,#f0c994,#a86f35 55%,#5c3a17)', values: metal({ tint: '#b47d45', roughness: 0.3 }) },
  { id: 'gunmetal', label: 'Gunmetal', group: 'metal', swatch: 'linear-gradient(135deg,#a3a8b0,#4a4f57 55%,#202328)', values: metal({ tint: '#5c616b', roughness: 0.2 }) },
  { id: 'cobalt', label: 'Cobalt', group: 'metal', swatch: 'linear-gradient(135deg,#c9d9ff,#3f6fd8 55%,#1d3a80)', values: metal({ tint: '#4a78de', roughness: 0.3 }) },
  { id: 'ceramic', label: 'Ceramic', group: 'metal', swatch: 'linear-gradient(135deg,#ffffff,#eceff3)', values: metal({ tint: '#f4f4f2', metalness: 0, roughness: 0.28, clearcoat: 1 }) },
  // Surfaces for the Color finish. Roughness, sheen and lacquer follow measured dielectric
  // responses (matte cotton ~0.85 with sheen, velvet sheen 1, leather ~0.62 with a trace of coat,
  // fired clay ~0.9, lacquer under a full coat). Each carries a paint, used when the model is
  // painted (the default for a black, white or grey mark, where the picture's own colour would make
  // every surface the same black); in picture mode the picture's colours show instead, de-lit so
  // the studio lights them, with their grain catching the light as a normal map.
  { id: 'natural', label: 'Natural', group: 'print', swatch: '#ece5dc', values: print({ paint: '#ece5dc', roughness: 0.68, clearcoat: 0, flatten: 0.55, grain: 0.5, sheen: 0.15 }) },
  // Fabric is the reference upholstery to the number: a flat colour under roughness 0.88, no
  // coat, no sheen, a fine uniform weave. The photo is de-lit and softened into that flat colour
  // (its own grain would stretch where it was projected at an angle) and the weave is procedural.
  { id: 'fabric', label: 'Fabric', group: 'print', swatch: '#c9bca9', values: print({ paint: '#c9bca9', roughness: 0.88, clearcoat: 0, flatten: 0.85, grain: 0, sheen: 0, weave: 1, soften: 0.6 }) },
  { id: 'velvet', label: 'Velvet', group: 'print', swatch: '#6b2a4a', values: print({ paint: '#6b2a4a', roughness: 0.72, clearcoat: 0, flatten: 0.8, grain: 0, sheen: 1, weave: 0.5, soften: 0.6 }) },
  { id: 'leather', label: 'Leather', group: 'print', swatch: '#7b4a2c', values: print({ paint: '#7b4a2c', roughness: 0.62, clearcoat: 0.08, flatten: 0.5, grain: 0.7, sheen: 0.1 }) },
  { id: 'clay', label: 'Clay', group: 'print', swatch: '#c46a4a', values: print({ paint: '#c46a4a', roughness: 0.92, clearcoat: 0, flatten: 0.45, grain: 0.3, sheen: 0 }) },
  { id: 'lacquer', label: 'Lacquer', group: 'print', swatch: '#b3202c', values: print({ paint: '#b3202c', roughness: 0.3, clearcoat: 1, flatten: 0.4, grain: 0, sheen: 0 }) },
  { id: 'matte', label: 'Matte', group: 'print', swatch: '#34373e', values: print({ paint: '#34373e', roughness: 0.62, clearcoat: 0, flatten: 0.3, grain: 0.25 }) },
  { id: 'satin', label: 'Satin', group: 'print', swatch: '#eceef2', values: print({ paint: '#eceef2', roughness: 0.4, clearcoat: 0.35, flatten: 0.3, grain: 0.15 }) },
  { id: 'gloss', label: 'Gloss', group: 'print', swatch: '#2457d6', values: print({ paint: '#2457d6', roughness: 0.18, clearcoat: 1, flatten: 0.2 }) },
  { id: 'acrylic', label: 'Acrylic', group: 'print', swatch: '#ff8fae', values: print({ paint: '#ff8fae', roughness: 0.06, clearcoat: 1 }) },
  { id: 'silk', label: 'Silk', group: 'print', swatch: '#d8c09a', values: print({ paint: '#d8c09a', roughness: 0.45, clearcoat: 0, flatten: 0.5, grain: 0, sheen: 0.6, weave: 0.2, soften: 0.3 }) },
  { id: 'rubber', label: 'Rubber', group: 'print', swatch: '#2a2b2f', values: print({ paint: '#2a2b2f', roughness: 0.95, clearcoat: 0, flatten: 0.35, grain: 0, sheen: 0.05 }) },
]

/** The preset these parameters currently match exactly, or null once any of its values is tuned. */
export function activePresetId(g: GlassParams): string | null {
  return MATERIAL_PRESETS.find(p => Object.entries(p.values).every(([k, v]) => g[k as keyof GlassParams] === v))?.id ?? null
}

/** Apply a preset in place: it sets every material key, so the result is the same from any start. */
export function applyPreset(g: GlassParams, p: MaterialPreset): void {
  Object.assign(g, p.values)
}

export interface BackdropPreset {
  id: string
  label: string
  values: Pick<GlassParams, 'background' | 'backdropFill' | 'background2' | 'backdropAngle' | 'vignette'>
}

const backdrop = (id: string, label: string, background: string, backdropFill: BackdropFill = 'solid', background2 = background, backdropAngle = 180, vignette = 0.4): BackdropPreset =>
  ({ id, label, values: { background, backdropFill, background2, backdropAngle, vignette } })

/**
 * One-click sets. Pale ones first: clear glass needs a wall with some tone to show its rims, so
 * nothing here is pure white without a falloff. The darks suit metal and the coloured glasses.
 */
export const BACKDROP_PRESETS: BackdropPreset[] = [
  backdrop('studio', 'Studio', '#f4f5f8', 'radial', '#c9ced8', 180, 0.4),
  backdrop('paper', 'Paper', '#ffffff', 'linear', '#dcdfe5', 180, 0.15),
  backdrop('wall', 'Wall', '#e6e8ec'),
  backdrop('azure', 'Azure', '#e3edff', 'radial', '#8fb4f2', 180, 0.25),
  backdrop('sky', 'Sky', '#cfe1ff', 'linear', '#f6f8fc', 0, 0.15),
  backdrop('sand', 'Sand', '#f6efe6', 'radial', '#e3d3bf', 180, 0.2),
  backdrop('blush', 'Blush', '#fbeaec', 'linear', '#e9d6f2', 135, 0.15),
  backdrop('graphite', 'Graphite', '#3a3d45', 'radial', '#16171b', 180, 0.3),
  backdrop('ink', 'Ink', '#1c1c1f', 'solid', '#1c1c1f', 180, 0.5),
  backdrop('night', 'Night', '#1d3a74', 'radial', '#070b16', 180, 0.3),
]

/** CSS for a backdrop swatch: the same fill the stage paints, so a tile previews its set. */
export function backdropCss(v: BackdropPreset['values'] | GlassParams): string {
  if (v.backdropFill === 'linear') return `linear-gradient(${v.backdropAngle}deg, ${v.background}, ${v.background2})`
  if (v.backdropFill === 'radial') return `radial-gradient(circle at 50% 46%, ${v.background}, ${v.background2} 78%)`
  return `radial-gradient(circle at 50% 46%, ${v.background} 40%, color-mix(in srgb, ${v.background}, #000 ${Math.round(v.vignette * 30)}%))`
}

/** The backdrop these parameters match, or null once a colour or the fill is tuned (vignette aside). */
export function activeBackdropId(g: GlassParams): string | null {
  return BACKDROP_PRESETS.find(({ values: v }) =>
    v.background === g.background && v.backdropFill === g.backdropFill
    && (v.backdropFill === 'solid' || (v.background2 === g.background2 && (v.backdropFill !== 'linear' || v.backdropAngle === g.backdropAngle))),
  )?.id ?? null
}
