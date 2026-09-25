<script setup lang="ts">
import { useDocumentVisibility } from '@vueuse/core'
import { logoById, logoViewBox, type Logo } from '~/utils/logos'

const props = defineProps<{ running: boolean; seen: boolean }>()
const ROTATION = ['github', 'figma', 'spotify', 'discord'].map(logoById)
const visibility = useDocumentVisibility()
const active = computed(() => props.running && visibility.value === 'visible')
const { index: round } = useCycle(ROTATION.length, 6800, active)
const logo = computed(() => ROTATION[round.value]!)
const extent = computed(() => Math.max(logo.value.viewBox[2], logo.value.viewBox[3]))
const box = computed(() => logoViewBox(logo.value, extent.value * 0.08))
const scale = computed(() => extent.value / 100)
const outlines = computed(() => logo.value.paths.reduce((n, p) => n + (p.d.match(/[Mm]/g)?.length ?? 0), 0))

interface Anchor { x: number; y: number; delay: number }
interface Trace { strokes: { d: string; delay: number; duration: number }[]; anchors: Anchor[] }
const measurements = shallowRef<Record<string, Trace>>({})
const trace = computed(() => measurements.value[logo.value.id])
const DRAW_DELAY = 380
const DRAW_DURATION = 1800
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 }

/**
 * Measure the original command endpoints, including implicit repeated commands.
 * Browser path geometry supplies the exact position and distance, so the nodes
 * sit on authored anchors and appear only when the trace reaches them.
 */
function measure(mark: Logo): Trace {
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  // Each contour needs its own dash: SVG restarts a compound path's dash at every moveto.
  const contours = mark.paths.flatMap(({ d }) => {
    const result: string[] = []
    let contour = ''
    for (const chunk of d.match(/[a-df-z][^a-df-z]*/gi) ?? []) {
      if (chunk[0]!.toLowerCase() === 'm') {
        let x = 0
        let y = 0
        if (contour) {
          probe.setAttribute('d', contour)
          const end = probe.getPointAtLength(probe.getTotalLength())
          x = end.x
          y = end.y
          result.push(contour)
        }
        const args = chunk.slice(1).match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? []
        const relative = chunk[0] === 'm'
        contour = `M${Number(args[0]) + (relative ? x : 0)} ${Number(args[1]) + (relative ? y : 0)} `
        if (args.length > 2) contour += `${relative ? 'l' : 'L'}${args.slice(2).join(' ')} `
      } else contour += chunk
    }
    if (contour) result.push(contour)
    return result
  })
  const lengths = contours.map((d) => {
    probe.setAttribute('d', d)
    return probe.getTotalLength()
  })
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const anchors: Anchor[] = []
  const strokes: Trace['strokes'] = []
  const minDistance = Math.max(mark.viewBox[2], mark.viewBox[3]) * 0.045
  let offset = 0

  contours.forEach((d, pathIndex) => {
    const length = lengths[pathIndex]!
    strokes.push({ d, delay: DRAW_DELAY + offset / total * DRAW_DURATION, duration: length / total * DRAW_DURATION })
    let prefix = ''
    for (const chunk of d.match(/[a-df-z][^a-df-z]*/gi) ?? []) {
      const command = chunk[0]!
      const lower = command.toLowerCase()
      const arity = ARITY[lower]
      if (!arity) { prefix += chunk; continue }
      const args: string[] = []
      let remaining = chunk.slice(1)
      while (remaining.trim()) {
        remaining = remaining.replace(/^[\s,]+/, '')
        // SVG arc flags may touch: `0 01-4 2` means rotation 0, flags 0/1, x -4, y 2.
        const flag = lower === 'a' && (args.length % arity === 3 || args.length % arity === 4)
        const token = remaining.match(flag ? /^[01]/ : /^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/i)?.[0]
        if (!token) break
        args.push(token)
        remaining = remaining.slice(token.length)
      }
      for (let i = 0; i + arity <= args.length; i += arity) {
        const repeated = lower === 'm' && i > 0 ? (command === 'm' ? 'l' : 'L') : command
        prefix += `${repeated}${args.slice(i, i + arity).join(' ')} `
        probe.setAttribute('d', prefix)
        const distance = probe.getTotalLength()
        // An interior moveto has no length; its endpoint is covered by the closed contour.
        if (lower === 'm' && i === 0 && distance > 0) continue
        const { x, y } = probe.getPointAtLength(distance)
        if (anchors.some(p => Math.hypot(p.x - x, p.y - y) < minDistance)) continue
        anchors.push({ x, y, delay: DRAW_DELAY + (offset + distance) / total * DRAW_DURATION })
      }
    }
    offset += length
  })
  // Keep dense source artwork as quiet as the simple marks, retaining real anchors.
  const selected = anchors.length <= 22 ? anchors : Array.from({ length: 22 }, (_, i) => anchors[Math.round(i * (anchors.length - 1) / 21)]!)
  return { strokes, anchors: selected }
}

