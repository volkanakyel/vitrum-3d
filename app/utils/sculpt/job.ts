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
  /** `BuildOutput.notes` from this pass's latest build; carried into the next build request. */
  notes: string[]
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

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * A save-boundary-safe copy of a job: every JSON-shaped field is deep-cloned
 * through JSON (which strips Vue reactive proxies, getters, class instances,
 * etc. down to plain data IndexedDB's structured-clone algorithm can never
 * choke on), while `glb` — an `ArrayBuffer`, which structured clone already
 * supports natively — is passed through by reference rather than JSON-cloned
 * (JSON cannot represent an `ArrayBuffer` at all).
 */
export function plainJob(job: SculptJob): SculptJob {
  return {
    id: job.id,
    createdAt: job.createdAt,
    image: job.image,
    hint: job.hint,
    dims: job.dims ? clonePlain(job.dims) : null,
    intake: job.intake ? clonePlain(job.intake) : null,
    spec: job.spec ? clonePlain(job.spec) : null,
    passes: job.passes.map(p => ({
      id: p.id,
      code: p.code,
      notes: [...p.notes],
      sheets: [...p.sheets],
      reviews: clonePlain(p.reviews),
      fixes: p.fixes,
    })),
    currentPass: job.currentPass,
    fixesTotal: job.fixesTotal,
    usage: { ...job.usage },
    costUsd: job.costUsd,
    status: job.status,
    quality: job.quality,
    error: job.error,
    question: job.question,
    glb: job.glb,
  }
}

export class JobRunner {
  readonly job: SculptJob
  private readonly deps: JobRunnerDeps
  private cancelled = false
  private running = false
  private controller: AbortController | null = null
  private pendingNotes: string[] | undefined
  /** Whether the most recent `renderer.load` call (across the whole run) succeeded. */
  private lastLoadOk = false

  /**
   * Not part of the required interface: `answer()` is `void` per the brief,
   * but it triggers an async resume internally, and `run()` itself is now
   * re-entrancy-guarded and may just hand back an in-flight run. Tests (and
   * callers that care) can await this to know when the current run/resume
   * has settled.
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

  /**
   * Persists (as a plain, non-reactive copy) then notifies; returns `false`
   * if a cancellation landed while the save was in flight. Callers MUST bail
   * out immediately when this returns `false` — no further transport/render
   * calls, and no further `status` mutation, so a cancellation can never be
   * silently overwritten by whatever step was about to run next.
   */
  private async commit(): Promise<boolean> {
    await this.deps.save(plainJob(this.job))
    this.deps.onChange({ ...this.job })
    return !this.cancelled
  }

