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
