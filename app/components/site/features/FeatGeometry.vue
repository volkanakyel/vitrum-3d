<script setup lang="ts">
/**
 * The studio's four geometry modes, shown as a cross-section through the camera icon.
 * Each mode is a height profile sampled at the same x positions, so switching modes can
 * morph one SVG path into the next instead of cross-fading two drawings.
 */
const props = defineProps<{ running: boolean; seen: boolean }>()

type Mode = 'extrude' | 'stack' | 'inflate' | 'relief'
const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'extrude', label: 'Extrude', hint: 'Silhouette as slab' },
  { value: 'stack', label: 'Stack', hint: 'Object with raised colours' },
  { value: 'inflate', label: 'Inflate', hint: 'Silhouette as volume' },
  { value: 'relief', label: 'Relief', hint: 'Picture as height' },
]

// A slice through the camera: body wall, lens ring, lens ring, body wall (0..1 across).
const SOLID: [number, number][] = [[0.04, 0.17], [0.33, 0.45], [0.55, 0.67], [0.83, 0.96]]
const OUTER: [number, number] = [0.04, 0.96]
const N = 180
const W = 560
const BASE = 150
const H = 118

const inside = (x: number, [a, b]: [number, number]) => x >= a && x <= b
const edge = (x: number, [a, b]: [number, number]) => Math.min(x - a, b - x)
const bevel = (d: number, r: number) => Math.sqrt(Math.max(0, Math.min(1, d / r)))

function height(mode: Mode, x: number) {
  const seg = SOLID.find(s => inside(x, s))
  if (mode === 'extrude') return seg ? 0.62 * bevel(edge(x, seg), 0.018) : 0
  if (mode === 'inflate') {
    if (!seg) return 0
    const half = (seg[1] - seg[0]) / 2
    const t = 1 - edge(x, seg) / half
    return 0.78 * Math.sqrt(Math.max(0, 1 - t * t))
  }
  const plate = inside(x, OUTER) ? bevel(edge(x, OUTER), 0.018) : 0
  if (mode === 'stack') return 0.24 * plate + (seg ? 0.4 * bevel(edge(x, seg), 0.014) : 0)
  // relief: a thin plate whose top follows the picture's brightness
  const wave = 0.5 + 0.22 * Math.sin(x * 21) + 0.16 * Math.sin(x * 47 + 1.3) + 0.12 * Math.cos(x * 9)
  return plate * (0.14 + 0.44 * wave * (seg ? 1 : 0.55))
}

const profiles = Object.fromEntries(MODES.map(m => [m.value, Array.from({ length: N }, (_, i) => height(m.value, i / (N - 1)))])) as Record<Mode, number[]>

const { index, hold } = useCycle(MODES.length, 2600, toRef(props, 'running'), 6000)
const mode = computed(() => MODES[index.value]!)

const current = ref<number[]>([...profiles.extrude])
let raf = 0
watch(() => mode.value.value, (next) => {
  cancelAnimationFrame(raf)
  const from = [...current.value]
  const to = profiles[next]
  if (!props.running) { current.value = [...to]; return }
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 720)
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2 // ease-in-out cubic
    current.value = from.map((v, i) => v + (to[i]! - v) * e)
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

const top = computed(() => current.value.map((h, i) => `${((i / (N - 1)) * W).toFixed(1)},${(BASE - h * H).toFixed(1)}`))
const solid = computed(() => `M0,${BASE} L${top.value.join(' L')} L${W},${BASE} Z`)
const rim = computed(() => `M${top.value.join(' L')}`)

function choose(i: number) { hold(i) }
</script>

<template>
  <div class="absolute inset-0 flex flex-col items-center justify-between px-[26px] pt-[22px] pb-[18px] max-fold:px-3.5 max-fold:pt-4 max-fold:pb-3.5">
    <div
      class="relative grid grid-cols-4 rounded-full bg-ink/5 p-[3px] shadow-[inset_0_1px_1px_rgba(13,14,18,.04)]"
      role="group"
      aria-label="Geometry mode"
    >
      <span
        class="absolute inset-y-[3px] left-[3px] w-[calc((100%-6px)/4)] rounded-full bg-white shadow-raise transition-transform duration-360 ease-in-out-cubic motion-reduce:transition-none"
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

    <svg
      class="w-full max-w-[620px] overflow-visible"
      :viewBox="`-12 20 ${W + 24} 150`"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="geo-fill"
          x1="0"
          x2="0"
          y1="0"
          y2="1"
        >
          <stop
            offset="0"
            stop-color="#a9c2fb"
          />
          <stop
            offset="1"
            stop-color="#5d8ef2"
          />
        </linearGradient>
      </defs>
      <line
        class="stroke-ink/14 [stroke-dasharray:2_4]"
        x1="-12"
        :x2="W + 12"
        :y1="BASE + 0.5"
        :y2="BASE + 0.5"
      />
      <path
        class="fill-[url(#geo-fill)] opacity-92"
        :d="solid"
      />
      <path
        class="fill-none stroke-white stroke-[1.6] [stroke-linejoin:round] [stroke-opacity:.9]"
        :d="rim"
      />
    </svg>

    <p class="flex w-full max-w-[620px] justify-between text-[12.5px] text-ink-2">
      <SwapTransition lift>
        <span :key="mode.value">{{ mode.hint }}</span>
      </SwapTransition>
      <span class="index text-ink-3">cross-section</span>
    </p>
  </div>
</template>
