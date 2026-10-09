<script setup lang="ts">
import { motion } from 'motion-v'

/**
 * The pipeline as an exploded isometric drawing: four plates, one per stage, from the flat file at
 * the top to the finished icon at the bottom. Fine grey linework; the stage that is on glows bronze.
 * Steps advance on their own while the figure is on screen and stop for a while after someone
 * points at one.
 */

const STEPS = [
  { title: 'Drop in a logo', text: 'An SVG or a PNG. Brand colours come along with it.' },
  { title: 'Traced into shapes', text: 'Every shape is found and holes are kept, so nothing gets redrawn.' },
  { title: 'Given depth', text: 'Extrude, layer, inflate or emboss it, sized in real millimetres.' },
  { title: 'Finished and exported', text: 'Glass, metal or colour, out as a PNG, a GLB or an STL.' },
] as const

const root = ref<HTMLElement | null>(null)
const inView = useInView(root)
const reduced = useReducedMotion()
const running = computed(() => inView.value && !reduced.value)
const INTERVAL = 3200
const { index: active, hold } = useCycle(STEPS.length, INTERVAL, running, 7000)

/** True once someone has picked a step: the progress line hides until the loop moves on again. */
const picked = ref(false)
let picking = false
watch(active, () => {
  if (!picking) picked.value = false
  picking = false
})
function pick(i: number) {
  picking = i !== active.value
  picked.value = true
  hold(i)
}

/* Isometric projection. World units: a plate is 32 × 32, one unit is S px on screen. */
const S = 4
const C = Math.sqrt(3) / 2
const OX = 168
const GAP = 26 // world units between plates
const OY = 3 * GAP * S + 22
const PLATE = 32
const T = 1 // plate thickness
const H = 5 // extrusion depth
type P3 = readonly [number, number, number]
const xy = ([x, y, z]: P3) => [OX + (x - y) * C * S, OY + ((x + y) * S) / 2 - z * S] as const
const pts = (list: readonly P3[]) => list.map(p => xy(p).map(n => n.toFixed(1)).join(',')).join(' ')
const line = (list: readonly P3[], close = false) => `M${pts(list).replaceAll(' ', 'L')}${close ? 'Z' : ''}`

/* The Framer mark (see LOGOS), as polygons (it is all straight edges), centred on the plate. */
const MARK: readonly (readonly [number, number])[][] = [
  [[4, 0], [20, 0], [20, 8], [12, 8]],
  [[4, 8], [12, 8], [20, 16], [4, 16]],
  [[4, 16], [12, 16], [4, 24]],
].map(poly => poly.map(([x, y]) => [x! + 8, y! + 4] as const))
const at = (poly: readonly (readonly [number, number])[], z: number): P3[] => poly.map(([x, y]) => [x, y, z])

const zOf = (i: number) => (STEPS.length - 1 - i) * GAP

function plate(z: number) {
  return {
    top: pts([[0, 0, z], [PLATE, 0, z], [PLATE, PLATE, z], [0, PLATE, z]]),
    right: pts([[PLATE, 0, z], [PLATE, PLATE, z], [PLATE, PLATE, z - T], [PLATE, 0, z - T]]),
    front: pts([[0, PLATE, z], [PLATE, PLATE, z], [PLATE, PLATE, z - T], [0, PLATE, z - T]]),
    edges: line([[PLATE, 0, z - T], [PLATE, PLATE, z - T], [0, PLATE, z - T]]) + line([[PLATE, PLATE, z], [PLATE, PLATE, z - T]]),
  }
}

/** The solid: side faces that face the viewer, back to front, then the top faces. */
function solid(z0: number, z1: number) {
  const sides: { points: string; shade: number; depth: number }[] = []
  for (const poly of MARK) {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length
    poly.forEach((p, k) => {
      const q = poly[(k + 1) % poly.length]!
      let nx = q[1] - p[1]
      let ny = p[0] - q[0]
      const mx = (p[0] + q[0]) / 2
      const my = (p[1] + q[1]) / 2
      if (nx * (mx - cx) + ny * (my - cy) < 0) [nx, ny] = [-nx, -ny]
      if (nx + ny <= 0) return
      const len = Math.hypot(nx, ny)
      sides.push({
        points: pts([[p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]]),
        // Light from the left: faces turned towards +y are the lit ones.
        shade: (ny / len) * 0.5 + 0.5,
        depth: mx + my,
      })
    })
  }
  sides.sort((a, b) => a.depth - b.depth)
  return { sides, tops: MARK.map(poly => pts(at(poly, z1))), edge: MARK.map(poly => line(at(poly, z1), true)).join('') }
}

