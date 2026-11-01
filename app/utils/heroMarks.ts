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
  const marks = new Promise<MarkData[]>((resolve, reject) => {
    worker = new Worker(new URL('../workers/showcase.worker.ts', import.meta.url), { type: 'module' })
    const out: MarkData[] = []
    const finish = (err?: Error) => {
      worker?.terminate()
      worker = null
      if (err) reject(err)
      else resolve(out)
    }
    worker.onmessage = (e: MessageEvent<ShowcaseWorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'mark') out.push(msg.mark)
      else finish(msg.type === 'error' ? new Error(msg.message) : undefined)
    }
    worker.onerror = e => finish(new Error(e.message || 'worker failed'))
    worker.postMessage({ marks: requests })
  })
  return { marks, terminate: () => { worker?.terminate(); worker = null } }
}

/**
 * Build marks off the main thread, split across two workers so phones trace on two cores at once
 * (the second worker's script comes from the HTTP cache). Rejects where module workers or
 * `OffscreenCanvas` are missing, so the caller can build on the main thread instead.
 */
export function buildMarksInWorker(requests: MarkRequest[]): MarkBuild {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return { marks: Promise.reject(new Error('no module worker')), terminate: () => {} }
  }
  const lanes = Math.min(2, requests.length, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))
  const batches: MarkRequest[][] = Array.from({ length: lanes }, () => [])
  requests.forEach((r, i) => batches[i % lanes]!.push(r))
  const runs = batches.map(runWorker)
  const marks = Promise.all(runs.map(r => r.marks)).then(all => all.flat())
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
  let stopped = false
  const marks = idb<MarkData[] | undefined>('readonly', s => s.get(key))
    .catch(() => undefined)
    .then((hit) => {
      if (hit?.length === requests.length) return hit
      if (stopped) throw new Error('stopped')
      build = buildMarksInWorker(requests)
      return build.marks.then((built) => {
        // Earlier builds' entries go; this one is written once (structured clone of the arrays).
        idb('readwrite', s => s.clear()).then(() => idb('readwrite', s => s.put(built, key))).catch(() => {})
        return built
      })
    })
  marks.catch(() => {})
  return { marks, terminate: () => { stopped = true; build?.terminate() } }
}
