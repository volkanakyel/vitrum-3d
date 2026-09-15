/**
 * Sculpt job orchestrator.
 *
 * `JobRunner` walks a `SculptJob` through intake → spec → the five build
 * passes → export, driving injected `Transport` (the `/api/sculpt/*`
 * routes) and `Renderer` (the sandbox) implementations so the whole thing is
 * unit-testable without a browser or a network.
 *
 * Resume is deliberately coarse: `run()` looks only at `job.intake`,
 * `job.spec` and `job.currentPass` to decide where to start — intake/spec
 * are skipped once present, and the pass loop starts at `currentPass` (or
 * the first pass). A pass that was interrupted mid-flight simply repeats its
 * build/render/review loop from the top the next time `run()` is called;
 * this is also how `answer()` resumes a `waiting-input` job — it just
 * re-enters `run()` on the same `currentPass` with the answer carried as a
 * build note.
 */

import type { ApiResult, BuildOutput, Dims, Intake, PassId, Review, SculptSpec, Usage, View } from './types'
import { PASSES } from './types'

export interface Transport {
  intake: (req: { image: string, hint?: string, dims?: Dims }, signal: AbortSignal) => Promise<ApiResult<Intake>>
  spec: (req: { intake: Intake, image: string, critique?: string }, signal: AbortSignal) => Promise<ApiResult<SculptSpec>>
  build: (req: { spec: SculptSpec, pass: PassId, code?: string, defects?: Review['defects'], notes?: string[] }, signal: AbortSignal) => Promise<ApiResult<BuildOutput>>
  review: (req: { spec: SculptSpec, pass: PassId, sheet: string, image: string, fixesLeft: number }, signal: AbortSignal) => Promise<ApiResult<Review>>
}

/** Sandbox + sheet, injected so the runner is testable. */
export interface Renderer {
  load: (code: string) => Promise<{ parts: string[], triangles: number }>
  render: (views: View[]) => Promise<{ name: string, blob: Blob }[]>
  exportGLB: () => Promise<ArrayBuffer>
}

export type JobStatus =
  | 'idle'
  | 'intake'
  | 'spec'
  | 'building'
  | 'rendering'
  | 'reviewing'
  | 'waiting-input'
  | 'exporting'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface PassRecord {
  id: PassId
  code: string
  /** data URLs */
  sheets: string[]
  reviews: Review[]
  fixes: number
}

export interface SculptJob {
  id: string
  createdAt: number
  /** data URL <=1568 */
  image: string
  hint: string
  dims: Dims | null
  intake: Intake | null
  spec: SculptSpec | null
  passes: PassRecord[]
  currentPass: PassId | null
  fixesTotal: number
  usage: Usage
  costUsd: number
  status: JobStatus
  quality: 'good' | 'approximate' | null
  error: string | null
  question: string | null
  glb: ArrayBuffer | null
}

export interface JobRunnerDeps {
  transport: Transport
  renderer: Renderer
  sheet: (ref: string, renders: { name: string, blob: Blob }[]) => Promise<string>
  save: (job: SculptJob) => Promise<void>
  onChange: (job: SculptJob) => void
}

/** Per-pass fix budget. */
const PASS_FIX_BUDGET = 2
/** Job-wide fix budget shared across all passes. */
const TOTAL_FIX_BUDGET = 8

export function createJob(image: string, hint: string, dims: Dims | null): SculptJob {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    image,
    hint,
    dims,
    intake: null,
    spec: null,
    passes: [],
    currentPass: null,
    fixesTotal: 0,
    usage: { input: 0, output: 0 },
    costUsd: 0,
    status: 'idle',
    quality: null,
    error: null,
    question: null,
    glb: null,
  }
}

export function viewsFor(spec: SculptSpec): View[] {
  return [
    { name: 'reference', yaw: spec.camera.yaw, pitch: spec.camera.pitch, fov: spec.camera.fov, distance: spec.camera.distance },
    { name: 'front', yaw: 0, pitch: 0, fov: 30, distance: 2.6 },
    { name: 'side', yaw: 90, pitch: 0, fov: 30, distance: 2.6 },
    { name: 'top', yaw: 0, pitch: 89, fov: 30, distance: 2.6 },
  ]
}