const LAYERS = STEPS.map((_, i) => ({ z: zOf(i), plate: plate(zOf(i)) }))
const FINISH = solid(zOf(3), zOf(3) + H)
const WIRE = {
  base: MARK.map(poly => line(at(poly, zOf(2)), true)).join(''),
  top: MARK.map(poly => line(at(poly, zOf(2) + H), true)).join(''),
  posts: MARK.flat().map(([x, y]) => line([[x, y, zOf(2)], [x, y, zOf(2) + H]])).join(''),
}
const TRACE = {
  outline: MARK.map(poly => line(at(poly, zOf(1)), true)).join(''),
  nodes: MARK.flat().map(([x, y]) => xy([x, y, zOf(1)])),
}
const FLAT = MARK.map(poly => pts(at(poly, zOf(0))))

/* Dashed guides between the three visible corners of neighbouring plates. */
const CORNERS = [[0, PLATE], [PLATE, PLATE], [PLATE, 0]] as const
const GUIDES = LAYERS.slice(0, -1).map((layer, i) =>
  CORNERS.map(([x, y]) => line([[x, y, layer.z - T], [x, y, zOf(i + 1)]])).join(''),
)

/* Numbered markers off each plate's left corner, matching the list. */
const MARKERS = LAYERS.map(layer => {
  const [x, y] = xy([0, PLATE, layer.z])
  return { x: x - 24, y, tip: x - 4 }
})

/* The three exports, small tiles on the floor beside the finished icon, labels lying on the plane. */
const FLOOR = `matrix(${C * S} ${S / 2} ${-C * S} ${S / 2} ${OX} ${OY})`
const FILES = ['PNG', 'GLB', 'STL'].map((name, k) => {
  const x0 = 37
  const y0 = 1 + k * 10
  const w = 8
  return {
    name,
    x0,
    y0,
    top: pts([[x0, y0, 0], [x0 + w, y0, 0], [x0 + w, y0 + w, 0], [x0, y0 + w, 0]]),
    sides: pts([[x0 + w, y0, 0], [x0 + w, y0 + w, 0], [x0, y0 + w, 0], [x0, y0 + w, -0.8], [x0 + w, y0 + w, -0.8], [x0 + w, y0, -0.8]]),
  }
})

const state = (i: number) => (i < active.value ? 'done' : i === active.value ? 'on' : 'off')
const uid = useId()
const glow = `iso-glow-${uid}`
const glass = `iso-glass-${uid}`
</script>

