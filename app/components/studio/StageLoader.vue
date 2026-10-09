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

<!--
  Frosted pane over the stage so the model builds behind a sheet of glass. Everything that moves
  in here animates transform or opacity only, so it stays on the compositor and keeps running
  while the main thread builds the geometry.
-->
<template>
  <motion.div
    class="pointer-events-auto absolute inset-0 z-20 grid place-items-center bg-white/62 backdrop-blur-[18px] backdrop-saturate-120"
    :style="{ '--tile': `${SIZE - 10}px` }"
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
            class="transition-[stroke-dashoffset] duration-600 ease-out-quint"
            x="0"
            y="0"
            :width="SIZE"
            :height="SIZE"
            :rx="R"
            fill="none"
            stroke="var(--lamp)"
            stroke-width="1.5"
            stroke-linecap="round"
            :stroke-dasharray="perimeter"
            :stroke-dashoffset="perimeter * (1 - progress)"
          />
        </svg>
        <div class="tile absolute inset-[5px] overflow-hidden rounded-[22px] shadow-[inset_0_1px_0_#ffffff,inset_0_-1px_0_rgba(38,40,46,.05),0_18px_32px_-20px_rgba(3,7,18,.4)]">
          <Transition
            enter-active-class="transition-opacity duration-250 ease-out-quint"
            leave-active-class="transition-opacity duration-250 ease-out-quint"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
          >
            <img
              v-if="preview"
              :src="preview"
              alt=""
              class="absolute inset-0 size-full object-contain p-4 opacity-90 grayscale contrast-105"
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
          <!-- Scan line: bronze, with a soft glow ahead of it, sweeping the tile top to bottom. -->
          <span
            class="absolute inset-x-0 top-0 h-px animate-[loader-scan_1.4s_cubic-bezier(0.45,0,0.55,1)_infinite] bg-lamp shadow-[0_0_8px_1px_rgba(176,138,92,.45),0_-14px_18px_-6px_rgba(176,138,92,.25)] will-change-[transform,opacity] motion-reduce:animate-none motion-reduce:opacity-60 motion-reduce:[transform:translateY(calc(var(--tile)*0.5))]"
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
              <!-- Three ticking dots, one em wide so the label never shifts. -->
              <span
                class="inline-flex size-[1em] items-end gap-0.5 pb-[0.2em] *:block *:size-0.5 *:rounded-full *:bg-current *:opacity-0 motion-reduce:*:animate-none motion-reduce:*:opacity-100"
                aria-hidden="true"
              ><i class="animate-[dot-1_1.2s_steps(1,end)_infinite]" /><i class="animate-[dot-2_1.2s_steps(1,end)_infinite]" /><i class="animate-[dot-3_1.2s_steps(1,end)_infinite]" /></span>
            </motion.span>
          </AnimatePresence>
        </span>
      </div>
      <span class="mt-1.5 max-w-[26ch] truncate text-[11.5px] text-ink-3">{{ name }}</span>
    </motion.div>
  </motion.div>
</template>
