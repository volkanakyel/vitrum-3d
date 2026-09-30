<script setup lang="ts">
import { useDocumentVisibility } from '@vueuse/core'

/**
 * The four geometry modes, drawn to the studio's own rules and default sizes on one small mark: a
 * blue ring with an amber dot, 100 mm wide. Left, the artwork as each mode reads it, cut from A to
 * B; right, the solid's cross-section along that cut, depth running up the page around the solid's
 * mid-plane, at true scale (1 mm = 3.2 units).
 *
 *   Extrude  reads the outline only (one grey)  → 14 mm slabs, 3.2 mm bevel on both faces
 *   Stack    reads colours: the biggest (blue) is the base face, every other colour (amber) is a
 *            2 mm layer seated on it                                  (utils/extrude.ts, trace.ts)
 *   Inflate  the silhouette puffed on both sides from its distance field, rounding over 0.6 of the
 *            thickest half-width; the picture stays on as colour                (utils/relief.ts)
 *   Relief   the whole picture, background included, as a height field on a 14 mm base: linear
 *            luminance, stretched, so white stands 4 mm proud, the dark ring sinks to the base and
 *            the amber dot sits at 28 %
 *
 * Every piece keeps its point count in every mode, so the solid morphs point for point.
 */
const props = defineProps<{ running: boolean; seen: boolean }>()

type Mode = 'extrude' | 'stack' | 'inflate' | 'relief'
const MODES: { value: Mode; label: string; hint: string; spec: string }[] = [
  { value: 'extrude', label: 'Extrude', hint: 'The outline as a solid slab', spec: '14 mm, 3.2 mm bevel' },
  { value: 'stack', label: 'Stack', hint: 'Extra colours become layers', spec: '14 mm + 2 mm layers' },
  { value: 'inflate', label: 'Inflate', hint: 'Rounded on both faces', spec: '14 mm, both faces' },
  { value: 'relief', label: 'Relief', hint: 'Light rises, dark sinks', spec: '14 mm + 4 mm relief' },
]

// ─── Scale ───────────────────────────────────────────────────────────────────────────────────
// Tile units (the artwork's 100-unit box) × 4 across; the ring spans 80 units = 100 mm, so one
// millimetre is 0.8 tile units, 3.2 svg units, in both directions.
const X = (v: number) => v * 4
const MM = 3.2
const MID = 66
const DEPTH = 14
const HALF = (DEPTH / 2) * MM
const BEVEL = 3.2 * MM
const LAYER = 2 * MM
const LAYER_BEVEL = Math.min(3.2 * 0.6, 2 * 0.45) * MM
const RELIEF = 4 * MM

const PIECES = [
  { id: 'ring-a', x0: 10, x1: 24 },
  { id: 'dot', x0: 40, x1: 60 },
  { id: 'ring-b', x0: 76, x1: 90 },
  { id: 'layer', x0: 40, x1: 60 },
] as const
type PieceId = (typeof PIECES)[number]['id']
/** Samples per piece, bunched at the ends (cosine spacing) where bevels and domes turn fastest. */
const N = 40
const U = Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((Math.PI * i) / (N - 1)))
/** The relief surface runs the whole cut at half-unit steps, fine enough for its sharp steps. */
const SURFACE_X = Array.from({ length: 185 }, (_, i) => 4 + i * 0.5)

/** Height of a bevelled slab face at `d` svg units in from its edge: a quarter round of radius r. */
function bevelled(h: number, r: number, d: number) {
  return d >= r ? h : h - r + Math.sqrt(Math.max(0, r * r - (r - d) ** 2))
}
/** Distance from tile-x on the cut (y = 50) to the nearest edge of the artwork, in tile units. */
function edgeDistance(x: number) {
  const r = Math.abs(x - 50)
  if (r <= 10) return 10 - r
  if (r >= 26 && r <= 40) return Math.min(r - 26, 40 - r)
  return 0
}
/** Stretched linear luminance along the cut, with the height grid's one-pixel blur. */
const LUM = { white: 1, dot: 0.28, ring: 0 }
function reliefHeight(x: number) {
  const r = Math.abs(x - 50)
  const step = (edge: number) => Math.min(1, Math.max(0, (r - edge) / 0.4 + 0.5))
  // White → dot → white → ring → white, outward from the centre.
  const inDot = 1 - step(10)
  const inRing = step(26) * (1 - step(40))
  return LUM.dot * inDot + LUM.ring * inRing + LUM.white * (1 - inDot - inRing)
}

