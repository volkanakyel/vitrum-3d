export interface Dims { widthMm: number; heightMm: number; depthMm: number }
export interface View { name: string; yaw: number; pitch: number; fov: number; distance: number }
export type PassId = 'blockout' | 'structural' | 'form' | 'material' | 'surface'
export const PASSES: readonly PassId[] = ['blockout', 'structural', 'form', 'material', 'surface']
export type ReviewAction = 'continue' | 'refine-code' | 'refine-spec' | 'request-input' | 'stop'

export interface Intake {
  name: string
  objectClass: string
  suitability: { verdict: 'pass' | 'conditional' | 'reject'; reasons: string[] }
  symmetry: 'left-right' | 'none'
  camera: { yaw: number; pitch: number; fov: number; distance: number; confidence: number }
  dimensions: { widthM: number; heightM: number; depthM: number; source: 'user' | 'estimated' }
  detailInventory: { id: string; zone: string; kind: string; evidence: string }[]
  materialsSeen: { zone: string; family: string; subtype: string; colorHex: string; finish: string }[]
  notes: string[]
}

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

export interface SculptSpec {
  name: string
  id: string
  camera: Intake['camera']
  dimensions: Intake['dimensions']
  symmetry: Intake['symmetry']
  suitability: Intake['suitability']
  detailInventory: Intake['detailInventory']
  components: SculptComponent[]
  materials: SculptMaterial[]
  repetition: { id: string; kind: 'mirror' | 'linear'; count: number; pitch: number; axis: 'x' | 'y' | 'z'; target: string }[]
  reviewViews: ('reference' | 'front' | 'side' | 'top')[]
  mustMatch: string[]
  niceToHave: string[]
}

export interface Review {
  action: ReviewAction
  fidelity: number
  layers: { silhouetteProportion: number; componentStructure: number; formDetail: number; materialSurface: number; lightingCamera: number }
  defects: { component: string; what: string; measured: string; fix: string }[]
  cameraAdjust?: { yaw: number; pitch: number; fov: number; distance: number }
  question?: string
  summary: string
}

export interface BuildOutput { code: string; notes: string[] }
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
