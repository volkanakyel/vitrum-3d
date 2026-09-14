<script setup lang="ts">
import { AnimatePresence, motion } from 'motion-v'

export type ImportPhase = 'read' | 'trace' | 'build'

const props = defineProps<{ phase: ImportPhase; preview: string; name: string }>()

const steps: { id: ImportPhase; label: string }[] = [
  { id: 'read', label: 'Reading image' },
  { id: 'trace', label: 'Tracing outline' },
  { id: 'build', label: 'Building the solid' },
]
const stepIndex = computed(() => steps.findIndex((s) => s.id === props.phase))
const label = computed(() => steps[stepIndex.value]?.label ?? '')

// Progress ring: a rounded square drawn around the tile, one third per phase.
const SIZE = 92
const R = 27
const perimeter = 4 * (SIZE - 2 * R) + 2 * Math.PI * R
const progress = computed(() => (stepIndex.value + 1) / steps.length)
</script>

<template>
  <motion.div
    class="loader pointer-events-auto absolute inset-0 z-20 grid place-items-center"
    :initial="{ opacity: 0 }"
    :animate="{ opacity: 1 }"
    :exit="{ opacity: 0, transition: { duration: 0.35, ease: [0.23, 1, 0.32, 1] } }"
    :transition="{ duration: 0.2 }"
    role="status"
    aria-live="polite"
    :aria-label="label"
  >
    <motion.div
      class="flex flex-col items-center"
      :initial="{ opacity: 0, y: 10, scale: 0.97 }"
      :animate="{ opacity: 1, y: 0, scale: 1 }"
      :exit="{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.25 } }"
      :transition="{ type: 'spring', stiffness: 320, damping: 28, delay: 0.05 }"
    >
      <!-- Tile: the image sits on a glass slab; a scan line reads it while the ring fills. -->
      <div
        class="relative"
        :style="{ width: `${SIZE}px`, height: `${SIZE}px` }"
      >
        <svg
          class="absolute -inset-[5px] size-[calc(100%+10px)]"
          :viewBox="`-5 -5 ${SIZE + 10} ${SIZE + 10}`"
          aria-hidden="true"
        >
          <rect
            x="0"
            y="0"
            :width="SIZE"
            :height="SIZE"
            :rx="R"
            fill="none"
            stroke="var(--hairline-strong)"
            stroke-width="1.5"
          />
          <rect
            class="ring"
            x="0"
            y="0"
            :width="SIZE"
            :height="SIZE"
            :rx="R"
            fill="none"
            stroke="var(--ice)"
            stroke-width="1.5"
            stroke-linecap="round"
            :stroke-dasharray="perimeter"
            :stroke-dashoffset="perimeter * (1 - progress)"
          />
        </svg>
        <div class="tile absolute inset-[5px] overflow-hidden rounded-[22px]">
          <Transition name="fade">
            <img
              v-if="preview"
              :src="preview"
              alt=""
              class="absolute inset-0 size-full object-contain p-4"
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
          </Transition>
          <span
            class="scan absolute inset-x-0 top-0 h-px"
            aria-hidden="true"
          />
        </div>
      </div>

      <!-- Step readout: mono index, crossfading label. -->
      <div class="mt-6 flex h-5 items-center gap-2.5">
        <span class="index text-ink-3 tabular-nums">
          {{ String(stepIndex + 1).padStart(2, '0') }}&thinsp;/&thinsp;{{ String(steps.length).padStart(2, '0') }}
        </span>
        <span class="relative h-5 w-[8.2em] overflow-hidden text-[13px] font-medium text-foreground">
          <AnimatePresence mode="wait">
            <motion.span
              :key="phase"
              class="absolute inset-0 flex items-center gap-1"
              :initial="{ opacity: 0, y: 8 }"
              :animate="{ opacity: 1, y: 0 }"
              :exit="{ opacity: 0, y: -8 }"
              :transition="{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }"
            >
              {{ label }}
              <span
                class="dots"
                aria-hidden="true"
              ><i /><i /><i /></span>
            </motion.span>
          </AnimatePresence>
        </span>
      </div>
      <span class="mt-1.5 max-w-[26ch] truncate text-[11.5px] text-ink-3">{{ name }}</span>
    </motion.div>
  </motion.div>
</template>

<style scoped>
/* Frosted pane over the stage so the model builds behind a sheet of glass.
   Everything that moves in here animates transform or opacity only, so it stays on the
   compositor and keeps running while the main thread builds the geometry. */
.loader {
  --tile: calc(v-bind(SIZE) * 1px - 10px);
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
}
.tile {
  background: linear-gradient(160deg, #ffffff 0%, #eef2f8 100%);
  box-shadow:
    inset 0 1px 0 #ffffff,
    inset 0 -1px 0 rgba(13, 14, 18, 0.05),
    0 18px 32px -20px rgba(3, 7, 18, 0.4);
}
.tile img {
  filter: grayscale(1) contrast(1.05);
  opacity: 0.9;
}
.ring {
  transition: stroke-dashoffset 0.6s var(--ease-out-quint);
}
/* Scan line: ice, with a soft glow ahead of it, sweeping the tile top to bottom. */
.scan {
  background: var(--ice);
  box-shadow:
    0 0 8px 1px rgba(47, 111, 237, 0.45),
    0 -14px 18px -6px rgba(47, 111, 237, 0.25);
  will-change: transform, opacity;
  animation: scan 1.4s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
@keyframes scan {
  0% { transform: translateY(calc(var(--tile) * 0.08)); opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { transform: translateY(calc(var(--tile) * 0.92)); opacity: 0; }
}
/* Three ticking dots, one em wide so the label never shifts. */
.dots {
  display: inline-flex;
  width: 1em;
  gap: 2px;
  align-items: flex-end;
  height: 1em;
  padding-bottom: 0.2em;
}
.dots i {
  display: block;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0;
  animation: 1.2s steps(1, end) infinite;
}
/* Fill in one by one (· ·· ···), then clear: the classic "..." tick, on the compositor. */
.dots i:nth-child(1) { animation-name: dot-1; }
.dots i:nth-child(2) { animation-name: dot-2; }
.dots i:nth-child(3) { animation-name: dot-3; }
@keyframes dot-1 { 0% { opacity: 0; } 25% { opacity: 1; } }
@keyframes dot-2 { 0% { opacity: 0; } 50% { opacity: 1; } }
@keyframes dot-3 { 0% { opacity: 0; } 75% { opacity: 1; } }
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s var(--ease-out-quint);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .scan,
  .dots i {
    animation: none;
  }
  .scan {
    transform: translateY(calc(var(--tile) * 0.5));
    opacity: 0.6;
  }
  .dots i {
    opacity: 1;
  }
}
</style>
