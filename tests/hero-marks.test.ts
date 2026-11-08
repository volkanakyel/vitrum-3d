import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMarksInWorker, heroMarks } from '~/utils/heroMarks'
import type { MarkBuild } from '~/utils/heroMarks'

class WorkerDouble {
  static all: WorkerDouble[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  stopped = false
  constructor() { WorkerDouble.all.push(this) }
  postMessage() {}
  terminate() { this.stopped = true }
}
const requests = [{ id: 'story', sampleId: 'vitrum', sizeMm: 100, res: 512 }]
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
beforeEach(() => {
  WorkerDouble.all = []
  vi.stubGlobal('Worker', WorkerDouble)
  vi.stubGlobal('OffscreenCanvas', class {})
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
})
afterEach(() => vi.unstubAllGlobals())

describe('hero build cancellation', () => {
  it('rejects an outstanding build when terminated', async () => {
    const build = buildMarksInWorker(requests)
    let state = 'pending'
    void build.marks.then(() => { state = 'resolved' }, e => { state = e.name })
    build.terminate()
    await flush()
    expect(state).toBe('AbortError')
  })

  it('settles cancellation even while IndexedDB open is pending', async () => {
    vi.stubGlobal('indexedDB', { open: () => ({}) })
    const build = heroMarks(requests, 'version')
    let state = 'pending'
    void build.marks.then(() => { state = 'resolved' }, e => { state = e.name })
    build.terminate()
    await flush()
    expect(state).toBe('AbortError')
  })

  it('stops other workers when one batch fails', async () => {
    const build = buildMarksInWorker([...requests, { ...requests[0]!, id: 'second' }])
    WorkerDouble.all[0]!.onerror?.({ message: 'failed' })
    await expect(build.marks).rejects.toThrow('failed')
    expect(WorkerDouble.all.every(w => w.stopped)).toBe(true)
  })
})
