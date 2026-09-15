/**
 * Sculpt job orchestrator.
 *
 * `JobRunner` walks a `SculptJob` through plan → build → render → (review →
 * fix → render) → done, driving injected `Transport` (the `/api/sculpt/*`
 * routes) and `Renderer` (the sandbox) implementations so the whole thing is
 * unit-testable without a browser or a network.
 *
 * The loop is bounded by construction: at most four model calls (plan, build,
 * review, one fix), and the model is on the stage — `deps.onModel` — as soon
 * as the first build renders, before the review has even started. A fix that
 * fails leaves the draft standing.
 *
 * Resume is coarse: `run()` looks at what the job already holds — a spec
 * skips the plan, code skips the build, a review skips the review — so a
 * failed run picks up from the last paid step.
 */

import type { ApiResult, BuildOutput, Defect, Dims, PartBounds, Review, SculptSpec, Usage, View } from './types'

export interface Transport {
  plan: (req: { image: string, hint?: string, dims?: Dims }, signal: AbortSignal) => Promise<ApiResult<SculptSpec>>
  build: (req: { spec: SculptSpec, image: string, code?: string, defects?: Defect[], partBounds?: PartBounds[] }, signal: AbortSignal) => Promise<ApiResult<BuildOutput>>
  review: (req: { spec: SculptSpec, sheet: string, partBounds?: PartBounds[] }, signal: AbortSignal) => Promise<ApiResult<Review>>
}

/** Sandbox + sheet, injected so the runner is testable. */
export interface Renderer {
  load: (code: string) => Promise<{ parts: string[], triangles: number, partBounds?: PartBounds[] }>
  render: (views: View[]) => Promise<{ name: string, blob: Blob }[]>
  exportGLB: () => Promise<ArrayBuffer>
}

export type JobStatus =
  | 'idle'
  | 'planning'
  | 'building'
  | 'rendering'
  | 'reviewing'
  | 'fixing'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface SculptJob {
  id: string
  createdAt: number
  /** data URL <=1568 */
  image: string
  hint: string
  dims: Dims | null
  /** Review and fix after the first build; off is one build and done. */
  polish: boolean
  spec: SculptSpec | null
  /** The latest factory file: the first build, or the fix. */
  code: string
  notes: string[]
  /** Measured world boxes from the latest successful load. */
  partBounds: PartBounds[]
  /** data URLs, one per render: the draft, then the fix. */
  sheets: string[]
  review: Review | null
  /** The fix call has been spent (whether or not its code loaded). */
  fixed: boolean
  usage: Usage
  costUsd: number
  status: JobStatus
  /** 'good' when the last review scored >= GOOD_FIDELITY; 'approximate' otherwise or unreviewed. */
  quality: 'good' | 'approximate' | null
  error: string | null
  glb: ArrayBuffer | null
  /** The glb is the first build's, and a review or fix may still replace it. */
  draft: boolean
}

export interface JobRunnerDeps {
  transport: Transport
  renderer: Renderer
  sheet: (ref: string, renders: { name: string, blob: Blob }[]) => Promise<string>
  save: (job: SculptJob) => Promise<void>
  onChange: (job: SculptJob) => void
  /** A model is ready for the stage: first the draft, then (maybe) the fix. */
  onModel: (glb: ArrayBuffer, job: SculptJob) => void
}

/** A review at or above this has nothing worth another opus call. */
export const GOOD_FIDELITY = 0.85

