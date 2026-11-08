import { abortable, abortError } from './async'
import type { ShowcaseWorkerResponse } from '~/workers/showcase.worker'
import type { MarkData, MarkRequest } from './showcaseMark'
import { HERO_SPOTS, HERO_STORY } from './samples'

/** The landing hero's marks, as requests to the showcase worker (or the main-thread fallback). */
export function heroRequests(width: number): MarkRequest[] {
  // Phone heroes draw each mark at ~200 device px; a 512 px trace is ample.
  const res = width < 768 ? 512 : 768
  return HERO_SPOTS.map(spot => ({
    id: spot.id,
    sampleId: spot.id === 'story' ? HERO_STORY : spot.id,
    sizeMm: spot.size,
    res,
  }))
}

export interface MarkBuild {
  marks: Promise<MarkData[]>
  terminate: () => void
}

/** One worker, one batch: marks are posted back one by one, `done` closes the batch. */
function runWorker(requests: MarkRequest[]): MarkBuild {
  let worker: Worker | null = null
  let finish: (err?: Error) => void = () => {}
  const marks = new Promise<MarkData[]>((resolve, reject) => {
    const out: MarkData[] = []
    let settled = false
    finish = (err?: Error) => {
      if (settled) return
      settled = true
      if (worker) {
        worker.onmessage = worker.onerror = null
        worker.terminate()
        worker = null
      }
      if (err) reject(err)
      else resolve(out)
    }
    try {
      worker = new Worker(new URL('../workers/showcase.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<ShowcaseWorkerResponse>) => {
        const msg = e.data
        if (msg.type === 'mark') out.push(msg.mark)
        else finish(msg.type === 'error' ? new Error(msg.message) : undefined)
      }
      worker.onerror = e => finish(new Error(e.message || 'worker failed'))
      worker.postMessage({ marks: requests })
    } catch (err) { finish(err as Error) }
  })
  return { marks, terminate: () => finish(abortError()) }
}

/**
 * Build marks off the main thread, split across two workers so phones trace on two cores at once
 * (the second worker's script comes from the HTTP cache). Rejects where module workers or
 * `OffscreenCanvas` are missing, so the caller can build on the main thread instead.
 */
export function buildMarksInWorker(requests: MarkRequest[]): MarkBuild {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    const marks = Promise.reject<MarkData[]>(new Error('no module worker'))
    marks.catch(() => {})
    return { marks, terminate: () => {} }
  }
  const lanes = Math.min(2, requests.length, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))
  const batches: MarkRequest[][] = Array.from({ length: lanes }, () => [])
  requests.forEach((r, i) => batches[i % lanes]!.push(r))
  const runs = batches.map(runWorker)
  const marks = Promise.all(runs.map(r => r.marks)).then(all => all.flat()).catch(err => {
    runs.forEach(r => r.terminate())
    throw err
  })
  // An unawaited rejection (fallback taken, page left) is not an error worth reporting.
  marks.catch(() => {})
  return { marks, terminate: () => runs.forEach(r => r.terminate()) }
}

// ─── Cache ───────────────────────────────────────────────────────────────────────────────────
// The marks are the same on every visit of one build, so a reload need not trace them again: the
// built arrays are kept in IndexedDB under the build id and the trace size, and a reload's marks
// are ready as soon as the renderer is. Any storage failure just means building as usual.

const DB = 'vitrum-hero'
const STORE = 'marks'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = run(tx.objectStore(STORE))
    tx.oncomplete = () => { db.close(); resolve(req.result as T) }
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
  }))
}

/**
 * The hero's marks from the cache when this build has stored them, from the workers otherwise
 * (then stored for the next visit). `version` should change whenever the marks could: the build id.
 */
export function heroMarks(requests: MarkRequest[], version: string): MarkBuild {
  if (typeof indexedDB === 'undefined' || !version) return buildMarksInWorker(requests)
  const key = `${version}:${requests.map(r => `${r.id}/${r.sampleId}/${r.sizeMm}/${r.res}`).join(',')}`
  let build: MarkBuild | null = null
  const controller = new AbortController()
  const { signal } = controller
  const work = idb<MarkData[] | undefined>('readonly', s => s.get(key))
    .catch(() => undefined)
    .then((hit) => {
      signal.throwIfAborted()
      if (hit?.length === requests.length) return hit
      build = buildMarksInWorker(requests)
      return build.marks.then((built) => {
        signal.throwIfAborted()
        // Earlier builds' entries go; this one is written once (structured clone of the arrays).
        idb('readwrite', s => s.clear()).then(() => idb('readwrite', s => s.put(built, key))).catch(() => {})
        return built
      })
    })
  const marks = abortable(work, signal)
  marks.catch(() => {})
  return { marks, terminate: () => { controller.abort(); build?.terminate() } }
}
