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
const dim = 'fill-none stroke-ink-3 stroke-1 stroke-draw [vector-effect:non-scaling-stroke] motion-reduce:[stroke-dashoffset:0]'
const scale = computed(() => 0.64 + (0.36 * (HEIGHTS[index.value]! - 60)) / 90)
</script>

<template>
  <div class="absolute inset-0 flex flex-col items-center justify-center gap-3.5 px-4 pt-6 pb-4">
    <div
      class="group w-3/5 max-w-[190px]"
      :data-play="seen || undefined"
    >
      <svg
        class="block w-full overflow-visible"
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
            :class="dim"
            class="motion-safe:group-data-play:animate-[draw_900ms_200ms_var(--ease-in-out-cubic)_forwards]"
            :d="`M${X} ${Y + H + 8} H${X + W} M${X} ${Y + H + 5} V${Y + H + 11} M${X + W} ${Y + H + 5} V${Y + H + 11}`"
            pathLength="1"
          />
          <path
            :class="dim"
            class="motion-safe:group-data-play:animate-[draw_900ms_450ms_var(--ease-in-out-cubic)_forwards]"
            :d="`M${X + W + 8} ${Y} V${Y + H} M${X + W + 5} ${Y} H${X + W + 11} M${X + W + 5} ${Y + H} H${X + W + 11}`"
            pathLength="1"
          />
        </g>
      </svg>
    </div>
    <DimReadout
      :values="[['W', wText], ['H', hText], ['D', '14.0']]"
      class="bg-white whitespace-nowrap"
    />
  </div>
</template>
