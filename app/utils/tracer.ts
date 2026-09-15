import { buildHull, type HullData, type HullOptions, type HullView } from './hull'
import { computeRelief, type ReliefData, type ReliefMask, type ReliefOptions } from './relief'
import { traceImage, type Crop, type TraceOptions, type TraceResult } from './trace'
import type { TraceWorkerRequest, TraceWorkerResponse } from '~/workers/trace.worker'

/** Longest side the worker's copy of the source is capped at; no trace raster is larger. */
const MAX_SOURCE_PX = 4096

export interface Traced {
  result: TraceResult
  /** Milliseconds spent tracing, wherever it ran. */
  ms: number
  /** `worker` when traced off the main thread, `main` for the synchronous fallback. */
  where: 'worker' | 'main'
}

export interface Relieved {
  result: ReliefData
  ms: number
  where: 'worker' | 'main'
}

export interface Hulled {
  result: HullData
  ms: number
  where: 'worker' | 'main'
}

type Settle<T> = { resolve: (v: T | null) => void; reject: (e: Error) => void }
type Work =
  | ({ kind: 'trace'; opts: TraceOptions } & Settle<Traced>)
  | ({ kind: 'relief'; opts: ReliefOptions; crop: Crop; mask: ReliefMask | null } & Settle<Relieved>)
  | ({ kind: 'hull'; views: HullView[]; opts: HullOptions } & Settle<Hulled>)
type Job = Work & { id: number }
type Kind = Work['kind']

/**
 * Runs `traceImage` in a Web Worker so a 2048 px trace (a few hundred milliseconds on a
 * laptop, seconds on a phone) never stalls the WebGL loop, the import loader or a slider
 * mid-drag. Requests coalesce: while one trace is in flight only the newest waiting options
 * are kept, and the calls they replace resolve to `null`.
 *
 * Browsers without module workers, `OffscreenCanvas` or `createImageBitmap` fall back to
 * tracing on the main thread with the same coalescing, so callers never branch on the
 * environment.
 */
export class Tracer {
  private worker: Worker | null = null
  private image: HTMLImageElement | null = null
  /** True once the worker holds a bitmap of `image`; false means trace on the main thread. */
  private workerHasSource = false
  private sourceReady: Promise<void> = Promise.resolve()
  private nextId = 1
  private inflight: Job | null = null
  /** One waiting request per kind: a slider drag on the relief never cancels a pending trace. */
  private pending: { trace: Work | null; relief: Work | null; hull: Work | null } = { trace: null, relief: null, hull: null }