export class JobRunner {
  readonly job: SculptJob
  private readonly deps: JobRunnerDeps
  private cancelled = false
  private controller: AbortController | null = null
  private pendingNotes: string[] | undefined

  /**
   * Not part of the required interface: `answer()` is `void` per the brief,
   * but it triggers an async resume internally. Tests (and callers that
   * care) can await this to know when that resume has settled.
   */
  lastRun: Promise<SculptJob>

  constructor(job: SculptJob, deps: JobRunnerDeps) {
    this.job = job
    this.deps = deps
    this.lastRun = Promise.resolve(job)
  }

  private snapshot(): SculptJob {
    return { ...this.job }
  }

  private async commit(): Promise<void> {
    await this.deps.save(this.job)
    this.deps.onChange({ ...this.job })
  }

  private addUsage(usage: Usage, costUsd: number): void {
    this.job.usage = { input: this.job.usage.input + usage.input, output: this.job.usage.output + usage.output }
    this.job.costUsd += costUsd
  }

  private async call<T>(fn: (signal: AbortSignal) => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    const controller = new AbortController()
    this.controller = controller
    try {
      return await fn(controller.signal)
    }
    finally {
      if (this.controller === controller) this.controller = null
    }
  }

  async run(): Promise<SculptJob> {
    this.cancelled = false
    const job = this.job

    try {
      if (!job.intake) {
        job.status = 'intake'
        await this.commit()
        const res = await this.call(signal => this.deps.transport.intake(
          { image: job.image, hint: job.hint || undefined, dims: job.dims ?? undefined },
          signal,
        ))
        if (this.cancelled) return this.snapshot()
        if (!res.ok) throw new Error(res.error)
        job.intake = res.data
        this.addUsage(res.usage, res.costUsd)
        await this.commit()
      }

      if (!job.spec) {
        job.status = 'spec'
        await this.commit()
        const res = await this.call(signal => this.deps.transport.spec(
          { intake: job.intake!, image: job.image },
          signal,
        ))
        if (this.cancelled) return this.snapshot()
        if (!res.ok) throw new Error(res.error)
        job.spec = res.data
        this.addUsage(res.usage, res.costUsd)
        await this.commit()
      }

      let stopped = false
      const firstPass = PASSES[0]!
      const startIndex = Math.max(0, PASSES.indexOf(job.currentPass ?? firstPass))

      for (let i = startIndex; i < PASSES.length; i++) {
        const pass = PASSES[i]!
        job.currentPass = pass

        let rec = job.passes.find(p => p.id === pass)
        if (!rec) {
          rec = { id: pass, code: '', sheets: [], reviews: [], fixes: 0 }
          job.passes.push(rec)
        }
        const record = rec

        let prevCode: string | undefined = record.code || undefined
        let defects: Review['defects'] | undefined
        let notes: string[] | undefined = this.pendingNotes
        this.pendingNotes = undefined

        while (true) {
          const spec: SculptSpec = job.spec!

          job.status = 'building'
          await this.commit()
          const buildRes: ApiResult<BuildOutput> = await this.call<BuildOutput>(signal => this.deps.transport.build(
            { spec, pass, code: prevCode, defects, notes },
            signal,
          ))
          if (this.cancelled) return this.snapshot()
          if (!buildRes.ok) throw new Error(buildRes.error)
          record.code = buildRes.data.code
          this.addUsage(buildRes.usage, buildRes.costUsd)
          await this.commit()

          job.status = 'rendering'
          await this.commit()

          try {
            await this.deps.renderer.load(record.code)
          }
          catch (err) {
            if (this.cancelled) return this.snapshot()
            const fixesLeft = Math.min(PASS_FIX_BUDGET - record.fixes, TOTAL_FIX_BUDGET - job.fixesTotal)
            if (fixesLeft <= 0) break
            record.fixes += 1
            job.fixesTotal += 1
            const message = err instanceof Error ? err.message : String(err)
            defects = [{ component: '*', what: message, measured: 'runtime error', fix: 'fix the runtime error' }]
            prevCode = record.code
            notes = undefined
            await this.commit()
            continue
          }
          if (this.cancelled) return this.snapshot()

          const renders = await this.deps.renderer.render(viewsFor(spec))
          if (this.cancelled) return this.snapshot()
          const sheetUrl = await this.deps.sheet(job.image, renders)
          if (this.cancelled) return this.snapshot()
          record.sheets.push(sheetUrl)
          await this.commit()

          job.status = 'reviewing'
          await this.commit()

          const fixesLeft = Math.min(PASS_FIX_BUDGET - record.fixes, TOTAL_FIX_BUDGET - job.fixesTotal)
          const reviewRes: ApiResult<Review> = await this.call<Review>(signal => this.deps.transport.review(
            { spec, pass, sheet: sheetUrl, image: job.image, fixesLeft },
            signal,
          ))
          if (this.cancelled) return this.snapshot()
          if (!reviewRes.ok) throw new Error(reviewRes.error)
          const review: Review = reviewRes.data
          record.reviews.push(review)
          this.addUsage(reviewRes.usage, reviewRes.costUsd)
          await this.commit()

          if (review.action === 'continue') {
            break
          }
          else if (review.action === 'refine-code') {
            if (fixesLeft <= 0) break
            record.fixes += 1
            job.fixesTotal += 1
            defects = review.defects
            prevCode = record.code
            notes = undefined
            await this.commit()
            continue
          }
          else if (review.action === 'refine-spec') {
            if (fixesLeft <= 0) break
            const critique: string = `${review.summary}\n${JSON.stringify(review.defects)}`
            const specRes: ApiResult<SculptSpec> = await this.call<SculptSpec>(signal => this.deps.transport.spec(
              { intake: job.intake!, image: job.image, critique },
              signal,
            ))
            if (this.cancelled) return this.snapshot()
            if (!specRes.ok) throw new Error(specRes.error)
            job.spec = specRes.data
            this.addUsage(specRes.usage, specRes.costUsd)
            record.fixes += 1
            job.fixesTotal += 1
            prevCode = undefined
            defects = undefined
            notes = undefined
            await this.commit()
            continue
          }
          else if (review.action === 'request-input') {
            job.status = 'waiting-input'
            job.question = review.question ?? ''
            await this.commit()
            return this.snapshot()
          }
          else {
            // 'stop': finish after this pass.
            stopped = true
            break
          }
        }

        if (stopped) break
      }

      job.status = 'exporting'
      await this.commit()
      const glb = await this.deps.renderer.exportGLB()
      if (this.cancelled) return this.snapshot()
      job.glb = glb

      job.quality = this.finalQuality() ?? 'approximate'
      job.status = 'done'
      await this.commit()
      return this.snapshot()
    }
    catch (err) {
      if (this.cancelled) return this.snapshot()
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
      await this.commit()
      return this.snapshot()
    }
  }

