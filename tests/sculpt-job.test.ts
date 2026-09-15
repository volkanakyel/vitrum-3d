import { describe, expect, it, vi } from 'vitest'
import { createJob, JobRunner, plainJob } from '../app/utils/sculpt/job'
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

function buildOutput(code: string, notes: string[] = []): BuildOutput {
  return { code, notes }
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

function refineSpecReview(summary: string): Review {
  return baseReview({
    action: 'refine-spec',
    fidelity: 0.4,
    summary,
    defects: [{ component: 'seat', what: 'too tall', measured: '0.6m', fix: 'lower to 0.45m' }],
  })
}

function stopReview(fidelity: number): Review {
  return baseReview({ action: 'stop', fidelity })
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

function makeRenderer(opts: { failLoadOnce?: boolean, failLoadAlways?: boolean } = {}): Renderer & { load: ReturnType<typeof vi.fn> } {
  let calls = 0
  const load = vi.fn(async (_code: string) => {
    calls += 1
    if (opts.failLoadAlways || (opts.failLoadOnce && calls === 1)) throw new Error('boom')
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

    const blockout: PassRecord = { id: 'blockout', code: 'blockout-code', notes: [], sheets: ['data:x'], reviews: [continueReview()], fixes: 0 }
    const structural: PassRecord = { id: 'structural', code: 'structural-code', notes: [], sheets: ['data:x'], reviews: [continueReview()], fixes: 0 }
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

  // -------------------------------------------------------------------------
  // fix round 1 — chained code + carried notes
  // -------------------------------------------------------------------------

  it('chains build code (and notes) from the previous pass, and refine-spec rebuilds without code', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec('v1')))

    // blockout: single build, continue. Carries its own notes forward.
    fake.queues.build.push(ok(buildOutput('blockout-final', ['note-A'])))
    fake.queues.review.push(ok(continueReview()))

    // structural: fresh pass -> chains blockout's final code + notes.
    fake.queues.build.push(ok(buildOutput('structural-draft', ['note-B'])))
    fake.queues.review.push(ok(refineSpecReview('proportions are wrong')))
    fake.queues.spec.push(ok(baseSpec('v2')))
    // refine-spec rebuild: no code, but notes still carry from the last build.
    fake.queues.build.push(ok(buildOutput('structural-mid', ['note-C'])))
    fake.queues.review.push(ok(refineCodeReview()))
    // refine-code rebuild: own latest code, notes carry from the last build.
    fake.queues.build.push(ok(buildOutput('structural-final', ['note-D'])))
    fake.queues.review.push(ok(continueReview()))

    // form: fresh pass -> chains structural's *final* code + notes.
    fake.queues.build.push(ok(buildOutput('form-final')))
    fake.queues.review.push(ok(continueReview()))

    queueSimplePass(fake, 'material')
    queueSimplePass(fake, 'surface')

    const result = await runner.run()

    const structuralBuilds = fake.calls.build.filter(c => c.pass === 'structural')
    expect(structuralBuilds).toHaveLength(3)
    expect(structuralBuilds[0]?.code).toBe('blockout-final')
    expect(structuralBuilds[0]?.notes).toEqual(['note-A'])
    expect(structuralBuilds[1]?.code).toBeUndefined() // rebuilt from the refined spec, no prior code
    expect(structuralBuilds[1]?.notes).toEqual(['note-B'])
    expect(structuralBuilds[2]?.code).toBe('structural-mid') // refine-code: own latest code
    expect(structuralBuilds[2]?.notes).toEqual(['note-C'])

    const formBuilds = fake.calls.build.filter(c => c.pass === 'form')
    expect(formBuilds).toHaveLength(1)
    expect(formBuilds[0]?.code).toBe('structural-final')
    expect(formBuilds[0]?.notes).toEqual(['note-D'])

    expect(result.status).toBe('done')
  })

  // -------------------------------------------------------------------------
  // fix round 1 — cancel/save races
  // -------------------------------------------------------------------------

  it('cancelling from inside save() bails immediately: no further transport calls, terminal status stays cancelled', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    let runner!: JobRunner
    const saveStatuses: string[] = []
    let triggered = false
    const save = vi.fn(async (job: SculptJob) => {
      saveStatuses.push(job.status)
      // Fires on the commit right after the first build succeeds — the exact
      // race from the bug report: cancel() lands while `save()` for that
      // commit is in flight, before `status` would otherwise move on to
      // 'rendering' and before renderer.load (a real, paid call) fires.
      if (!triggered && job.status === 'building' && job.passes[0]?.code === 'blockout-1') {
        triggered = true
        runner.cancel()
      }
    })
    const onChange = vi.fn()
    const deps = { transport: fake.transport, renderer, sheet: vi.fn(async () => 'data:image/jpeg;base64,x'), save, onChange }
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    fake.queues.build.push(ok(buildOutput('blockout-1')))
    // No review queued: reaching a review call would be a bug.

    const result = await runner.run()

    expect(result.status).toBe('cancelled')
    expect(fake.calls.build).toHaveLength(1)
    expect(fake.calls.review).toHaveLength(0)
    expect(renderer.load).not.toHaveBeenCalled()
    expect(saveStatuses[saveStatuses.length - 1]).toBe('cancelled')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })

  it('cancel during renderer.render() stops before sheet/review are ever called', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    let resolveRender!: (value: { name: string, blob: Blob }[]) => void
    const renderPromise = new Promise<{ name: string, blob: Blob }[]>((resolve) => { resolveRender = resolve })
    renderer.render = vi.fn(() => renderPromise)
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    fake.queues.build.push(ok(buildOutput('blockout-1')))

    const runPromise = runner.run()
    while ((renderer.render as ReturnType<typeof vi.fn>).mock.calls.length === 0) await tick(1)

    runner.cancel()
    resolveRender([{ name: 'reference', blob: new Blob(['x']) }])
    const result = await runPromise

    expect(result.status).toBe('cancelled')
    expect(deps.sheet).not.toHaveBeenCalled()
    expect(fake.calls.review).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // fix round 1 — save failure surfaces as a job failure
  // -------------------------------------------------------------------------

  it('a save() rejection during a pass fails the job, still fires onChange, and run() resolves (not rejects)', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    let saveCallCount = 0
    const save = vi.fn(async () => {
      saveCallCount += 1
      // The 5th commit is the "status: building" commit for the blockout
      // pass — i.e. a failure that happens *during a pass*, not during
      // intake/spec.
      if (saveCallCount === 5) throw new Error('disk full')
    })
    const onChange = vi.fn()
    const deps = { transport: fake.transport, renderer, sheet: vi.fn(async () => 'data:image/jpeg;base64,x'), save, onChange }
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    // No build/review queued: the failure must happen before any build call.

    const result = await runner.run()

    expect(result.status).toBe('failed')
    expect(result.error).toBe('disk full')
    expect(fake.calls.build).toHaveLength(0)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'disk full' }))
  })

  // -------------------------------------------------------------------------
  // fix round 1 — quality is surface-only
  // -------------------------------------------------------------------------

  it('stop before surface finishes "approximate" (even with a high fidelity), and export still runs', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    fake.queues.build.push(ok(buildOutput('blockout-1')))
    fake.queues.review.push(ok(stopReview(0.85)))

    const result = await runner.run()

    expect(result.status).toBe('done')
    expect(result.quality).toBe('approximate')
    expect(result.passes).toHaveLength(1)
    expect(result.currentPass).toBe('blockout')
    expect(renderer.exportGLB).toHaveBeenCalledTimes(1)
    expect(result.glb).toBeInstanceOf(ArrayBuffer)
  })

  // -------------------------------------------------------------------------
  // fix round 1 — re-entrancy
  // -------------------------------------------------------------------------

  it('run() is re-entrant: a concurrent call returns the same in-flight promise', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    for (const pass of ['blockout', 'structural', 'form', 'material', 'surface']) queueSimplePass(fake, pass)

    const p1 = runner.run()
    const p2 = runner.run()
    expect(p2).toBe(p1)

    const result = await p1
    expect(result.status).toBe('done')
    expect(fake.calls.intake).toHaveLength(1)
  })

  it('run() on an already-done job is a no-op', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    job.status = 'done'
    const runner = new JobRunner(job, deps)

    const result = await runner.run()

    expect(result.status).toBe('done')
    expect(fake.calls.intake).toHaveLength(0)
    expect(deps.save).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // fix round 1 — export guarded by the last load's success
  // -------------------------------------------------------------------------

  it('skips export and finishes "approximate" with glb: null when the renderer never loaded successfully', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer({ failLoadAlways: true })
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    // Every pass burns its fix budget on load failures alone; 13 build calls
    // total across the 5 passes (3 + 3 + 3 + 3 + 1, per the shared 8-fix cap).
    for (let i = 0; i < 13; i++) fake.queues.build.push(ok(buildOutput(`code-${i}`)))

    const result = await runner.run()

    expect(result.status).toBe('done')
    expect(result.quality).toBe('approximate')
    expect(result.glb).toBeNull()
    expect(renderer.exportGLB).not.toHaveBeenCalled()
    expect(fake.calls.review).toHaveLength(0)
    expect(fake.calls.build).toHaveLength(13)
  })

  // -------------------------------------------------------------------------
  // fix round 1 — save boundary is a plain (non-reactive-proxy-safe) copy
  // -------------------------------------------------------------------------

  it('plainJob() deep-clones JSON-shaped fields but passes glb through by reference', () => {
    const original = createJob('data:image/jpeg;base64,photo', '', null)
    original.intake = new Proxy(baseIntake(), {}) // stand-in for a Vue reactive proxy
    original.passes = [{ id: 'blockout', code: 'c', notes: ['n'], sheets: ['s'], reviews: [continueReview()], fixes: 0 }]
    original.glb = new ArrayBuffer(4)

    const plain = plainJob(original)

    expect(plain).not.toBe(original)
    expect(plain.intake).toEqual(baseIntake())
    expect(Object.getPrototypeOf(plain.intake)).toBe(Object.prototype)
    expect(plain.passes).not.toBe(original.passes)
    expect(plain.passes[0]).not.toBe(original.passes[0])
    expect(plain.passes).toEqual(original.passes)
    // The one field JSON cannot represent must survive by reference, not be dropped.
    expect(plain.glb).toBe(original.glb)
  })

  it('commit() persists a plain copy, not the live job object', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    for (const pass of ['blockout', 'structural', 'form', 'material', 'surface']) queueSimplePass(fake, pass)

    await runner.run()

    expect(deps.save.mock.calls.length).toBeGreaterThan(0)
    for (const [savedJob] of deps.save.mock.calls) {
      expect(savedJob).not.toBe(job)
    }
  })

  // -------------------------------------------------------------------------
  // fix round 1 — usage/cost accumulation
  // -------------------------------------------------------------------------

  it('accumulates usage and costUsd across intake, spec, build and review calls', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake(), { input: 100, output: 50 }, 1))
    fake.queues.spec.push(ok(baseSpec(), { input: 200, output: 80 }, 2))
    fake.queues.build.push(ok(buildOutput('blockout-1'), { input: 300, output: 120 }, 3))
    fake.queues.review.push(ok(stopReview(0.5), { input: 400, output: 160 }, 4))

    const result = await runner.run()

    expect(result.usage).toEqual({ input: 1000, output: 410 })
    expect(result.costUsd).toBeCloseTo(10)
    expect(result.status).toBe('done')
  })

  // -------------------------------------------------------------------------
  // fix round 1 — resume a pass that has code but no review (rebuild)
  // -------------------------------------------------------------------------

  it('resumes a pass with code but no review by rebuilding it from the top', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    const deps = makeDeps(fake.transport, renderer)

    const blockout: PassRecord = { id: 'blockout', code: 'existing-code', notes: ['n1'], sheets: [], reviews: [], fixes: 0 }
    const job: SculptJob = {
      id: 'persisted-2',
      createdAt: Date.now(),
      image: 'data:image/jpeg;base64,photo',
      hint: '',
      dims: null,
      intake: baseIntake(),
      spec: baseSpec(),
      passes: [blockout],
      currentPass: 'blockout',
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

    fake.queues.build.push(ok(buildOutput('blockout-rebuilt')))
    fake.queues.review.push(ok(continueReview()))
    for (const pass of ['structural', 'form', 'material', 'surface']) queueSimplePass(fake, pass)

    const result = await runner.run()

    expect(fake.calls.intake).toHaveLength(0)
    expect(fake.calls.spec).toHaveLength(0)
    expect(fake.calls.build[0]?.code).toBe('existing-code')
    expect(fake.calls.build[0]?.notes).toEqual(['n1'])
    const finalBlockout = result.passes.find(p => p.id === 'blockout') as PassRecord
    expect(finalBlockout.code).toBe('blockout-rebuilt')
    expect(result.status).toBe('done')
  })
})

