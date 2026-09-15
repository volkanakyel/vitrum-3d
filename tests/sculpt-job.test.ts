import { describe, expect, it, vi } from 'vitest'
import { createJob, GOOD_FIDELITY, JobRunner, plainJob } from '../app/utils/sculpt/job'
import type { Renderer, SculptJob, Transport } from '../app/utils/sculpt/job'
import type { ApiResult, BuildOutput, Review, SculptSpec } from '../app/utils/sculpt/types'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function baseSpec(name = 'Oak stool'): SculptSpec {
  return {
    name,
    id: 'oak-stool',
    objectClass: 'stool',
    suitability: { verdict: 'pass', reasons: [] },
    symmetry: 'left-right',
    camera: { yaw: 20, pitch: 10, fov: 32, distance: 2.4, confidence: 0.9 },
    dimensions: { widthM: 0.4, heightM: 0.45, depthM: 0.4, source: 'estimated' },
    detailInventory: [],
    notes: [],
    components: [],
    materials: [],
    repetition: [],
    mustMatch: [],
    niceToHave: [],
  }
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    fidelity: 0.9,
    layers: { silhouetteProportion: 1, componentStructure: 1, formDetail: 1, materialSurface: 1, lightingCamera: 1 },
    defects: [],
    summary: 'looks right',
    ...overrides,
  }
}

const DEFECT = { component: 'legs', what: 'too thin', measured: '10mm', fix: 'thicken to 20mm' }

function ok<T>(data: T, usage = { input: 10, output: 20 }, costUsd = 0.01): ApiResult<T> {
  return { ok: true, data, usage, costUsd }
}

function fail(error: string): ApiResult<never> {
  return { ok: false, error }
}

// ---------------------------------------------------------------------------
// fake transport / renderer
// ---------------------------------------------------------------------------

interface Fake {
  transport: Transport
  queues: { plan: ApiResult<SculptSpec>[], build: ApiResult<BuildOutput>[], review: ApiResult<Review>[] }
  calls: {
    plan: Parameters<Transport['plan']>[0][]
    build: Parameters<Transport['build']>[0][]
    review: Parameters<Transport['review']>[0][]
  }
}

function makeTransport(): Fake {
  const queues: Fake['queues'] = { plan: [], build: [], review: [] }
  const calls: Fake['calls'] = { plan: [], build: [], review: [] }
  const take = <T>(q: ApiResult<T>[], name: string): ApiResult<T> => {
    const next = q.shift()
    if (!next) throw new Error(`${name} queue exhausted`)
    return next
  }
  const transport: Transport = {
    plan: vi.fn(async (req) => { calls.plan.push(req); return take(queues.plan, 'plan') }),
    build: vi.fn(async (req) => { calls.build.push(req); return take(queues.build, 'build') }),
    review: vi.fn(async (req) => { calls.review.push(req); return take(queues.review, 'review') }),
  }
  return { transport, queues, calls }
}

interface FakeRenderer {
  renderer: Renderer
  loads: string[]
  /** Codes whose load throws. */
  broken: Set<string>
  exports: number
}

function makeRenderer(): FakeRenderer {
  const state: FakeRenderer = {
    loads: [],
    broken: new Set(),
    exports: 0,
    renderer: {
      load: vi.fn(async (code: string) => {
        state.loads.push(code)
        if (state.broken.has(code)) throw new Error(`boom: ${code}`)
        return { parts: ['seat'], triangles: 12, partBounds: [{ id: 'seat', min: [0, 0, 0], max: [1, 1, 1] }] }
      }),
      render: vi.fn(async views => views.map(v => ({ name: v.name, blob: new Blob(['png']) }))),
      exportGLB: vi.fn(async () => { state.exports += 1; return new ArrayBuffer(8) }),
    },
  }
  return state
}

