import { useTimeoutFn } from '@vueuse/core'

/**
 * Shares a URL through the Web Share API, falling back to the clipboard, then to a link the
 * user copies by hand (`fallbackUrl`). `status` is a short message that clears itself.
 */
export function useShare(clearAfter = 5000) {
  const status = ref('')
  const fallbackUrl = ref('')
  const { start: clearLater, stop: cancelClear } = useTimeoutFn(() => { status.value = '' }, clearAfter, { immediate: false })

  function reset() {
    cancelClear()
    status.value = ''
    fallbackUrl.value = ''
  }

  function showFallback(url: string) {
    fallbackUrl.value = url
    status.value = 'Copy the link below'
  }

  async function share(data: { title: string; text: string; url: string }) {
    try {
      if (navigator.share) {
        await navigator.share(data)
        status.value = 'Shared'
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.url)
        status.value = 'Link copied'
      } else {
        showFallback(data.url)
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      showFallback(data.url)
    }
    clearLater()
  }

  return { status, fallbackUrl, share, reset }
}
