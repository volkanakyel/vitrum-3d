import { describe, expect, it, vi } from 'vitest'
import { createJob, JobRunner } from '../app/utils/sculpt/job'
import type { PassRecord, Renderer, SculptJob, Transport } from '../app/utils/sculpt/job'
import type { ApiResult, BuildOutput, Intake, Review, SculptSpec } from '../app/utils/sculpt/types'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function baseIntake(): Intake {
  return {
    name: 'Oak stool',
    objectClass: 'stool',
    suitability: { verdict: 'pass', reasons: [] },
    symmetry: 'left-right',
    camera: { yaw: 20, pitch: 10, fov: 32, distance: 2.4, confidence: 0.9 },
    dimensions: { widthM: 0.4, heightM: 0.45, depthM: 0.4, source: 'estimated' },
    detailInventory: [],
    materialsSeen: [],
    notes: [],
  }
}

function baseSpec(name = 'Oak stool'): SculptSpec {
  return {
    name,
    id: 'oak-stool',
    camera: { yaw: 20, pitch: 10, fov: 32, distance: 2.4, confidence: 0.9 },
    dimensions: { widthM: 0.4, heightM: 0.45, depthM: 0.4, source: 'estimated' },
    symmetry: 'left-right',
    suitability: { verdict: 'pass', reasons: [] },
    detailInventory: [],
    components: [],
    materials: [],
    repetition: [],
    reviewViews: ['reference', 'front', 'side', 'top'],
    mustMatch: [],
    niceToHave: [],
  }
}

function buildOutput(code: string): BuildOutput {
  return { code, notes: [] }
}

function baseReview(overrides: Partial<Review> = {}): Review {
  return {
    action: 'continue',
    fidelity: 0.9,
    layers: { silhouetteProportion: 1, componentStructure: 1, formDetail: 1, materialSurface: 1, lightingCamera: 1 },
    defects: [],
    summary: 'looks right',
    ...overrides,
  }
}

function continueReview(fidelity = 0.9): Review {
  return baseReview({ action: 'continue', fidelity })
}

function refineCodeReview(): Review {
  return baseReview({
    action: 'refine-code',
    fidelity: 0.5,
    defects: [{ component: 'legs', what: 'too thin', measured: '10mm', fix: 'thicken to 20mm' }],
  })
}

function requestInputReview(question: string): Review {
  return baseReview({ action: 'request-input', fidelity: 0.6, question })
}

function ok<T>(data: T, usage = { input: 10, output: 20 }, costUsd = 0.01): ApiResult<T> {
  return { ok: true, data, usage, costUsd }
}

function fail(error: string): ApiResult<never> {
  return { ok: false, error }
}

// ---------------------------------------------------------------------------
// fake transport / renderer
// ---------------------------------------------------------------------------

interface FakeTransport {
  transport: Transport
  queues: {
    intake: ApiResult<Intake>[]
    spec: ApiResult<SculptSpec>[]
    build: ApiResult<BuildOutput>[]
    review: ApiResult<Review>[]
  }
  calls: {
    intake: { image: string, hint?: string }[]
    spec: { intake: Intake, image: string, critique?: string }[]
    build: { spec: SculptSpec, pass: string, code?: string, defects?: unknown, notes?: string[] }[]
    review: { spec: SculptSpec, pass: string, sheet: string, image: string, fixesLeft: number }[]
  }
}

function makeTransport(): FakeTransport {
  const queues: FakeTransport['queues'] = { intake: [], spec: [], build: [], review: [] }
  const calls: FakeTransport['calls'] = { intake: [], spec: [], build: [], review: [] }

  const transport: Transport = {
    intake: vi.fn(async (req) => {
      calls.intake.push(req)
      const next = queues.intake.shift()
      if (!next) throw new Error('intake queue exhausted')
      return next
    }),
    spec: vi.fn(async (req) => {
      calls.spec.push(req)
      const next = queues.spec.shift()
      if (!next) throw new Error('spec queue exhausted')
      return next
    }),
    build: vi.fn(async (req) => {
      calls.build.push(req)
      const next = queues.build.shift()
      if (!next) throw new Error('build queue exhausted')
      return next
    }),
    review: vi.fn(async (req) => {
      calls.review.push(req)
      const next = queues.review.shift()
      if (!next) throw new Error('review queue exhausted')
      return next
    }),
  }

  return { transport, queues, calls }
}

