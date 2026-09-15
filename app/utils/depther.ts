import type { DepthMap } from './depth'
import type { DepthDevice, DepthWorkerRequest, DepthWorkerResponse } from '~/workers/depth.worker'

export interface Depthed {
  map: DepthMap
  /** Milliseconds for the whole request, model download included the first time. */
  ms: number
  device: DepthDevice
}

type Settle = { resolve: (v: Depthed | null) => void; reject: (e: Error) => void }
type Job = Settle & { id: number; image: ImageData; mask: Uint8Array }

/**
 * Runs the depth model in its own worker (`depth.worker.ts`). One request in flight; a newer one
 * replaces the waiting one, which resolves `null`. There is no main-thread fallback: the model is
 * far too slow on the UI thread, so without a worker there is no depth and `available` is false.
 */
export class Depther {
  readonly available: boolean
  /** Weights download progress, first run only. */
  onProgress: ((loaded: number, total: number) => void) | null = null
  private worker: Worker | null = null
  private nextId = 1
  private inflight: Job | null = null
  private pending: Job | null = null

  constructor(private readonly model: string) {
    this.available = typeof Worker !== 'undefined'
    if (!this.available) return
    try {
      this.worker = new Worker(new URL('../workers/depth.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<DepthWorkerResponse>) => this.onMessage(e.data)
      this.worker.onerror = (e) => {
        if (import.meta.dev) console.warn('[depth] worker failed:', e.message)
        this.fail(new Error(e.message || 'Depth worker failed'))
      }
    } catch {
      this.worker = null
      this.available = false
    }
  }

  /** Nearness map for a front photo crop and its silhouette mask (same size). Resolves `null` when superseded. */
  depth(image: ImageData, mask: Uint8Array): Promise<Depthed | null> {
    return new Promise((resolve, reject) => {
      const job: Job = { id: this.nextId++, image, mask, resolve, reject }
      if (!this.worker) { reject(new Error('Depth model unavailable')); return }
      if (this.inflight) {
        this.pending?.resolve(null)
        this.pending = job
        return
      }
      this.start(job)
    })
  }

  private start(job: Job) {
    this.inflight = job
    const msg: DepthWorkerRequest = { type: 'depth', id: job.id, image: job.image, mask: job.mask, model: this.model }
    try {
      this.worker!.postMessage(msg)
    } catch (err) {
      this.finish(job, () => job.reject(err as Error))
    }
  }

  private onMessage(msg: DepthWorkerResponse) {
    const job = this.inflight
    if (!job || job.id !== msg.id) return
    if (msg.type === 'progress') { this.onProgress?.(msg.loaded, msg.total); return }
    if (msg.type === 'depth') this.finish(job, () => job.resolve({ map: msg.map, ms: msg.ms, device: msg.device }))
    else this.finish(job, () => job.reject(new Error(msg.message)))
  }

  private fail(err: Error) {
    const job = this.inflight
    this.worker?.terminate()
    this.worker = null
    this.pending?.reject(err)
    this.pending = null
    if (job) this.finish(job, () => job.reject(err))
  }

  private finish(job: Job, settle: () => void) {
    if (this.inflight === job) this.inflight = null
    settle()
    if (this.inflight || !this.pending) return
    const next = this.pending
    this.pending = null
    this.start(next)
  }

  dispose() {
    this.pending?.resolve(null)
    this.pending = null
    this.inflight?.resolve(null)
    this.inflight = null
    this.worker?.terminate()
    this.worker = null
  }
}
