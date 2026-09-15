import { PASSES } from '../../../app/utils/sculpt/types'
import type { ApiResult, BuildOutput, Intake, PassId, Review, SculptSpec, Usage } from '../../../app/utils/sculpt/types'
import { buildSchema, intakeSchema, reviewSchema, specSchema, toolSchema, validateSpec } from './schema'
import { validateCode } from './validateCode'
import { PROMPTS } from './prompts'
import type { CallTool, ImageMediaType, ToolResult, UserPart } from './anthropic'

export interface RouteCfg {
  /** Model that writes the intake, the spec and the code. */
  modelAuthor: string
  /** Model that reviews the renders. */
  modelReview: string
}

export const DEFAULT_ROUTE_CFG: RouteCfg = {
  modelAuthor: 'claude-opus-5',
  modelReview: 'claude-sonnet-5',
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
/**
 * The same cap measured in base64 characters, so an oversized payload is
 * refused on its `.length` before anything decodes it: `Buffer.from` on a
 * hostile string would allocate the decoded copy first and complain after.
 * 4/3 is base64's expansion, plus slack for the data-URL prefix, padding and
 * any line breaks.
 */
const MAX_IMAGE_BASE64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024
/** Below this a reviewer's `stop` is honoured before the surface pass. */
const HOPELESS_FIDELITY = 0.35

/** A tally that grows across the retries of one request. */
class Tally {
  usage: Usage = { input: 0, output: 0 }
  costUsd = 0

  add<T>(result: ToolResult<T>): T {
    this.usage = {
      input: this.usage.input + result.usage.input,
      output: this.usage.output + result.usage.output,
    }
    this.costUsd += result.costUsd
    return result.data
  }

  ok<T>(data: T): ApiResult<T> {
    return { ok: true, data, usage: this.usage, costUsd: this.costUsd }
  }

  /** A failure after paid calls: the spend still reaches the daily ceiling. */
  fail(error: string): ApiResult<never> {
    return { ok: false, error, usage: this.usage, costUsd: this.costUsd }
  }
}

function fail(error: string): ApiResult<never> {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Accepts a bare base64 payload or a data URL; the media type comes from the bytes. */
function parseImage(value: unknown, label: string): { ok: true, part: UserPart } | { ok: false, error: string } {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, error: `${label} must be a base64-encoded JPEG or PNG` }
  }
  if (value.length > MAX_IMAGE_BASE64_CHARS) {
    return { ok: false, error: `${label} is larger than the 4 MB limit` }
  }
  const base64 = value.replace(/^data:image\/(?:jpeg|jpg|png);base64,/, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, error: `${label} is not valid base64` }
  }

  const bytes = Buffer.from(base64, 'base64')
  const isPng = bytes.length > 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
  const isJpeg = bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF
  if (!isPng && !isJpeg) {
    return { ok: false, error: `${label} must be a JPEG or a PNG` }
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    const mb = (bytes.length / (1024 * 1024)).toFixed(1)
    return { ok: false, error: `${label} is ${mb} MB; the limit is 4 MB` }
  }

  const mediaType: ImageMediaType = isPng ? 'image/png' : 'image/jpeg'
  return { ok: true, part: { type: 'image', base64, mediaType } }
}