export function createJob(image: string, hint: string, dims: Dims | null, polish = true): SculptJob {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    image,
    hint,
    dims,
    polish,
    spec: null,
    code: '',
    notes: [],
    partBounds: [],
    sheets: [],
    review: null,
    fixed: false,
    usage: { input: 0, output: 0 },
    costUsd: 0,
    status: 'idle',
    quality: null,
    error: null,
    glb: null,
    draft: false,
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
 * supports natively — is passed through by reference.
 */
export function plainJob(job: SculptJob): SculptJob {
  return {
    id: job.id,
    createdAt: job.createdAt,
    image: job.image,
    hint: job.hint,
    dims: job.dims ? clonePlain(job.dims) : null,
    polish: job.polish,
    spec: job.spec ? clonePlain(job.spec) : null,
    code: job.code,
    notes: [...job.notes],
    partBounds: clonePlain(job.partBounds),
    sheets: [...job.sheets],
    review: job.review ? clonePlain(job.review) : null,
    fixed: job.fixed,
    usage: { ...job.usage },
    costUsd: job.costUsd,
    status: job.status,
    quality: job.quality,
    error: job.error,
    glb: job.glb,
    draft: job.draft,
  }
}

/** Thrown by `load` so the runner can turn a broken file into a fix request. */
class LoadError extends Error {}

export class JobRunner {
  readonly job: SculptJob
  private readonly deps: JobRunnerDeps
  private cancelled = false
  private running = false
  private controller: AbortController | null = null
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
   * if a cancellation landed while the save was in flight. Callers bail out
   * immediately on `false` so a cancellation is never overwritten by the step
   * that was about to run.
   */
  private async commit(): Promise<boolean> {
    await this.deps.save(plainJob(this.job))
    this.deps.onChange({ ...this.job })
    return !this.cancelled
  }

  /** Failure/cancel paths: never throws, always notifies. */
  private async commitBestEffort(): Promise<void> {
    try {
      await this.deps.save(plainJob(this.job))
    }
    catch {
      // The in-memory job and this onChange are the remaining source of truth.
    }
    finally {
      this.deps.onChange({ ...this.job })
    }
  }

  private addUsage(usage: Usage, costUsd: number): void {
    this.job.usage = { input: this.job.usage.input + usage.input, output: this.job.usage.output + usage.output }
    this.job.costUsd += costUsd
  }

  private async call<T>(fn: (signal: AbortSignal) => Promise<ApiResult<T>>): Promise<T> {
    const controller = new AbortController()
    this.controller = controller
    try {
      const res = await fn(controller.signal)
      // A failed route may still have paid for a call; count it before throwing.
      if (res.usage) this.addUsage(res.usage, res.costUsd ?? 0)
      if (!res.ok) throw new Error(res.error)
      return res.data
    }
    finally {
      if (this.controller === controller) this.controller = null
    }
  }

  /**
   * Resumes from what the job holds. Re-entrant: a call while already running
   * returns the same in-flight promise; a `done` job is a no-op.
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

  /** Loads, renders and exports the current code; puts the model on the stage. */
  private async stage(status: 'rendering'): Promise<void> {
    const job = this.job
    job.status = status
    if (!(await this.commit())) return
    let loaded: Awaited<ReturnType<Renderer['load']>>
    try {
      loaded = await this.deps.renderer.load(job.code)
    }
    catch (err) {
      throw new LoadError(err instanceof Error ? err.message : String(err))
    }
    if (this.cancelled) return
    job.partBounds = loaded.partBounds ?? []
    // The model reaches the stage before the sheet is even drawn: a review
    // and a fix are refinements of something the user can already orbit.
    job.glb = await this.deps.renderer.exportGLB()
    if (this.cancelled) return
    this.deps.onModel(job.glb, { ...job })
    const renders = await this.deps.renderer.render(viewsFor(job.spec!))
    if (this.cancelled) return
    job.sheets.push(await this.deps.sheet(job.image, renders))
  }

  private async execute(): Promise<SculptJob> {
    const job = this.job
    try {
      if (!job.spec) {
        job.status = 'planning'
        if (!(await this.commit())) return this.snapshot()
        job.spec = await this.call(signal => this.deps.transport.plan(
          { image: job.image, hint: job.hint || undefined, dims: job.dims ?? undefined },
          signal,
        ))
        if (this.cancelled) return this.snapshot()
        if (!(await this.commit())) return this.snapshot()
      }

      if (!job.code) {
        job.status = 'building'
        if (!(await this.commit())) return this.snapshot()
        const built = await this.call(signal => this.deps.transport.build({ spec: job.spec!, image: job.image }, signal))
        if (this.cancelled) return this.snapshot()
        job.code = built.code
        job.notes = built.notes
        if (!(await this.commit())) return this.snapshot()
      }

      // The first build reaches the stage as a draft. A file that does not
      // even load spends the fix on the error; a second failure is the end.
      let defects: Defect[] | null = null
      if (job.sheets.length === 0) {
        job.draft = true
        try {
          await this.stage('rendering')
          if (this.cancelled) return this.snapshot()
        }
        catch (err) {
          if (!(err instanceof LoadError) || job.fixed) throw err
          defects = [{ component: '*', what: err.message, measured: 'runtime error on load', fix: 'fix the runtime error' }]
        }
        if (!(await this.commit())) return this.snapshot()
      }

      if (job.polish && !defects && !job.review && job.sheets.length > 0) {
        job.status = 'reviewing'
        if (!(await this.commit())) return this.snapshot()
        job.review = await this.call(signal => this.deps.transport.review(
          { spec: job.spec!, sheet: job.sheets[job.sheets.length - 1]!, partBounds: job.partBounds.length ? job.partBounds : undefined },
          signal,
        ))
        if (this.cancelled) return this.snapshot()
        if (!(await this.commit())) return this.snapshot()
      }

      if (!defects && job.review && job.review.defects.length > 0 && job.review.fidelity < GOOD_FIDELITY) {
        defects = job.review.defects
      }

      if (defects && !job.fixed) {
        job.status = 'fixing'
        job.fixed = true
        if (!(await this.commit())) return this.snapshot()
        const fixedBuild = await this.call(signal => this.deps.transport.build(
          { spec: job.spec!, image: job.image, code: job.code, defects, partBounds: job.partBounds.length ? job.partBounds : undefined },
          signal,
        ))
        if (this.cancelled) return this.snapshot()
        const draftCode = job.code
        job.code = fixedBuild.code
        job.notes = fixedBuild.notes
        if (!(await this.commit())) return this.snapshot()
        try {
          await this.stage('rendering')
          if (this.cancelled) return this.snapshot()
        }
        catch (err) {
          if (!(err instanceof LoadError)) throw err
          // The fix broke the file: the draft that already stands is the result.
          if (!job.glb) throw err
          job.code = draftCode
          job.notes = [...job.notes, `fix discarded: ${err.message}`]
        }
      }

      job.draft = false
      job.quality = job.review && job.review.fidelity >= GOOD_FIDELITY ? 'good' : 'approximate'
      job.status = 'done'
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

  cancel(): void {
    if (this.job.status === 'done' || this.job.status === 'failed' || this.job.status === 'cancelled') return
    this.cancelled = true
    this.controller?.abort()
    this.job.status = 'cancelled'
    this.lastRun = this.commitBestEffort().then(() => this.snapshot())
  }
}
