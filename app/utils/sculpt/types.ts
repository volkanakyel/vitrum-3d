export interface Dims { widthMm: number; heightMm: number; depthMm: number }
export interface View { name: string; yaw: number; pitch: number; fov: number; distance: number }

/** The photographer's orbit around the object's centre: degrees, and distance in bounding radii. */
export interface Camera { yaw: number; pitch: number; fov: number; distance: number; confidence: number }
export interface Dimensions { widthM: number; heightM: number; depthM: number; source: 'user' | 'estimated' }
export interface DetailEntry { id: string; zone: string; kind: string; evidence: string }

export interface SculptComponent {
  id: string
  name: string
  level: 'macro' | 'meso' | 'micro'
  parent: string | null
  importance: number
  confidence: number
  primitive: 'box' | 'roundedBox' | 'pillow' | 'cylinder' | 'capsule' | 'torus' | 'tube' | 'bentTube' | 'lathe' | 'extrude' | 'sweep' | 'instanced'
  dimensions: { w: number; h: number; d: number }
  position: [number, number, number]
  rotation: [number, number, number]
  edge: { radius: number; segments: number }
  attachment: { parent: string; contact: 'rests-on' | 'inserted' | 'wrapped' | 'bolted'; overlap: number } | null
  material: string
  localFeatures: { id: string; kind: string; description: string; evidence: string }[]
  /** Printed artwork on this part, cut from the photo: see `kit.print`. */
  print?: PrintRegion
}

export interface PrintRegion {
  /** Crop of the photo carrying the artwork: [x0, y0, x1, y1] in 0..1 of the image, origin top-left. */
  photo: [number, number, number, number]
  /** Where it sits on the part: [bottom, top] in 0..1 of the part's height. */
  band: [number, number]
  /** `ink`: dark print on a plain body. `photo`: full-colour artwork. */
  mode: 'ink' | 'photo'
}

export interface SculptMaterial {
  id: string
  family: 'fabric' | 'leather' | 'wood' | 'metal' | 'plastic' | 'glass' | 'stone'
  subtype: string
  baseColor: string
  roughness: number
  metalness: number
  sheen: number
  clearcoat: number
  pattern: { kind: string; scale: number; amplitude: number }
  weave?: { threadsPerCm: number; contrast: number }
  wear: { edge: number; dirt: number }
}

/**
 * The plan: what the photo shows and how to build it, in one document. The
 * builder sees the photo too, but every number it needs is here in metres.
 */
export interface SculptSpec {
  name: string
  id: string
  objectClass: string
  suitability: { verdict: 'pass' | 'conditional' | 'reject'; reasons: string[] }
  symmetry: 'left-right' | 'none'
  camera: Camera
  dimensions: Dimensions
  detailInventory: DetailEntry[]
  /** Inferences and things the single view cannot show. */
  notes: string[]
  components: SculptComponent[]
  materials: SculptMaterial[]
  repetition: { id: string; kind: 'mirror' | 'linear'; count: number; pitch: number; axis: 'x' | 'y' | 'z'; target: string }[]
  mustMatch: string[]
  niceToHave: string[]
}

export interface Defect { component: string; what: string; measured: string; fix: string }

export interface Review {
  fidelity: number
  layers: { silhouetteProportion: number; componentStructure: number; formDetail: number; materialSurface: number; lightingCamera: number }
  defects: Defect[]
  summary: string
}

export interface BuildOutput { code: string; notes: string[] }
/** The one-call draft: the plan and the code that builds it. */
export interface DraftOutput { spec: SculptSpec; code: string; notes: string[] }
/** World-space box of one part after the last load, metres, root already centred. */
export interface PartBounds { id: string; min: [number, number, number]; max: [number, number, number] }
export interface Usage { input: number; output: number }
export interface ApiOk<T> { ok: true; data: T; usage: Usage; costUsd: number }
export interface ApiErr {
  ok: false
  error: string
  /** Tokens spent before the request failed (validation after a paid call). */
  usage?: Usage
  costUsd?: number
}
export type ApiResult<T> = ApiOk<T> | ApiErr
