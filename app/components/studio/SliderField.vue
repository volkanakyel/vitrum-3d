<script setup lang="ts">
import { AnimatePresence, motion } from 'motion-v'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: number
    min: number
    max: number
    step?: number
    unit?: string
    decimals?: number
    hint?: string
    defaultValue?: number
  }>(),
  { step: 0.01, unit: '', decimals: 2 },
)
const emit = defineEmits<{ 'update:modelValue': [number] }>()

const arr = computed({
  get: () => [props.modelValue],
  set: (v: number[] | undefined) => {
    if (v && v[0] !== undefined) set(snap(v[0]))
  },
})
const changed = computed(
  () => props.defaultValue !== undefined && Math.abs(props.defaultValue - props.modelValue) > 1e-9,
)
const fmt = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: props.decimals })

// Displayed number springs toward the real value so typed jumps and preset changes roll over.
const shown = useSpringText(() => props.modelValue, fmt, { stiffness: 420, damping: 38 })

const pct = computed(() => ((props.modelValue - props.min) / (props.max - props.min)) * 100)
const defaultPct = computed(() =>
  props.defaultValue === undefined
    ? null
    : ((props.defaultValue - props.min) / (props.max - props.min)) * 100,
)
const dragging = ref(false)
const editing = ref(false)
const draft = ref('')

// Magnetic snap while dragging: the midpoint and the default value pull the thumb in when it
// comes within 2.5% of the range, with a short pulse so the catch is felt, not just seen.
const quantize = (v: number) => +(Math.round((v - props.min) / props.step) * props.step + props.min).toFixed(6)
const mid = computed(() => quantize((props.min + props.max) / 2))
const snapTargets = computed(() => {
  const t = [mid.value]
  if (props.defaultValue !== undefined && Math.abs(props.defaultValue - mid.value) > 1e-9) t.push(props.defaultValue)
  return t
})
const atMid = computed(() => Math.abs(props.modelValue - mid.value) < 1e-9)
const midPct = computed(() => ((mid.value - props.min) / (props.max - props.min)) * 100)
const pulse = ref(0)
const snapping = ref(false)
let held: number | null = null
let pulseTimer: ReturnType<typeof setTimeout> | undefined
function snap(v: number) {
  if (!dragging.value) return v
  const win = (props.max - props.min) * 0.025
  for (const t of snapTargets.value) {
    if (Math.abs(v - t) <= win) {
      if (held !== t) {
        held = t
        pulse.value++
        snapping.value = true
        clearTimeout(pulseTimer)
        pulseTimer = setTimeout(() => (snapping.value = false), 380)
      }
      return t
    }
  }
  held = null
  return v
}
function endDrag() {
  dragging.value = false
  held = null
}

function set(v: number) {
  if (Number.isNaN(v)) return
  emit('update:modelValue', Math.min(props.max, Math.max(props.min, v)))
}
function focus(e: FocusEvent) {
  editing.value = true
  draft.value = fmt(props.modelValue)
  nextTick(() => (e.target as HTMLInputElement).select())
}
function commit(e: Event) {
  editing.value = false
  set(parseFloat((e.target as HTMLInputElement).value.replace(',', '.')))
}
function onWheel(e: WheelEvent) {
  e.preventDefault()
  set(+(props.modelValue + (e.deltaY < 0 ? props.step : -props.step)).toFixed(6))
}
function onKey(e: KeyboardEvent) {
  const big = e.shiftKey ? 10 : 1
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    set(+(props.modelValue + props.step * big).toFixed(6))
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    set(+(props.modelValue - props.step * big).toFixed(6))
  }
}

// Hairline track, filled range, small ringed thumb that grows on hover / press and pops on a snap.
const thumb = [
  'size-3.5 rounded-full border-0 bg-card transition-[scale,box-shadow] duration-[250ms,150ms] ease-[var(--ease-spring),ease] motion-reduce:transition-none pointer-coarse:size-4',
  'shadow-[0_0_0_1px_var(--hairline-strong),0_1px_2px_rgba(17,18,20,.16),inset_0_1px_0_#fff]',
  'hover:scale-115 hover:ring-0 hover:shadow-[0_0_0_1px_var(--hairline-strong),0_0_0_5px_var(--well),0_1px_2px_rgba(17,18,20,.16),inset_0_1px_0_#fff]',
  'focus-visible:scale-115 focus-visible:ring-0 focus-visible:shadow-[0_0_0_1px_var(--hairline-strong),0_0_0_5px_var(--ice-glow),0_1px_2px_rgba(17,18,20,.16),inset_0_1px_0_#fff]',
  'active:scale-95',
]
</script>

