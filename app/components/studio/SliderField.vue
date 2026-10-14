<script setup lang="ts">
import { Input } from '@/components/ui/input'
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
// One formatter per `decimals`, not one per call: the spring below formats every frame. No grouping,
// so a typed-over draft never reads "1,000" back as 1.
const nf = computed(() => new Intl.NumberFormat('en-US', { maximumFractionDigits: props.decimals, useGrouping: false }))
const fmt = (v: number) => nf.value.format(v)

// Displayed number springs toward the real value so typed jumps and preset changes roll over.
// While dragging, the exact value shows instead: the figure must track the thumb, not trail it.
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
  // The span is swapped for the field on this tick; select the field's text once it exists.
  const label = (e.target as HTMLElement).closest('label')
  nextTick(() => label?.querySelector('input')?.select())
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
// Only scale and shadow transition: reka positions the thumb with `left`, which stays untransitioned
// so the thumb tracks the pointer 1:1 while dragging.
const thumb = [
  'size-4 rounded-full border-0 bg-card transition-[scale,box-shadow] duration-[250ms,150ms] ease-[var(--ease-spring),ease] motion-reduce:transition-none pointer-coarse:size-5',
  // A white bead: hairline edge, a tight contact shadow and a soft fall-off below it.
  'shadow-[0_0_0_0.5px_rgba(38,40,46,.2),0_1px_2px_rgba(38,40,46,.16),0_3px_8px_-2px_rgba(38,40,46,.16),inset_0_-1px_0_rgba(38,40,46,.04)]',
  'hover:scale-110 hover:ring-0 hover:shadow-[0_0_0_0.5px_rgba(38,40,46,.2),0_0_0_5px_var(--well),0_1px_2px_rgba(38,40,46,.16),0_4px_10px_-2px_rgba(38,40,46,.2)]',
  'focus-visible:scale-110 focus-visible:ring-0 focus-visible:shadow-[0_0_0_0.5px_rgba(38,40,46,.2),0_0_0_5px_var(--lamp-glow),0_1px_2px_rgba(38,40,46,.16),0_4px_10px_-2px_rgba(38,40,46,.2)]',
  'active:scale-95',
]
</script>

<template>
  <div class="group/slider flex flex-col gap-2">
    <div class="flex h-5 items-center justify-between">
      <span class="flex items-center gap-1.5 text-[13.5px] text-ink-2">
        {{ label }}
        <Tooltip v-if="hint">
          <TooltipTrigger as-child>
            <span
              class="flex cursor-help text-muted-foreground transition-colors hover:text-foreground"
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
          <!-- Press squash on the CSS `scale` property; motion owns `transform` and `opacity`. -->
          <motion.button
            v-if="changed"
            key="reset"
            type="button"
            class="flex text-muted-foreground transition-[color,scale] duration-150 ease-out hover:text-foreground active:scale-[.85]"
            :initial="{ opacity: 0, transform: 'scale(0.9)' }"
            :animate="{ opacity: 1, transform: 'scale(1)' }"
            :exit="{ opacity: 0, transform: 'scale(0.9)', transition: { duration: 0.1, ease: EASE_OUT } }"
            :transition="{ duration: 0.15, ease: EASE_OUT }"
            title="Reset to default"
            aria-label="Reset to default"
            @click="set(defaultValue!)"
          >
            <Icon
              name="reset"
              :size="11"
            />
          </motion.button>
        </AnimatePresence>
      </span>

      <!-- Inline value: plain figures at rest; focus turns it into a small raised field. -->
      <label
        class="-mr-1.5 flex h-6 items-center gap-1 rounded-[8px] px-1.5 transition-[background-color,box-shadow] duration-150"
        :class="
          editing
            ? 'bg-card shadow-raise'
            : 'hover:bg-well focus-within:bg-card focus-within:shadow-raise'
        "
      >
        <Input
          v-if="editing"
          :model-value="draft"
          @update:model-value="draft = String($event)"
          class="h-5 w-12 rounded-none border-0 bg-transparent p-0 text-right text-[13px] font-medium tabular-nums shadow-none focus-visible:ring-0 md:text-[13px]"
          inputmode="decimal"
          autofocus
          @blur="commit"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
          @keydown.esc="editing = false"
        />
        <span
          v-else
          class="min-w-8 cursor-text text-right text-[13px] font-medium tabular-nums outline-none select-none"
          :class="changed ? 'text-foreground' : 'text-ink-2'"
          tabindex="0"
          @focus="focus"
          @wheel="onWheel"
          @keydown="onKey"
        >
          {{ dragging ? fmt(modelValue) : shown }}
        </span>
        <span
          v-if="unit"
          class="text-[12.5px] text-muted-foreground"
          :class="{ '-ml-1': unit === '°' }"
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
        track-class="rounded-full bg-well-strong shadow-[inset_0_1px_1px_rgba(38,40,46,.08)] transition-colors duration-150 group-hover/track:bg-[color-mix(in_srgb,var(--ink)_14%,transparent)] data-[orientation=horizontal]:h-1"
        range-class="rounded-full bg-lamp shadow-[inset_0_1px_0_rgba(255,255,255,.22)]"
        :thumb-label="label"
        :thumb-class="[thumb, snapping && 'scale-125! duration-90']"
      />
      <!-- snap pulse -->
      <AnimatePresence>
        <motion.span
          v-if="snapping"
          :key="pulse"
          class="pointer-events-none absolute top-1/2 z-20 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-lamp/60"
          :style="{ left: `${pct}%` }"
          :initial="{ transform: 'scale(1)', opacity: 0.7 }"
          :animate="{ transform: 'scale(2.6)', opacity: 0 }"
          :exit="{ opacity: 0 }"
          :transition="{ duration: 0.38, ease: EASE_OUT }"
        />
      </AnimatePresence>
      <!-- drag tooltip -->
      <AnimatePresence>
        <motion.div
          v-if="dragging"
          key="tip"
          class="pointer-events-none absolute -top-6 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[12px] font-medium text-primary-foreground tabular-nums shadow-raise-dark"
          :style="{ left: `${pct}%` }"
          :initial="{ opacity: 0, transform: 'translateY(4px) scale(0.9)' }"
          :animate="{ opacity: 1, transform: 'translateY(0px) scale(1)' }"
          :exit="{ opacity: 0, transform: 'translateY(4px) scale(0.9)', transition: { duration: 0.1, ease: EASE_OUT } }"
          :transition="{ duration: 0.15, ease: EASE_OUT }"
        >
          {{ fmt(modelValue) }}{{ unit ? ` ${unit}` : '' }}
        </motion.div>
      </AnimatePresence>
    </div>
  </div>
</template>
