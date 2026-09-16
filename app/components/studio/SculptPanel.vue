<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { SculptApi } from '~/composables/useSculpt'
import type { JobStatus } from '~/utils/sculpt/job'

const props = defineProps<{ sculpt: SculptApi }>()

const job = computed(() => props.sculpt.job.value)
const status = computed<JobStatus | 'none'>(() => job.value?.status ?? 'none')
const running = computed(() => props.sculpt.running.value)

const hint = ref('')
const polish = ref(true)
/** The sheet opened full size, if any. */
const zoomed = ref('')
/** How many previous runs the list shows: each carries a full-size data-URL thumbnail. */
const RECENT_JOBS = 5
const recent = computed(() => props.sculpt.jobs.value.slice(0, RECENT_JOBS))

// Escape closes the zoomed sheet. The overlay is not focusable, so the key has
// to be caught on the window — only while a sheet is open.
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') zoomed.value = ''
}
watch(zoomed, (open, was) => {
  if (open && !was) window.addEventListener('keydown', onKey)
  else if (!open && was) window.removeEventListener('keydown', onKey)
})
onScopeDispose(() => window.removeEventListener('keydown', onKey))

/**
 * The run's four steps. Rendering belongs to the build (the model lands on the
 * stage at the end of it) and to the fix; neither gets its own row.
 */
const STEPS: { id: 'build' | 'review' | 'fix', label: string }[] = [
  { id: 'build', label: 'Reading the photo, writing the model' },
  { id: 'review', label: 'Comparing to the photo' },
  { id: 'fix', label: 'Fixing what differs' },
]
const stepIndex: Partial<Record<JobStatus, number>> = { building: 0, rendering: 0, reviewing: 1, fixing: 2 }
const activeStep = computed(() => {
  const j = job.value
  if (!j) return -1
  const i = stepIndex[j.status]
  if (i !== undefined) return j.status === 'rendering' && j.fixed ? 2 : i
  return -1
})
const steps = computed(() => {
  const j = job.value
  const active = activeStep.value
  return STEPS.filter(s => j?.polish || (s.id !== 'review' && s.id !== 'fix')).map((s, i) => ({
    ...s,
    state: i < active ? 'done' : i === active ? 'active' : 'todo',
  }))
})

const sheet = computed(() => job.value?.sheets.at(-1) ?? '')
const tokens = computed(() => {
  const u = job.value?.usage
  const total = u ? u.input + u.output : 0
  return total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total)
})
const cost = computed(() => `$${(job.value?.costUsd ?? 0).toFixed(2)}`)

