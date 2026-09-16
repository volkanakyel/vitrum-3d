import { z } from 'zod'
import type { BuildOutput, DraftOutput, Review, SculptSpec } from '../../../app/utils/sculpt/types'

const suitabilitySchema = z.strictObject({
  verdict: z.enum(['pass', 'conditional', 'reject']),
  reasons: z.array(z.string()),
})

const cameraSchema = z.strictObject({
  yaw: z.number(),
  pitch: z.number(),
  fov: z.number(),
  distance: z.number(),
  confidence: z.number(),
})

const dimensionsIntakeSchema = z.strictObject({
  widthM: z.number(),
  heightM: z.number(),
  depthM: z.number(),
  source: z.enum(['user', 'estimated']),
})

const detailInventorySchema = z.strictObject({
  id: z.string(),
  zone: z.string(),
  kind: z.string(),
  evidence: z.string(),
})

const componentDimensionsSchema = z.strictObject({
  w: z.number(),
  h: z.number(),
  d: z.number(),
})

const vec3Schema = z.tuple([z.number(), z.number(), z.number()])

const edgeSchema = z.strictObject({
  radius: z.number(),
  segments: z.number(),
})

const attachmentSchema = z.strictObject({
  parent: z.string(),
  contact: z.enum(['rests-on', 'inserted', 'wrapped', 'bolted']),
  overlap: z.number(),
}).nullable()

const localFeatureSchema = z.strictObject({
  id: z.string(),
  kind: z.string(),
  description: z.string(),
  evidence: z.string(),
})

const printSchema = z.strictObject({
  photo: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  band: z.tuple([z.number(), z.number()]),
  mode: z.enum(['ink', 'photo']),
})

const componentSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  level: z.enum(['macro', 'meso', 'micro']),
  parent: z.string().nullable(),
  importance: z.number(),
  confidence: z.number(),
  primitive: z.enum(['box', 'roundedBox', 'pillow', 'cylinder', 'capsule', 'torus', 'tube', 'bentTube', 'lathe', 'extrude', 'sweep', 'instanced']),
  dimensions: componentDimensionsSchema,
  position: vec3Schema,
  rotation: vec3Schema,
  edge: edgeSchema,
  attachment: attachmentSchema,
  material: z.string(),
  localFeatures: z.array(localFeatureSchema),
  print: printSchema.optional(),
})

const patternSchema = z.strictObject({
  kind: z.string(),
  scale: z.number(),
  amplitude: z.number(),
})

const weaveSchema = z.strictObject({
  threadsPerCm: z.number(),
  contrast: z.number(),
})

const wearSchema = z.strictObject({
  edge: z.number(),
  dirt: z.number(),
})

const materialSchema = z.strictObject({
  id: z.string(),
  family: z.enum(['fabric', 'leather', 'wood', 'metal', 'plastic', 'glass', 'stone']),
  subtype: z.string(),
  baseColor: z.string(),
  roughness: z.number(),
  metalness: z.number(),
  sheen: z.number(),
  clearcoat: z.number(),
  pattern: patternSchema,
  weave: weaveSchema.optional(),
  wear: wearSchema,
})

const repetitionSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(['mirror', 'linear']),
  count: z.number(),
  pitch: z.number(),
  axis: z.enum(['x', 'y', 'z']),
  target: z.string(),
})

export const specSchema: z.ZodType<SculptSpec> = z.strictObject({
  name: z.string(),
  id: z.string(),
  objectClass: z.string(),
  suitability: suitabilitySchema,
  symmetry: z.enum(['left-right', 'none']),
  camera: cameraSchema,
  dimensions: dimensionsIntakeSchema,
  detailInventory: z.array(detailInventorySchema),
  notes: z.array(z.string()),
  components: z.array(componentSchema),
  materials: z.array(materialSchema),
  repetition: z.array(repetitionSchema),
  mustMatch: z.array(z.string()),
  niceToHave: z.array(z.string()),
})

const layersSchema = z.strictObject({
  silhouetteProportion: z.number(),
  componentStructure: z.number(),
  formDetail: z.number(),
  materialSurface: z.number(),
  lightingCamera: z.number(),
})

const defectSchema = z.strictObject({
  component: z.string(),
  what: z.string(),
  measured: z.string(),
  fix: z.string(),
})