function makeRenderer(opts: { failLoadOnce?: boolean } = {}): Renderer & { load: ReturnType<typeof vi.fn> } {
  let calls = 0
  const load = vi.fn(async (_code: string) => {
    calls += 1
    if (opts.failLoadOnce && calls === 1) throw new Error('boom')
    return { parts: ['part'], triangles: 100 }
  })
  const render = vi.fn(async (views: { name: string }[]) =>
    views.map(v => ({ name: v.name, blob: new Blob(['x']) })))
  const exportGLB = vi.fn(async () => new ArrayBuffer(8))
  return { load, render, exportGLB }
}

function makeDeps(transport: Transport, renderer: Renderer) {
  const sheet = vi.fn(async () => 'data:image/jpeg;base64,x')
  const save = vi.fn(async () => {})
  const onChange = vi.fn()
  return { transport, renderer, sheet, save, onChange }
}

/** Queues a plain `build -> continue review` round for one pass. */
function queueSimplePass(fake: FakeTransport, pass: string, fidelity = 0.9): void {
  fake.queues.build.push(ok(buildOutput(`code-${pass}`)))
  fake.queues.review.push(ok(continueReview(fidelity)))
}

async function tick(times = 50): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

// ---------------------------------------------------------------------------
// (a) happy path
// ---------------------------------------------------------------------------

