<script setup lang="ts">
import { logoById, logoViewBox } from '~/utils/logos'

/**
 * A flat brand mark is scanned, then its outline is drawn back over it and the points pop in.
 * Each round traces the next logo, so the card reads as "any mark works".
 */
const props = defineProps<{ running: boolean; seen: boolean }>()

const ROTATION = ['github', 'figma', 'spotify', 'discord'].map(logoById)
const { index: round } = useCycle(1_000_000, 5200, toRef(props, 'running'))
const logo = computed(() => ROTATION[round.value % ROTATION.length]!)
const box = computed(() => logoViewBox(logo.value, Math.max(logo.value.viewBox[2], logo.value.viewBox[3]) * 0.08))
// Every "M" starts an outline: the studio counts these as separate shapes and holes.
const outlines = computed(() => logo.value.paths.reduce((n, p) => n + (p.d.match(/[Mm]/g)?.length ?? 0), 0))

// Points are sampled from the rendered paths, evenly along their length.
const traced = ref<SVGPathElement[]>([])
const points = ref<{ x: number; y: number }[]>([])
const scale = computed(() => Math.max(logo.value.viewBox[2], logo.value.viewBox[3]) / 100)
async function samplePoints() {
  await nextTick()
  const paths = traced.value.filter(Boolean)
  const lengths = paths.map(p => p.getTotalLength())
  const total = lengths.reduce((a, b) => a + b, 0)
  const out: { x: number; y: number }[] = []
  paths.forEach((p, i) => {
    const n = Math.max(2, Math.round((lengths[i]! / total) * 18))
    for (let k = 0; k < n; k++) out.push(p.getPointAtLength((k / n) * lengths[i]!))
  })
  points.value = out
}
onMounted(() => void samplePoints())
watch(logo, () => {
  traced.value = []
  void samplePoints()
})
</script>

<template>
  <div class="absolute inset-0 grid place-items-center px-7 pt-7 pb-14">
    <svg
      :key="round"
      class="group max-h-full w-full max-w-[168px] overflow-visible"
      :data-play="seen || undefined"
      :viewBox="box"
      aria-hidden="true"
    >
      <g class="fill-[#d5d9e1]">
        <path
          v-for="(p, i) in logo.paths"
          :key="i"
          :d="p.d"
          :fill-rule="logo.evenodd ? 'evenodd' : undefined"
        />
      </g>
      <g>
        <path
          v-for="(p, i) in logo.paths"
          :key="i"
          :ref="el => { if (el) traced[i] = el as SVGPathElement }"
          class="fill-none stroke-ice stroke-[1.4] stroke-draw [stroke-linejoin:round] [vector-effect:non-scaling-stroke] motion-safe:group-data-play:animate-[draw_1500ms_450ms_var(--ease-in-out-cubic)_forwards] motion-reduce:[stroke-dashoffset:0]"
          :d="p.d"
          pathLength="1"
        />
      </g>
      <circle
        v-for="(pt, i) in points"
        :key="i"
        class="origin-center fill-white stroke-ice [transform:scale(0)] [transform-box:fill-box] motion-safe:group-data-play:animate-[pop_260ms_var(--ease-out-quint)_forwards] motion-reduce:[transform:none]"
        :cx="pt.x"
        :cy="pt.y"
        :r="1.5 * scale"
        :stroke-width="0.8 * scale"
        :style="{ animationDelay: `${1100 + i * 40}ms` }"
      />
    </svg>
    <div class="absolute bottom-4 left-4 flex h-[30px] items-center gap-2 rounded-full bg-white/85 pr-3 pl-2.5 text-[12px] text-ink shadow-raise">
      <LiveDot :on="seen" />
      {{ logo.id }}.svg
      <SwapTransition>
        <span
          :key="round"
          class="index text-ink-3"
        >{{ outlines }}&thinsp;{{ outlines === 1 ? 'outline' : 'outlines' }}</span>
      </SwapTransition>
    </div>
    <span
      class="pointer-events-none absolute inset-x-0 top-0 h-16 border-b border-[rgba(47,111,237,.35)] bg-[linear-gradient(180deg,rgba(47,111,237,0),rgba(47,111,237,.14))] opacity-0 motion-safe:data-play:animate-[trace-scan_1100ms_var(--ease-in-out-cubic)_both]"
      :data-play="seen || undefined"
    />
  </div>
</template>
