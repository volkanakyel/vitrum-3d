import type { ApiResult, BuildOutput, Defect, PartBounds, Review, SculptSpec, Usage } from '../../../app/utils/sculpt/types'
import { buildSchema, reviewSchema, specSchema, toolSchema, validateSpec } from './schema'
import { validateCode } from './validateCode'
import { PROMPTS } from './prompts'
import type { CallTool, ImageMediaType, ToolResult, UserPart } from './anthropic'

export interface RouteCfg {
  /** Model that writes the plan and the code. */
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
/**
 * Output ceilings. The plan is a JSON document of at most 24 components; the
 * build is a file capped at 40 kB by the validator (~12k tokens), so a ceiling
 * twice that leaves room for the tool-call envelope and is never the limit a
 * healthy answer hits. The review is a short scored list.
 */
const PLAN_MAX_TOKENS = 12_000
const BUILD_MAX_TOKENS = 24_000
const REVIEW_MAX_TOKENS = 4_000
/** Defects past this many are noise; the review prompt says eight. */
const MAX_DEFECTS = 8

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

const MAX_PART_BOUNDS = 400

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n))
}

/** The measured part table from the client, shape-checked and capped. */
function parsePartBounds(value: unknown): PartBounds[] {
  if (!Array.isArray(value)) return []
  const out: PartBounds[] = []
  for (const entry of value.slice(0, MAX_PART_BOUNDS)) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !isVec3(entry.min) || !isVec3(entry.max)) continue
    out.push({ id: entry.id.slice(0, 120), min: entry.min, max: entry.max })
  }
  return out
}