<template>
  <div
    ref="root"
    class="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-2 rounded-window bg-slab p-2 shadow-pane max-desk:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-tab:grid-cols-1"
  >
    <div
      class="lightbox iso relative grid place-items-center overflow-hidden rounded-pane bg-[radial-gradient(90%_70%_at_50%_0%,#ffffff_0%,transparent_70%),linear-gradient(180deg,#f3f4f7,#eceef2)] px-6 py-8 shadow-[inset_0_0_0_1px_rgba(38,40,46,.05),inset_0_1px_0_#fff] max-tab:px-3 max-tab:py-5"
      :data-running="running"
    >
      <svg
        class="block h-auto w-full max-w-[460px]"
        viewBox="0 0 400 500"
        aria-hidden="true"
      >
        <defs>
          <filter
            :id="glow"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
          <linearGradient
            :id="glass"
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop
              offset="0"
              stop-color="#fbfaf8"
            />
            <stop
              offset="1"
              stop-color="#e9e0d3"
            />
          </linearGradient>
        </defs>

        <g
          v-for="(d, i) in GUIDES"
          :key="`guide-${i}`"
          class="iso-guide"
          :data-lit="active > i || undefined"
        >
          <path :d="d" />
        </g>

        <!-- Painted bottom up, so each plate frosts the ones below it. -->
        <g
          v-for="i in [3, 2, 1, 0]"
          :key="i"
          class="iso-layer"
          :data-state="state(i)"
          @pointerenter="pick(i)"
        >
          <g class="iso-plate">
            <polygon
              class="iso-plate-side"
              :points="LAYERS[i]!.plate.right"
            />
            <polygon
              class="iso-plate-side"
              :points="LAYERS[i]!.plate.front"
            />
            <polygon
              class="iso-plate-top"
              :points="LAYERS[i]!.plate.top"
            />
          </g>

          <!-- Linework once in grey, once again blurred in bronze as the glow. -->
          <g
            v-for="pass in ['glow', 'line']"
            :key="pass"
            :class="pass === 'glow' ? 'iso-halo' : 'iso-lines'"
            :filter="pass === 'glow' ? `url(#${glow})` : undefined"
          >
            <polygon
              :points="LAYERS[i]!.plate.top"
              fill="none"
            />
            <path :d="LAYERS[i]!.plate.edges" />
            <path
              v-if="i === 1"
              :d="TRACE.outline"
            />
            <path
              v-if="i === 3 && pass === 'glow'"
              :d="FINISH.edge"
            />
            <template v-if="i === 2">
              <path
                :d="WIRE.base"
                stroke-dasharray="2 2.5"
              />
              <path
                :d="WIRE.posts"
                class="iso-faint"
              />
              <path :d="WIRE.top" />
            </template>
          </g>

          <polygon
            v-for="(p, k) in i === 0 ? FLAT : []"
            :key="`flat-${k}`"
            class="iso-flat"
            :points="p"
            
          />

          <template v-if="i === 3">
            <polygon
              v-for="(f, k) in FINISH.sides"
              :key="`side-${k}`"
              class="iso-face"
              :points="f.points"
              :style="{ fill: `color-mix(in srgb, #e6dccd ${Math.round(30 + f.shade * 65)}%, #a99173)` }"
            />
            <polygon
              v-for="(p, k) in FINISH.tops"
              :key="`top-${k}`"
              class="iso-face"
              :points="p"
              :fill="`url(#${glass})`"
            />
            <g
              v-for="(file, k) in FILES"
              :key="file.name"
              class="iso-file"
              :style="{ transitionDelay: `${k * 70}ms` }"
            >
              <polygon
                class="iso-plate-side"
                :points="file.sides"
              />
              <polygon
                class="iso-plate-top"
                :points="file.top"
              />
              <text
                :transform="FLOOR"
                :x="file.x0 + 1.3"
                :y="file.y0 + 5.2"
                class="iso-file-label"
              >{{ file.name }}</text>
            </g>
          </template>

          <circle
            v-for="([cx, cy], k) in i === 1 ? TRACE.nodes : []"
            :key="`node-${k}`"
            class="iso-node"
            :cx="cx"
            :cy="cy"
            r="1.8"
          />

          <g class="iso-marker">
            <path :d="`M${MARKERS[i]!.x + 9} ${MARKERS[i]!.y}H${MARKERS[i]!.tip}`" />
            <circle
              :cx="MARKERS[i]!.x"
              :cy="MARKERS[i]!.y"
              r="9"
            />
            <text
              :x="MARKERS[i]!.x"
              :y="MARKERS[i]!.y + 3.4"
            >{{ i + 1 }}</text>
          </g>
        </g>
      </svg>
    </div>

    <ol class="flex flex-col justify-center gap-1 px-6 py-8 max-desk:px-3 max-tab:px-1 max-tab:pt-2 max-tab:pb-1">
      <li
        v-for="(step, i) in STEPS"
        :key="step.title"
      >
        <button
          type="button"
          class="relative flex w-full items-start gap-4 rounded-[18px] p-4 text-left transition-[scale] duration-[380ms] ease-spring focus-ring [--ring-offset:2px] active:scale-[.985] active:duration-100 motion-reduce:transition-none"
          :aria-pressed="active === i"
          @click="pick(i)"
          @focus="pick(i)"
          @pointerenter="pick(i)"
        >
          <motion.span
            v-if="active === i"
            layout-id="iso-step"
            class="absolute inset-0 rounded-[18px] bg-well"
            :transition="{ type: 'spring', stiffness: 420, damping: 40 }"
            aria-hidden="true"
          />
          <!-- The number doubles as the timer: while the steps advance on their own, a hairline arc
               closes around it, and the next step lights when the ring is full. -->
          <span class="relative grid size-6 shrink-0 place-items-center">
            <svg
              v-if="active === i"
              class="pointer-events-none absolute -inset-[5px] size-[34px] -rotate-90"
              viewBox="0 0 34 34"
              aria-hidden="true"
            >
              <circle
                cx="17"
                cy="17"
                r="16"
                class="fill-none stroke-(--lamp)/20"
                stroke-width="1.25"
              />
              <circle
                v-if="running && !picked"
                :key="active"
                cx="17"
                cy="17"
                r="16"
                pathLength="1"
                class="fill-none stroke-(--lamp) [stroke-dasharray:1] [stroke-linecap:round] animate-[iso-ring_var(--interval)_linear_both]"
                stroke-width="1.25"
                :style="{ '--interval': `${INTERVAL}ms` }"
              />
            </svg>
            <span
              class="grid size-6 place-items-center rounded-full text-[11.5px] font-medium tabular-nums transition-[background-color,color,box-shadow] duration-300"
              :class="active === i ? 'bg-(--lamp) text-white' : 'text-ink-3 shadow-[0_0_0_1px_var(--hairline-strong)]'"
            >{{ i + 1 }}</span>
          </span>
          <span class="relative flex min-w-0 flex-col gap-1">
            <span class="font-(family-name:--font-display) text-[15px] leading-[1.3] font-medium tracking-[-0.02em] text-ink">{{ step.title }}</span>
            <span class="max-w-[42ch] text-[13px] leading-[1.55] text-pretty text-ink-2">{{ step.text }}</span>
          </span>
        </button>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.iso {
  --line-off: rgba(38, 40, 46, 0.22);
  --line-done: rgba(38, 40, 46, 0.46);
}
.iso-layer {
  --line: var(--line-off);
  transition: transform 520ms var(--ease-spring);
}
.iso-layer[data-state='done'] { --line: var(--line-done); }
.iso-layer[data-state='on'] {
  --line: var(--lamp);
  transform: translateY(-5px);
}

