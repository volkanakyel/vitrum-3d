import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useShare } from '~/composables/useShare'
import { mountComposable, deferred } from './helpers/mount'
let unmount: () => void
beforeEach(() => { vi.stubGlobal('ref', ref) })
afterEach(() => { unmount?.(); vi.unstubAllGlobals() })
const data = (url: string) => ({ title: 'Look', text: 'Example', url })
function share() { const m = mountComposable(useShare); unmount = m.unmount; return m.value }

it('removes an old fallback URL after the next successful share', async () => {
  vi.stubGlobal('navigator', {})
  const s = share()
  await s.share(data('https://example.com/old'))
  vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
  await s.share(data('https://example.com/new'))
  expect(s.fallbackUrl.value).toBe('')
  expect(s.status.value).toBe('Link copied')
})

it('does not publish a late share outcome after reset', async () => {
  const pending = deferred<void>()
  vi.stubGlobal('navigator', { share: () => pending.promise })
  const s = share()
  const work = s.share(data('https://example.com'))
  s.reset()
  pending.resolve()
  await work
  expect(s.status.value).toBe('')
})

it('does not publish a late share outcome after unmount', async () => {
  const pending = deferred<void>()
  vi.stubGlobal('navigator', { share: () => pending.promise })
  const s = share()
  const work = s.share(data('https://example.com'))
  unmount()
  pending.resolve()
  await work
  expect(s.status.value).toBe('')
})
