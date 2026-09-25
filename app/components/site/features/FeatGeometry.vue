<script setup lang="ts">
import { useDocumentVisibility } from '@vueuse/core'

const props = defineProps<{ running: boolean; seen: boolean }>()

type Mode = 'extrude' | 'stack' | 'inflate' | 'relief'
type Point = [number, number]
const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'extrude', label: 'Extrude', hint: 'Silhouette as slab' },
  { value: 'stack', label: 'Stack', hint: 'Object with raised colours' },
  { value: 'inflate', label: 'Inflate', hint: 'Silhouette as volume' },
  { value: 'relief', label: 'Relief', hint: 'Picture as height' },
]

const W = 560
const BASE = 150
const H = 118
const DURATION = 560
const KAPPA = 0.5522847498307936
const SOLID: Point[] = [[22.4, 95.2], [184.8, 252], [308, 375.2], [464.8, 537.6]]
const START = SOLID[0]![0]
const END = SOLID[SOLID.length - 1]![1]

/**
 * Shared cubic topology keeps walls vertical and corners tangent during a morph.
 * Inflated sections use six elliptical arcs instead of a faceted polyline.
 */
function profile(mode: Mode): Point[] {
  const points: Point[] = []
  const floor = mode === 'stack' ? BASE - H * 0.24 : BASE
  const relief = (x: number) => {
    const t = (x - START) / (END - START)
    return BASE - H * (0.37 + 0.13 * Math.sin(t * Math.PI * 6 - 0.5)
      + 0.055 * Math.sin(t * Math.PI * 12 + 0.8) + 0.035 * Math.cos(t * Math.PI * 2))
  }
  const slope = (x: number) => (relief(x + 0.01) - relief(x - 0.01)) / 0.02
  const cubic = (c1: Point, c2: Point, end: Point) => points.push(c1, c2, end)
  let pen: Point = [START, BASE]
  const line = (end: Point) => {
    cubic([pen[0] + (end[0] - pen[0]) / 3, pen[1] + (end[1] - pen[1]) / 3],
      [pen[0] + (end[0] - pen[0]) * 2 / 3, pen[1] + (end[1] - pen[1]) * 2 / 3], end)
    pen = end
  }
  const wave = (a: number, b: number, first = false, last = false) => {
    const dx = (b - a) / 3
    cubic(first ? [a, relief(a)] : [a + dx, relief(a) + slope(a) * dx],
      last ? [b, relief(b)] : [b - dx, relief(b) - slope(b) * dx],
      [b, relief(b) + (last ? 5 : 0)])
  }

  line([START, mode === 'relief' ? relief(START) + 5 : floor])
  SOLID.forEach(([a, b], index) => {
    const center = (a + b) / 2
    if (mode === 'inflate') {
      const rx = (b - a) / 2
      const ry = H * 0.78
      for (let i = 0; i < 6; i++) {
        const t0 = Math.PI - i * Math.PI / 6
        const t1 = t0 - Math.PI / 6
        const k = 4 / 3 * Math.tan((t1 - t0) / 4)
        const x0 = center + rx * Math.cos(t0)
        const y0 = BASE - ry * Math.sin(t0)
        const x1 = center + rx * Math.cos(t1)
        const y1 = BASE - ry * Math.sin(t1)
        cubic([x0 - k * rx * Math.sin(t0), y0 - k * ry * Math.cos(t0)],
          [x1 + k * rx * Math.sin(t1), y1 + k * ry * Math.cos(t1)], [x1, y1])
      }
    } else if (mode === 'relief') {
      for (let i = 0; i < 6; i++) {
        wave(a + (b - a) * i / 6, a + (b - a) * (i + 1) / 6,
          index === 0 && i === 0, index === SOLID.length - 1 && i === 5)
      }
    } else {
      const y = floor - H * (mode === 'stack' ? 0.4 : 0.62)
      const r = mode === 'stack' ? 4 : 5
      pen = [a, floor]
      line([a, y + r])
      cubic([a, y + r * (1 - KAPPA)], [a + r * (1 - KAPPA), y], [a + r, y])
      pen = [a + r, y]
      line([center, y])
      line([b - r, y])
      cubic([b - r * (1 - KAPPA), y], [b, y + r * (1 - KAPPA)], [b, y + r])
      pen = [b, y + r]
      line([b, floor])
    }
    pen = points[points.length - 1]!
    const next = SOLID[index + 1]
    if (next) {
      if (mode === 'relief') wave(b, next[0])
      else line([next[0], floor])
    }
  })
  pen = points[points.length - 1]!
  line([END, BASE])
  return points
}