.iso-lines, .iso-halo {
  fill: none;
  stroke: var(--line);
  stroke-width: 0.9;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.iso-lines * { transition: stroke 360ms ease; }
.iso-faint { opacity: 0.5; }
.iso-halo {
  stroke: var(--lamp);
  stroke-width: 2.6;
  opacity: 0;
  transition: opacity 420ms ease;
}
.iso-layer[data-state='on'] .iso-halo { opacity: 0.4; }

.iso-plate-top {
  fill: rgba(255, 255, 255, 0.62);
  transition: fill 360ms ease;
}
.iso-plate-side { fill: rgba(222, 226, 234, 0.7); }
.iso-layer[data-state='on'] .iso-plate-top { fill: color-mix(in srgb, var(--lamp) 7%, rgba(255, 255, 255, 0.8)); }

.iso-flat { fill: var(--ink); opacity: 0.8; }
.iso-face {
  stroke: rgba(90, 72, 48, 0.32);
  stroke-width: 0.7;
  stroke-linejoin: round;
}
.iso-node {
  fill: #fff;
  stroke: var(--line);
  stroke-width: 0.9;
  transition: stroke 360ms ease, fill 360ms ease;
}
.iso-layer[data-state='on'] .iso-node { fill: var(--lamp); }

.iso-file .iso-plate-top, .iso-file .iso-plate-side { stroke: var(--line); stroke-width: 0.8; stroke-linejoin: round; }
.iso-file-label {
  font-size: 3.1px;
  font-weight: 600;
  letter-spacing: 0.02em;
  fill: var(--line);
  transition: fill 360ms ease;
}
/* The tiles land one after another when the last step comes on. */
.iso-file { transition: transform 520ms var(--ease-spring); }
.iso-layer[data-state='on'] .iso-file { transform: translateY(-3px); }

.iso-marker path { stroke: var(--line); stroke-width: 0.8; transition: stroke 360ms ease; }
.iso-marker circle {
  fill: #fff;
  stroke: var(--line);
  stroke-width: 0.8;
  transition: fill 360ms ease, stroke 360ms ease;
}
.iso-marker text {
  font-size: 10px;
  font-weight: 500;
  text-anchor: middle;
  fill: rgba(38, 40, 46, 0.55);
  font-feature-settings: 'tnum';
  transition: fill 360ms ease;
}
.iso-layer[data-state='on'] .iso-marker circle { fill: var(--lamp); }
.iso-layer[data-state='on'] .iso-marker text { fill: #fff; }

.iso-guide path {
  fill: none;
  stroke: rgba(38, 40, 46, 0.18);
  stroke-width: 0.8;
  stroke-dasharray: 1.5 3;
  transition: stroke 360ms ease;
}
.iso-guide[data-lit] path { stroke: color-mix(in srgb, var(--lamp) 70%, transparent); }
/* Light runs down the lit guides, the direction the work flows. */
@media (prefers-reduced-motion: no-preference) {
  .iso[data-running='true'] .iso-guide[data-lit] path { animation: iso-flow 900ms linear infinite; }
}
@media (prefers-reduced-motion: reduce) {
  .iso-layer, .iso-file { transition: none; }
}
@keyframes iso-flow {
  to { stroke-dashoffset: -9; }
}
</style>