export const reviewSchema: z.ZodType<Review> = z.strictObject({
  fidelity: z.number(),
  layers: layersSchema,
  defects: z.array(defectSchema),
  summary: z.string(),
})

export const buildSchema: z.ZodType<BuildOutput> = z.strictObject({
  code: z.string(),
  notes: z.array(z.string()),
})

export const draftSchema: z.ZodType<DraftOutput> = z.strictObject({
  spec: specSchema,
  code: z.string(),
  notes: z.array(z.string()),
})

export function toolSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>
  delete json.$schema
  if (json.additionalProperties === undefined) json.additionalProperties = false
  relaxTuples(json)
  return json
}

/**
 * Strict tool schemas accept neither `prefixItems` nor `minItems` above 1, so a
 * fixed-length tuple (`[x, y, z]`) is offered to the model as a plain array of
 * its element type with the length stated in the description. The zod schema
 * still enforces the exact length when the answer comes back.
 */
function relaxTuples(node: unknown): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) relaxTuples(item)
    return
  }
  const o = node as Record<string, unknown>
  const prefix = o.prefixItems
  if (Array.isArray(prefix) && prefix.length > 0) {
    const first = JSON.stringify(prefix[0])
    const uniform = prefix.every(p => JSON.stringify(p) === first)
    o.items = uniform ? prefix[0] : { anyOf: prefix }
    const existing = typeof o.description === 'string' ? `${o.description} ` : ''
    o.description = `${existing}Exactly ${prefix.length} items.`
    delete o.prefixItems
    delete o.minItems
    delete o.maxItems
  }
  for (const value of Object.values(o)) relaxTuples(value)
}

export function validateSpec(spec: unknown): { ok: true; spec: SculptSpec } | { ok: false; errors: string[] } {
  const parsed = specSchema.safeParse(spec)
  if (!parsed.success) {
    const errors = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
    return { ok: false, errors }
  }

  const s = parsed.data
  const errors: string[] = []

  const ids = new Set<string>()
  for (const c of s.components) {
    if (ids.has(c.id)) errors.push(`duplicate component id: ${c.id}`)
    ids.add(c.id)
  }

  for (const c of s.components) {
    if (c.parent !== null && !ids.has(c.parent)) {
      errors.push(`component ${c.id}: parent references unknown component: ${c.parent}`)
    }
    if (c.attachment !== null && !ids.has(c.attachment.parent)) {
      errors.push(`component ${c.id}: attachment.parent references unknown component: ${c.attachment.parent}`)
    }
    if (!s.materials.some(m => m.id === c.material)) {
      errors.push(`component ${c.id}: material references unknown material: ${c.material}`)
    }
  }

  for (const r of s.repetition) {
    if (!ids.has(r.target)) {
      errors.push(`repetition ${r.id}: target references unknown component: ${r.target}`)
    }
  }

  const roots = s.components.filter(c => c.parent === null)
  if (roots.length !== 1) {
    errors.push(`expected exactly one root component (parent === null), found ${roots.length}`)
  }

  if (!(s.dimensions.widthM > 0) || !(s.dimensions.heightM > 0) || !(s.dimensions.depthM > 0)) {
    errors.push('dimensions must be positive')
  }

  for (const c of s.components) {
    const p = c.print
    if (!p) continue
    const unit = (v: number) => v >= 0 && v <= 1
    if (!p.photo.every(unit) || p.photo[2] <= p.photo[0] || p.photo[3] <= p.photo[1]) {
      errors.push(`component ${c.id}: print.photo must be [x0, y0, x1, y1] in 0..1 with x1 > x0 and y1 > y0`)
    }
    if (!p.band.every(unit) || p.band[1] <= p.band[0]) {
      errors.push(`component ${c.id}: print.band must be [bottom, top] in 0..1 with top > bottom`)
    }
  }

  const macroCount = s.components.filter(c => c.level === 'macro').length
  if (macroCount < 1) {
    errors.push('spec must have at least one macro component')
  }

  if (s.mustMatch.length < 1) {
    errors.push('mustMatch must be non-empty')
  }

  if (s.camera.fov < 20 || s.camera.fov > 70) {
    errors.push(`camera.fov must be between 20 and 70, got ${s.camera.fov}`)
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, spec: s }
}