/** One piece: top and bottom offsets above the mid-plane (svg units, up is positive), per sample. */
type Profile = { top: number[]; bottom: number[] }
type Solid = Record<PieceId, Profile>

function shapeFor(mode: Mode): Solid {
  const out = {} as Solid
  const inflateRadius = 10 * 0.6
  for (const p of PIECES) {
    const edge = (u: number) => Math.min(u, 1 - u) * (X(p.x1) - X(p.x0))
    let top: number[]
    let bottom: number[]
    if (p.id === 'layer') {
      // Seated on the dot's face; zero thick outside Stack, so it rides the dot invisibly.
      const seat = shapeForPiece(mode, 'dot')
      top = mode === 'stack' ? U.map((u, i) => seat.top[i]! + bevelled(LAYER, LAYER_BEVEL, edge(u))) : seat.top
      bottom = seat.top
    } else {
      ({ top, bottom } = shapeForPiece(mode, p.id))
    }
    out[p.id] = { top, bottom }
  }
  return out

  function shapeForPiece(m: Mode, id: 'ring-a' | 'dot' | 'ring-b'): Profile {
    const p = PIECES.find(q => q.id === id)!
    const w = X(p.x1) - X(p.x0)
    const edge = (u: number) => Math.min(u, 1 - u) * w
    if (m === 'inflate') {
      const top = U.map((u) => {
        const t = Math.min(1, edgeDistance(p.x0 + u * (p.x1 - p.x0)) / inflateRadius)
        return HALF * Math.sqrt(1 - (1 - t) * (1 - t))
      })
      return { top, bottom: top.map(v => -v) }
    }
    if (m === 'relief') {
      // Lies inside the surface it has become (same fill, same top); kept off the back face so the
      // two edges never double up there.
      const top = U.map(u => HALF + RELIEF * reliefHeight(p.x0 + u * (p.x1 - p.x0)))
      return { top, bottom: U.map(() => -HALF + 2) }
    }
    const top = U.map(u => bevelled(HALF, BEVEL, edge(u)))
    return { top, bottom: top.map(v => -v) }
  }
}

/**
 * Relief's surface (the picture's background between the pieces) has no counterpart in the other
 * modes, so it does not morph: it holds its shape and fades in behind the pieces as they move into
 * place, and out as they leave. Growing it out of the mid-plane reads as goo.
 */
const SURFACE = outline(SURFACE_X, SURFACE_X.map(x => HALF + RELIEF * reliefHeight(x)), SURFACE_X.map(() => -HALF))

/** Flattened per mode, so a morph is one lerp over one array. */
function pack(solid: Solid): number[] {
  const out: number[] = []
  for (const p of PIECES) out.push(...solid[p.id].top, ...solid[p.id].bottom)
  return out
}
const PACKED = Object.fromEntries(MODES.map(m => [m.value, pack(shapeFor(m.value))])) as Record<Mode, number[]>

// ─── Colour: what the surface shows by default in each mode ─────────────────────────────────────
const BLUE = '#5b7fe0'
const AMBER = '#eea24a'
const ONE = '#747f96'
const GREY = '#8d97ab'
const FILLS: Record<Mode, Record<PieceId, string>> = {
  extrude: { 'ring-a': ONE, 'dot': ONE, 'ring-b': ONE, 'layer': ONE },
  stack: { 'ring-a': BLUE, 'dot': BLUE, 'ring-b': BLUE, 'layer': AMBER },
  inflate: { 'ring-a': BLUE, 'dot': AMBER, 'ring-b': BLUE, 'layer': AMBER },
  relief: { 'ring-a': GREY, 'dot': GREY, 'ring-b': GREY, 'layer': GREY },
}
/** The artwork as each mode reads it: outline only, colours, or brightness. */
const ART: Record<Mode, { ring: string; dot: string }> = {
  extrude: { ring: ONE, dot: ONE },
  stack: { ring: BLUE, dot: AMBER },
  inflate: { ring: BLUE, dot: AMBER },
  relief: { ring: '#44484f', dot: '#9da1a8' },
}

