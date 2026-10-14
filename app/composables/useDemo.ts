import type { ComputedRef, Ref } from 'vue'
import { useDocumentVisibility, useIntervalFn, useIntersectionObserver, useMounted, usePreferredReducedMotion, type MaybeComputedElementRef } from '@vueuse/core'

/** True while the element is on screen. Landing demos only animate while someone can see them. */
export function useInView(el: MaybeComputedElementRef, rootMargin = '0px 0px -12% 0px'): Ref<boolean> {
  const inView = ref(false)
  useIntersectionObserver(el, ([entry]) => { inView.value = entry?.isIntersecting ?? false }, { rootMargin })
  return inView
}

/**
 * Mirrors `prefers-reduced-motion`. False until mounted (and on the server), so the prerendered
 * HTML and the hydrating client both show the resting state.
 */
export function useReducedMotion(): ComputedRef<boolean> {
  const mounted = useMounted()
  const preference = usePreferredReducedMotion()
  return computed(() => mounted.value && preference.value === 'reduce')
}

/**
 * Everything a landing demo needs to know. `seen` latches the first time it is on screen (for
 * play-once reveals); `running` is true while it is on screen, in a visible tab, and motion is
 * allowed (for loops).
 */
export function useDemoPlayback(el: MaybeComputedElementRef, rootMargin?: string) {
  const inView = useInView(el, rootMargin)
  const reduced = useReducedMotion()
  const visibility = useDocumentVisibility()
  const seen = ref(false)
  watch(inView, (value) => { if (value) seen.value = true })
  const running = computed(() => inView.value && visibility.value === 'visible' && !reduced.value)
  return { inView, reduced, seen, running }
}

/**
 * An index that steps through `length` states every `interval` ms while `running` is true and
 * the tab is visible. `hold()` pauses the loop after someone interacts, so their choice stays on
 * screen for a while.
 */
export function useCycle(length: number, interval: number, running: MaybeRefOrGetter<boolean>, holdMs = 5000) {
  const index = ref(0)
  let heldUntil = 0
  const visibility = useDocumentVisibility()
  const active = computed(() => toValue(running) && visibility.value === 'visible')
  const { pause, resume } = useIntervalFn(() => {
    if (Date.now() < heldUntil) return
    index.value = (index.value + 1) % length
  }, interval, { immediate: false })
  // Client only: the loop starts once mounted, then follows `active`.
  onMounted(() => watch(active, on => (on ? resume() : pause()), { immediate: true }))
  function hold(to?: number) {
    if (to !== undefined) index.value = to
    heldUntil = Date.now() + holdMs
  }
  return { index, hold }
}
