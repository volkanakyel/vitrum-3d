import type { Ref } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'

/** True while the element is on screen. Landing demos only animate while someone can see them. */
export function useInView(el: Ref<HTMLElement | null>, rootMargin = '0px 0px -12% 0px') {
  const inView = ref(false)
  useIntersectionObserver(el, ([entry]) => { inView.value = entry?.isIntersecting ?? false }, { rootMargin })
  return inView
}

/** Mirrors `prefers-reduced-motion`. False on the server, so prerendered HTML shows the resting state. */
export function useReducedMotion() {
  const reduced = ref(false)
  let query: MediaQueryList | null = null
  const update = () => { reduced.value = query?.matches ?? false }
  onMounted(() => {
    query = window.matchMedia('(prefers-reduced-motion: reduce)')
    update()
    query.addEventListener('change', update)
  })
  onBeforeUnmount(() => query?.removeEventListener('change', update))
  return reduced
}

/**
 * An index that steps through `length` states every `interval` ms while `running` is true.
 * `hold()` pauses the loop after someone interacts, so their choice stays on screen for a while.
 */
export function useCycle(length: number, interval: number, running: Ref<boolean>, holdMs = 5000) {
  const index = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined
  let heldUntil = 0
  const start = () => {
    clearInterval(timer)
    if (!running.value) return
    timer = setInterval(() => {
      if (Date.now() < heldUntil) return
      index.value = (index.value + 1) % length
    }, interval)
  }
  watch(running, start)
  onMounted(start)
  onBeforeUnmount(() => clearInterval(timer))
  function hold(to?: number) {
    if (to !== undefined) index.value = to
    heldUntil = Date.now() + holdMs
  }
  return { index, hold }
}