describe('JobRunner', () => {
  it('(a) happy path: 5 passes, every review continues, ends done with quality good', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', 'an oak stool', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    queueSimplePass(fake, 'blockout')
    queueSimplePass(fake, 'structural')
    queueSimplePass(fake, 'form')
    queueSimplePass(fake, 'material')
    fake.queues.build.push(ok(buildOutput('code-surface')))
    fake.queues.review.push(ok(continueReview(0.85)))

    const result = await runner.run()

    expect(result.status).toBe('done')
    expect(result.quality).toBe('good')
    expect(result.passes).toHaveLength(5)
    expect(result.passes.map(p => p.id)).toEqual(['blockout', 'structural', 'form', 'material', 'surface'])
    expect(deps.save.mock.calls.length).toBeGreaterThanOrEqual(12)
    expect(result.glb).toBeInstanceOf(ArrayBuffer)
  })

  // -------------------------------------------------------------------------
  // (b) per-pass fix budget
  // -------------------------------------------------------------------------

  it('(b) refine-code twice then continue on blockout: fixes 2, third refine-code ignored, pass advances', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    fake.queues.build.push(ok(buildOutput('blockout-1')), ok(buildOutput('blockout-2')), ok(buildOutput('blockout-3')))
    fake.queues.review.push(ok(refineCodeReview()), ok(refineCodeReview()), ok(refineCodeReview()))
    queueSimplePass(fake, 'structural')
    queueSimplePass(fake, 'form')
    queueSimplePass(fake, 'material')
    queueSimplePass(fake, 'surface')

    const result = await runner.run()

    const blockout = result.passes.find(p => p.id === 'blockout') as PassRecord
    expect(blockout.fixes).toBe(2)
    expect(blockout.code).toBe('blockout-3')
    expect(fake.calls.build.filter(c => c.pass === 'blockout')).toHaveLength(3)
    expect(fake.calls.review.filter(c => c.pass === 'blockout')).toHaveLength(3)
    expect(result.currentPass).toBe('surface')
    expect(result.status).toBe('done')
  })

  // -------------------------------------------------------------------------
  // (c) global fix budget
  // -------------------------------------------------------------------------

  it('(c) 8 fixes total across passes stops further fixes', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))

    for (const pass of ['blockout', 'structural', 'form', 'material']) {
      fake.queues.build.push(ok(buildOutput(`${pass}-1`)), ok(buildOutput(`${pass}-2`)), ok(buildOutput(`${pass}-3`)))
      fake.queues.review.push(ok(refineCodeReview()), ok(refineCodeReview()), ok(continueReview()))
    }
    // surface: one review call, refine-code requested but the global budget is spent.
    fake.queues.build.push(ok(buildOutput('surface-1')))
    fake.queues.review.push(ok(refineCodeReview()))

    const result = await runner.run()

    expect(result.fixesTotal).toBe(8)
    const surface = result.passes.find(p => p.id === 'surface') as PassRecord
    expect(surface.fixes).toBe(0)
    expect(fake.calls.build.filter(c => c.pass === 'surface')).toHaveLength(1)
    expect(fake.calls.review.filter(c => c.pass === 'surface')).toHaveLength(1)
    expect(result.status).toBe('done')
  })

  // -------------------------------------------------------------------------
  // (d) refine-spec
  // -------------------------------------------------------------------------

  it('(d) refine-spec calls transport.spec with a critique and rebuilds without prior code', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec('Oak stool v1')))
    fake.queues.build.push(ok(buildOutput('blockout-1')), ok(buildOutput('blockout-2')))
    fake.queues.review.push(
      ok(baseReview({ action: 'refine-spec', fidelity: 0.4, summary: 'proportions are wrong', defects: [{ component: 'seat', what: 'too tall', measured: '0.6m', fix: 'lower to 0.45m' }] })),
      ok(continueReview()),
    )
    fake.queues.spec.push(ok(baseSpec('Oak stool v2')))
    for (const pass of ['structural', 'form', 'material', 'surface']) queueSimplePass(fake, pass)

    const result = await runner.run()

    expect(fake.calls.spec).toHaveLength(2)
    expect(fake.calls.spec[1]?.critique).toContain('proportions are wrong')
    // The rebuild after refine-spec must not carry the previous pass's code forward.
    const blockoutBuildCalls = fake.calls.build.filter(c => c.pass === 'blockout')
    expect(blockoutBuildCalls).toHaveLength(2)
    expect(blockoutBuildCalls[0]?.code).toBeUndefined()
    expect(blockoutBuildCalls[1]?.code).toBeUndefined()
    expect(result.spec?.name).toBe('Oak stool v2')
    expect(result.status).toBe('done')
  })

  // -------------------------------------------------------------------------
  // (e) request-input / answer
  // -------------------------------------------------------------------------

  it('(e) request-input pauses the job; answer() resumes with notes carrying the answer', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    fake.queues.build.push(ok(buildOutput('blockout-1')))
    fake.queues.review.push(ok(requestInputReview('What material are the legs?')))

    const paused = await runner.run()
    expect(paused.status).toBe('waiting-input')
    expect(paused.question).toBe('What material are the legs?')
    expect(fake.calls.build).toHaveLength(1)

    fake.queues.build.push(ok(buildOutput('blockout-2')))
    fake.queues.review.push(ok(continueReview()))
    for (const pass of ['structural', 'form', 'material', 'surface']) queueSimplePass(fake, pass)

    runner.answer('oak legs')
    const result = await runner.lastRun

    expect(fake.calls.build).toHaveLength(6)
    expect(fake.calls.build[1]?.notes).toEqual(['oak legs'])
    expect(result.hint).toContain('User answer: oak legs')
    expect(result.question).toBeNull()
    expect(result.status).toBe('done')
  })

  // -------------------------------------------------------------------------
  // (f) load error
  // -------------------------------------------------------------------------

  it('(f) a renderer.load error becomes a refine-code fix and is counted against the budget', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer({ failLoadOnce: true })
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    fake.queues.build.push(ok(buildOutput('blockout-1')), ok(buildOutput('blockout-2')))
    fake.queues.review.push(ok(continueReview()))
    for (const pass of ['structural', 'form', 'material', 'surface']) queueSimplePass(fake, pass)

    const result = await runner.run()

    const blockout = result.passes.find(p => p.id === 'blockout') as PassRecord
    expect(blockout.fixes).toBe(1)
    expect(fake.calls.build.filter(c => c.pass === 'blockout')).toHaveLength(2)
    // The failed load produced no render, so no review happened for that iteration.
    expect(fake.calls.review.filter(c => c.pass === 'blockout')).toHaveLength(1)
    const secondBuildCall = fake.calls.build.filter(c => c.pass === 'blockout')[1]
    expect(secondBuildCall?.defects).toEqual([{ component: '*', what: 'boom', measured: 'runtime error', fix: 'fix the runtime error' }])
    expect(result.status).toBe('done')
  })

  // -------------------------------------------------------------------------
  // (g) cancel
  // -------------------------------------------------------------------------

  it('(g) cancel mid-build stops the job with no further transport calls', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))

    let resolveBuild!: (value: ApiResult<BuildOutput>) => void
    const pendingBuild = new Promise<ApiResult<BuildOutput>>((resolve) => { resolveBuild = resolve })
    fake.transport.build = vi.fn((req) => {
      fake.calls.build.push(req)
      return pendingBuild
    })

    const runPromise = runner.run()
    // Let intake and spec resolve, and the first build call fire.
    while (fake.calls.build.length === 0) await tick(1)

    runner.cancel()
    expect(job.status).toBe('cancelled')

    resolveBuild(ok(buildOutput('blockout-1')))
    const result = await runPromise

    expect(result.status).toBe('cancelled')
    expect(fake.calls.build).toHaveLength(1)
    expect(fake.calls.review).toHaveLength(0)
    expect(renderer.load).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // (h) resume
  // -------------------------------------------------------------------------

  it('(h) resumes a persisted job at currentPass "form", skipping intake/spec/blockout/structural', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)

    const blockout: PassRecord = { id: 'blockout', code: 'blockout-code', sheets: ['data:x'], reviews: [continueReview()], fixes: 0 }
    const structural: PassRecord = { id: 'structural', code: 'structural-code', sheets: ['data:x'], reviews: [continueReview()], fixes: 0 }
    const job: SculptJob = {
      id: 'persisted-1',
      createdAt: Date.now(),
      image: 'data:image/jpeg;base64,photo',
      hint: '',
      dims: null,
      intake: baseIntake(),
      spec: baseSpec(),
      passes: [blockout, structural],
      currentPass: 'form',
      fixesTotal: 0,
      usage: { input: 0, output: 0 },
      costUsd: 0,
      status: 'idle',
      quality: null,
      error: null,
      question: null,
      glb: null,
    }
    const runner = new JobRunner(job, deps)

    queueSimplePass(fake, 'form')
    queueSimplePass(fake, 'material')
    queueSimplePass(fake, 'surface')

    const result = await runner.run()

    expect(fake.calls.intake).toHaveLength(0)
    expect(fake.calls.spec).toHaveLength(0)
    expect(fake.calls.build).toHaveLength(3)
    expect(fake.calls.build[0]?.pass).toBe('form')
    expect(result.passes).toHaveLength(5)
    expect(result.status).toBe('done')
  })

  // -------------------------------------------------------------------------
  // (i) transport failure
  // -------------------------------------------------------------------------

  it('(i) a transport ok:false result fails the job with the error', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(fail('camera obstructed'))

    const result = await runner.run()

    expect(result.status).toBe('failed')
    expect(result.error).toBe('camera obstructed')
    expect(fake.calls.spec).toHaveLength(0)
    expect(fake.calls.build).toHaveLength(0)
  })
})