onMounted(() => {
  measurements.value = Object.fromEntries(ROTATION.map(mark => [mark.id, measure(mark)]))
})
</script>

<template>
  <div
    class="trace-demo absolute inset-0 grid place-items-center px-7 pt-7 pb-14"
    :data-running="active"
  >
    <Transition name="trace-artwork" mode="out-in">
      <svg
        :key="logo.id"
        class="trace-artwork max-h-full w-full max-w-[168px] overflow-visible"
        :data-play="seen && trace ? '' : undefined"
        :viewBox="box"
        aria-hidden="true"
      >
        <g class="fill-[#d5d9e1]">
          <path
            v-for="(p, i) in logo.paths" :key="i" :d="p.d"
            :fill-rule="logo.evenodd ? 'evenodd' : undefined"
          />
        </g>
        <g class="fill-none stroke-ice" :stroke-width="0.8 * scale" stroke-linejoin="round" stroke-linecap="round">
          <path
            v-for="(p, i) in trace?.strokes ?? []"
            :key="i"
            class="trace-outline"
            :d="p.d"
            pathLength="1"
            :style="{ '--draw-delay': `${p.delay}ms`, '--draw-duration': `${p.duration}ms` }"
          />
        </g>
        <circle
          v-for="(point, i) in trace?.anchors ?? []"
          :key="i"
          class="trace-node fill-white stroke-ice"
          :cx="point.x" :cy="point.y" :r="1.18 * scale" :stroke-width="0.65 * scale"
          :style="{ '--node-delay': `${point.delay}ms` }"
        />
        <line
          class="trace-scan stroke-ice"
          :x1="logo.viewBox[0] - extent * 0.08"
          :x2="logo.viewBox[0] + logo.viewBox[2] + extent * 0.08"
          :y1="logo.viewBox[1] - extent * 0.08"
          :y2="logo.viewBox[1] - extent * 0.08"
          stroke-width="0.75"
          vector-effect="non-scaling-stroke"
          :style="{ '--scan-distance': `${logo.viewBox[3] + extent * 0.16}px` }"
        />
      </svg>
    </Transition>
    <div class="absolute bottom-4 left-4 flex h-[30px] items-center gap-2 rounded-full bg-white/85 pr-3 pl-2.5 text-[12px] text-ink shadow-raise">
      <LiveDot :on="seen" />
      <span class="grid min-w-[120px]">
        <Transition name="trace-label">
          <span :key="logo.id" class="col-start-1 row-start-1 flex items-center gap-2">
            <span>{{ logo.id }}.svg</span>
            <span class="index text-ink-3">{{ outlines }}&thinsp;{{ outlines === 1 ? 'outline' : 'outlines' }}</span>
          </span>
        </Transition>
      </span>
    </div>
  </div>
</template>

<style scoped>
.trace-outline {
  stroke-dasharray: 1;
  stroke-dashoffset: 0;
}
.trace-node {
  transform-box: fill-box;
  transform-origin: center;
}
.trace-scan { opacity: 0; }

@media (prefers-reduced-motion: no-preference) {
  .trace-outline { stroke-dashoffset: 1; }
  .trace-node { opacity: 0; }
  .trace-artwork[data-play] .trace-outline {
    animation: trace-draw var(--draw-duration) var(--draw-delay) linear both;
  }
  .trace-artwork[data-play] .trace-node {
    animation: trace-anchor 240ms var(--node-delay) var(--ease-out-quint) both;
  }
  .trace-artwork[data-play] .trace-scan {
    animation: trace-sweep 1400ms 120ms cubic-bezier(0.333333, 0, 0.666667, 1) both;
  }
  .trace-demo[data-running='false'] .trace-outline,
  .trace-demo[data-running='false'] .trace-node,
  .trace-demo[data-running='false'] .trace-scan {
    animation-play-state: paused;
  }
  .trace-artwork-enter-active { transition: opacity 360ms ease, transform 360ms var(--ease-out-quint); }
  .trace-artwork-leave-active { transition: opacity 180ms ease; }
  .trace-artwork-enter-from { opacity: 0; transform: translateY(3px); }
  .trace-artwork-leave-to { opacity: 0; }
  .trace-label-enter-active, .trace-label-leave-active { transition: opacity 180ms ease; }
  .trace-label-enter-from, .trace-label-leave-to { opacity: 0; }
}

@keyframes trace-draw {
  from { stroke-dashoffset: 1; }
  to { stroke-dashoffset: 0; }
}
@keyframes trace-anchor {
  from { opacity: 0; transform: scale(0.82); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes trace-sweep {
  0% { opacity: 0; transform: translateY(0); }
  18%, 72% { opacity: 0.28; }
  100% { opacity: 0; transform: translateY(var(--scan-distance)); }
}
</style>
