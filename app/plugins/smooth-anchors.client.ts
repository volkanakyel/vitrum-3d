/**
 * Same-page anchor links (nav, mobile menu, footer, back to top, skip link) glide instead of
 * jumping. One delegated listener covers every `<a href="#…">`, so no link has to opt in.
 *
 * - The trip eases in and out (the page is content already on screen, moving) and takes longer the
 *   further it goes, on a square-root curve: a hop to the next section ~0.55 s, the whole page
 *   under a second. Never a fixed duration that crawls on short hops or blurs long ones.
 * - It lands where the browser would: the target's own `scroll-margin-top` clears the fixed nav.
 * - Any wheel, touch, key or pointer press hands the page straight back to the reader.
 * - The URL gets the hash without a history entry of its own, and without touching the router's
 *   `history.state` (vue-router keeps its position data there).
 * - Focus moves to the target afterwards, so the next Tab continues from there.
 * - Reduced motion: the jump is instant, as before.
 */
export default defineNuxtPlugin(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let frame = 0
  let release: (() => void) | null = null

  function stop() {
    cancelAnimationFrame(frame)
    frame = 0
    release?.()
    release = null
  }

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

  function glide(to: number, done: () => void) {
    stop()
    const from = window.scrollY
    const distance = to - from
    if (Math.abs(distance) < 2 || reduced.matches) {
      window.scrollTo(0, to)
      done()
      return
    }
    const duration = Math.min(980, 360 + Math.sqrt(Math.abs(distance)) * 8)
    const start = performance.now()
    const interrupt = () => stop()
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
    for (const e of events) window.addEventListener(e, interrupt, { passive: true })
    release = () => { for (const e of events) window.removeEventListener(e, interrupt) }
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      window.scrollTo(0, from + distance * ease(t))
      if (t < 1) frame = requestAnimationFrame(step)
      else {
        stop()
        done()
      }
    }
    frame = requestAnimationFrame(step)
  }

  function destination(target: HTMLElement) {
    const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0
    const max = document.documentElement.scrollHeight - window.innerHeight
    return Math.round(Math.min(max, Math.max(0, target.getBoundingClientRect().top + window.scrollY - margin)))
  }

  function focus(target: HTMLElement) {
    if (!target.matches('a[href], button, input, select, textarea, [tabindex]')) {
      target.setAttribute('tabindex', '-1')
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
    }
    target.focus({ preventScroll: true })
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const link = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]')
    if (!link || link.target) return
    const id = decodeURIComponent(link.hash.slice(1))
    const target = id ? document.getElementById(id) : null
    if (!target) return
    e.preventDefault()
    // "Back to top" and the skip link land on the page's own start: keep the URL clean there.
    const url = id === 'main-content' ? window.location.pathname + window.location.search : `#${id}`
    window.history.replaceState(window.history.state, '', url)
    glide(destination(target), () => focus(target))
  })
})
