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
</script>

<!--
  Frosted pane over the stage so the model builds behind a sheet of glass.

  The geometry is built on the main thread, which can stall for a few hundred milliseconds at a
  time. So nothing in here is driven by JavaScript while the loader is up: the entrance, the scan,
  the label swap and the step bars are all CSS animations or transitions on transform and
  opacity, which the compositor keeps running through a blocked main thread. motion-v only
  handles the exit, which plays once the work is done.
-->
<template>
  <motion.div
    class="loader pointer-events-auto absolute inset-0 z-20 grid place-items-center bg-white/60 backdrop-blur-[16px] backdrop-saturate-120"
    :exit="{ opacity: 0, transition: { duration: 0.28, ease: [0.23, 1, 0.32, 1] } }"
    role="status"
    aria-live="polite"
    :aria-label="label"
  >
    <div class="loader-body flex flex-col items-center">
      <!-- Tile: the logo sits on a glass slab while a band of light reads it, top to bottom. -->
      <div class="tile relative size-[84px] overflow-hidden rounded-[24px] shadow-[inset_0_1px_0_#fff,inset_0_0_0_1px_rgba(38,40,46,.06),0_1px_2px_rgba(38,40,46,.06),0_20px_36px_-22px_rgba(38,40,46,.45)]">
        <img
          v-if="preview"
          :src="preview"
          alt=""
          class="loader-art absolute inset-0 size-full object-contain p-[18px] mix-blend-multiply grayscale"
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
          class="loader-scan pointer-events-none absolute inset-x-0 top-0 h-1/2"
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
          class="loader-label col-start-1 row-start-1"
          :data-state="i < stepIndex ? 'past' : i === stepIndex ? 'current' : 'next'"
        >{{ s.label }}</span>
      </div>
      <span class="mt-1 max-w-[26ch] truncate text-[12px] text-ink-3">{{ name }}</span>

      <!-- Step bars: past steps are full; the current one creeps forward on its own. -->
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
            class="loader-bar block size-full origin-left rounded-full bg-lamp"
            :data-state="i < stepIndex ? 'past' : i === stepIndex ? 'current' : 'next'"
          />
        </span>
      </div>
    </div>
  </motion.div>
</template>

<style scoped>
.loader {
  animation: loader-fade 200ms cubic-bezier(0.23, 1, 0.32, 1) both;
}
.loader-body {
  animation: loader-rise 520ms cubic-bezier(0.23, 1, 0.32, 1) 40ms both;
}
.loader-art {
  animation: loader-fade 320ms cubic-bezier(0.23, 1, 0.32, 1) both;
  opacity: 0.88;
}

/* A soft band of azure light with a crisp leading edge, sweeping down and fading at the ends. */
.loader-scan {
  background: linear-gradient(to bottom, rgba(42, 114, 224, 0) 0%, rgba(42, 114, 224, 0.1) 92%, rgba(42, 114, 224, 0.55) 99%, rgba(42, 114, 224, 0) 100%);
  animation: loader-scan 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite;
  will-change: transform, opacity;
}

.loader-label {
  transition: opacity 260ms cubic-bezier(0.23, 1, 0.32, 1), transform 360ms cubic-bezier(0.23, 1, 0.32, 1), filter 260ms cubic-bezier(0.23, 1, 0.32, 1);
}
.loader-label[data-state='past'] { opacity: 0; transform: translateY(-6px); filter: blur(2px); }
.loader-label[data-state='next'] { opacity: 0; transform: translateY(6px); filter: blur(2px); }

.loader-bar {
  transform: scaleX(0);
  will-change: transform;
}
.loader-bar[data-state='past'] {
  transform: scaleX(1);
  transition: transform 220ms cubic-bezier(0.23, 1, 0.32, 1);
}
/* Eases toward 85% over a little longer than a step takes, then snaps full when the step ends. */
.loader-bar[data-state='current'] {
  transform: scaleX(0.85);
  transition: transform 700ms cubic-bezier(0.215, 0.61, 0.355, 1);
}

@keyframes loader-fade {
  from { opacity: 0; }
}
@keyframes loader-rise {
  from { opacity: 0; transform: translateY(8px) scale(0.97); }
}
@keyframes loader-scan {
  0% { transform: translateY(-100%); opacity: 0; }
  15% { opacity: 1; }
  80% { opacity: 1; }
  100% { transform: translateY(200%); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .loader,
  .loader-body,
  .loader-art { animation: none; }
  .loader-scan { animation: none; opacity: 0; }
  .loader-label,
  .loader-bar { transition: none; }
  .loader-label[data-state='past'],
  .loader-label[data-state='next'] { transform: none; filter: none; }
}
</style>