function makeRunner(job: SculptJob, fake: Fake, r: FakeRenderer) {
  const changes: SculptJob[] = []
  const landed: SculptJob[] = []
  const runner = new JobRunner(job, {
    transport: fake.transport,
    renderer: r.renderer,
    sheet: async () => 'data:image/jpeg;base64,sheet',
    save: async () => {},
    onChange: j => changes.push(j),
    onModel: (_glb, j) => landed.push(j),
  })
  return { runner, changes, landed }
}

function fresh(polish = true): SculptJob {
  return createJob('data:image/png;base64,ref', '', null, polish)
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('JobRunner: the happy path', () => {
  it('plans, builds, lands the draft, reviews, and finishes in three calls when the review is clean', async () => {
    const fake = makeTransport()
    const r = makeRenderer()
    fake.queues.plan.push(ok(baseSpec()))
    fake.queues.build.push(ok({ code: 'v1', notes: ['built'] }))
    fake.queues.review.push(ok(review({ fidelity: 0.9 })))
    const { runner, landed, changes } = makeRunner(fresh(), fake, r)

    const result = await runner.run()

    expect(result.status).toBe('done')
    expect(result.quality).toBe('good')
    expect(result.draft).toBe(false)
    expect(result.code).toBe('v1')
    expect(result.glb).toBeInstanceOf(ArrayBuffer)
    expect(result.sheets).toHaveLength(1)
    expect(fake.calls.plan).toHaveLength(1)
    expect(fake.calls.build).toHaveLength(1)
    expect(fake.calls.review).toHaveLength(1)
    // The draft reached the stage before the review was asked for.
    expect(landed).toHaveLength(1)
    expect(landed[0]!.draft).toBe(true)
    const order = changes.map(c => c.status)
    expect(order.indexOf('reviewing')).toBeGreaterThan(order.indexOf('rendering'))
    expect(result.usage).toEqual({ input: 30, output: 60 })
    expect(result.costUsd).toBeCloseTo(0.03)
    // The reviewer gets the sheet and the measured table, never the photo again.
    expect(fake.calls.review[0]!.partBounds).toHaveLength(1)
    expect('image' in fake.calls.review[0]!).toBe(false)
  })

  it('spends the one fix when the review lists defects below the bar, and lands the fix', async () => {
    const fake = makeTransport()
    const r = makeRenderer()
    fake.queues.plan.push(ok(baseSpec()))
    fake.queues.build.push(ok({ code: 'v1', notes: [] }), ok({ code: 'v2', notes: ['fixed'] }))
    fake.queues.review.push(ok(review({ fidelity: 0.6, defects: [DEFECT] })))
    const { runner, landed } = makeRunner(fresh(), fake, r)

    const result = await runner.run()

    expect(result.status).toBe('done')
    expect(result.code).toBe('v2')
    expect(result.fixed).toBe(true)
    expect(result.quality).toBe('approximate')
    expect(result.sheets).toHaveLength(2)
    expect(fake.calls.build).toHaveLength(2)
    const fix = fake.calls.build[1]!
    expect(fix.code).toBe('v1')
    expect(fix.defects).toEqual([DEFECT])
    expect(fix.partBounds).toHaveLength(1)
    expect(landed.map(j => j.draft)).toEqual([true, true])
    expect(r.exports).toBe(2)
    // One review only: the fix is never re-reviewed.
    expect(fake.calls.review).toHaveLength(1)
  })

  it('skips the fix when the review scores at the bar even with defects listed', async () => {
    const fake = makeTransport()
    const r = makeRenderer()
    fake.queues.plan.push(ok(baseSpec()))
    fake.queues.build.push(ok({ code: 'v1', notes: [] }))
    fake.queues.review.push(ok(review({ fidelity: GOOD_FIDELITY, defects: [DEFECT] })))
    const { runner } = makeRunner(fresh(), fake, r)
    const result = await runner.run()
    expect(result.status).toBe('done')
    expect(result.fixed).toBe(false)
    expect(fake.calls.build).toHaveLength(1)
  })

  it('without polish it is two calls and done', async () => {
    const fake = makeTransport()
    const r = makeRenderer()
    fake.queues.plan.push(ok(baseSpec()))
    fake.queues.build.push(ok({ code: 'v1', notes: [] }))
    const { runner, landed } = makeRunner(fresh(false), fake, r)
    const result = await runner.run()
    expect(result.status).toBe('done')
    expect(result.quality).toBe('approximate')
    expect(fake.calls.review).toHaveLength(0)
    expect(landed).toHaveLength(1)
    expect(result.draft).toBe(false)
  })

  it('the plan carries the hint and the dims', async () => {
    const fake = makeTransport()
    const r = makeRenderer()
    fake.queues.plan.push(ok(baseSpec()))
    fake.queues.build.push(ok({ code: 'v1', notes: [] }))
    const job = createJob('img', 'a stool', { widthMm: 400, heightMm: 450, depthMm: 400 }, false)
    await makeRunner(job, fake, r).runner.run()
    expect(fake.calls.plan[0]).toEqual({ image: 'img', hint: 'a stool', dims: { widthMm: 400, heightMm: 450, depthMm: 400 } })
  })
})

describe('JobRunner: broken code', () => {
  it('a draft that will not load spends the fix on the error', async () => {
    const fake = makeTransport()
    const r = makeRenderer()
    r.broken.add('bad')
    fake.queues.plan.push(ok(baseSpec()))
    fake.queues.build.push(ok({ code: 'bad', notes: [] }), ok({ code: 'good', notes: [] }))
    const { runner, landed } = makeRunner(fresh(), fake, r)
    const result = await runner.run()
    expect(result.status).toBe('done')
    expect(result.code).toBe('good')
    expect(fake.calls.build[1]!.defects?.[0]?.what).toContain('boom: bad')
    expect(fake.calls.build[1]!.code).toBe('bad')
    // No render happened, so there is nothing to review; the fix is the result.
    expect(fake.calls.review).toHaveLength(0)
    expect(landed).toHaveLength(1)
  })

  it('a draft and a fix that both fail to load ends the run failed with no model', async () => {
    const fake = makeTransport()
    const r = makeRenderer()
    r.broken.add('bad1').add('bad2')
    fake.queues.plan.push(ok(baseSpec()))
    fake.queues.build.push(ok({ code: 'bad1', notes: [] }), ok({ code: 'bad2', notes: [] }))
    const { runner, landed } = makeRunner(fresh(), fake, r)
    const result = await runner.run()
    expect(result.status).toBe('failed')
    expect(result.error).toContain('boom: bad2')
    expect(result.glb).toBeNull()
    expect(landed).toHaveLength(0)
    expect(fake.calls.build).toHaveLength(2)
  })

  it('a fix that will not load keeps the draft and finishes', async () => {
    const fake = makeTransport()
    const r = makeRenderer()
    r.broken.add('v2')
    fake.queues.plan.push(ok(baseSpec()))
    fake.queues.build.push(ok({ code: 'v1', notes: [] }), ok({ code: 'v2', notes: [] }))
    fake.queues.review.push(ok(review({ fidelity: 0.5, defects: [DEFECT] })))
    const { runner, landed } = makeRunner(fresh(), fake, r)
    const result = await runner.run()
    expect(result.status).toBe('done')
    expect(result.code).toBe('v1')
    expect(result.glb).toBeInstanceOf(ArrayBuffer)
    expect(result.notes.join(' ')).toContain('fix discarded')
    expect(landed).toHaveLength(1)
  })
})

describe('JobRunner: failures and resume', () => {
  it('a failed plan ends the run with the error', async () => {
    const fake = makeTransport()
    fake.queues.plan.push(fail('rate limited'))
    const { runner } = makeRunner(fresh(), fake, makeRenderer())
    const result = await runner.run()
    expect(result.status).toBe('failed')
    expect(result.error).toBe('rate limited')
  })

  it('a failed route still counts what it spent', async () => {
    const fake = makeTransport()
    fake.queues.plan.push(ok(baseSpec()))
    fake.queues.build.push({ ok: false, error: 'generated code failed validation twice', usage: { input: 5, output: 7 }, costUsd: 0.2 })
    const { runner } = makeRunner(fresh(), fake, makeRenderer())
    const result = await runner.run()
    expect(result.status).toBe('failed')
    expect(result.usage).toEqual({ input: 15, output: 27 })
    expect(result.costUsd).toBeCloseTo(0.21)
  })

  it('resumes a failed build without re-planning, and a failed review without rebuilding', async () => {
    const fake = makeTransport()
    const r = makeRenderer()
    fake.queues.plan.push(ok(baseSpec()))
    fake.queues.build.push(fail('upstream'))
    const job = fresh()
    const first = await makeRunner(job, fake, r).runner.run()
    expect(first.status).toBe('failed')
    expect(first.spec).not.toBeNull()

    fake.queues.build.push(ok({ code: 'v1', notes: [] }))
    fake.queues.review.push(fail('upstream again'))
    const second = await makeRunner({ ...first, error: null }, fake, r).runner.run()
    expect(second.status).toBe('failed')
    expect(fake.calls.plan).toHaveLength(1)
    expect(second.glb).toBeInstanceOf(ArrayBuffer)
    expect(second.sheets).toHaveLength(1)

    fake.queues.review.push(ok(review({ fidelity: 0.9 })))
    const third = await makeRunner({ ...second, error: null }, fake, r).runner.run()
    expect(third.status).toBe('done')
    expect(fake.calls.build).toHaveLength(2)
    expect(r.loads).toHaveLength(1)
  })

  it('a done job is a no-op', async () => {
    const fake = makeTransport()
    const job = { ...fresh(), status: 'done' as const }
    const result = await makeRunner(job, fake, makeRenderer()).runner.run()
    expect(result.status).toBe('done')
    expect(fake.calls.plan).toHaveLength(0)
  })
})

describe('JobRunner: cancel', () => {
  it('a cancel during the plan stops before the build', async () => {
    const fake = makeTransport()
    const r = makeRenderer()
    let release!: (v: ApiResult<SculptSpec>) => void
    fake.transport.plan = vi.fn(() => new Promise<ApiResult<SculptSpec>>((resolve) => { release = resolve }))
    const { runner } = makeRunner(fresh(), fake, r)
    const run = runner.run()
    await new Promise(resolve => setTimeout(resolve, 0))
    runner.cancel()
    release(ok(baseSpec()))
    const result = await run
    expect(result.status).toBe('cancelled')
    expect(fake.calls.build).toHaveLength(0)
  })

  it('a cancel after the draft landed keeps the draft', async () => {
    const fake = makeTransport()
    const r = makeRenderer()
    fake.queues.plan.push(ok(baseSpec()))
    fake.queues.build.push(ok({ code: 'v1', notes: [] }))
    let release!: (v: ApiResult<Review>) => void
    fake.transport.review = vi.fn(() => new Promise<ApiResult<Review>>((resolve) => { release = resolve }))
    const { runner, landed } = makeRunner(fresh(), fake, r)
    const run = runner.run()
    while (landed.length === 0) await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
    runner.cancel()
    release(ok(review({ fidelity: 0.3, defects: [DEFECT] })))
    const result = await run
    expect(result.status).toBe('cancelled')
    expect(result.glb).toBeInstanceOf(ArrayBuffer)
    expect(fake.calls.build).toHaveLength(1)
  })
})

describe('plainJob', () => {
  it('deep-copies the JSON fields and passes the glb by reference', () => {
    const glb = new ArrayBuffer(4)
    const job: SculptJob = { ...fresh(), spec: baseSpec(), review: review(), glb, sheets: ['s'], partBounds: [{ id: 'a', min: [0, 0, 0], max: [1, 1, 1] }] }
    const copy = plainJob(job)
    expect(copy).toEqual(job)
    expect(copy.spec).not.toBe(job.spec)
    expect(copy.review).not.toBe(job.review)
    expect(copy.sheets).not.toBe(job.sheets)
    expect(copy.glb).toBe(glb)
  })
})
