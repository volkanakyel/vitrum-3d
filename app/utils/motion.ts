/**
 * JS-driven motion, for what CSS cannot tween: SVG path data, window scroll. Shares its curve with
 * the CSS token `--ease-in-out-cubic` (main.css), so a JS morph and the CSS transition beside it
 * start and land together.
 */

/** Slow out, fast through, slow in: for things already on screen moving to a new place. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

export interface TweenOptions {
  ease?: (t: number) => number
  /** Called once, after the last frame (not when cancelled). */
  done?: () => void
}

/**
 * Calls `frame` with eased progress (0 → 1) on every animation frame for `duration` ms.
 * Returns a cancel function; cancelling stops without calling `done`.
 */
export function tween(duration: number, frame: (progress: number) => void, { ease = easeInOutCubic, done }: TweenOptions = {}): () => void {
  const start = performance.now()
  let raf = requestAnimationFrame(function step(now) {
    const t = Math.min(1, (now - start) / duration)
    frame(ease(t))
    if (t < 1) raf = requestAnimationFrame(step)
    else done?.()
  })
  return () => cancelAnimationFrame(raf)
}
