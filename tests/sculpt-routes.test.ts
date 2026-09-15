import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildCore, intakeCore, reviewCore, specCore } from '../server/utils/sculpt/routes'
import { PROMPTS } from '../server/utils/sculpt/prompts'
import { FORBIDDEN } from '../server/utils/sculpt/validateCode'
import { PASSES } from '../app/utils/sculpt/types'
import type { CallTool, ToolCall } from '../server/utils/sculpt/anthropic'
import type { Intake, Review, SculptSpec } from '../app/utils/sculpt/types'

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

function makeIntake(): Intake {
  return {
    name: 'Orange chair bed',
    objectClass: 'convertible armchair',
    suitability: { verdict: 'pass', reasons: ['single object, clear silhouette'] },
    symmetry: 'left-right',
    camera: { yaw: 25, pitch: 12, fov: 35, distance: 2.4, confidence: 0.8 },
    dimensions: { widthM: 0.8, heightM: 0.9, depthM: 0.75, source: 'estimated' },
    detailInventory: [{ id: 'd1', zone: 'side', kind: 'strap', evidence: 'visible on right flank' }],
    materialsSeen: [{ zone: 'shell', family: 'fabric', subtype: 'woven', colorHex: '#e0431c', finish: 'matte' }],
    notes: [],
  }
}

function makeSpec(): SculptSpec {
  return {
    name: 'Orange chair bed',
    id: 'orange-chair-bed',
    camera: { yaw: 25, pitch: 12, fov: 35, distance: 2.4, confidence: 0.8 },
    dimensions: { widthM: 0.8, heightM: 0.9, depthM: 0.75, source: 'estimated' },
    symmetry: 'left-right',
    suitability: { verdict: 'pass', reasons: [] },
    detailInventory: [],
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
    reviewViews: ['reference', 'front', 'side', 'top'],
    mustMatch: ['backrest top is 0.55 m above the seat top'],
    niceToHave: [],
  }
}

function makeReview(over: Partial<Review> = {}): Review {
  return {
    action: 'continue',
    fidelity: 0.85,
    layers: {
      silhouetteProportion: 0.8,
      componentStructure: 0.8,
      formDetail: 0.8,
      materialSurface: 0.8,
      lightingCamera: 0.8,
    },
    defects: [],
    summary: 'looks right',
    ...over,
  }
}

const goodCode = 'function createModel(kit, THREE, options) {\n  return kit.root([])\n}\n'

describe('intakeCore', () => {
  it('returns the intake with usage and cost', async () => {
    const { callTool, calls } = makeFake([makeIntake()])
    const res = await intakeCore({ image: pngBase64(), hint: 'orange chair' }, callTool)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.objectClass).toBe('convertible armchair')
    expect(res.usage).toEqual({ input: 10, output: 20 })
    expect(res.costUsd).toBeCloseTo(0.5)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.user.some(p => p.type === 'image')).toBe(true)
    expect(userText(calls[0]!)).toContain('orange chair')
  })

  it('rejects a 5 MB image', async () => {
    const { callTool, calls } = makeFake([makeIntake()])
    const res = await intakeCore({ image: pngBase64(5 * 1024 * 1024) }, callTool)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/4 MB|too large/i)
    expect(calls).toHaveLength(0)
  })

  it('rejects a non-object body and a non-image payload', async () => {
    const { callTool } = makeFake([])
    expect((await intakeCore('nope', callTool)).ok).toBe(false)
    expect((await intakeCore({ image: 'not base64 !!!' }, callTool)).ok).toBe(false)
    expect((await intakeCore({}, callTool)).ok).toBe(false)
  })
})

describe('specCore', () => {
  it('retries once with the validation errors and sums usage', async () => {
    const bad = { ...makeSpec(), mustMatch: [] }
    const { callTool, calls } = makeFake([bad, makeSpec()])
    const res = await specCore({ intake: makeIntake(), image: pngBase64() }, callTool)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(calls).toHaveLength(2)
    const second = userText(calls[1]!)
    expect(second).toContain('The previous spec failed validation')
    expect(second).toContain('mustMatch')
    expect(second).toContain('Return a corrected spec.')
    expect(res.usage).toEqual({ input: 20, output: 40 })
    expect(res.costUsd).toBeCloseTo(1)
  })

  it('fails after two invalid specs', async () => {
    const bad = { ...makeSpec(), mustMatch: [] }
    const { callTool, calls } = makeFake([bad, bad])
    const res = await specCore({ intake: makeIntake(), image: pngBase64() }, callTool)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/mustMatch/)
    expect(calls).toHaveLength(2)
  })

  it('passes a critique through to the model', async () => {
    const { callTool, calls } = makeFake([makeSpec()])
    await specCore({ intake: makeIntake(), image: pngBase64(), critique: 'the rail is missing' }, callTool)
    expect(userText(calls[0]!)).toContain('the rail is missing')
  })
})

