<script setup lang="ts">
/**
 * One icon, three files: the same render three times, each annotated the way the next tool will
 * see it. A design canvas selects the PNG, a 3D viewer orbits the GLB, a slicer measures the STL.
 * The marks are hairlines in the lamp's blue or the ink's grey, placed on the mark's measured
 * bounds (render scaled so the logo spans x 124.6–275.4, y 70–230 of a 400 × 300 tile).
 */
const FORMATS = [
  { kind: 'png', icon: 'camera', title: 'PNG for your designs', text: 'The view you set, at 2× on a transparent background.', tools: 'Works in Figma, Framer and Keynote.' },
  { kind: 'glb', icon: 'cuboid', title: 'GLB for the web', text: 'A glTF binary with real materials, sized in metres.', tools: 'Loads in three.js, React Three Fiber and Spline.' },
  { kind: 'stl', icon: 'layers', title: 'STL for print', text: 'A closed mesh in millimetres, at the height you set.', tools: 'Opens in Bambu Studio, PrusaSlicer and Cura.' },
] as const
/** The GLB gizmo: x, y and z, drawn out from the origin one after another. */
const AXES = [
  { d: 'M8 16 H22', colour: '#e07070' },
  { d: 'M8 16 V2', colour: '#5fa873' },
  { d: 'M8 16 L2 21.5', colour: 'var(--lamp)' },
]
/** The STL's two dimension lines, on the mark's measured bounds: width below it, height beside it. */
const DIMS = ['M124.6 256 H275.4 M124.6 251 V261 M275.4 251 V261', 'M300 70 V230 M295 70 H305 M295 230 H305']

// The marks draw in once, when the row first comes into view: the file being prepared. Only the
// turntable keeps moving after that, and only while the row is on screen in a visible tab.
const list = useTemplateRef<HTMLElement>('list')
const { seen, running: turning } = useDemoPlayback(list)

/*
 * One sequence per tile, staggered across the row by `--d`: the file chip settles, then the tile's
 * own marks arrive the way the tool would draw them. Everything eases out and lands once. Under
 * reduced motion the marks still fade in; the lift, blur and scale go.
 */
const SETTLE = 'opacity-0 transition-[opacity,filter,translate] duration-[600ms,600ms,700ms] ease-out group-data-seen:opacity-100 group-data-seen:blur-none motion-safe:blur-[3px]'
</script>

