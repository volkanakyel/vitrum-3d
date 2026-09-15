<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SculptApi } from '~/composables/useSculpt'
import type { JobStatus } from '~/utils/sculpt/job'
import { PASSES, type PassId } from '~/utils/sculpt/types'

const props = defineProps<{ sculpt: SculptApi }>()

const job = computed(() => props.sculpt.job.value)
const status = computed<JobStatus | 'none'>(() => job.value?.status ?? 'none')

const hint = ref('')
const reply = ref('')
/** The sheet opened full size, if any. */
const zoomed = ref('')

/** The run's stages in order, with the two that come before the build passes. */
const STAGES: { id: 'intake' | 'spec' | PassId, label: string }[] = [
  { id: 'intake', label: 'Reading the photo' },
  { id: 'spec', label: 'Planning the parts' },
  ...PASSES.map(id => ({ id, label: { blockout: 'Blockout', structural: 'Structure', form: 'Form', material: 'Materials', surface: 'Surface' }[id] })),
]

/** Which stage the runner is in now; everything before it is done. */
const activeStage = computed(() => {
  const j = job.value
  if (!j) return -1
  if (j.status === 'intake') return 0
  if (j.status === 'spec') return 1
  const pass = j.currentPass
  return pass ? 2 + PASSES.indexOf(pass) : j.intake ? 1 : 0
})
const stageState = (index: number) => {
  if (status.value === 'done') return 'done'
  return index < activeStage.value ? 'done' : index === activeStage.value ? 'active' : 'todo'
}

const running = computed(() => props.sculpt.running.value)
const sheets = computed(() => (job.value?.passes.flatMap(p => p.sheets) ?? []).slice(-3).reverse())
const tokens = computed(() => {
  const u = job.value?.usage
  const total = u ? u.input + u.output : 0
  return total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total)
})
const cost = computed(() => `$${(job.value?.costUsd ?? 0).toFixed(2)}`)

/**
 * How long the run took. A job only carries its start, so the finish is taken
 * when it lands here; a run reopened from the history has none and shows none.
 */
const finishedAt = ref(0)
watch(status, (now, before) => {
  if (now === 'done' && before && before !== 'done') finishedAt.value = Date.now()
  if (now === 'none') { finishedAt.value = 0; reply.value = '' }
})
const elapsed = computed(() => {
  const j = job.value
  if (!j || !finishedAt.value) return ''
  const s = Math.max(0, Math.round((finishedAt.value - j.createdAt) / 1000))
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
})

const statusLabel: Record<JobStatus, string> = {
  'idle': 'Starting',
  'intake': 'Reading the photo',
  'spec': 'Planning the parts',
  'building': 'Writing the code',
  'rendering': 'Rendering',
  'reviewing': 'Reviewing',
  'waiting-input': 'Waiting for you',
  'exporting': 'Exporting',
  'done': 'Done',
  'failed': 'Failed',
  'cancelled': 'Cancelled',
}

function start() {
  void props.sculpt.start(hint.value)
}
function send() {
  const text = reply.value.trim()
  if (!text) return
  reply.value = ''
  props.sculpt.answer(text)
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
    <!-- Idle, cancelled or reopened-without-a-model: the run can be started. -->
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
        Rebuild as parts
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
          placeholder="Anything worth knowing (optional)"
          class="h-8 rounded-lg text-[12px]"
        />
        <p class="text-[11.5px] leading-relaxed text-ink-3">
          Claude reads the photo, plans the parts and writes the model. Uses W/H/D from the size
          section when set.
        </p>
      </template>
      <p class="text-[11.5px] leading-relaxed text-ink-3">
        This sends the photo to Anthropic. Tracing, carving and depth never leave your browser.
      </p>

      <div
        v-if="sculpt.jobs.value.length"
        class="flex flex-col gap-1"
      >
        <span class="text-[11px] text-ink-3">Previous runs</span>
        <button
          v-for="previous in sculpt.jobs.value"
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

    <!-- A run in flight: the stages, the latest sheets, what it has cost so far. -->
    <template v-else-if="running || status === 'idle' || status === 'waiting-input'">
      <ol class="flex flex-col gap-1.5">
        <li
          v-for="(stage, i) in STAGES"
          :key="stage.id"
          class="flex items-center gap-2 text-[12px]"
          :class="stageState(i) === 'todo' ? 'text-ink-3' : 'text-foreground'"
        >
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="{
              'bg-ice shadow-[0_0_0_3px_var(--ice-glow)] animate-pulse': stageState(i) === 'active',
              'bg-ice': stageState(i) === 'done',
              'bg-ink-3/40': stageState(i) === 'todo',
            }"
          />
          {{ stage.label }}
        </li>
      </ol>

      <div
        v-if="sheets.length"
        class="flex gap-1.5"
      >
        <button
          v-for="(sheet, i) in sheets"
          :key="i"
          type="button"
          class="min-w-0 flex-1 overflow-hidden rounded-md bg-well"
          aria-label="Open the comparison sheet"
          @click="zoomed = sheet"
        >
          <img
            :src="sheet"
            alt=""
            class="h-14 w-full object-cover"
          >
        </button>
      </div>

      <p class="text-[11.5px] text-ink-3 tabular-nums">
        {{ statusLabel[status as JobStatus] }} · {{ tokens }} tokens · {{ cost }}
      </p>

      <template v-if="status === 'waiting-input'">
        <p class="text-[12px] leading-relaxed text-foreground">
          {{ job?.question }}
        </p>
        <div class="flex gap-1.5">
          <Input
            v-model="reply"
            placeholder="Your answer"
            class="h-8 flex-1 rounded-lg text-[12px]"
            @keydown.enter.prevent="send"
          />
          <Button
            class="h-8 rounded-lg px-3 text-[12px]"
            :disabled="!reply.trim()"
            @click="send"
          >
            Send
          </Button>
        </div>
      </template>
      <Button
        v-else
        variant="ghost"
        class="h-8 w-full rounded-lg text-[12px]"
        @click="sculpt.cancel()"
      >
        Cancel
      </Button>
    </template>

    <!-- Finished: the parts model is on the stage. -->
    <template v-else-if="status === 'done'">
      <p class="text-[12px] text-foreground tabular-nums">
        Parts model · {{ job?.quality ?? 'approximate' }} · {{ cost }}<template v-if="elapsed"> · {{ elapsed }}</template>
      </p>
      <p
        v-if="!job?.glb"
        class="text-[11.5px] leading-relaxed text-ink-3"
      >
        The run finished without a model that could be exported.
      </p>
      <Button
        variant="ghost"
        class="h-8 w-full rounded-lg text-[12px]"
        @click="sculpt.clear()"
      >
        Back to carve
      </Button>
    </template>

    <!-- Failed: the studio kept the carve; a retry resumes from the last completed pass. -->
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
          Back to carve
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
        tabindex="-1"
        @click="zoomed = ''"
        @keydown.esc="zoomed = ''"
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
