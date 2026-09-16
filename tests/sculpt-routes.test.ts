import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildCore, draftCore, reviewCore } from '../server/utils/sculpt/routes'
import { PROMPTS } from '../server/utils/sculpt/prompts'
import { FORBIDDEN } from '../server/utils/sculpt/validateCode'
import type { CallTool, ToolCall } from '../server/utils/sculpt/anthropic'
import type { Review, SculptSpec } from '../app/utils/sculpt/types'

/** A small, structurally valid PNG payload (header bytes are all the loader checks). */
function pngBase64(padBytes = 64): string {
  const head = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  return Buffer.concat([head, Buffer.alloc(padBytes, 1)]).toString('base64')
}

function makeFake(queue: unknown[]) {
  const calls: ToolCall<unknown>[] = []
  const callTool = (async (call) => {
    calls.push(call as ToolCall<unknown>)
    if (queue.length === 0) throw new Error('fake callTool: queue exhausted')
    const data = queue.shift()
    return { data: data as never, usage: { input: 10, output: 20 }, costUsd: 0.5, raw: '' }
  }) as CallTool
  return { callTool, calls }
}

function userText(call: ToolCall<unknown>): string {
  return call.user.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n')
}

function imageCount(call: ToolCall<unknown>): number {
  return call.user.filter(p => p.type === 'image').length
}

function makeSpec(): SculptSpec {
  return {
    name: 'Orange chair bed',
    id: 'orange-chair-bed',
    objectClass: 'convertible armchair',
    suitability: { verdict: 'pass', reasons: [] },
    symmetry: 'left-right',
    camera: { yaw: 25, pitch: 12, fov: 35, distance: 2.4, confidence: 0.8 },
    dimensions: { widthM: 0.8, heightM: 0.9, depthM: 0.75, source: 'estimated' },
    detailInventory: [],
    notes: [],
    components: [
      {
        id: 'base',
        name: 'Base block',
        level: 'macro',
        parent: null,
        importance: 1,
        confidence: 0.9,
        primitive: 'pillow',
        dimensions: { w: 0.8, h: 0.3, d: 0.75 },
        position: [0, 0.2, 0],
        rotation: [0, 0, 0],
        edge: { radius: 0.05, segments: 3 },
        attachment: null,
        material: 'shell',
        localFeatures: [],
      },
    ],
    materials: [
      {
        id: 'shell',
        family: 'fabric',
        subtype: 'woven',
        baseColor: '#e0431c',
        roughness: 0.88,
        metalness: 0,
        sheen: 1,
        clearcoat: 0,
        pattern: { kind: 'weave', scale: 0.01, amplitude: 0.4 },
        wear: { edge: 0.1, dirt: 0.05 },
      },
    ],
    repetition: [],
    mustMatch: ['backrest top is 0.55 m above the seat top'],
    niceToHave: [],
  }
}

function makeReview(over: Partial<Review> = {}): Review {
  return {
    fidelity: 0.85,
    layers: { silhouetteProportion: 0.8, componentStructure: 0.8, formDetail: 0.8, materialSurface: 0.8, lightingCamera: 0.8 },
    defects: [],
    summary: 'looks right',
    ...over,
  }
}

const goodCode = 'function createModel(kit, THREE, options) {\n  return kit.root([])\n}\n'
const bounds = [{ id: 'base', min: [-0.4, 0, -0.375], max: [0.4, 0.3, 0.375] }]

