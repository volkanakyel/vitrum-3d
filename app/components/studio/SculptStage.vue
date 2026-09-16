<script setup lang="ts">
/**
 * The stage while a parts model is on its way: the photo where the model will
 * stand, the step the run is in, and the clock. Replaces the carve, which for a
 * product photo is not worth looking at, and leaves the stage the moment the
 * draft lands.
 */
import { motion } from 'motion-v'
import type { JobStatus, SculptJob } from '~/utils/sculpt/job'

const props = defineProps<{ job: SculptJob }>()

const label: Partial<Record<JobStatus, string>> = {
  idle: 'Starting',
  building: 'Reading the photo, writing the model',
  rendering: 'Rendering the draft',
  reviewing: 'Comparing to the photo',
  fixing: 'Fixing what differs',
}
const status = computed(() => label[props.job.status] ?? 'Working')

const STEPS: JobStatus[] = ['building', 'reviewing', 'fixing']
const stepIndex = computed(() => {
  const s = props.job.status
  if (s === 'rendering') return props.job.fixed ? 2 : 0
  const i = STEPS.indexOf(s)
  return i < 0 ? 0 : i
})
const stepCount = computed(() => (props.job.polish ? 3 : 1))

const now = ref(Date.now())
const ticker = setInterval(() => { now.value = Date.now() }, 1000)
onScopeDispose(() => clearInterval(ticker))
const elapsed = computed(() => {
  const s = Math.max(0, Math.round((now.value - props.job.createdAt) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
</script>

<template>
  <motion.div
    class="pointer-events-none absolute inset-0 grid place-items-center"
    :initial="{ opacity: 0 }"
    :animate="{ opacity: 1 }"
    :exit="{ opacity: 0, transition: { duration: 0.4, ease: [0.23, 1, 0.32, 1] } }"
    :transition="{ duration: 0.25 }"
  >
    <motion.div
      class="flex flex-col items-center gap-5"
      :initial="{ y: 10, scale: 0.98 }"
      :animate="{ y: 0, scale: 1 }"
      :transition="{ type: 'spring', stiffness: 300, damping: 28 }"
    >
      <span class="photo relative flex size-[168px] items-center justify-center overflow-hidden rounded-[28px]">
        <img
          :src="job.image"
          alt=""
          class="size-full object-contain p-3"
        >
        <span
          class="sweep absolute inset-0"
          aria-hidden="true"
        />
      </span>
      <div class="flex flex-col items-center gap-1.5 text-center">
        <span class="text-[13px] font-medium tracking-[-0.005em] text-foreground">{{ status }}</span>
        <span class="index text-ink-3 tabular-nums">
          {{ String(stepIndex + 1).padStart(2, '0') }} / {{ String(stepCount).padStart(2, '0') }} · {{ elapsed }}
        </span>
      </div>
      <span class="flex items-center gap-1.5">
        <span
          v-for="i in stepCount"
          :key="i"
          class="h-1 rounded-full transition-all duration-500"
          :class="i - 1 < stepIndex ? 'w-6 bg-ice' : i - 1 === stepIndex ? 'w-6 bg-ice animate-pulse' : 'w-3 bg-ink-3/30'"
        />
      </span>
    </motion.div>
  </motion.div>
</template>

<style scoped>
.photo {
  background: linear-gradient(160deg, #ffffff 0%, #eef2f8 100%);
  box-shadow:
    inset 0 1px 0 #ffffff,
    0 0 0 1px var(--hairline),
    0 24px 44px -28px rgba(3, 7, 18, 0.45);
}
.sweep {
  background: linear-gradient(115deg, transparent 35%, rgba(255, 255, 255, 0.85) 50%, transparent 65%);
  transform: translateX(-120%);
  animation: sweep 2.8s var(--ease-out-quint) infinite;
}
@keyframes sweep {
  0% { transform: translateX(-120%); }
  60%, 100% { transform: translateX(120%); }
}
@media (prefers-reduced-motion: reduce) {
  .sweep { animation: none; }
}
</style>