const profiles = Object.fromEntries(MODES.map(m => [m.value, profile(m.value)])) as Record<Mode, Point[]>
const visibility = useDocumentVisibility()
const interacting = ref(false)
const hovered = ref(false)
const focused = ref(false)
const active = computed(() => props.running && visibility.value === 'visible')
const autoplay = computed(() => active.value && !interacting.value && !hovered.value && !focused.value)
const { index, hold } = useCycle(MODES.length, 4400, autoplay)
const mode = computed(() => MODES[index.value]!)
const gradientId = `geometry-fill-${useId()}`
const current = shallowRef(profiles.extrude)
let raf = 0

watch(() => mode.value.value, (next) => {
  cancelAnimationFrame(raf)
  const from = current.value
  const to = profiles[next]
  if (!active.value) { current.value = to; return }
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION)
    // Matches the selector's cubic-bezier(1/3, 0, 2/3, 1) exactly.
    const e = t * t * (3 - 2 * t)
    current.value = from.map(([x, y], i) => [x + (to[i]![0] - x) * e, y + (to[i]![1] - y) * e])
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
})
watch(active, (value) => {
  if (value) return
  cancelAnimationFrame(raf)
  current.value = profiles[mode.value.value]
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

const rim = computed(() => {
  const coords = current.value.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`)
  const curves = []
  for (let i = 0; i < coords.length; i += 3) curves.push(`C${coords.slice(i, i + 3).join(' ')}`)
  return `M${START},${BASE} ${curves.join(' ')}`
})
const solid = computed(() => `${rim.value} Z`)

function choose(i: number) {
  interacting.value = true
  hold(i)
}
</script>

<template>
  <div
    class="geometry-demo absolute inset-0 flex flex-col items-center justify-between px-[26px] pt-[22px] pb-[18px] max-fold:px-3.5 max-fold:pt-4 max-fold:pb-3.5"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focused = true"
    @focusout="focused = false"
  >
    <div
      class="relative grid grid-cols-4 rounded-full bg-ink/5 p-[3px] shadow-[inset_0_1px_1px_rgba(13,14,18,.04)]"
      role="group"
      aria-label="Geometry mode"
    >
      <span
        class="geometry-selector pointer-events-none absolute inset-y-[3px] left-[3px] w-[calc((100%-6px)/4)] rounded-full bg-white shadow-raise"
        :style="{ transform: `translateX(${index * 100}%)` }"
      />
      <button
        v-for="(m, i) in MODES"
        :key="m.value"
        type="button"
        class="relative h-[30px] min-w-[82px] rounded-full px-3.5 text-[12.5px] text-ink-2 transition-colors duration-200 ease-[ease] focus-ring [--ring-offset:1px] aria-pressed:font-medium aria-pressed:text-ink motion-reduce:transition-none max-fold:min-w-0 max-fold:px-2.5 max-fold:text-[12px]"
        :aria-pressed="index === i"
        @click="choose(i)"
      >
        {{ m.label }}
      </button>
    </div>

    <svg class="w-full max-w-[620px] overflow-visible" :viewBox="`-12 20 ${W + 24} 150`" aria-hidden="true">
      <defs>
        <linearGradient :id="gradientId" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="55" :y2="BASE">
          <stop offset="0" stop-color="#afc5f8" />
          <stop offset="1" stop-color="#6a90e5" />
        </linearGradient>
      </defs>
      <line
        class="stroke-ink/14"
        x1="-12" :x2="W + 12" :y1="BASE + 0.5" :y2="BASE + 0.5"
        stroke-width="1" stroke-dasharray="2 5" vector-effect="non-scaling-stroke"
      />
      <path :fill="`url(#${gradientId})`" :d="solid" fill-opacity="0.94" />
      <path
        class="fill-none stroke-white" :d="rim"
        stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round" stroke-opacity="0.92"
        vector-effect="non-scaling-stroke"
      />
    </svg>

    <p class="flex w-full max-w-[620px] items-end justify-between gap-3 text-[12.5px] text-ink-2 max-2xs:text-[11px]">
      <SwapTransition>
        <span :key="mode.value">{{ mode.hint }}</span>
      </SwapTransition>
      <span class="index shrink-0 text-ink-3">cross-section</span>
    </p>
  </div>
</template>

<style scoped>
.geometry-selector {
  transition: transform 560ms cubic-bezier(0.333333, 0, 0.666667, 1);
}

@media (prefers-reduced-motion: reduce) {
  .geometry-selector { transition: none; }
}
</style>