// ─── State and motion ────────────────────────────────────────────────────────────────────────
const visibility = useDocumentVisibility()
const interacting = ref(false)
const hovered = ref(false)
const focused = ref(false)
const active = computed(() => props.running && visibility.value === 'visible')
const autoplay = computed(() => active.value && !interacting.value && !hovered.value && !focused.value)
const { index, hold } = useCycle(MODES.length, 3800, autoplay)
const mode = computed(() => MODES[index.value]!)
const fills = computed(() => FILLS[mode.value.value])
const art = computed(() => ART[mode.value.value])
const current = shallowRef(PACKED.extrude)
/** The morph, the pill and the surface fade share this duration and `--ease-in-out-cubic`. */
const DURATION = 640
let cancel = () => {}

watch(() => mode.value.value, (next) => {
  cancel()
  const from = current.value
  const to = PACKED[next]
  if (!active.value) {
    current.value = to
    return
  }
  cancel = tween(DURATION, (e) => {
    current.value = from.map((v, i) => v + (to[i]! - v) * e)
  })
})
watch(active, (value) => {
  if (value) return
  cancel()
  current.value = PACKED[mode.value.value]
})
onBeforeUnmount(() => cancel())

function f(n: number) {
  return n.toFixed(2)
}
function outline(xs: number[], top: number[], bottom: number[]) {
  const up = xs.map((x, i) => `${f(X(x))} ${f(MID - top[i]!)}`)
  const down = xs.map((x, i) => `${f(X(x))} ${f(MID - bottom[i]!)}`).reverse()
  const thick = Math.max(...top.map((t, i) => t - bottom[i]!))
  return { body: `M${up.join(' L')} L${down.join(' L')} Z`, rim: `M${up.join(' L')}`, visible: thick > 0.4 }
}
const pieces = computed(() => {
  const v = current.value
  let at = 0
  const take = (n: number) => v.slice(at, (at += n))
  return PIECES.map((p) => {
    const top = take(N)
    const bottom = take(N)
    return { id: p.id, ...outline(U.map(u => p.x0 + u * (p.x1 - p.x0)), top, bottom) }
  })
})

function choose(i: number) {
  interacting.value = true
  hold(i)
}

/**
 * Colour settles first (220 ms), then the solid finishes forming (640 ms): the artwork is re-read,
 * and the geometry follows from it. A fade as long as the morph would pass through mud.
 */
const EASE = 'transition-[fill] duration-[220ms] ease-out motion-reduce:transition-none'
/**
 * A/B marks. Both drawings scale with their box and shrink ~2× on the phone card, so the letters
 * are set larger there (in user units) to stay a readable ~7 px.
 */
const LETTER = 'font-mono text-[8px] leading-none font-medium fill-ink-3'
</script>

