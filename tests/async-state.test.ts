import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { delay, nextPaint, abortable } from '~/utils/async'
import { loadImage } from '~/utils/trace'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('settles a paint wait in a background tab', async () => {
  const pending = nextPaint(new AbortController().signal)
  await vi.advanceTimersByTimeAsync(80)
  await expect(pending).resolves.toBeUndefined()
})
it('cancels timers and paint callbacks when their owner leaves', async () => {
  const controller = new AbortController()
  const waits = [delay(1000, controller.signal), nextPaint(controller.signal)]
  const result = Promise.allSettled(waits)
  controller.abort()
  expect((await result).every(r => r.status === 'rejected' && r.reason.name === 'AbortError')).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
it('handles an underlying rejection even after cancellation', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(abortable(Promise.reject(new Error('late')), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
it('releases an image URL immediately when decode is cancelled', async () => {
  vi.stubGlobal('Image', class { src = ''; onload = null; onerror = null })
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const controller = new AbortController()
  let result = 'pending'
  void loadImage(new File(['png'], 'test.png'), controller.signal).then(() => { result = 'done' }, e => { result = e.name })
  controller.abort()
  await vi.advanceTimersByTimeAsync(0)
  expect(result).toBe('AbortError')
  expect(revoke).toHaveBeenCalledOnce()
  revoke.mockRestore()
})