  private finalQuality(): 'good' | 'approximate' | null {
    const job = this.job
    const surfaceRec = job.passes.find(p => p.id === 'surface')
    let lastReview: Review | undefined
    if (surfaceRec && surfaceRec.reviews.length > 0) {
      lastReview = surfaceRec.reviews[surfaceRec.reviews.length - 1]
    }
    else {
      for (let i = job.passes.length - 1; i >= 0; i--) {
        const p = job.passes[i]!
        if (p.reviews.length > 0) {
          lastReview = p.reviews[p.reviews.length - 1]
          break
        }
      }
    }
    if (!lastReview) return null
    return lastReview.fidelity >= 0.8 ? 'good' : 'approximate'
  }

  cancel(): void {
    if (this.job.status === 'done' || this.job.status === 'failed' || this.job.status === 'cancelled') return
    this.cancelled = true
    this.controller?.abort()
    this.job.status = 'cancelled'
    this.lastRun = this.commit().then(() => this.snapshot())
  }

  /** Only valid in `waiting-input`; resumes the current pass with the answer as a build note. */
  answer(text: string): void {
    if (this.job.status !== 'waiting-input') return
    this.cancelled = false
    this.job.hint = `${this.job.hint}\n\nUser answer: ${text}`
    this.job.question = null
    this.job.status = 'building'
    this.pendingNotes = [text]
    this.lastRun = this.run()
  }
}