function isPass(value: unknown): value is PassId {
  return typeof value === 'string' && (PASSES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// intake
// ---------------------------------------------------------------------------

export async function intakeCore(
  body: unknown,
  callTool: CallTool,
  cfg: RouteCfg = DEFAULT_ROUTE_CFG,
): Promise<ApiResult<Intake>> {
  if (!isRecord(body)) return fail('request body must be an object')

  const image = parseImage(body.image, 'image')
  if (!image.ok) return fail(image.error)

  const hint = typeof body.hint === 'string' ? body.hint.slice(0, 2000) : ''
  const dims = isRecord(body.dims) ? body.dims : null

  const lines = ['Analyse this photograph and return the intake.']
  if (hint) lines.push(`What the owner says it is: ${hint}`)
  if (dims) {
    lines.push(`Measured dimensions supplied by the owner (millimetres): ${JSON.stringify(dims)}. Use them and set dimensions.source to "user".`)
  }
  else {
    lines.push('No dimensions were supplied: estimate them in metres and set dimensions.source to "estimated".')
  }

  const tally = new Tally()
  const raw = tally.add(await callTool<unknown>({
    system: PROMPTS.intake,
    user: [image.part, { type: 'text', text: lines.join('\n\n') }],
    tool: {
      name: 'intake',
      description: 'Report the eight-layer analysis of the photographed object.',
      schema: toolSchema(intakeSchema),
    },
    model: cfg.modelAuthor,
    maxTokens: 16_000,
  }))

  const parsed = intakeSchema.safeParse(raw)
  if (!parsed.success) {
    return tally.fail(`intake failed validation: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  return tally.ok(parsed.data)
}

// ---------------------------------------------------------------------------
// spec
// ---------------------------------------------------------------------------

export async function specCore(
  body: unknown,
  callTool: CallTool,
  cfg: RouteCfg = DEFAULT_ROUTE_CFG,
): Promise<ApiResult<SculptSpec>> {
  if (!isRecord(body)) return fail('request body must be an object')
  if (!isRecord(body.intake)) return fail('intake must be an object')

  const image = parseImage(body.image, 'image')
  if (!image.ok) return fail(image.error)

  const critique = typeof body.critique === 'string' ? body.critique.slice(0, 8000) : ''

  const base = [
    'Author the SculptSpec for the photographed object.',
    `Intake analysis:\n\`\`\`json\n${JSON.stringify(body.intake, null, 2)}\n\`\`\``,
  ]
  if (critique) {
    base.push(`A reviewer asked for the spec to be revised:\n${critique}\n\nAddress every point.`)
  }

  const tally = new Tally()
  let errors: string[] = []

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = attempt === 0
      ? base.join('\n\n')
      : `${base.join('\n\n')}\n\nThe previous spec failed validation:\n${errors.map(e => `- ${e}`).join('\n')}\n\nReturn a corrected spec.`

    const raw = tally.add(await callTool<unknown>({
      system: PROMPTS.spec,
      user: [image.part, { type: 'text', text }],
      tool: {
        name: 'spec',
        description: 'Author the buildable SculptSpec for the photographed object.',
        schema: toolSchema(specSchema),
        // The spec grammar is too large for strict mode; zod plus one retry covers it.
        strict: false,
      },
      model: cfg.modelAuthor,
      maxTokens: 16_000,
    }))

    const result = validateSpec(raw)
    if (result.ok) return tally.ok(result.spec)
    errors = result.errors
  }

  return tally.fail(`spec failed validation twice: ${errors.join('; ')}`)
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

export async function buildCore(
  body: unknown,
  callTool: CallTool,
  cfg: RouteCfg = DEFAULT_ROUTE_CFG,
): Promise<ApiResult<BuildOutput>> {
  if (!isRecord(body)) return fail('request body must be an object')
  if (!isPass(body.pass)) return fail(`unknown pass: ${String(body.pass)}`)
  const spec = validateSpec(body.spec)
  if (!spec.ok) return fail(`spec failed validation: ${spec.errors.join('; ')}`)

  const pass = body.pass
  const previous = typeof body.code === 'string' ? body.code : ''
  const defects = Array.isArray(body.defects) ? body.defects : []
  const notes = Array.isArray(body.notes) ? body.notes.filter(n => typeof n === 'string') : []

  const base = [
    `Write the factory for the "${pass}" pass.`,
    `Spec:\n\`\`\`json\n${JSON.stringify(spec.spec, null, 2)}\n\`\`\``,
  ]
  if (previous) {
    base.push(`The current file, which you are revising:\n\`\`\`js\n${previous}\n\`\`\``)
  }
  if (defects.length > 0) {
    base.push(`Defects the reviewer measured — fix exactly these and nothing else:\n\`\`\`json\n${JSON.stringify(defects, null, 2)}\n\`\`\``)
  }
  if (notes.length > 0) {
    base.push(`Notes carried from the previous pass:\n${notes.map(n => `- ${n}`).join('\n')}`)
  }

  const system = `${PROMPTS.build}\n\n${PROMPTS.buildPass[pass]}`
  const tally = new Tally()
  let errors: string[] = []

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = attempt === 0
      ? base.join('\n\n')
      : `${base.join('\n\n')}\n\nThe code you returned failed validation:\n${errors.map(e => `- ${e}`).join('\n')}\n\nReturn the whole corrected file.`

    const raw = tally.add(await callTool<unknown>({
      system,
      user: [{ type: 'text', text }],
      tool: {
        name: 'build',
        description: 'Return the complete createModel factory file for this pass.',
        schema: toolSchema(buildSchema),
      },
      model: cfg.modelAuthor,
      maxTokens: 64_000,
    }))

    const parsed = buildSchema.safeParse(raw)
    if (!parsed.success) {
      errors = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      continue
    }
    const checked = validateCode(parsed.data.code)
    if (checked.ok) return tally.ok(parsed.data)
    errors = checked.errors
  }

  return tally.fail(`generated code failed validation twice: ${errors.join('; ')}`)
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

export async function reviewCore(
  body: unknown,
  callTool: CallTool,
  cfg: RouteCfg = DEFAULT_ROUTE_CFG,
): Promise<ApiResult<Review>> {
  if (!isRecord(body)) return fail('request body must be an object')
  if (!isPass(body.pass)) return fail(`unknown pass: ${String(body.pass)}`)
  const spec = validateSpec(body.spec)
  if (!spec.ok) return fail(`spec failed validation: ${spec.errors.join('; ')}`)

  const photo = parseImage(body.image, 'image')
  if (!photo.ok) return fail(photo.error)
  const sheet = parseImage(body.sheet, 'sheet')
  if (!sheet.ok) return fail(sheet.error)

  const fixesLeft = typeof body.fixesLeft === 'number' && Number.isFinite(body.fixesLeft)
    ? Math.max(0, Math.floor(body.fixesLeft))
    : 0

  const text = [
    `Review the "${body.pass}" pass.`,
    `Fixes left in the budget: ${fixesLeft}.`,
    `Spec:\n\`\`\`json\n${JSON.stringify(spec.spec, null, 2)}\n\`\`\``,
  ].join('\n\n')

  const tally = new Tally()
  const raw = tally.add(await callTool<unknown>({
    system: PROMPTS.review,
    // Each image is introduced by its own label, so "image 1" and "image 2" in the
    // system prompt refer to something the model can actually see named.
    user: [
      { type: 'text', text: 'Image 1 — the reference photograph:' },
      photo.part,
      { type: 'text', text: 'Image 2 — the comparison sheet (left: render from the estimated reference camera; right: the photo; below: front/side/top renders):' },
      sheet.part,
      { type: 'text', text },
    ],
    tool: {
      name: 'review',
      description: 'Score the render against the reference and choose the next action.',
      schema: toolSchema(reviewSchema),
    },
    model: cfg.modelReview,
    maxTokens: 16_000,
  }))

  const parsed = reviewSchema.safeParse(raw)
  if (!parsed.success) {
    return tally.fail(`review failed validation: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }

  const review = { ...parsed.data }

  // `refine-code` with nothing to fix is an empty work order; treat it as a pass.
  if (review.action === 'refine-code' && review.defects.length === 0) {
    review.action = 'continue'
  }
  // A reviewer that waves a weak render through is the most expensive failure in
  // the loop, so a low-fidelity `continue` is spent on another fix instead.
  // With no fixes left the pass moves on anyway: an imperfect structure with
  // real materials beats a stopped job with placeholder colours.
  if (review.action === 'continue' && review.fidelity < 0.7 && fixesLeft > 0) {
    review.action = 'refine-code'
  }
  // `stop` ends the whole job. Before the surface pass that leaves an
  // unfinished, unmaterialised model, so it is honoured only when the object
  // is hopeless; otherwise the remaining passes run and the job ends
  // 'approximate'.
  if (review.action === 'stop' && body.pass !== 'surface' && review.fidelity >= HOPELESS_FIDELITY) {
    review.action = 'continue'
  }

  return tally.ok(review)
}