describe('buildCore', () => {
  it('retries once when the code fails validation and sums usage', async () => {
    const bad = { code: 'function createModel(kit, THREE, options) { return fetch("x") }', notes: [] }
    const { callTool, calls } = makeFake([bad, { code: goodCode, notes: ['ok'] }])
    const res = await buildCore({ spec: makeSpec(), pass: 'blockout' }, callTool)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(calls).toHaveLength(2)
    expect(userText(calls[1]!)).toMatch(/failed validation/i)
    expect(userText(calls[1]!)).toContain('fetch')
    expect(res.usage).toEqual({ input: 20, output: 40 })
    expect(res.costUsd).toBeCloseTo(1)
  })

  it('fails after two invalid programs', async () => {
    const bad = { code: 'function nope() {}', notes: [] }
    const { callTool } = makeFake([bad, bad])
    const res = await buildCore({ spec: makeSpec(), pass: 'form' }, callTool)
    expect(res.ok).toBe(false)
    if (res.ok) return
    // Both calls were paid for: the failure still reports the spend so the
    // daily ceiling counts it.
    expect(res.usage).toEqual({ input: 20, output: 40 })
    expect(res.costUsd).toBeCloseTo(1)
  })

  it('rejects an unknown pass', async () => {
    const { callTool, calls } = makeFake([{ code: goodCode, notes: [] }])
    const res = await buildCore({ spec: makeSpec(), pass: 'polish' }, callTool)
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('includes the pass prompt, the kit API, the previous code and the defects', async () => {
    const { callTool, calls } = makeFake([{ code: goodCode, notes: [] }])
    await buildCore(
      {
        spec: makeSpec(),
        pass: 'material',
        code: goodCode,
        defects: [{ component: 'base', what: 'too thin', measured: '0.15 m vs 0.20 m', fix: 'thicken' }],
        notes: ['keep the rail'],
      },
      callTool,
    )
    const call = calls[0]!
    expect(call.system).toContain(PROMPTS.buildPass.material)
    expect(call.system).toContain('## Sculpt kit API')
    const text = userText(call)
    expect(text).toContain('too thin')
    expect(text).toContain('keep the rail')
    expect(text).toContain('createModel')
  })
})

describe('reviewCore', () => {
  it('labels each image and sends the photo before the sheet', async () => {
    const { callTool, calls } = makeFake([makeReview()])
    const res = await reviewCore(
      { spec: makeSpec(), pass: 'surface', sheet: pngBase64(), image: pngBase64(), fixesLeft: 2 },
      callTool,
    )
    expect(res.ok).toBe(true)
    const parts = calls[0]!.user
    expect(parts.map(p => p.type)).toEqual(['text', 'image', 'text', 'image', 'text'])
    expect((parts[0] as { text: string }).text).toBe('Image 1 — the reference photograph:')
    expect((parts[2] as { text: string }).text).toContain('Image 2 — the comparison sheet')
    expect((parts[2] as { text: string }).text).toContain('front/side/top renders')
    expect((parts[4] as { text: string }).text).toContain('Fixes left in the budget: 2')
  })

  it('downgrades continue at fidelity 0.6 to refine-code while fixes remain', async () => {
    const { callTool } = makeFake([makeReview({ action: 'continue', fidelity: 0.6, defects: [{ component: 'base', what: 'thin', measured: 'x', fix: 'y' }] })])
    const res = await reviewCore(
      { spec: makeSpec(), pass: 'blockout', sheet: pngBase64(), image: pngBase64(), fixesLeft: 2 },
      callTool,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.action).toBe('refine-code')
  })

  it('downgrades continue at fidelity 0.6 to stop when no fixes remain', async () => {
    const { callTool } = makeFake([makeReview({ action: 'continue', fidelity: 0.6 })])
    const res = await reviewCore(
      { spec: makeSpec(), pass: 'blockout', sheet: pngBase64(), image: pngBase64(), fixesLeft: 0 },
      callTool,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.action).toBe('stop')
  })

  it('turns a defect-free refine-code into continue', async () => {
    const { callTool } = makeFake([makeReview({ action: 'refine-code', fidelity: 0.82, defects: [] })])
    const res = await reviewCore(
      { spec: makeSpec(), pass: 'form', sheet: pngBase64(), image: pngBase64(), fixesLeft: 3 },
      callTool,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.action).toBe('continue')
  })

  it('leaves a high-fidelity continue alone', async () => {
    const { callTool } = makeFake([makeReview({ action: 'continue', fidelity: 0.85 })])
    const res = await reviewCore(
      { spec: makeSpec(), pass: 'form', sheet: pngBase64(), image: pngBase64(), fixesLeft: 3 },
      callTool,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.action).toBe('continue')
  })

  it('rejects a missing sheet', async () => {
    const { callTool, calls } = makeFake([makeReview()])
    const res = await reviewCore(
      { spec: makeSpec(), pass: 'form', image: pngBase64(), fixesLeft: 1 },
      callTool,
    )
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('prompts', () => {
  it('ships a non-empty document for every stage', () => {
    for (const [name, text] of Object.entries(PROMPTS)) {
      if (name === 'buildPass') continue
      expect(typeof text, name).toBe('string')
      expect((text as string).trim().length, name).toBeGreaterThan(400)
    }
  })

  it('has a prompt for all five passes', () => {
    expect(Object.keys(PROMPTS.buildPass).sort()).toEqual([...PASSES].sort())
    for (const pass of PASSES) {
      expect(PROMPTS.buildPass[pass].trim().length, pass).toBeGreaterThan(200)
    }
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
