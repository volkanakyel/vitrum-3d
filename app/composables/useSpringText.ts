import type { Ref } from 'vue'

/**
 * A number that eases toward its source on requestAnimationFrame and exposes a formatted
 * string ref. Self-contained so it works anywhere in a template, unlike a raw MotionValue.
 */
export function useSpringText(
  source: Ref<number> | (() => number),
  format: (v: number) => string,
  opts: { stiffness?: number; damping?: number } = {},
) {
  const read = typeof source === 'function' ? source : () => source.value
  const stiffness = opts.stiffness ?? 380
  const damping = opts.damping ?? 36
  let current = read()
  let velocity = 0
  let target = current
  let raf = 0
  let last = 0
  const text = ref(format(current))

  const tick = (now: number) => {
    const dt = Math.min(0.064, (now - last) / 1000 || 0.016)
    last = now
    // Damped spring integration; settles in ~250 ms with the defaults. Sub-stepped so a slow
    // frame (dt * damping > 2) cannot flip the velocity sign and blow up.
    const steps = Math.ceil(dt / 0.008)
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      const accel = -stiffness * (current - target) - damping * velocity
      velocity += accel * h
      current += velocity * h
    }
    const settled = Math.abs(current - target) < Math.abs(target) * 1e-4 + 1e-3 && Math.abs(velocity) < 1e-2
    if (settled) { current = target; velocity = 0 }
    text.value = format(current)
    raf = settled ? 0 : requestAnimationFrame(tick)
  }

  watch(read, v => {
    target = v
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick) }
  })
  onBeforeUnmount(() => cancelAnimationFrame(raf))
  return text
}
