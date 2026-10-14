<script setup lang="ts">
import { motion } from 'motion-v'

export type ImportPhase = 'read' | 'trace' | 'build'

const props = defineProps<{ phase: ImportPhase; preview: string; name: string }>()

const steps: { id: ImportPhase; label: string }[] = [
  { id: 'read', label: 'Reading image' },
  { id: 'trace', label: 'Tracing outline' },
  { id: 'build', label: 'Building the solid' },
]
const stepIndex = computed(() => steps.findIndex((s) => s.id === props.phase))
const label = computed(() => steps[stepIndex.value]?.label ?? '')
const stateOf = (i: number) => (i < stepIndex.value ? 'past' : i === stepIndex.value ? 'current' : 'next')
</script>

<!--
  Frosted pane over the stage so the model builds behind a sheet of glass.

  The geometry is built on the main thread, which can stall for a few hundred milliseconds at a
  time. So nothing in here is driven by JavaScript while the loader is up: the entrance, the scan,
  the label swap and the step bars are all CSS animations or transitions on transform and
  opacity, which the compositor keeps running through a blocked main thread. motion-v only
  handles the exit, which plays once the work is done. Reduced motion keeps the fades and drops
  the movement.
-->
<template>
  <motion.div
    class="pointer-events-auto absolute inset-0 z-20 grid place-items-center bg-white/60 backdrop-blur-[16px] backdrop-saturate-120 animate-[fade-in_200ms_var(--ease-out)_both]"
    :exit="{ opacity: 0, transition: { duration: 0.28, ease: EASE_OUT } }"
    role="status"
    aria-live="polite"
    :aria-label="label"
  >
    <div class="flex flex-col items-center transition-[opacity,translate,scale] delay-40 duration-520 ease-out starting:opacity-0 motion-safe:starting:translate-y-2 motion-safe:starting:scale-97">
      <!-- Tile: the logo sits on a glass slab while a band of light reads it, top to bottom. -->
      <div class="tile relative size-[84px] overflow-hidden rounded-window shadow-[inset_0_1px_0_#fff,inset_0_0_0_1px_rgba(38,40,46,.06),0_1px_2px_rgba(38,40,46,.06),0_20px_36px_-22px_rgba(38,40,46,.45)]">
        <img
          v-if="preview"
          :src="preview"
          alt=""
          class="absolute inset-0 size-full object-contain p-[18px] opacity-88 mix-blend-multiply grayscale transition-opacity duration-320 ease-out starting:opacity-0"
          draggable="false"
        />
        <span
          v-else
          class="absolute inset-0 grid place-items-center text-ink-3"
        >
          <Icon
            name="image"
            :size="22"
            :stroke-width="1.5"
          />
        </span>
        <span
          class="loader-scan pointer-events-none absolute inset-x-0 top-0 h-1/2 motion-reduce:hidden"
          aria-hidden="true"
        />
      </div>

      <!-- Label: every step is stacked in one cell and crossfades, so the width never jumps. -->
      <div
        class="mt-7 grid text-center text-[13px] font-medium text-foreground"
        aria-hidden="true"
      >
        <span
          v-for="(s, i) in steps"
          :key="s.id"
          class="col-start-1 row-start-1 transition-[opacity,translate,filter] duration-[260ms,360ms,260ms] ease-out data-[state=next]:opacity-0 data-[state=past]:opacity-0 motion-safe:data-[state=next]:translate-y-1.5 motion-safe:data-[state=next]:blur-[2px] motion-safe:data-[state=past]:-translate-y-1.5 motion-safe:data-[state=past]:blur-[2px]"
          :data-state="stateOf(i)"
        >{{ s.label }}</span>
      </div>
      <span class="mt-1 max-w-[26ch] truncate text-[12px] text-ink-3">{{ name }}</span>

      <!-- Step bars: past steps fill in 220ms; the current one creeps toward 85% over a little longer
           than a step takes (an ease-out-cubic, gentler than --ease-out), then fills when it ends. -->
      <div
        class="mt-5 flex gap-1"
        aria-hidden="true"
      >
        <span
          v-for="(s, i) in steps"
          :key="s.id"
          class="h-[3px] w-7 overflow-hidden rounded-full bg-[rgba(38,40,46,.09)]"
        >
          <span
            class="block size-full origin-left scale-x-0 rounded-full bg-lamp transition-[scale] duration-0 motion-reduce:transition-none data-[state=current]:scale-x-85 data-[state=current]:duration-700 data-[state=current]:ease-[cubic-bezier(0.215,0.61,0.355,1)] data-[state=past]:scale-x-100 data-[state=past]:duration-220 data-[state=past]:ease-out"
            :data-state="stateOf(i)"
          />
        </span>
      </div>
    </div>
  </motion.div>
</template>

<style scoped>
/* A soft band of azure light with a crisp leading edge, sweeping down and fading at the ends. */
.loader-scan {
  background: linear-gradient(to bottom, rgba(42, 114, 224, 0) 0%, rgba(42, 114, 224, 0.1) 92%, rgba(42, 114, 224, 0.55) 99%, rgba(42, 114, 224, 0) 100%);
  animation: loader-scan 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite;
  will-change: transform, opacity;
}
@keyframes loader-scan {
  0% { transform: translateY(-100%); opacity: 0; }
  15%, 80% { opacity: 1; }
  100% { transform: translateY(200%); opacity: 0; }
}
</style>
