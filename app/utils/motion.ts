/**
 * JS-driven motion, for what CSS cannot tween: SVG path data, window scroll. Shares its curve with
 * the CSS token `--ease-in-out` (main.css, a quartic in-out), so a JS morph and the CSS
 * transition beside it start and land together.
 */

/** `--ease-out` from main.css, as a motion-v / WAAPI bezier: enter, exit and response. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const

/** Slow out, fast through, slow in: for things already on screen moving to a new place. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2
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
export function tween(duration: number, frame: (progress: number) => void, { ease = easeInOut, done }: TweenOptions = {}): () => void {
  const start = performance.now()
  let raf = requestAnimationFrame(function step(now) {
    const t = Math.min(1, (now - start) / duration)
    frame(ease(t))
    if (t < 1) raf = requestAnimationFrame(step)
    else done?.()
  })
  return () => cancelAnimationFrame(raf)
}
