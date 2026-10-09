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
  background: string
  /** How much darker the backdrop gets toward the corners (0..1). */
  vignette: number
  exposure: number
  fov: number
  autoRotate: boolean
  rotateSpeed: number
}

export const DEFAULT_GLASS_PARAMS: GlassParams = {
  finish: 'glass',
  geometry: 'extrude',
  reliefMm: 4,
  layerMm: 2,
  metalness: 1,
  shadow: 0.35,
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
  // A mid-grey wall with a real vignette: clear glass on a white wall is invisible, on this it
  // shows its rims, its dispersion and the room it refracts.
  background: '#e6e9ef',
  vignette: 0.5,
  exposure: 1,
  fov: 28,
  autoRotate: true,
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
  finish: 'print', metalness: 0, roughness: 0.5, clearcoat: 0, tint: '#ffffff', flatten: 0, grain: 0, sheen: 0, weave: 0, soften: 0, ...v,
})

/** One-click looks. Each sets every material key so switching presets is deterministic. */
export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'clear', label: 'Clear', group: 'glass', swatch: 'linear-gradient(135deg,#fff 0%,#dfe3ea 55%,#fff 100%)', values: glass({}) },
  { id: 'crystal', label: 'Crystal', group: 'glass', swatch: 'linear-gradient(135deg,#fff,#cfe1ff 45%,#ffd9c4 55%,#fff)', values: glass({ ior: 1.9, dispersion: 0.18, roughness: 0.02, edgeChroma: 0.6, tir: 1, blur: 0.05, attenuationMm: 600 }) },
  { id: 'frosted', label: 'Frosted', group: 'glass', swatch: 'linear-gradient(135deg,#f6f6f6,#dcdcdc)', values: glass({ ior: 1.45, dispersion: 0.03, roughness: 0.35, clearcoat: 0.4, edgeChroma: 0.1, tir: 0.5, clarity: 0.9, blur: 0.5 }) },
  { id: 'milk', label: 'Milk', group: 'glass', swatch: 'linear-gradient(135deg,#ffffff,#eef0f2)', values: glass({ roughness: 0.25, clarity: 0.55, blur: 0.6, edgeChroma: 0.05, tir: 0.4, clearcoat: 0.8 }) },
  { id: 'smoke', label: 'Smoke', group: 'glass', swatch: 'linear-gradient(135deg,#9a9a9e,#4a4a4f)', values: glass({ tint: '#3a3a40', attenuationMm: 18, edgeChroma: 0.15, tir: 0.9, dispersion: 0.05 }) },
  { id: 'obsidian', label: 'Obsidian', group: 'glass', swatch: 'linear-gradient(135deg,#3a3a3f,#0a0a0c)', values: glass({ tint: '#0b0b0d', attenuationMm: 2, roughness: 0.04, edgeChroma: 0.2, tir: 1, dispersion: 0.03 }) },
  { id: 'sapphire', label: 'Sapphire', group: 'glass', swatch: 'linear-gradient(135deg,#cfe0ff,#3d7bff)', values: glass({ tint: '#7fa8ff', attenuationMm: 45, edgeChroma: 0.2 }) },
  { id: 'emerald', label: 'Emerald', group: 'glass', swatch: 'linear-gradient(135deg,#c9f2dc,#1f9d6a)', values: glass({ tint: '#5fcf9a', attenuationMm: 40, dispersion: 0.1, ior: 1.58 }) },
  { id: 'amber', label: 'Amber', group: 'glass', swatch: 'linear-gradient(135deg,#ffe3b0,#e0851a)', values: glass({ tint: '#f4b054', attenuationMm: 36, dispersion: 0.06, edgeChroma: 0.1 }) },
  { id: 'rose', label: 'Rosé', group: 'glass', swatch: 'linear-gradient(135deg,#ffe4ec,#ff8fb0)', values: glass({ tint: '#ff9ab8', attenuationMm: 45, edgeChroma: 0.25 }) },
  { id: 'holo', label: 'Holo', group: 'glass', swatch: 'linear-gradient(135deg,#ffd1f0,#c8e7ff 40%,#d9ffe1 70%,#fff2c2)', values: glass({ edgeChroma: 1, dispersion: 0.3, ior: 1.7, tir: 0.7, blur: 0.1 }) },
  { id: 'gold', label: 'Gold', group: 'metal', swatch: 'linear-gradient(135deg,#fff1b8,#d4a017 55%,#8a6508)', values: metal({ tint: '#e4b84a', roughness: 0.2 }) },
  { id: 'rosegold', label: 'Rose gold', group: 'metal', swatch: 'linear-gradient(135deg,#ffe0d0,#d9946f 55%,#8e5a45)', values: metal({ tint: '#d9a08a', roughness: 0.22 }) },
  { id: 'chrome', label: 'Chrome', group: 'metal', swatch: 'linear-gradient(135deg,#ffffff,#b8bcc4 50%,#5d6169)', values: metal({ tint: '#f2f3f5', roughness: 0.06 }) },
  { id: 'silver', label: 'Brushed', group: 'metal', swatch: 'linear-gradient(135deg,#e6e7ea,#a9acb3 55%,#7d8188)', values: metal({ tint: '#d8d9dc', roughness: 0.42 }) },
  { id: 'champagne', label: 'Champagne', group: 'metal', swatch: 'linear-gradient(135deg,#f4ede3,#c9b394 55%,#8c7558)', values: metal({ tint: '#d9c6a8', roughness: 0.38 }) },
  { id: 'copper', label: 'Copper', group: 'metal', swatch: 'linear-gradient(135deg,#ffc9a8,#c06a3a 55%,#6e3517)', values: metal({ tint: '#c8734a', roughness: 0.26 }) },
  { id: 'titanium', label: 'Titanium', group: 'metal', swatch: 'linear-gradient(135deg,#8f939b,#4f535a 55%,#2a2d32)', values: metal({ tint: '#5f636b', roughness: 0.34 }) },
  { id: 'black', label: 'Black', group: 'metal', swatch: 'linear-gradient(135deg,#3a3b40,#111114)', values: metal({ tint: '#15161a', metalness: 0.35, roughness: 0.32, clearcoat: 0.9 }) },
  // Photographed objects. Roughness, sheen and lacquer follow measured dielectric responses
  // (matte cotton ~0.85 with sheen, velvet sheen 1, leather ~0.62 with a trace of coat, bare wood
  // ~0.72, varnished wood ~0.42 under a 0.75 coat). The picture's own shading is divided out so
  // the studio lights it, and its grain catches the light as a normal map.
  { id: 'natural', label: 'Natural', group: 'print', swatch: 'linear-gradient(135deg,#f7f3ee,#d8cfc4 60%,#efe9e2)', values: print({ roughness: 0.68, clearcoat: 0, flatten: 0.55, grain: 0.5, sheen: 0.15 }) },
  // Fabric is the reference upholstery to the number: a flat colour under roughness 0.88, no
  // coat, no sheen, a fine uniform weave. The photo is de-lit and softened into that flat colour
  // (its own grain would stretch where it was projected at an angle) and the weave is procedural.
  { id: 'fabric', label: 'Fabric', group: 'print', swatch: 'repeating-linear-gradient(45deg,#e8ddd2 0 2px,#cfc2b4 2px 4px)', values: print({ roughness: 0.88, clearcoat: 0, flatten: 0.85, grain: 0, sheen: 0, weave: 1, soften: 0.6 }) },
  { id: 'velvet', label: 'Velvet', group: 'print', swatch: 'radial-gradient(circle at 35% 30%,#6b2a4a,#2a0f1e 70%)', values: print({ roughness: 0.72, clearcoat: 0, flatten: 0.8, grain: 0, sheen: 1, weave: 0.5, soften: 0.6 }) },
  { id: 'leather', label: 'Leather', group: 'print', swatch: 'linear-gradient(135deg,#8a5a3c,#4a2c1a 60%,#6b4630)', values: print({ roughness: 0.62, clearcoat: 0.08, flatten: 0.5, grain: 0.7, sheen: 0.1 }) },
  { id: 'wood', label: 'Wood', group: 'print', swatch: 'repeating-linear-gradient(100deg,#c9a071 0 3px,#a87c4f 3px 5px,#b98c5e 5px 9px)', values: print({ roughness: 0.72, clearcoat: 0, flatten: 0.45, grain: 0.6, sheen: 0 }) },
  { id: 'varnished', label: 'Varnished', group: 'print', swatch: 'linear-gradient(135deg,#fff3dc 0%,#b8834a 45%,#7a4d24 60%,#e9c89a 100%)', values: print({ roughness: 0.42, clearcoat: 0.75, flatten: 0.4, grain: 0.45, sheen: 0 }) },
  { id: 'matte', label: 'Matte', group: 'print', swatch: 'linear-gradient(135deg,#f3f1ec,#d9d6cf)', values: print({ roughness: 0.62, clearcoat: 0, flatten: 0.3, grain: 0.25 }) },
  { id: 'satin', label: 'Satin', group: 'print', swatch: 'linear-gradient(135deg,#ffffff,#e2e5ea 60%,#f6f7f9)', values: print({ roughness: 0.4, clearcoat: 0.35, flatten: 0.3, grain: 0.15 }) },
  { id: 'gloss', label: 'Gloss', group: 'print', swatch: 'linear-gradient(135deg,#ffffff 0%,#d7dbe2 50%,#ffffff 100%)', values: print({ roughness: 0.18, clearcoat: 1, flatten: 0.2 }) },
  { id: 'acrylic', label: 'Acrylic', group: 'print', swatch: 'linear-gradient(135deg,#ffffff,#cfe0ff 55%,#ffffff)', values: print({ roughness: 0.06, clearcoat: 1 }) },
  { id: 'ceramic', label: 'Ceramic', group: 'metal', swatch: 'linear-gradient(135deg,#ffffff,#eceff3)', values: metal({ tint: '#f4f4f2', metalness: 0, roughness: 0.28, clearcoat: 1 }) },
]

/** The preset these parameters currently match exactly, or null once any of its values is tuned. */
export function activePresetId(g: GlassParams): string | null {
  return MATERIAL_PRESETS.find(p => Object.entries(p.values).every(([k, v]) => g[k as keyof GlassParams] === v))?.id ?? null
}

/** Apply a preset in place: it sets every material key, so the result is the same from any start. */
export function applyPreset(g: GlassParams, p: MaterialPreset): void {
  Object.assign(g, p.values)
}

/** @deprecated kept for older imports; use MATERIAL_PRESETS. */
export const GLASS_PRESETS = MATERIAL_PRESETS.filter(p => p.group === 'glass').map(p => ({ id: p.id, label: p.label, values: p.values }))