<template>
  <div class="group/slider flex flex-col gap-1">
    <div class="flex h-5 items-center justify-between">
      <span class="flex items-center gap-1.5 text-[12.5px] text-ink-2">
        {{ label }}
        <Tooltip v-if="hint">
          <TooltipTrigger as-child>
            <span
              class="flex cursor-help text-muted-foreground/45 transition-colors hover:text-foreground"
              tabindex="0"
            >
              <Icon
                name="info"
                :size="11"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            class="max-w-[220px] text-pretty"
          >
            {{ hint }}
          </TooltipContent>
        </Tooltip>
        <AnimatePresence>
          <motion.button
            v-if="changed"
            key="reset"
            class="flex text-muted-foreground/60 transition-colors hover:text-foreground"
            :initial="{ opacity: 0, scale: 0.6 }"
            :animate="{ opacity: 1, scale: 1 }"
            :exit="{ opacity: 0, scale: 0.6 }"
            title="Reset to default"
            @click="set(defaultValue!)"
          >
            <Icon
              name="reset"
              :size="11"
            />
          </motion.button>
        </AnimatePresence>
      </span>

      <!-- Inline value: plain mono text at rest, becomes a field on focus. -->
      <label
        class="-mr-1.5 flex h-5 items-center gap-1 rounded-full px-1.5 transition-[background-color,box-shadow]"
        :class="
          editing
            ? 'bg-card shadow-[0_0_0_1px_var(--ring)]'
            : 'hover:bg-well focus-within:bg-card focus-within:shadow-[0_0_0_1px_var(--ring)]'
        "
      >
        <input
          v-if="editing"
          class="w-11 bg-transparent text-right font-mono text-[11.5px] tabular-nums outline-none"
          :value="draft"
          inputmode="decimal"
          autofocus
          @input="draft = ($event.target as HTMLInputElement).value"
          @blur="commit"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
          @keydown.esc="editing = false"
        />
        <span
          v-else
          class="min-w-8 cursor-text text-right font-mono text-[11.5px] tabular-nums outline-none select-none"
          :class="changed ? 'text-foreground' : 'text-ink-2'"
          tabindex="0"
          @focus="focus"
          @wheel="onWheel"
          @keydown="onKey"
        >
          {{ shown }}
        </span>
        <span
          v-if="unit"
          class="text-[10px] text-muted-foreground"
        >
          {{ unit }}
        </span>
      </label>
    </div>

    <div
      class="relative h-4 pointer-coarse:h-8"
      @pointerdown="dragging = true"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @pointerleave="endDrag"
    >
      <!-- midpoint tick -->
      <span
        class="pointer-events-none absolute top-1/2 z-10 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[background-color,scale] duration-200"
        :class="atMid ? 'scale-125 bg-background' : 'bg-foreground/25'"
        :style="{ left: `${midPct}%` }"
      />
      <!-- default marker -->
      <span
        v-if="defaultPct !== null && changed"
        class="pointer-events-none absolute top-1/2 z-10 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/35"
        :style="{ left: `${defaultPct}%` }"
      />
      <Slider
        v-model="arr"
        :min="min"
        :max="max"
        :step="step"
        class="group/track h-4 pointer-coarse:h-8"
        track-class="h-[3px] rounded-full bg-well-strong group-hover/track:bg-[color-mix(in_srgb,var(--ink)_16%,transparent)] data-[orientation=horizontal]:h-[3px]"
        range-class="bg-foreground"
        :thumb-class="[thumb, snapping && 'scale-125! duration-90']"
      />
      <!-- snap pulse -->
      <AnimatePresence>
        <motion.span
          v-if="snapping"
          :key="pulse"
          class="pointer-events-none absolute top-1/2 z-20 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/50"
          :style="{ left: `${pct}%` }"
          :initial="{ scale: 1, opacity: 0.7 }"
          :animate="{ scale: 2.6, opacity: 0 }"
          :exit="{ opacity: 0 }"
          :transition="{ duration: 0.38, ease: [0.23, 1, 0.32, 1] }"
        />
      </AnimatePresence>
      <!-- drag tooltip -->
      <AnimatePresence>
        <motion.div
          v-if="dragging"
          key="tip"
          class="pointer-events-none absolute -top-6 -translate-x-1/2 rounded-full bg-foreground px-2 py-0.5 font-mono text-[10.5px] text-background shadow-raise-dark"
          :style="{ left: `${pct}%` }"
          :initial="{ opacity: 0, y: 4, scale: 0.9 }"
          :animate="{ opacity: 1, y: 0, scale: 1 }"
          :exit="{ opacity: 0, y: 4, scale: 0.9 }"
          :transition="{ duration: 0.15 }"
        >
          {{ fmt(modelValue) }}{{ unit ? ` ${unit}` : '' }}
        </motion.div>
      </AnimatePresence>
    </div>
  </div>
</template>
