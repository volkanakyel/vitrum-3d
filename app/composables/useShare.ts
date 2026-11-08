import { ref, onScopeDispose } from 'vue'
import { abortable } from '~/utils/async'
import { useTimeoutFn } from '@vueuse/core'

/**
 * Shares a URL through the Web Share API, falling back to the clipboard, then to a link the
 * user copies by hand (`fallbackUrl`). `status` is a short message that clears itself.
 */
export function useShare(clearAfter = 5000) {
  const status = ref('')
  const fallbackUrl = ref('')
  const sharing = ref(false)
  let disposed = false
  let owner: AbortController | null = null
  const { start: clearLater, stop: cancelClear } = useTimeoutFn(() => { status.value = '' }, clearAfter, { immediate: false })

  function reset() {
    owner?.abort()
    owner = null
    sharing.value = false
    cancelClear()
    status.value = ''
    fallbackUrl.value = ''
  }

  function showFallback(url: string) {
    fallbackUrl.value = url
    status.value = 'Copy the link below'
  }

  async function share(data: { title: string; text: string; url: string }) {
    if (disposed || sharing.value) return
    reset()
    const request = owner = new AbortController()
    const current = () => !disposed && owner === request && !request.signal.aborted
    sharing.value = true
    try {
      if (navigator.share) {
        await abortable(navigator.share(data), request.signal)
        if (current()) status.value = 'Shared'
      } else if (navigator.clipboard?.writeText) {
        await abortable(navigator.clipboard.writeText(data.url), request.signal)
        if (current()) status.value = 'Link copied'
      } else {
        showFallback(data.url)
      }
    } catch (error) {
      if (!current() || (error instanceof Error && error.name === 'AbortError')) return
      showFallback(data.url)
    } finally {
      if (current()) {
        sharing.value = false
        if (status.value) clearLater()
      }
    }
  }

  onScopeDispose(() => { disposed = true; reset() })

  return { status, fallbackUrl, sharing, share, reset }
}