  /**
   * Used only on the failure/cancel paths: must never throw (a broken
   * `save` must not turn a reported failure into a rejected `run()`), and
   * must always notify so the failure is observable even if persistence
   * itself failed.
   */
  private async commitBestEffort(): Promise<void> {
    try {
      await this.deps.save(plainJob(this.job))
    }
    catch {
      // Persistence failed on the way to reporting a terminal state; the
      // in-memory job and this onChange are the only remaining source of
      // truth for it.
    }
    finally {
      this.deps.onChange({ ...this.job })
    }
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

  /**
   * Resumes from `job.status`/`job.currentPass`. Re-entrant: a call while
   * already running just returns the same in-flight promise (not merely an
   * equal one — deliberately not `async`, so the promise identity survives);
   * a `done` job is a no-op.
   */
  run(): Promise<SculptJob> {
    if (this.job.status === 'done') return Promise.resolve(this.snapshot())
    if (this.running) return this.lastRun
    this.running = true
    this.cancelled = false
    const promise = this.execute().finally(() => { this.running = false })
    this.lastRun = promise
    return promise
  }

  private async execute(): Promise<SculptJob> {
    const job = this.job

    try {
      if (!job.intake) {
        job.status = 'intake'
        if (!(await this.commit())) return this.snapshot()
        const res = await this.call(signal => this.deps.transport.intake(
          { image: job.image, hint: job.hint || undefined, dims: job.dims ?? undefined },
          signal,
        ))
        if (this.cancelled) return this.snapshot()
        if (!res.ok) throw new Error(res.error)
        job.intake = res.data
        this.addUsage(res.usage, res.costUsd)
        if (!(await this.commit())) return this.snapshot()
      }

      if (!job.spec) {
        job.status = 'spec'
        if (!(await this.commit())) return this.snapshot()
        const res = await this.call(signal => this.deps.transport.spec(
          { intake: job.intake!, image: job.image },
          signal,
        ))
        if (this.cancelled) return this.snapshot()
        if (!res.ok) throw new Error(res.error)
        job.spec = res.data
        this.addUsage(res.usage, res.costUsd)
        if (!(await this.commit())) return this.snapshot()
      }

      let stopped = false
      const firstPass = PASSES[0]!
      const startIndex = Math.max(0, PASSES.indexOf(job.currentPass ?? firstPass))

      for (let i = startIndex; i < PASSES.length; i++) {
        const pass = PASSES[i]!
        job.currentPass = pass

        let rec = job.passes.find(p => p.id === pass)
        if (!rec) {
          rec = { id: pass, code: '', notes: [], sheets: [], reviews: [], fixes: 0 }
          job.passes.push(rec)
        }
        const record = rec

        // The pass prompts are written as edits of "the current file", so a
        // fresh pass (no code of its own yet) must chain from the previous
        // pass's final code rather than starting from an empty file. A pass
        // that already has its own code (mid-pass resume, or answer()
        // resuming a waiting-input pass) keeps building on that instead.
        let prevCode: string | undefined = record.code || undefined
        let carriedNotes: string[] = record.code ? (record.notes ?? []) : []
        if (!prevCode && i > 0) {
          const prevRec = job.passes.find(p => p.id === PASSES[i - 1]!)
          if (prevRec) {
            prevCode = prevRec.code || undefined
            if (carriedNotes.length === 0) carriedNotes = prevRec.notes ?? []
          }
        }

        let defects: Review['defects'] | undefined
        let answerNotes: string[] | undefined = this.pendingNotes
        this.pendingNotes = undefined

        while (true) {
          const spec: SculptSpec = job.spec!
          const notes = [...carriedNotes, ...(answerNotes ?? [])]
          answerNotes = undefined

          job.status = 'building'
          if (!(await this.commit())) return this.snapshot()
          const buildRes: ApiResult<BuildOutput> = await this.call<BuildOutput>(signal => this.deps.transport.build(
            { spec, pass, code: prevCode, defects, notes: notes.length > 0 ? notes : undefined },
            signal,
          ))
          if (this.cancelled) return this.snapshot()
          if (!buildRes.ok) throw new Error(buildRes.error)
          record.code = buildRes.data.code
          record.notes = buildRes.data.notes ?? []
          carriedNotes = record.notes
          this.addUsage(buildRes.usage, buildRes.costUsd)
          if (!(await this.commit())) return this.snapshot()

          job.status = 'rendering'
          if (!(await this.commit())) return this.snapshot()

          this.lastLoadOk = false
          try {
            await this.deps.renderer.load(record.code)
            this.lastLoadOk = true
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
            if (!(await this.commit())) return this.snapshot()
            continue
          }
          if (this.cancelled) return this.snapshot()

          const renders = await this.deps.renderer.render(viewsFor(spec))
          if (this.cancelled) return this.snapshot()
          const sheetUrl = await this.deps.sheet(job.image, renders)
          if (this.cancelled) return this.snapshot()
          record.sheets.push(sheetUrl)
          if (!(await this.commit())) return this.snapshot()

          job.status = 'reviewing'
          if (!(await this.commit())) return this.snapshot()

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
          if (!(await this.commit())) return this.snapshot()

          if (review.action === 'continue') {
            break
          }
          else if (review.action === 'refine-code') {
            if (fixesLeft <= 0) break
            record.fixes += 1
            job.fixesTotal += 1
            defects = review.defects
            prevCode = record.code
            if (!(await this.commit())) return this.snapshot()
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
            if (!(await this.commit())) return this.snapshot()
            continue
          }
          else if (review.action === 'request-input') {
            job.status = 'waiting-input'
            job.question = review.question ?? ''
            // Best-effort: this pass is paid for and the question is on
            // screen either way; a full store must not turn it into a
            // rejected run().
            await this.commitBestEffort()
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
      if (!(await this.commit())) return this.snapshot()

      if (this.lastLoadOk) {
        const glb = await this.deps.renderer.exportGLB()
        if (this.cancelled) return this.snapshot()
        job.glb = glb
        job.quality = this.finalQuality()
      }
      else {
        // The last renderer.load never succeeded (the pass advanced only
        // because its fix budget ran out) — there is nothing renderable to
        // export.
        job.glb = null
        job.quality = 'approximate'
      }
      job.status = 'done'
      // The run is finished and the GLB is in hand; a save that fails here
      // costs the cached copy, not the result, so it must not be reported as
      // a failed run.
      await this.commitBestEffort()
      return this.snapshot()
    }
    catch (err) {
      if (this.cancelled) return this.snapshot()
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
      await this.commitBestEffort()
      return this.snapshot()
    }
  }

  /** 'good' only when the surface pass's last review has fidelity >= 0.8; any early stop or a missing surface pass is 'approximate'. */
  private finalQuality(): 'good' | 'approximate' {
    const surfaceRec = this.job.passes.find(p => p.id === 'surface')
    if (!surfaceRec || surfaceRec.reviews.length === 0) return 'approximate'
    const lastReview = surfaceRec.reviews[surfaceRec.reviews.length - 1]!
    return lastReview.fidelity >= 0.8 ? 'good' : 'approximate'
  }

  cancel(): void {
    if (this.job.status === 'done' || this.job.status === 'failed' || this.job.status === 'cancelled') return
    this.cancelled = true
    this.controller?.abort()
    this.job.status = 'cancelled'
    this.lastRun = this.commitBestEffort().then(() => this.snapshot())
  }

  /** Only valid in `waiting-input`; resumes the current pass with the answer as a build note. */
  answer(text: string): void {
    if (this.job.status !== 'waiting-input') return
    this.job.hint = `${this.job.hint}\n\nUser answer: ${text}`
    this.job.question = null
    this.job.status = 'building'
    this.pendingNotes = [text]
    this.lastRun = this.run()
  }
}
