<script setup lang="ts">
import { logoById, logoViewBox } from '~/utils/logos'

/** Set the height in millimetres and the width follows the mark's proportions; depth is its own dial. */
const props = defineProps<{ running: boolean; seen: boolean }>()

const logo = logoById('figma')
const ASPECT = logo.viewBox[2] / logo.viewBox[3]
// The mark sits in a 100-unit frame, 80 units tall, centred.
const H = 80
const W = H * ASPECT
const X = 50 - W / 2
const Y = 8

const HEIGHTS = [100, 60, 150]
const { index } = useCycle(HEIGHTS.length, 2400, toRef(props, 'running'))
const h = computed(() => (props.seen ? HEIGHTS[index.value]! : 0))
const hText = useSpringText(h, v => v.toFixed(1), { stiffness: 120, damping: 22 })
const wText = useSpringText(() => h.value * ASPECT, v => v.toFixed(1), { stiffness: 120, damping: 22 })
const scale = computed(() => 0.64 + (0.36 * (HEIGHTS[index.value]! - 60)) / 90)
/**
 * Hairline in user units, divided by the group's scale so it stays one device-independent pixel
 * as the mark grows and shrinks. (`vector-effect: non-scaling-stroke` would do this, but it makes
 * Chrome dash in screen space and breaks the `pathLength` draw-in.) It eases with the scale.
 */
const hairline = computed(() => 0.55 / scale.value)
/** Each stroke its own path, so every one draws from its own start: line first, then its ends. */
const DIMS = [
  { d: `M${X} ${Y + H + 8} H${X + W}`, delay: 200 },
  { d: `M${X} ${Y + H + 5} V${Y + H + 11}`, delay: 200 },
  { d: `M${X + W} ${Y + H + 5} V${Y + H + 11}`, delay: 820 },
  { d: `M${X + W + 8} ${Y + H} V${Y}`, delay: 420 },
  { d: `M${X + W + 5} ${Y + H} H${X + W + 11}`, delay: 420 },
  { d: `M${X + W + 5} ${Y} H${X + W + 11}`, delay: 1040 },
]
</script>

<template>
  <div class="absolute inset-0 flex flex-col items-center gap-3 px-6 pt-9 pb-4">
    <div
      class="group relative min-h-0 w-full flex-1"
      :data-play="seen || undefined"
    >
      <svg
        class="absolute inset-0 size-full overflow-visible"
        viewBox="0 0 100 104"
        aria-hidden="true"
      >
        <g
          class="origin-[50px_52px] transition-transform duration-700 ease-in-out-cubic motion-reduce:transition-none"
          :style="{ transform: `scale(${scale})` }"
        >
          <svg
            :x="X"
            :y="Y"
            :width="W"
            :height="H"
            :viewBox="logoViewBox(logo)"
          >
            <path
              v-for="(p, i) in logo.paths"
              :key="i"
              :d="p.d"
              :fill="p.fill ?? logo.colour"
            />
          </svg>
          <path
            v-for="(l, i) in DIMS"
            :key="i"
            class="fill-none stroke-ink-3 stroke-draw [stroke-linecap:round] transition-[stroke-width] duration-700 ease-in-out-cubic motion-safe:group-data-play:animate-[draw_var(--len)_var(--delay)_var(--ease-in-out-cubic)_forwards] motion-reduce:transition-none motion-reduce:[stroke-dashoffset:0]"
            :d="l.d"
            pathLength="1"
            :style="{ strokeWidth: hairline, '--delay': `${l.delay}ms`, '--len': i === 0 || i === 3 ? '640ms' : '220ms' }"
          />
        </g>
      </svg>
    </div>
    <DimReadout
      :values="[['W', wText], ['H', hText], ['D', '14.0']]"
      class="shrink-0 bg-white whitespace-nowrap"
    />
  </div>
</template>