/** One line per part, millimetre precision, in the model's own frame. */
function partBoundsTable(bounds: PartBounds[]): string {
  const f = (n: number) => n.toFixed(3)
  const lines = bounds.map(b =>
    `${b.id}: x ${f(b.min[0])}..${f(b.max[0])}  y ${f(b.min[1])}..${f(b.max[1])}  z ${f(b.min[2])}..${f(b.max[2])}  (size ${f(b.max[0] - b.min[0])} × ${f(b.max[1] - b.min[1])} × ${f(b.max[2] - b.min[2])})`,
  )
  return [
    'Measured world-space box of every part in the last render, in metres, after `kit.root` centred the model in x/z and set its bottom to y = 0 (so compare parts with each other, not with the raw numbers in your code):',
    '```',
    ...lines,
    '```',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

export async function planCore(
  body: unknown,
  callTool: CallTool,
  cfg: RouteCfg = DEFAULT_ROUTE_CFG,
): Promise<ApiResult<SculptSpec>> {
  if (!isRecord(body)) return fail('request body must be an object')

  const image = parseImage(body.image, 'image')
  if (!image.ok) return fail(image.error)

  const hint = typeof body.hint === 'string' ? body.hint.slice(0, 2000) : ''
  const dims = isRecord(body.dims) ? body.dims : null

  const base = ['Read this photograph and write the SculptSpec.']
  if (hint) base.push(`What the owner says it is: ${hint}`)
  if (dims) {
    base.push(`Measured dimensions supplied by the owner (millimetres): ${JSON.stringify(dims)}. Convert to metres, use them exactly and set dimensions.source to "user".`)
  }
  else {
    base.push('No dimensions were supplied: estimate them in metres and set dimensions.source to "estimated".')
  }

  const tally = new Tally()
  let errors: string[] = []

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = attempt === 0
      ? base.join('\n\n')
      : `${base.join('\n\n')}\n\nThe previous plan failed validation:\n${errors.map(e => `- ${e}`).join('\n')}\n\nReturn a corrected plan.`

    const raw = tally.add(await callTool<unknown>({
      system: PROMPTS.plan,
      user: [image.part, { type: 'text', text }],
      tool: {
        name: 'plan',
        description: 'Report the reading of the photographed object and the buildable plan for it.',
        schema: toolSchema(specSchema),
        // The spec grammar is too large for strict mode; zod plus one retry covers it.
        strict: false,
      },
      model: cfg.modelAuthor,
      maxTokens: PLAN_MAX_TOKENS,
      effort: 'medium',
    }))

    const result = validateSpec(raw)
    if (result.ok) return tally.ok(result.spec)
    errors = result.errors
  }

  return tally.fail(`plan failed validation twice: ${errors.join('; ')}`)
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function parseDefects(value: unknown): Defect[] {
  if (!Array.isArray(value)) return []
  const out: Defect[] = []
  for (const entry of value.slice(0, MAX_DEFECTS)) {
    if (!isRecord(entry)) continue
    const s = (v: unknown) => (typeof v === 'string' ? v.slice(0, 600) : '')
    out.push({ component: s(entry.component), what: s(entry.what), measured: s(entry.measured), fix: s(entry.fix) })
  }
  return out
}

/**
 * One route, two jobs: without `code` it writes the whole model from the plan
 * and the photo; with `code` and `defects` it fixes exactly those defects in
 * that file. The photo travels both times — the author is meant to look at it.
 */
export async function buildCore(
  body: unknown,
  callTool: CallTool,
  cfg: RouteCfg = DEFAULT_ROUTE_CFG,
): Promise<ApiResult<BuildOutput>> {
  if (!isRecord(body)) return fail('request body must be an object')
  const spec = validateSpec(body.spec)
  if (!spec.ok) return fail(`spec failed validation: ${spec.errors.join('; ')}`)
  const image = parseImage(body.image, 'image')
  if (!image.ok) return fail(image.error)

  const previous = typeof body.code === 'string' ? body.code : ''
  const defects = parseDefects(body.defects)
  const measured = parsePartBounds(body.partBounds)

  const base = [
    previous ? 'Fix the model.' : 'Write the finished model.',
    `Plan:\n\`\`\`json\n${JSON.stringify(spec.spec, null, 2)}\n\`\`\``,
  ]
  if (previous) {
    base.push(`The current file, which you are revising:\n\`\`\`js\n${previous}\n\`\`\``)
    if (defects.length > 0) {
      base.push(`Defects the reviewer measured — fix exactly these and nothing else:\n\`\`\`json\n${JSON.stringify(defects, null, 2)}\n\`\`\``)
    }
    if (measured.length > 0) {
      base.push(`${partBoundsTable(measured)}\n\nUse this table to locate each defect exactly: a part whose box does not touch its parent's box is floating, a part whose box crosses a face it should sit under is poking through, a part that is missing from the table was never added to the root. Fix the numbers, not the guess.`)
    }
  }

  const tally = new Tally()
  let errors: string[] = []

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = attempt === 0
      ? base.join('\n\n')
      : `${base.join('\n\n')}\n\nThe code you returned failed validation:\n${errors.map(e => `- ${e}`).join('\n')}\n\nReturn the whole corrected file.`

    const raw = tally.add(await callTool<unknown>({
      system: PROMPTS.build,
      user: [image.part, { type: 'text', text }],
      tool: {
        name: 'build',
        description: 'Return the complete createModel factory file.',
        schema: toolSchema(buildSchema),
      },
      model: cfg.modelAuthor,
      maxTokens: BUILD_MAX_TOKENS,
      // The file is a few hundred lines against a small kit: medium effort
      // writes it as well as high and spends a third of the thinking tokens.
      effort: 'medium',
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

/**
 * The sheet already carries the photograph on its right-hand panel, so it is
 * the only image sent: a second copy of the photo would double the image
 * tokens for nothing the reviewer cannot already see.
 */
export async function reviewCore(
  body: unknown,
  callTool: CallTool,
  cfg: RouteCfg = DEFAULT_ROUTE_CFG,
): Promise<ApiResult<Review>> {
  if (!isRecord(body)) return fail('request body must be an object')
  const spec = validateSpec(body.spec)
  if (!spec.ok) return fail(`spec failed validation: ${spec.errors.join('; ')}`)
  const sheet = parseImage(body.sheet, 'sheet')
  if (!sheet.ok) return fail(sheet.error)

  const measured = parsePartBounds(body.partBounds)
  const text = [
    'Review the finished model.',
    `Plan:\n\`\`\`json\n${JSON.stringify(spec.spec, null, 2)}\n\`\`\``,
    ...(measured.length > 0
      ? [`${partBoundsTable(measured)}\n\nThe table is ground truth for structure. Quote the numbers in \`measured\` when you report a structural defect.`]
      : []),
  ].join('\n\n')

  const tally = new Tally()
  const raw = tally.add(await callTool<unknown>({
    system: PROMPTS.review,
    user: [
      { type: 'text', text: 'The comparison sheet (left: render from the estimated reference camera; right: the photograph; below: front/side/top renders):' },
      sheet.part,
      { type: 'text', text },
    ],
    tool: {
      name: 'review',
      description: 'Score the render against the photograph and list the defects one round of fixes should close.',
      schema: toolSchema(reviewSchema),
    },
    model: cfg.modelReview,
    maxTokens: REVIEW_MAX_TOKENS,
    effort: 'low',
  }))

  const parsed = reviewSchema.safeParse(raw)
  if (!parsed.success) {
    return tally.fail(`review failed validation: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  const review = parsed.data
  return tally.ok({ ...review, defects: review.defects.slice(0, MAX_DEFECTS) })
}