describe('draftCore', () => {
  const good = () => ({ spec: makeSpec(), code: goodCode, notes: ['built'] })

  it('returns the plan and the code with usage and cost, and sends the photo once', async () => {
    const { callTool, calls } = makeFake([good()])
    const res = await draftCore({ image: pngBase64(), hint: 'a chair bed' }, callTool)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.spec.name).toBe('Orange chair bed')
    expect(res.data.code).toBe(goodCode)
    expect(res.usage).toEqual({ input: 10, output: 20 })
    expect(calls).toHaveLength(1)
    expect(imageCount(calls[0]!)).toBe(1)
    expect(calls[0]!.tool.name).toBe('draft')
    expect(calls[0]!.model).toBe('claude-opus-5')
    expect(calls[0]!.system).toBe(PROMPTS.draft)
    expect(calls[0]!.maxTokens).toBe(24_000)
    expect(userText(calls[0]!)).toContain('a chair bed')
    expect(userText(calls[0]!)).toContain('estimated')
  })

  it('passes supplied dimensions through and asks for source "user"', async () => {
    const { callTool, calls } = makeFake([good()])
    await draftCore({ image: pngBase64(), dims: { widthMm: 800, heightMm: 900, depthMm: 750 } }, callTool)
    expect(userText(calls[0]!)).toContain('"widthMm":800')
    expect(userText(calls[0]!)).toContain('"user"')
  })

  it('retries once with both the plan and the code errors, and sums usage', async () => {
    const bad = { spec: { ...makeSpec(), components: [] }, code: 'function nope() {}', notes: [] }
    const { callTool, calls } = makeFake([bad, good()])
    const res = await draftCore({ image: pngBase64() }, callTool)
    expect(res.ok).toBe(true)
    expect(calls).toHaveLength(2)
    const retry = userText(calls[1]!)
    expect(retry).toContain('failed validation')
    expect(retry).toContain('spec:')
    expect(retry).toContain('code:')
    if (res.ok) expect(res.usage).toEqual({ input: 20, output: 40 })
  })

  it('fails after two invalid answers, still reporting the spend', async () => {
    const bad = { spec: makeSpec(), code: 'x', notes: [] }
    const { callTool } = makeFake([bad, bad])
    const res = await draftCore({ image: pngBase64() }, callTool)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('twice')
      expect(res.costUsd).toBe(1)
    }
  })

  it('rejects a 5 MB image before calling the model', async () => {
    const { callTool, calls } = makeFake([])
    const res = await draftCore({ image: pngBase64(5 * 1024 * 1024) }, callTool)
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('rejects a non-object body and a non-image payload', async () => {
    const { callTool } = makeFake([])
    expect((await draftCore('x', callTool)).ok).toBe(false)
    expect((await draftCore({ image: 'not base64!' }, callTool)).ok).toBe(false)
  })
})