<template>
  <div
    class="absolute inset-0 flex flex-col items-center gap-3 px-6 pt-[18px] pb-4 max-fold:px-4 max-fold:pt-11"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focused = true"
    @focusout="focused = false"
  >
    <div
      class="relative grid shrink-0 grid-cols-4 rounded-full bg-ink/5 p-[3px] shadow-[inset_0_1px_1px_rgba(13,14,18,.04)]"
      role="group"
      aria-label="Geometry mode"
    >
      <span
        class="pointer-events-none transition-transform duration-[640ms] ease-in-out-cubic motion-reduce:transition-none absolute inset-y-[3px] left-[3px] w-[calc((100%-6px)/4)] rounded-full bg-white shadow-raise"
        :style="{ transform: `translateX(${index * 100}%)` }"
      />
      <button
        v-for="(m, i) in MODES"
        :key="m.value"
        type="button"
        class="relative h-7 min-w-[76px] rounded-full px-3 text-[12px] text-ink-2 transition-colors duration-200 ease-[ease] focus-ring [--ring-offset:1px] aria-pressed:font-medium aria-pressed:text-ink motion-reduce:transition-none max-fold:min-w-0 max-fold:px-2.5"
        :aria-pressed="index === i"
        @click="choose(i)"
      >
        {{ m.label }}
      </button>
    </div>

    <div class="flex min-h-0 w-full max-w-[640px] flex-1 items-center gap-7 max-fold:gap-3">
      <!-- The artwork, as this mode reads it. -->
      <svg
        class="h-full max-h-[112px] w-auto shrink-0 overflow-visible max-fold:max-h-[76px]"
        viewBox="-12 -2 124 104"
        aria-hidden="true"
      >
        <rect
          x="0"
          y="0"
          width="100"
          height="100"
          rx="18"
          class="fill-white"
          filter="drop-shadow(0 1px 1.5px rgba(13,14,18,.08))"
        />
        <rect
          x="0.5"
          y="0.5"
          width="99"
          height="99"
          rx="17.5"
          class="fill-none stroke-ink/[.07]"
        />
        <path
          d="M50 10 a40 40 0 1 0 0.001 0 Z M50 24 a26 26 0 1 1 -0.001 0 Z"
          fill-rule="evenodd"
          :class="EASE"
          :style="{ fill: art.ring }"
        />
        <circle
          cx="50"
          cy="50"
          r="10"
          :class="EASE"
          :style="{ fill: art.dot }"
        />
        <line
          x1="-2"
          y1="50"
          x2="102"
          y2="50"
          class="stroke-ice"
          stroke-width="1.2"
          stroke-dasharray="3 2.5"
        />
        <text
          x="-7"
          y="53.5"
          :class="LETTER"
          class="max-fold:text-[10px]"
          text-anchor="middle"
        >A</text>
        <text
          x="107"
          y="53.5"
          :class="LETTER"
          class="max-fold:text-[10px]"
          text-anchor="middle"
        >B</text>
      </svg>

      <!-- The solid's cross-section along A to B: depth runs up the page, around the mid-plane. -->
      <svg
        class="h-full min-w-0 flex-1 overflow-visible"
        viewBox="0 24 400 88"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <line
          x1="0"
          :y1="MID"
          x2="400"
          :y2="MID"
          class="stroke-ink/15"
          stroke-width="1"
          stroke-dasharray="2 4"
          vector-effect="non-scaling-stroke"
        />
        <!-- Fades in over the whole morph, on its curve; out fast, so the pieces are seen leaving. -->
        <g
          class="opacity-0 transition-opacity duration-200 ease-out data-on:opacity-100 data-on:duration-[640ms] data-on:ease-in-out-cubic motion-reduce:transition-none"
          :data-on="mode.value === 'relief' || undefined"
        >
          <path
            :d="SURFACE.body"
            :style="{ fill: GREY }"
          />
          <path
            :d="SURFACE.rim"
            class="fill-none stroke-white/85"
            stroke-width="1.25"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </g>
        <g
          v-for="p in pieces"
          :key="p.id"
          :class="{ 'opacity-0': !p.visible }"
        >
          <path
            :d="p.body"
            :class="EASE"
            :style="{ fill: fills[p.id] }"
          />
          <path
            :d="p.rim"
            class="fill-none stroke-white/85"
            stroke-width="1.25"
            stroke-linejoin="round"
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
          />
        </g>
        <text
          :x="X(4)"
          y="108"
          :class="LETTER"
          class="max-fold:text-[15px]"
          text-anchor="middle"
        >A</text>
        <text
          :x="X(96)"
          y="108"
          :class="LETTER"
          class="max-fold:text-[15px]"
          text-anchor="middle"
        >B</text>
      </svg>
    </div>

    <p class="flex w-full max-w-[640px] shrink-0 items-end justify-between gap-3 text-[12px] text-ink-2 max-2xs:text-[11px]">
      <SwapTransition lift>
        <span :key="mode.value">{{ mode.hint }}</span>
      </SwapTransition>
      <SwapTransition>
        <span
          :key="mode.value"
          class="index shrink-0 text-ink-3"
        >{{ mode.spec }}</span>
      </SwapTransition>
    </p>
  </div>
</template>
