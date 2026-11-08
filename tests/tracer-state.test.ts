import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tracer } from '~/utils/tracer'
import { DEFAULT_TRACE_OPTIONS } from '~/utils/trace'

class WorkerDouble {
  static all: WorkerDouble[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  messages: any[] = []
  terminated = false
  constructor() { WorkerDouble.all.push(this) }
  postMessage(message: unknown) { this.messages.push(message) }
  terminate() { this.terminated = true }
  reply(data: unknown) { this.onmessage?.({ data }) }
}
let tracer: Tracer
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  WorkerDouble.all = []
  vi.stubGlobal('Worker', WorkerDouble)
  vi.stubGlobal('OffscreenCanvas', class {})
  vi.stubGlobal('createImageBitmap', async () => ({ close() {} }))
  tracer = new Tracer()
})
afterEach(() => { tracer.dispose(); vi.useRealTimers(); vi.unstubAllGlobals() })
const image = () => ({ naturalWidth: 100, naturalHeight: 100 }) as HTMLImageElement
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe('tracer source ownership', () => {
  it('settles jobs for the previous source when it changes', async () => {
    tracer.setSource(image())
    let old: unknown = 'pending'
    void tracer.trace(DEFAULT_TRACE_OPTIONS).then(v => { old = v })
    await flush()
    tracer.setSource(image())
    await flush()
    expect(old).toBeNull()
  })

  it('does not run queued work against a replacement image', async () => {
    tracer.setSource(image())
    void tracer.trace(DEFAULT_TRACE_OPTIONS)
    let queued: unknown = 'pending'
    void tracer.trace(DEFAULT_TRACE_OPTIONS).then(v => { queued = v })
    await flush()
    tracer.setSource(null)
    await flush()
    expect(queued).toBeNull()
  })

  it('keeps disposal terminal', async () => {
    tracer.dispose()
    tracer.setSource(image())
    let result: unknown = 'pending'
    void tracer.trace(DEFAULT_TRACE_OPTIONS).then(v => { result = v })
    await flush()
    expect(result).toBeNull()
  })
})