<template>
  <ul
    ref="list"
    :data-seen="seen || undefined"
    class="group grid grid-cols-3 gap-6 max-desk:gap-4 max-tab:grid-cols-1 max-tab:gap-12"
  >
    <li
      v-for="(f, i) in FORMATS"
      :key="f.kind"
      class="flex flex-col"
      :style="{ '--d': `${160 + i * 160}ms` }"
    >
      <!-- Every mark is placed in the same 400 × 300 frame as the render, so it sits on the mark's edges.
           The pane: lighter at the top like the table under the lamp, a lit rim, a shadow you feel more than see. -->
      <div
        class="relative aspect-[4/3] overflow-hidden rounded-window bg-[linear-gradient(180deg,color-mix(in_oklab,var(--shell)_55%,white)_0%,var(--shell)_70%)] shadow-[inset_0_0_0_1px_rgba(38,40,46,.05),inset_0_1px_0_rgba(255,255,255,.9),0_1px_2px_rgba(38,40,46,.03),0_16px_36px_-24px_rgba(38,40,46,.16)]"
        aria-hidden="true"
      >
        <img
          src="/images/set/github-chrome.webp"
          alt=""
          width="1024"
          height="1024"
          loading="lazy"
          decoding="async"
          class="absolute top-[-0.79%] left-[16.24%] aspect-square w-[70.99%] max-w-none [mask-image:radial-gradient(closest-side,#000_74%,transparent)]"
        >

        <!-- The file, named the same way on every tile. -->
        <span
          class="absolute top-4 left-4 flex h-[26px] items-center gap-1.5 rounded-full bg-surface/80 pr-2.5 pl-2 text-[12px] font-medium tracking-[-0.005em] text-ink-2 shadow-[0_0_0_1px_rgba(38,40,46,.05),0_2px_6px_-2px_rgba(38,40,46,.10)] backdrop-blur-md delay-(--d) motion-safe:translate-y-[3px] group-data-seen:translate-y-0"
          :class="SETTLE"
        >
          <Icon
            :name="f.icon"
            :size="12"
            class="shrink-0 text-ink-3"
          />
          github.{{ f.kind }}
        </span>

        <!-- PNG: the selected frame and its export size, as a design canvas draws it. The frame is
             dragged out, then its handles click into place. -->
        <span
          v-if="f.kind === 'png'"
          class="absolute inset-x-[29%] inset-y-[20.67%] opacity-0 ring-1 ring-lamp/80 transition-[opacity,scale] duration-[400ms,700ms] ease-out delay-[calc(var(--d)_+_80ms)] group-data-seen:opacity-100 group-data-seen:scale-100 motion-safe:scale-94"
        >
          <span
            v-for="(c, j) in ['-top-[3px] -left-[3px]', '-top-[3px] -right-[3px]', '-bottom-[3px] -left-[3px]', '-right-[3px] -bottom-[3px]']"
            :key="c"
            class="absolute size-1.5 rounded-[1.5px] bg-surface opacity-0 shadow-[0_0_0_1px_var(--lamp)] transition-[opacity,scale] duration-380 ease-out delay-[calc(var(--d)_+_260ms_+_var(--h))] group-data-seen:opacity-100 group-data-seen:scale-100 motion-safe:scale-50"
            :class="c"
            :style="{ '--h': `${j * 50}ms` }"
          />
          <span
            class="absolute top-[calc(100%+8px)] left-1/2 flex h-5 -translate-x-1/2 items-center rounded-[5px] bg-lamp px-1.5 text-[11px] font-medium whitespace-nowrap text-white tabular-nums shadow-[0_2px_6px_-2px_rgba(46,110,220,.45)] delay-[calc(var(--d)_+_420ms)] motion-safe:translate-y-[3px] group-data-seen:translate-y-0"
            :class="SETTLE"
          >2048 × 2048</span>
        </span>

        <!-- GLB: the turntable a 3D viewer orbits on, opening out, then turning slowly enough to read
             as idle rather than busy; and its axis gizmo. -->
        <template v-else-if="f.kind === 'glb'">
          <svg
            class="absolute inset-0 size-full"
            viewBox="0 0 400 300"
            fill="none"
          >
            <ellipse
              class="origin-center opacity-0 [transform-box:fill-box] transition-[opacity,scale] duration-[500ms,900ms] ease-out delay-[calc(var(--d)_+_80ms)] group-data-seen:opacity-100 group-data-seen:scale-100 motion-safe:scale-80"
              :class="{ 'animate-[orbit_3.2s_linear_infinite]': seen }"
              :style="{ animationPlayState: turning ? 'running' : 'paused' }"
              cx="200"
              cy="241"
              rx="98"
              ry="12"
              stroke="var(--lamp)"
              stroke-opacity=".45"
              stroke-dasharray="2 5"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <svg
            class="absolute bottom-[18px] left-[18px] size-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke-width="1.5"
            stroke-linecap="round"
          >
            <path
              v-for="(axis, k) in AXES"
              :key="k"
              class="stroke-draw transition-[stroke-dashoffset] duration-520 ease-out delay-[calc(var(--d)_+_300ms_+_var(--a))] group-data-seen:[stroke-dashoffset:0] motion-reduce:[stroke-dashoffset:0] motion-reduce:transition-none"
              pathLength="1"
              :d="axis.d"
              :stroke="axis.colour"
              :style="{ '--a': `${k * 90}ms` }"
            />
            <circle
              class="delay-(--d)"
              :class="SETTLE"
              cx="8"
              cy="16"
              r="1.75"
              fill="var(--ink-3)"
              stroke="none"
            />
          </svg>
        </template>

        <!-- STL: the mark measured along its real edges, the way a slicer reads it. The dimension
             lines open out from their middle, as a measurement being taken. -->
        <template v-else>
          <svg
            class="absolute inset-0 size-full text-ink-3"
            viewBox="0 0 400 300"
            fill="none"
            stroke="currentColor"
            stroke-opacity=".75"
          >
            <path
              v-for="(d, k) in DIMS"
              :key="k"
              class="origin-center [transform-box:fill-box] transition-transform duration-900 ease-in-out delay-[calc(var(--d)_+_80ms)] group-data-seen:scale-100 motion-reduce:scale-100 motion-reduce:transition-none"
              :class="k === 0 ? 'scale-x-0' : 'scale-y-0'"
              :d="d"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <span
            class="absolute top-[85.33%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-shell px-1.5 text-[11.5px] font-medium text-ink-3 tabular-nums delay-[calc(var(--d)_+_520ms)] motion-safe:translate-y-[calc(-50%_+_3px)] group-data-seen:-translate-y-1/2"
            :class="SETTLE"
          >100 mm</span>
          <span
            class="absolute top-1/2 left-[75%] -translate-x-1/2 -translate-y-1/2 rotate-90 bg-shell px-1.5 text-[11.5px] font-medium whitespace-nowrap text-ink-3 tabular-nums delay-[calc(var(--d)_+_520ms)] motion-safe:translate-y-[calc(-50%_+_3px)] group-data-seen:-translate-y-1/2"
            :class="SETTLE"
          >97 mm</span>
        </template>
      </div>
      <h3 class="mt-6 text-[17px] font-medium tracking-[-0.016em] text-ink">
        {{ f.title }}
      </h3>
      <p class="mt-1.5 max-w-[36ch] text-[15px] leading-[1.6] text-ink-2">
        {{ f.text }}
      </p>
      <p class="mt-0.5 max-w-[36ch] text-[14px] leading-[1.6] text-ink-3">
        {{ f.tools }}
      </p>
    </li>
  </ul>
</template>