/** Seconds since the run started, ticking while it runs; frozen when it settles. */
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
watch(running, (on) => {
  if (on && !ticker) ticker = setInterval(() => { now.value = Date.now() }, 1000)
  else if (!on && ticker) { clearInterval(ticker); ticker = null; now.value = Date.now() }
}, { immediate: true })
onScopeDispose(() => { if (ticker) clearInterval(ticker) })
const elapsed = computed(() => {
  const j = job.value
  if (!j) return ''
  const s = Math.max(0, Math.round((now.value - j.createdAt) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

const statusLabel: Record<JobStatus, string> = {
  'idle': 'Starting',
  'building': 'Reading the photo, writing the model',
  'rendering': 'Rendering',
  'reviewing': 'Comparing',
  'fixing': 'Fixing',
  'done': 'Done',
  'failed': 'Failed',
  'cancelled': 'Cancelled',
}

const fidelity = computed(() => {
  const f = job.value?.review?.fidelity
  return f === undefined ? '' : `${Math.round(f * 100)}% match`
})

function start() {
  // From the panel it is always a new run: the automatic build on import is
  // what reuses a stored model for the same photo.
  void props.sculpt.start(hint.value, undefined, { polish: polish.value, reuse: false })
}
function openJob(id: string) {
  void props.sculpt.reopen(id)
}
function when(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Idle or cancelled: the run can be started. -->
    <template v-if="!job || status === 'cancelled'">
      <Button
        class="h-9 w-full rounded-lg text-[12.5px]"
        :disabled="!sculpt.available.value"
        @click="start"
      >
        <Icon
          name="sparkle"
          :size="14"
        />
        {{ job ? 'Build again' : 'Build the parts model' }}
      </Button>
      <p
        v-if="!sculpt.available.value"
        class="text-[11.5px] text-ink-3"
      >
        Set NUXT_ANTHROPIC_KEY
      </p>
      <template v-else>
        <Input
          v-model="hint"
          placeholder="What it is, if the photo is unclear (optional)"
          class="h-8 rounded-lg text-[12px]"
        />
        <label class="flex items-center justify-between gap-3 text-[12px] text-foreground">
          <span class="flex flex-col">
            <span>Polish</span>
            <span class="text-[11px] text-ink-3">One compare-and-fix round after the draft</span>
          </span>
          <Switch v-model="polish" />
        </label>
        <p class="text-[11.5px] leading-relaxed text-ink-3">
          A dropped photo builds on its own. Claude reads it and writes the model in one call: a
          draft stands on the stage in under a minute. {{ polish ? 'Polish adds one review and one fix.' : '' }}
          Uses W/H/D from the size section when set. Three calls at most, about $0.30–0.60.
        </p>
      </template>
      <p class="text-[11.5px] leading-relaxed text-ink-3">
        This sends the photo to Anthropic. Tracing, carving and depth never leave your browser.
      </p>

      <div
        v-if="recent.length"
        class="flex flex-col gap-1"
      >
        <span class="text-[11px] text-ink-3">Previous runs</span>
        <button
          v-for="previous in recent"
          :key="previous.id"
          type="button"
          class="flex items-center gap-2 rounded-lg p-1 text-left transition-colors hover:bg-well"
          @click="openJob(previous.id)"
        >
          <img
            :src="previous.thumbnail"
            alt=""
            class="size-8 shrink-0 rounded-md object-cover"
          >
          <span class="flex min-w-0 flex-col">
            <span class="truncate text-[12px] text-foreground">{{ previous.name }}</span>
            <span class="text-[11px] text-ink-3 tabular-nums">
              {{ statusLabel[previous.status] }} · ${{ previous.costUsd.toFixed(2) }} · {{ when(previous.createdAt) }}
            </span>
          </span>
        </button>
      </div>
    </template>

    <!-- A run in flight: the steps, the latest sheet, what it has cost so far. -->
    <template v-else-if="running || status === 'idle'">
      <ol class="flex flex-col gap-1.5">
        <li
          v-for="step in steps"
          :key="step.id"
          class="flex items-center gap-2 text-[12px]"
          :class="step.state === 'todo' ? 'text-ink-3' : 'text-foreground'"
        >
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="{
              'bg-ice shadow-[0_0_0_3px_var(--ice-glow)] animate-pulse': step.state === 'active',
              'bg-ice': step.state === 'done',
              'bg-ink-3/40': step.state === 'todo',
            }"
          />
          {{ step.label }}
        </li>
      </ol>

      <p
        v-if="job?.glb"
        class="text-[11.5px] leading-relaxed text-ink-3"
      >
        The draft is on the stage. Orbit it while the polish runs.
      </p>

      <button
        v-if="sheet"
        type="button"
        class="overflow-hidden rounded-md bg-well"
        aria-label="Open the comparison sheet"
        @click="zoomed = sheet"
      >
        <img
          :src="sheet"
          alt=""
          class="h-20 w-full object-cover"
        >
      </button>

      <p class="text-[11.5px] text-ink-3 tabular-nums">
        {{ statusLabel[status as JobStatus] }} · {{ elapsed }} · {{ tokens }} tokens · {{ cost }}
      </p>

      <Button
        variant="ghost"
        class="h-8 w-full rounded-lg text-[12px]"
        @click="sculpt.cancel()"
      >
        {{ job?.glb ? 'Keep the draft' : 'Cancel' }}
      </Button>
    </template>

    <!-- Finished: the parts model is on the stage. -->
    <template v-else-if="status === 'done'">
      <p class="text-[12px] text-foreground tabular-nums">
        Parts model<template v-if="fidelity"> · {{ fidelity }}</template> · {{ cost }} · {{ elapsed }}
      </p>
      <p
        v-if="job?.review?.summary"
        class="text-[11.5px] leading-relaxed text-ink-3"
      >
        {{ job.review.summary }}
      </p>
      <p
        v-if="!job?.glb"
        class="text-[11.5px] leading-relaxed text-ink-3"
      >
        The run finished without a model that could be exported.
      </p>
      <button
        v-if="sheet"
        type="button"
        class="overflow-hidden rounded-md bg-well"
        aria-label="Open the comparison sheet"
        @click="zoomed = sheet"
      >
        <img
          :src="sheet"
          alt=""
          class="h-20 w-full object-cover"
        >
      </button>
      <Button
        variant="ghost"
        class="h-8 w-full rounded-lg text-[12px]"
        @click="sculpt.clear()"
      >
        Back to the carve
      </Button>
    </template>

    <!-- Failed: whatever landed stays on the stage; a retry resumes from the last paid step. -->
    <template v-else>
      <p class="text-[11.5px] leading-relaxed text-destructive">
        {{ job?.error || 'Sculpt failed' }}
      </p>
      <div class="flex gap-1.5">
        <Button
          class="h-8 flex-1 rounded-lg text-[12px]"
          :disabled="!sculpt.available.value"
          @click="sculpt.retry()"
        >
          Retry
        </Button>
        <Button
          variant="ghost"
          class="h-8 rounded-lg px-3 text-[12px]"
          @click="sculpt.clear()"
        >
          Back to the carve
        </Button>
      </div>
    </template>

    <!-- A sheet at full size. -->
    <Teleport to="body">
      <div
        v-if="zoomed"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
        role="dialog"
        aria-label="Comparison sheet"
        @click="zoomed = ''"
      >
        <img
          :src="zoomed"
          alt="Comparison sheet"
          class="max-h-full max-w-full rounded-lg object-contain"
        >
      </div>
    </Teleport>
  </div>
</template>