  constructor() {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return
    try {
      this.worker = new Worker(new URL('../workers/trace.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<TraceWorkerResponse>) => this.onMessage(e.data)
      this.worker.onerror = (e) => {
        // A worker that cannot start (module workers blocked, CSP) drops us to the main thread.
        if (import.meta.dev) console.warn('[tracer] worker failed, tracing on the main thread:', e.message)
        this.dropWorker()
        const cur = this.inflight
        if (cur) this.runMain(cur)
      }
    } catch {
      this.worker = null
    }
  }

  /**
   * Give the worker its own copy of the image. The copy is made asynchronously; `trace()`
   * waits for it, so a trace issued right after `setSource` is ordered correctly.
   */
  setSource(img: HTMLImageElement | null) {
    this.image = img
    this.workerHasSource = false
    const worker = this.worker
    if (!worker) return
    this.sourceReady = (async () => {
      let bitmap: ImageBitmap | null = null
      if (img) {
        try {
          bitmap = await toBitmap(img)
        } catch (err) {
          // Firefox refuses SVGs without an intrinsic size; those trace on the main thread.
          if (import.meta.dev) console.warn('[tracer] createImageBitmap failed, tracing on the main thread:', err)
        }
      }
      if (this.worker !== worker || this.image !== img) { bitmap?.close(); return }
      worker.postMessage({ type: 'source', bitmap } satisfies TraceWorkerRequest, bitmap ? [bitmap] : [])
      this.workerHasSource = !!bitmap
    })()
  }

  /** Trace the current source. Resolves `null` when a newer request superseded this one. */
  trace(opts: TraceOptions): Promise<Traced | null> {
    return new Promise((resolve, reject) => this.enqueue({ kind: 'trace', opts: { ...opts }, resolve, reject }))
  }

  /**
   * Height grid for the Relief geometry. `crop` and `mask` come from the current trace so the
   * grid and the print texture cover the same pixels. Resolves `null` when superseded.
   */
  relief(opts: ReliefOptions, crop: Crop, mask: ReliefMask | null): Promise<Relieved | null> {
    return new Promise((resolve, reject) => this.enqueue({ kind: 'relief', opts: { ...opts }, crop, mask, resolve, reject }))
  }

  /** Visual hull from the front outline plus a side and/or top outline. Resolves `null` when superseded. */
  hull(views: HullView[], opts: HullOptions): Promise<Hulled | null> {
    return new Promise((resolve, reject) => this.enqueue({ kind: 'hull', views, opts: { ...opts }, resolve, reject }))
  }

  private enqueue(work: Work) {
    if (this.inflight) {
      // Newest options win; the request they replace resolves empty so callers can ignore it.
      this.pending[work.kind]?.resolve(null)
      this.pending[work.kind] = work
      return
    }
    this.start({ id: this.nextId++, ...work })
  }

  private start(job: Job) {
    this.inflight = job
    if (!this.image) {
      this.finish(job, () => job.reject(new Error('No image to trace')))
      return
    }
    void this.sourceReady.then(() => {
      if (this.inflight !== job) return
      if (this.worker && this.workerHasSource) {
        const msg: TraceWorkerRequest = job.kind === 'trace'
          ? { type: 'trace', id: job.id, opts: job.opts }
          : job.kind === 'relief'
            ? { type: 'relief', id: job.id, opts: job.opts, crop: job.crop, mask: job.mask }
            : { type: 'hull', id: job.id, views: job.views, opts: job.opts }
        try {
          this.worker.postMessage(msg)
        } catch (err) {
          // A payload that cannot be cloned (a reactive proxy, a detached buffer) is the caller's bug: surface it.
          this.finish(job, () => job.reject(err as Error))
        }
      } else {
        this.runMain(job)
      }
    })
  }

  private runMain(job: Job) {
    // Yield a frame first so whatever the UI just changed (a loader step, a slider thumb)
    // paints before the synchronous trace takes the thread. rAF is paused in background
    // tabs, so a short timeout backs it up.
    let started = false
    const go = () => {
      if (started) return
      started = true
      if (this.inflight !== job) return
      const img = this.image
      if (!img) { this.finish(job, () => job.resolve(null)); return }
      try {
        const t0 = performance.now()
        if (job.kind === 'trace') {
          const result = traceImage(img, job.opts)
          this.finish(job, () => job.resolve({ result, ms: performance.now() - t0, where: 'main' }))
        } else if (job.kind === 'hull') {
          const result = buildHull(job.views, job.opts)
          this.finish(job, () => job.resolve({ result, ms: performance.now() - t0, where: 'main' }))
        } else {
          const result = computeRelief(img, job.opts, job.crop, job.mask)
          this.finish(job, () => job.resolve({ result, ms: performance.now() - t0, where: 'main' }))
        }
      } catch (err) {
        this.finish(job, () => job.reject(err as Error))
      }
    }
    requestAnimationFrame(go)
    setTimeout(go, 80)
  }

  private onMessage(msg: TraceWorkerResponse) {
    const job = this.inflight
    if (!job || job.id !== msg.id) return
    if (msg.type === 'result' && job.kind === 'trace') this.finish(job, () => job.resolve({ result: msg.result, ms: msg.ms, where: 'worker' }))
    else if (msg.type === 'relief' && job.kind === 'relief') this.finish(job, () => job.resolve({ result: msg.result, ms: msg.ms, where: 'worker' }))
    else if (msg.type === 'hull' && job.kind === 'hull') this.finish(job, () => job.resolve({ result: msg.result, ms: msg.ms, where: 'worker' }))
    else if (msg.type === 'error') this.finish(job, () => job.reject(new Error(msg.message)))
    else this.finish(job, () => job.reject(new Error('Worker answered the wrong request')))
  }

  private finish(job: Job, settle: () => void) {
    if (this.inflight === job) this.inflight = null
    settle()
    if (this.inflight) return
    // Traces first: a waiting relief usually depends on the crop the trace is about to produce.
    const kind: Kind | null = this.pending.trace ? 'trace' : this.pending.relief ? 'relief' : this.pending.hull ? 'hull' : null
    if (!kind) return
    const next = this.pending[kind]!
    this.pending[kind] = null
    this.start({ id: this.nextId++, ...next })
  }

  private dropWorker() {
    this.worker?.terminate()
    this.worker = null
    this.workerHasSource = false
  }

  dispose() {
    this.pending.trace?.resolve(null)
    this.pending.relief?.resolve(null)
    this.pending.hull?.resolve(null)
    this.pending = { trace: null, relief: null, hull: null }
    this.inflight?.resolve(null)
    this.inflight = null
    this.image = null
    this.dropWorker()
  }
}

/** The source as a transferable bitmap, downscaled only when larger than any trace raster. */
async function toBitmap(img: HTMLImageElement): Promise<ImageBitmap> {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) throw new Error('Image has no intrinsic size')
  const k = Math.min(1, MAX_SOURCE_PX / Math.max(iw, ih))
  if (k < 1) {
    return createImageBitmap(img, { resizeWidth: Math.round(iw * k), resizeHeight: Math.round(ih * k), resizeQuality: 'high' })
  }
  return createImageBitmap(img)
}
