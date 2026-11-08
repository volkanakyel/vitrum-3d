import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { mountComposable, deferred } from './helpers/mount'
import { useStudio, type ViewerHandle } from '~/composables/useStudio'
import { MATERIAL_PRESETS } from '~/utils/presets'
import type { TraceResult } from '~/utils/trace'
import type { ReliefData } from '~/utils/relief'

const io = vi.hoisted(() => ({ decode: vi.fn(), trace: vi.fn(), relief: vi.fn(), sample: vi.fn() }))
vi.mock('~/utils/trace', async importOriginal => ({ ...await importOriginal<object>(), loadImage: io.decode }))
vi.mock('~/utils/samples', async importOriginal => ({ ...await importOriginal<object>(), sampleFile: io.sample }))
vi.mock('~/utils/tracer', () => ({ Tracer: class {
  setSource() {} dispose() {}
  trace = io.trace
  relief = io.relief
} }))

const outline = {
  polygons: [{ exterior: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] }],
  width: 100, height: 100, bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  resolvedMode: 'alpha', threshold: 128, background: [255, 255, 255], coverage: 0.5,
  crop: { x: 0, y: 0, w: 1, h: 1 }, strokeWidth: 10, vertexCount: 4, palette: 1, hasTile: false,
} as TraceResult
const grid = { width: 2, height: 2, heights: new Float32Array(4), crop: outline.crop, mirror: true } as ReliefData
const timed = <T>(result: T) => ({ result, ms: 1, where: 'worker' as const })
const img = () => ({ naturalWidth: 100, naturalHeight: 100 }) as HTMLImageElement
const file = (name: string) => new File(['image'], name, { type: 'image/png' })
let unmount: () => void
function studio() {
  const mounted = mountComposable(useStudio)
  unmount = mounted.unmount
  return mounted.value
}
async function finishImport(s: ReturnType<typeof useStudio>, name = 'test.png') {
  const pending = s.useFile(file(name))
  await vi.advanceTimersByTimeAsync(1600)
  await pending
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 1))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray() }) }), toDataURL: () => 'preview' }) })
  io.decode.mockReset().mockImplementation(async () => img())
  io.trace.mockReset().mockResolvedValue(timed(outline))
  io.relief.mockReset().mockResolvedValue(timed(grid))
  io.sample.mockReset().mockResolvedValue(file('sample.png'))
})
afterEach(() => { unmount?.(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('studio document ownership', () => {
  it('keeps the newer import when an older decode finishes last', async () => {
    const old = deferred<HTMLImageElement>()
    io.decode.mockImplementationOnce(() => old.promise)
    const s = studio()
    const first = s.useFile(file('old.png'))
    await finishImport(s, 'new.png')
    old.resolve(img())
    await vi.advanceTimersByTimeAsync(1600)
    await first
    expect(s.fileName.value).toBe('new.png')
    expect(s.error.value).toBe('')
  })

  it('does not resurrect a cleared document after decode', async () => {
    const decode = deferred<HTMLImageElement>()
    io.decode.mockImplementationOnce(() => decode.promise)
    const s = studio()
    const pending = s.useFile(file('late.png'))
    s.clearImage()
    decode.resolve(img())
    await vi.advanceTimersByTimeAsync(1600)
    await pending
    expect(s.image.value).toBeNull()
    expect(s.trace.value).toBeNull()
    expect(s.busy.value).toBe(false)
  })

  it('does not commit a document after unmount', async () => {
    const decode = deferred<HTMLImageElement>()
    io.decode.mockImplementationOnce(() => decode.promise)
    const s = studio()
    const pending = s.useFile(file('late.png'))
    unmount()
    decode.resolve(img())
    await vi.advanceTimersByTimeAsync(1600)
    await pending
    expect(s.image.value).toBeNull()
  })

  it('keeps busy true until relief started by a retrace finishes', async () => {
    const s = studio()
    await finishImport(s)
    s.glass.geometry = 'inflate'
    await vue.nextTick()
    await vi.advanceTimersByTimeAsync(200)
    const relief = deferred<ReturnType<typeof timed<ReliefData>>>()
    io.relief.mockImplementationOnce(() => relief.promise)
    s.traceOpts.threshold++
    await vue.nextTick()
    await vi.advanceTimersByTimeAsync(130)
    expect(s.busy.value).toBe(true)
    relief.resolve(timed(grid))
    await vue.nextTick()
  })

  it('rejects trace results as soon as newer options are requested', async () => {
    const s = studio()
    await finishImport(s)
    const first = deferred<ReturnType<typeof timed<TraceResult>>>()
    io.trace.mockImplementationOnce(() => first.promise)
    s.traceOpts.threshold++
    await vue.nextTick()
    await vi.advanceTimersByTimeAsync(130)
    s.traceOpts.threshold++
    await vue.nextTick()
    const stale = { ...outline, vertexCount: 999 }
    first.resolve(timed(stale))
    await vue.nextTick()
    await vue.nextTick()
    expect(s.trace.value?.vertexCount).toBe(4)
  })

  it('does not export while a trace refresh is pending', async () => {
    const s = studio()
    await finishImport(s)
    const saved: string[] = []
    s.viewer.value = { exportGLB: async () => { saved.push('glb') }, snap() {} } as unknown as ViewerHandle
    s.dims.value = { widthMm: 100, heightMm: 100, depthMm: 14, triangles: 12 }
    s.traceOpts.threshold++
    await vue.nextTick()
    await s.doExport('glb')
    expect(saved).toEqual([])
  })

  it('does not claim an empty outline is ready to export', async () => {
    const s = studio()
    s.trace.value = { ...outline, polygons: [] }
    expect(s.ready.value).toBe(false)
  })

  it('keeps an invalidated trace unexportable when its refresh is cancelled', async () => {
    const s = studio()
    await finishImport(s)
    s.dims.value = { widthMm: 100, heightMm: 100, depthMm: 14, triangles: 12 }
    io.trace.mockResolvedValueOnce(null)
    s.traceOpts.threshold++
    await vi.advanceTimersByTimeAsync(130)
    expect(s.busy.value).toBe(false)
    expect(s.canExport.value).toBe(false)
  })

  it('clears a failed grid error when returning to a valid extrusion', async () => {
    const s = studio()
    await finishImport(s)
    io.relief.mockRejectedValueOnce(new Error('Grid failed'))
    s.glass.geometry = 'inflate'
    await vue.nextTick()
    expect(s.error.value).toBe('Grid failed')
    s.glass.geometry = 'extrude'
    expect(s.error.value).toBe('')
  })

  it('rebuilds grid options changed during the final import hold', async () => {
    const s = studio()
    io.trace.mockResolvedValueOnce(timed({ ...outline, palette: 30 }))
    const pending = s.useFile(file('photo.png'))
    await vi.advanceTimersByTimeAsync(1100)
    expect(s.relief.value).not.toBeNull()
    s.reliefOpts.roundness = 0.9
    await vi.advanceTimersByTimeAsync(500)
    await pending
    expect(s.relief.value).not.toBeNull()
    expect(io.relief).toHaveBeenLastCalledWith(expect.objectContaining({ roundness: 0.9 }), expect.anything(), expect.anything())
  })
})


describe('user choices and import cancellation', () => {
  it('settles a cancelled import without waiting for image decode', async () => {
    io.decode.mockReturnValueOnce(new Promise(() => {}))
    const s = studio()
    let settled = false
    void s.useFile(file('pending.png')).then(() => { settled = true })
    s.clearImage()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
  })

  it('owns sample rasterization before it finishes', async () => {
    const sample = deferred<File>()
    io.sample.mockReturnValueOnce(sample.promise)
    const s = studio()
    const pending = s.openLinkedSample('vitrum', 'chrome')
    await finishImport(s, 'new.png')
    const finish = s.glass.finish
    sample.resolve(file('old-sample.png'))
    await vi.advanceTimersByTimeAsync(1600)
    await pending
    expect(s.fileName.value).toBe('new.png')
    expect(s.glass.finish).toBe(finish)
  })

  it('preserves an explicitly chosen print preset across a simple import', async () => {
    const s = studio()
    io.trace.mockResolvedValueOnce(timed({ ...outline, palette: 30 }))
    await finishImport(s, 'photo.png')
    s.selectMaterial(MATERIAL_PRESETS.find(p => p.id === 'velvet')!)
    await finishImport(s, 'logo.png')
    expect(s.glass.finish).toBe('print')
    expect(s.glass.paint).toBe('#6b2a4a')
  })

  it('preserves a deliberately selected liquid backdrop when leaving liquid', async () => {
    const s = studio()
    await finishImport(s)
    s.selectMaterial(MATERIAL_PRESETS.find(p => p.id === 'liquid')!)
    await vue.nextTick()
    s.editBackdrop({ background: '#000000', background2: '#000000', backdropFill: 'solid', vignette: 0 })
    s.selectMaterial(MATERIAL_PRESETS.find(p => p.id === 'clear')!)
    await vue.nextTick()
    expect(s.glass.background).toBe('#000000')
  })

  it('rejects relief from older options without clearing the newest busy state', async () => {
    const s = studio()
    await finishImport(s)
    const first = deferred<ReturnType<typeof timed<ReliefData>>>()
    const second = deferred<ReturnType<typeof timed<ReliefData>>>()
    io.relief.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    s.glass.geometry = 'inflate'
    await vue.nextTick()
    s.reliefOpts.roundness = 0.9
    await vue.nextTick()
    await vi.advanceTimersByTimeAsync(130)
    first.resolve(timed(grid))
    await vue.nextTick()
    expect(s.relief.value).toBeNull()
    expect(s.busy.value).toBe(true)
    const newest = { ...grid, width: 3 }
    second.resolve(timed(newest))
    await vue.nextTick()
    expect(s.relief.value?.width).toBe(3)
    expect(s.busy.value).toBe(false)
  })

  it('clears busy even when outstanding work finishes after the document is removed', async () => {
    const s = studio()
    await finishImport(s)
    const pending = deferred<ReturnType<typeof timed<TraceResult>>>()
    io.trace.mockReturnValueOnce(pending.promise)
    s.traceOpts.threshold++
    await vue.nextTick()
    await vi.advanceTimersByTimeAsync(130)
    s.clearImage()
    pending.reject(new Error('obsolete'))
    await vue.nextTick()
    expect(s.busy.value).toBe(false)
    expect(s.error.value).toBe('')
  })
})