describe('measured part bounds', () => {
  it('are recorded from each load, sent to the reviewer, and to a refine-code rebuild only', async () => {
    const fake = makeTransport()
    const renderer = makeRenderer()
    let loads = 0
    renderer.load.mockImplementation(async () => {
      loads += 1
      return { parts: ['slab'], triangles: 10, partBounds: [{ id: 'slab', min: [0, loads, 0], max: [1, loads + 1, 1] }] }
    })
    const deps = makeDeps(fake.transport, renderer)
    const job = createJob('data:image/jpeg;base64,photo', '', null)
    const runner = new JobRunner(job, deps)

    fake.queues.intake.push(ok(baseIntake()))
    fake.queues.spec.push(ok(baseSpec()))
    // blockout: draft -> refine-code -> final -> continue
    fake.queues.build.push(ok(buildOutput('blockout-draft')))
    fake.queues.review.push(ok(refineCodeReview()))
    fake.queues.build.push(ok(buildOutput('blockout-final')))
    fake.queues.review.push(ok(continueReview()))
    // the remaining passes go straight through
    for (let i = 0; i < 4; i++) {
      fake.queues.build.push(ok(buildOutput(`pass-${i}`)))
      fake.queues.review.push(ok(continueReview()))
    }

    const result = await runner.run()
    expect(result.status).toBe('done')

    // The first review saw the first load's boxes.
    expect(fake.calls.review[0]!.partBounds).toEqual([{ id: 'slab', min: [0, 1, 0], max: [1, 2, 1] }])
    // A fresh build carries no boxes; the refine-code rebuild carries the draft's.
    expect(fake.calls.build[0]!.partBounds).toBeUndefined()
    expect(fake.calls.build[1]!.partBounds).toEqual([{ id: 'slab', min: [0, 1, 0], max: [1, 2, 1] }])
    // The next pass is a fresh file against the previous pass's code: no boxes.
    expect(fake.calls.build[2]!.partBounds).toBeUndefined()
    // The record keeps the latest load's boxes.
    const blockout = result.passes.find(p => p.id === 'blockout')!
    expect(blockout.partBounds).toEqual([{ id: 'slab', min: [0, 2, 0], max: [1, 3, 1] }])
  })
})