describe('buildCore', () => {
  it('writes the whole model from the plan and the photo', async () => {
    const { callTool, calls } = makeFake([{ code: goodCode, notes: ['built'] }])
    const res = await buildCore({ spec: makeSpec(), image: pngBase64() }, callTool)
    expect(res.ok).toBe(true)
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(imageCount(call)).toBe(1)
    expect(call.system).toBe(PROMPTS.build)
    expect(call.maxTokens).toBe(24_000)
    const text = userText(call)
    expect(text).toContain('Write the finished model')
    expect(text).toContain('"orange-chair-bed"')
    expect(text).not.toContain('Defects')
  })

  it('retries once when the code fails validation and sums usage', async () => {
    const { callTool, calls } = makeFake([{ code: 'function nope() {}', notes: [] }, { code: goodCode, notes: [] }])
    const res = await buildCore({ spec: makeSpec(), image: pngBase64() }, callTool)
    expect(res.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(userText(calls[1]!)).toContain('failed validation')
    if (res.ok) expect(res.usage).toEqual({ input: 20, output: 40 })
  })

  it('fails after two invalid programs', async () => {
    const { callTool } = makeFake([{ code: 'x', notes: [] }, { code: 'y', notes: [] }])
    const res = await buildCore({ spec: makeSpec(), image: pngBase64() }, callTool)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('twice')
  })

  it('fixes: carries the previous code, the defects and the measured table', async () => {
    const { callTool, calls } = makeFake([{ code: goodCode, notes: [] }])
    const defects = [{ component: 'base', what: 'too short', measured: '0.30 m', fix: 'raise to 0.35' }]
    await buildCore({ spec: makeSpec(), image: pngBase64(), code: 'function createModel(kit, THREE, options) { return kit.root([]) }', defects, partBounds: bounds }, callTool)
    expect(calls[0]!.model).toBe('claude-opus-5')
    const text = userText(calls[0]!)
    expect(text).toContain('Fix the model')
    expect(text).toContain('The current file')
    expect(text).toContain('too short')
    expect(text).toContain('base: x -0.400..0.400')
  })

  it('never shows a table on a fresh build, and drops malformed entries on a fix', async () => {
    const { callTool, calls } = makeFake([{ code: goodCode, notes: [] }, { code: goodCode, notes: [] }])
    await buildCore({ spec: makeSpec(), image: pngBase64(), partBounds: bounds }, callTool)
    expect(userText(calls[0]!)).not.toContain('Measured world-space box')
    await buildCore({ spec: makeSpec(), image: pngBase64(), code: goodCode, defects: [], partBounds: [...bounds, { id: 'junk', min: [0, 0], max: 'x' }] }, callTool)
    const text = userText(calls[1]!)
    expect(text).toContain('base: x')
    expect(text).not.toContain('junk')
  })

  it('rejects an invalid spec and a missing image', async () => {
    const { callTool, calls } = makeFake([])
    expect((await buildCore({ spec: { nope: true }, image: pngBase64() }, callTool)).ok).toBe(false)
    expect((await buildCore({ spec: makeSpec() }, callTool)).ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('reviewCore', () => {
  it('sends only the sheet, with the plan and the measured table', async () => {
    const { callTool, calls } = makeFake([makeReview()])
    const res = await reviewCore({ spec: makeSpec(), sheet: pngBase64(), partBounds: bounds }, callTool)
    expect(res.ok).toBe(true)
    const call = calls[0]!
    expect(imageCount(call)).toBe(1)
    expect(call.maxTokens).toBe(4_000)
    expect(call.tool.name).toBe('review')
    const text = userText(call)
    expect(text).toContain('comparison sheet')
    expect(text).toContain('base: x -0.400..0.400')
  })

  it('strips stray tags from the summary', async () => {
    const { callTool } = makeFake([makeReview({ summary: 'close to the photo.</summary>' })])
    const res = await reviewCore({ spec: makeSpec(), sheet: pngBase64() }, callTool)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.summary).toBe('close to the photo.')
  })

  it('caps the defect list at eight', async () => {
    const defects = Array.from({ length: 12 }, (_, i) => ({ component: `p${i}`, what: 'w', measured: 'm', fix: 'f' }))
    const { callTool } = makeFake([makeReview({ fidelity: 0.5, defects })])
    const res = await reviewCore({ spec: makeSpec(), sheet: pngBase64() }, callTool)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.defects).toHaveLength(8)
  })

  it('rejects a missing sheet and a malformed review', async () => {
    const { callTool } = makeFake([{ fidelity: 'high' }])
    expect((await reviewCore({ spec: makeSpec() }, callTool)).ok).toBe(false)
    const res = await reviewCore({ spec: makeSpec(), sheet: pngBase64() }, callTool)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('validation')
  })
})

describe('prompts', () => {
  it('ships a non-empty document for every call', () => {
    for (const key of ['plan', 'build', 'draft', 'review', 'kitApi'] as const) {
      expect(PROMPTS[key].length, key).toBeGreaterThan(200)
    }
    expect(PROMPTS.plan).toContain('detailInventory')
    expect(PROMPTS.plan).toContain('mustMatch')
    expect(PROMPTS.review).toContain('one round of fixes')
  })

  // The draft is the plan prompt followed by the build prompt with a single
  // tool line, so the one-call path asks for exactly what the two-call path did.
  it('the draft prompt is the plan then the build, asking for the draft tool only', () => {
    const d = PROMPTS.draft
    expect(d).toContain('# Part one — the plan')
    expect(d).toContain('# Part two — the model')
    expect(d).toContain('detailInventory')
    expect(d).toContain('function createModel(kit, THREE, options)')
    expect(d).toContain('Example of a complete, correct factory')
    expect(d).not.toContain('calling the `plan` tool')
    expect(d).not.toContain('calling the `build` tool')
    expect(d.trim().endsWith('Output only by calling the `draft` tool, with `spec`, `code` and `notes`.')).toBe(true)
  })

  it('states the build contract and every forbidden identifier', () => {
    const build = PROMPTS.build
    expect(build).toContain('function createModel(kit, THREE, options)')
    expect(build).toContain('kit.root([')
    expect(build).toContain('kit.restOn')
    expect(build).toContain('kit.mirror')
    expect(build).toContain('kit.random()')
    expect(build).toContain('40 kB')
    expect(build).toContain('+Y up')
    expect(build).toContain('+Z front')
    expect(build).toContain('finished model in one sitting')
    for (const name of FORBIDDEN) {
      expect(build, name).toContain(name)
    }
  })

  it('carries the kit API doc and the worked exemplar', () => {
    expect(PROMPTS.kitApi).toContain('## Sculpt kit API')
    expect(PROMPTS.build).toContain('Example of a complete, correct factory')
    expect(PROMPTS.build).toContain('kit.bentTube(')
  })

  // The exemplar is a copy of the fixture the kit tests run, so the code the model
  // is shown is code that is actually known to build.
  it('quotes the kit fixture verbatim as the exemplar', () => {
    const fixture = readFileSync(new URL('./fixtures/orange-chair.kit.js', import.meta.url), 'utf8')
    expect(PROMPTS.build).toContain(fixture.trim())
  })
})
