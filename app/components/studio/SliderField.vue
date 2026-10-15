<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import { Input } from '@/components/ui/input'
import { AnimatePresence, motion } from 'motion-v'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A field slider: one row that is the control. A sunken glass well holds the label and the value;
 * a smoked graphite fill rises behind them to the value, edged by a slim handle. Azure arrives only
 * with the hand (hover, focus, drag), so at rest the panel stays neutral and the stage leads. The whole row drags,
 * by the pointer's travel (never a jump); a click without a drag glides the value there, or opens
 * the number for typing when it lands on the figure.
 */
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
const reduced = useReducedMotion()

const range = computed(() => props.max - props.min)
const changed = computed(
  () => props.defaultValue !== undefined && Math.abs(props.defaultValue - props.modelValue) > 1e-9,
)
// One formatter per `decimals`, not one per call: the spring below formats every frame. No grouping,
// so a typed-over draft never reads "1,000" back as 1.
const nf = computed(() => new Intl.NumberFormat('en-US', { maximumFractionDigits: props.decimals, useGrouping: false }))
const fmt = (v: number) => nf.value.format(v)

// Displayed number springs toward the real value so typed jumps and preset changes roll over.
// While dragging, the exact value shows instead: the figure must track the hand, not trail it.
const shown = useSpringText(() => props.modelValue, fmt, { stiffness: 420, damping: 38 })

const toPct = (v: number) => ((v - props.min) / range.value) * 100
/**
 * While dragging, the fill follows the continuous value under the hand, not the stepped one: a
 * coarse step (a degree of lens is 2% of the row) would otherwise make the fill tick along in jumps.
 * The figure still shows the stepped value, and the fill settles onto it on release.
 */
const live = ref<number | null>(null)
const pct = computed(() => Math.min(100, Math.max(0, toPct(live.value ?? props.modelValue))))
/** Detents: rows with few steps (segments, small integer ranges) show one tick per step. */
const detents = computed(() => {
  const n = Math.round(range.value / props.step)
  return n > 1 && n <= 20 ? Array.from({ length: n - 1 }, (_, i) => ((i + 1) / n) * 100) : []
})
const defaultPct = computed(() => (props.defaultValue === undefined ? null : toPct(props.defaultValue)))
const quantize = (v: number) => +(Math.round((v - props.min) / props.step) * props.step + props.min).toFixed(6)
const clamp = (v: number) => Math.min(props.max, Math.max(props.min, v))
const mid = computed(() => quantize((props.min + props.max) / 2))
const midPct = computed(() => toPct(mid.value))

function set(v: number) {
  if (Number.isNaN(v)) return
  emit('update:modelValue', clamp(v))
}

// --- dragging -------------------------------------------------------------------------------------
// Pulling the pointer away from the row gears the drag down (¼, then ⅒) for fine work, as iOS
// scrubbing does; Alt does the same from anywhere. Past either end the well gives a little, like a
// rubber band, and springs back on release.
const rowEl = useTemplateRef<HTMLElement>('row')
const dragging = ref(false)
/** Glide to the next value (a click, a preset, a reset); never while dragging or stepping by key. */
const glide = ref(true)
const gear = ref(1)
/** How far, in px, the pointer has been pulled past an end: drives the rubber band. */
const over = ref(0)
let raw = 0
let lastX = 0
let width = 1
let touchDrag = false

const GEARS = [
  { at: 0, factor: 1 },
  { at: 36, factor: 0.25 },
  { at: 96, factor: 0.1 },
]
const gearLabel = computed(() => (gear.value === 0.25 ? '¼' : gear.value === 0.1 ? '⅒' : ''))

// Magnetic snap: the midpoint and the default pull the value in within 2.5% of the range, and the
// handle flashes so the catch is felt. Off in a fine gear: precision beats convenience there.
const snapTargets = computed(() => {
  const t = [mid.value]
  if (props.defaultValue !== undefined && Math.abs(props.defaultValue - mid.value) > 1e-9) t.push(props.defaultValue)
  return t
})
const snapping = ref(false)
let held: number | null = null
let pulseTimer: ReturnType<typeof setTimeout> | undefined
function magnet(v: number) {
  if (gear.value < 1) return v
  const win = range.value * 0.025
  for (const t of snapTargets.value) {
    if (Math.abs(v - t) <= win) {
      if (held !== t) {
        held = t
        snapping.value = true
        // A felt click on phones that have a motor; desktops ignore it.
        if (touchDrag) navigator.vibrate?.(8)
        clearTimeout(pulseTimer)
        pulseTimer = setTimeout(() => (snapping.value = false), 320)
      }
      return t
    }
  }
  held = null
  return v
}

function onRowDown(e: PointerEvent) {
  const target = e.target as HTMLElement
  if (!e.isPrimary || e.button !== 0 || !rowEl.value || editing.value || target.closest('[data-no-drag]')) return
  const el = rowEl.value
  const rect = el.getBoundingClientRect()
  width = Math.max(1, rect.width)
  const startX = e.clientX
  raw = props.modelValue
  lastX = startX
  gear.value = 1
  touchDrag = e.pointerType === 'touch'
  let moved = false
  // Pointer speed, smoothed: slow hands get finer steps, like a trackpad's acceleration in reverse.
  let speed = 1
  let lastT = e.timeStamp
  el.focus({ preventScroll: true })
  try {
    el.setPointerCapture(e.pointerId)
  } catch {}

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    // A small dead zone tells a click from a drag.
    if (!moved) {
      if (Math.abs(ev.clientX - startX) < 3) return
      moved = true
      dragging.value = true
      hoverPct.value = null
      lastX = ev.clientX
      lastT = ev.timeStamp
      return
    }
    const dt = Math.max(1, ev.timeStamp - lastT)
    lastT = ev.timeStamp
    speed = speed * 0.75 + (Math.abs(ev.clientX - lastX) / dt) * 0.25
    const r = el.getBoundingClientRect()
    const away = Math.abs(ev.clientY - (r.top + r.height / 2))
    const pulled = GEARS.reduce((f, g) => (away >= g.at ? g.factor : f), 1)
    gear.value = ev.altKey ? Math.min(pulled, 0.1) : pulled
    // In the top gear only: under ~0.05 px/ms the hand is placing, not travelling, so it moves the
    // value at half rate; from ~0.5 px/ms up it is 1:1. Geared down, the gear alone decides.
    const t = Math.min(1, Math.max(0, (speed - 0.05) / 0.45))
    const precision = gear.value === 1 && !touchDrag ? 0.5 + 0.5 * t * t * (3 - 2 * t) : 1
    raw += ((ev.clientX - lastX) / width) * range.value * gear.value * precision
    lastX = ev.clientX
    // Let the raw value run a little past the ends so the band has something to stretch, then
    // hold it there: dragging back in responds at once instead of eating the overshoot first.
    const slack = range.value * 0.12
    raw = Math.min(props.max + slack, Math.max(props.min - slack, raw))
    const past = raw > props.max ? raw - props.max : raw < props.min ? raw - props.min : 0
    over.value = reduced.value ? 0 : (past / range.value) * width
    const v = clamp(magnet(raw))
    live.value = v
    set(quantize(v))
  }
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    if (!moved && ev.type === 'pointerup') {
      // A click: on the figure it opens the field, anywhere else it glides the value there.
      if (target.closest('[data-value]')) startEdit()
      else {
        glide.value = !reduced.value
        set(quantize(props.min + ((ev.clientX - rect.left) / width) * range.value))
      }
    }
    if (over.value !== 0) {
      springBack.value = true
      clearTimeout(springTimer)
      springTimer = setTimeout(() => (springBack.value = false), 440)
    }
    dragging.value = false
    live.value = null
    over.value = 0
    gear.value = 1
    held = null
    if (moved) glide.value = true
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}

/** Rubber band: the overshoot in px, softened so a long pull only gives a few pixels. */
const band = computed(() => Math.sign(over.value) * 8 * (1 - Math.exp(-Math.abs(over.value) / 36)))
/** True for the moment a released band springs home: the one place anything overshoots. */
const springBack = ref(false)
let springTimer: ReturnType<typeof setTimeout> | undefined
/**
 * Steps that repeat fast (keys, wheel) land without a glide; it comes back once they pause, so the
 * next preset or reset still glides.
 */
let quietTimer: ReturnType<typeof setTimeout> | undefined
function quiet() {
  glide.value = false
  clearTimeout(quietTimer)
  quietTimer = setTimeout(() => (glide.value = true), 180)
}
/**
 * One transition for whatever moves with the value: none under the hand, a spring after a band, a
 * glide for clicks and presets. The few hundredths the fill settles by on release ride the glide.
 */
function motionFor(prop: string): string {
  if (reduced.value || dragging.value) return 'none'
  if (springBack.value) return `${prop} 420ms var(--ease-spring)`
  return glide.value ? `${prop} 220ms var(--ease-out)` : 'none'
}

// Hover probe: with a mouse over the row, a hairline marks where a click would glide the value.
const hoverPct = ref<number | null>(null)
function onHover(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || dragging.value || editing.value || !rowEl.value) return
  if ((e.target as HTMLElement).closest('[data-no-drag],[data-value]')) {
    hoverPct.value = null
    return
  }
  const r = rowEl.value.getBoundingClientRect()
  hoverPct.value = toPct(quantize(props.min + ((e.clientX - r.left) / r.width) * range.value))
}

function resetToDefault() {
  if (props.defaultValue === undefined) return
  glide.value = !reduced.value
  set(props.defaultValue)
}

function onRowKey(e: KeyboardEvent) {
  if (editing.value) return
  if (e.key === 'Enter') {
    e.preventDefault()
    startEdit()
    return
  }
  const big = e.shiftKey ? 10 : 1
  const by: Record<string, number> = {
    ArrowRight: props.step * big, ArrowUp: props.step * big, ArrowLeft: -props.step * big, ArrowDown: -props.step * big,
    PageUp: props.step * 10, PageDown: -props.step * 10,
  }
  let next: number | undefined
  if (e.key in by) next = props.modelValue + by[e.key]!
  else if (e.key === 'Home') next = props.min
  else if (e.key === 'End') next = props.max
  if (next === undefined) return
  e.preventDefault()
  // Keys repeat dozens of times a second: the value steps without a glide.
  quiet()
  set(quantize(next))
}

// --- typed value ----------------------------------------------------------------------------------
const editing = ref(false)
const draft = ref('')
function startEdit() {
  draft.value = fmt(props.modelValue)
  editing.value = true
  nextTick(() => {
    const input = rowEl.value?.querySelector<HTMLInputElement>('[data-value-input]')
    input?.focus()
    input?.select()
  })
}
function commit(e: Event) {
  if (!editing.value) return
  editing.value = false
  glide.value = !reduced.value
  set(parseFloat((e.target as HTMLInputElement).value.replace(',', '.')))
  rowEl.value?.focus({ preventScroll: true })
}
function cancel() {
  editing.value = false
  rowEl.value?.focus({ preventScroll: true })
}
function onWheel(e: WheelEvent) {
  // Only a hovered, focused row takes the wheel: scrolling the panel past it must still scroll.
  if (document.activeElement !== rowEl.value) return
  e.preventDefault()
  quiet()
  set(+(props.modelValue + (e.deltaY < 0 ? props.step : -props.step)).toFixed(6))
}

// The handle steps aside for the text: crossing the label (with its marks) or the figure it fades out (the fill's
// crisp blue edge still marks the value), so a low or high value never strikes through a word.
const labelEl = useTemplateRef<HTMLElement>('labelText')
const valueEl = useTemplateRef<HTMLElement>('valueText')
const textZones = ref<[number, number][]>([])
function measureText() {
  const row = rowEl.value?.getBoundingClientRect()
  if (!row?.width) return
  textZones.value = [labelEl.value, valueEl.value].filter(Boolean).map((el) => {
    const r = el!.getBoundingClientRect()
    return [((r.left - row.left - 4) / row.width) * 100, ((r.right - row.left + 4) / row.width) * 100]
  })
}
useResizeObserver(rowEl, measureText)
// The reset mark comes and goes (it hides while dragging): measure again once its 100ms fade is done.
watch(() => [props.label, editing.value, changed.value, dragging.value], () => setTimeout(measureText, 130))
/** The default's notch would read as an underscore beneath a word: leave it out there. */
const notchUnderText = computed(() => defaultPct.value !== null && textZones.value.some(([a, b]) => defaultPct.value! > a && defaultPct.value! < b))
const handleHidden = computed(() => pct.value < 3 || textZones.value.some(([a, b]) => pct.value > a && pct.value < b))
</script>

<template>
  <div
    ref="row"
    role="slider"
    tabindex="0"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    :aria-valuetext="`${fmt(modelValue)}${unit ? ` ${unit}` : ''}`"
    :data-active="dragging || undefined"
    :data-snap="snapping || undefined"
    class="group/row relative isolate flex h-8 cursor-ew-resize touch-pan-y items-center rounded-[10px] outline-none select-none pointer-coarse:h-10"
    @pointerdown="onRowDown"
    @keydown="onRowKey"
    @dblclick="(e) => !(e.target as HTMLElement).closest('[data-no-drag],[data-value]') && resetToDefault()"
    @wheel="onWheel"
    @pointermove="onHover"
    @pointerleave="hoverPct = null"
  >
    <!-- The well, and the fill inside it. Only this layer stretches with the rubber band, so the
         text above never scales. -->
    <div
      class="field absolute inset-0 -z-10 overflow-hidden rounded-[10px] group-hover/row:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] group-focus-visible/row:shadow-[inset_0_0_0_0.5px_rgba(38,40,46,.1),inset_0_1px_2px_rgba(38,40,46,.07),0_0_0_3px_var(--lamp-glow)] group-data-active/row:shadow-[inset_0_0_0_0.5px_rgba(38,40,46,.1),inset_0_1px_2px_rgba(38,40,46,.07),0_0_0_3px_var(--lamp-soft)]"
      :style="{
        scale: `${1 + Math.abs(band) / Math.max(width, 1)} 1`,
        transformOrigin: band > 0 ? 'left' : 'right',
        transition: `background-color 150ms ease, box-shadow 150ms ease, ${springBack ? 'scale 420ms var(--ease-spring)' : 'scale 0s'}`,
      }"
    >
      <!-- The fill: smoked graphite at rest, a translucent tint with a white catch along its top and a
           crisp edge. Under the hand it crossfades to smoked azure (gradients cannot transition, so
           the azure is a second layer), deepens while held and flashes brighter on a snap. -->
      <div
        class="absolute inset-y-0 left-0 w-full origin-left"
        :style="{ scale: `${pct / 100} 1`, transition: motionFor('scale') }"
      >
        <div class="absolute inset-0 bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--ink)_11%,transparent),color-mix(in_srgb,var(--ink)_8%,transparent))] shadow-[inset_0_1px_0_rgba(255,255,255,.55),inset_-1px_0_0_color-mix(in_srgb,var(--ink)_26%,transparent)]" />
        <div class="absolute inset-0 bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--lamp)_30%,transparent),color-mix(in_srgb,var(--lamp)_22%,transparent))] opacity-0 shadow-[inset_0_1px_0_rgba(255,255,255,.5),inset_-1px_0_0_color-mix(in_srgb,var(--lamp)_60%,transparent)] transition-[opacity,filter] duration-150 ease-[ease] group-hover/row:opacity-100 group-focus-visible/row:opacity-100 group-data-active/row:bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--lamp)_40%,transparent),color-mix(in_srgb,var(--lamp)_30%,transparent))] group-data-active/row:opacity-100 group-data-snap/row:brightness-[1.12]" />
      </div>
      <!-- detents, for rows with few steps: dark in the empty well, white over the fill -->
      <span
        v-for="d in detents"
        :key="d"
        class="absolute bottom-1 size-[3px] -translate-x-1/2 rounded-full transition-colors duration-100"
        :class="d <= pct ? 'bg-white/80' : 'bg-foreground/22'"
        :style="{ left: `${d}%` }"
      />
      <!-- midpoint: a hairline, only in the empty part of the well -->
      <span
        v-if="!detents.length"
        class="absolute inset-y-2.5 w-px -translate-x-1/2 rounded-full bg-foreground/18 transition-opacity duration-150"
        :class="pct >= midPct ? 'opacity-0' : 'opacity-100'"
        :style="{ left: `${midPct}%` }"
      />
      <!-- default: a dot on the floor of the well, once the value has moved off it (never under text) -->
      <span
        v-if="defaultPct !== null && changed && !notchUnderText"
        class="absolute bottom-[3px] size-[3px] -translate-x-1/2 rounded-full bg-foreground/40"
        :style="{ left: `${defaultPct}%` }"
      />
    </div>

    <!-- Hover probe: where a click would glide the value. Hidden while dragging and over the text. -->
    <span
      class="pointer-events-none absolute top-1/2 -z-10 h-4 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-lamp/55 transition-opacity duration-150 ease-[ease]"
      :class="hoverPct === null || dragging ? 'opacity-0' : 'opacity-100'"
      :style="{ left: `${hoverPct ?? 0}%` }"
    />

    <!-- Handle: a slim graphite bar riding the fill's edge, ringed in white so it reads on any fill.
         It turns azure and grows on hover and press, and stretches full height for a beat on a snap. -->
    <div
      class="pointer-events-none absolute inset-y-0 left-0 -z-10 w-full"
      :style="{ transform: `translateX(calc(${pct}% + ${band}px))`, transition: motionFor('transform') }"
    >
      <span
        class="absolute top-1/2 left-0 -mt-3 h-6 w-[3px] -translate-x-[calc(100%+2.5px)] scale-y-[.62] rounded-full bg-ink-2 shadow-[0_0_0_1px_rgba(255,255,255,.85),0_1px_2px_rgba(20,24,32,.2)] transition-[scale,opacity,box-shadow,background-color] duration-200 ease-[var(--ease-out)] group-hover/row:scale-y-[.76] group-hover/row:bg-lamp group-focus-visible/row:bg-lamp group-data-active/row:bg-lamp group-data-active/row:scale-y-[.86] group-data-active/row:shadow-[0_0_0_1px_rgba(255,255,255,.9),0_0_12px_var(--lamp-glow)] group-data-snap/row:scale-y-100! group-data-snap/row:duration-90 motion-reduce:transition-none"
        :class="handleHidden && 'opacity-0'"
      />
    </div>

    <!-- Label, hint and reset on the left. -->
    <span
      ref="labelText"
      class="flex min-w-0 items-center gap-1.5 pl-3 text-[13px] text-ink-2 transition-colors duration-150 ease-[ease] group-hover/row:text-foreground group-data-active/row:text-foreground"
    >
      <span class="truncate">{{ label }}</span>
      <Tooltip v-if="hint">
        <TooltipTrigger as-child>
          <span
            data-no-drag
            class="flex cursor-help text-muted-foreground opacity-0 transition-[opacity,color] duration-150 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 hover:text-foreground focus-visible:opacity-100 pointer-coarse:opacity-100"
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
          v-if="changed && !dragging"
          key="reset"
          type="button"
          data-no-drag
          class="flex cursor-pointer text-muted-foreground transition-[color,scale] duration-150 ease-out hover:text-lamp-ink active:scale-[.85]"
          :initial="{ opacity: 0, transform: 'scale(0.9)' }"
          :animate="{ opacity: 1, transform: 'scale(1)' }"
          :exit="{ opacity: 0, transform: 'scale(0.9)', transition: { duration: 0.1, ease: EASE_OUT } }"
          :transition="{ duration: 0.15, ease: EASE_OUT }"
          title="Reset to default"
          aria-label="Reset to default"
          @click="resetToDefault"
        >
          <Icon
            name="reset"
            :size="11"
          />
        </motion.button>
      </AnimatePresence>
    </span>

    <!-- Value on the right: the gear chip while geared down, then the figure (or its field). -->
    <span class="ml-auto flex items-center gap-1.5 pr-1.5 pl-2">
      <AnimatePresence>
        <motion.span
          v-if="gearLabel"
          key="gear"
          class="rounded-full bg-lamp px-1.5 text-[11px] leading-4 font-medium text-white tabular-nums"
          :initial="{ opacity: 0, transform: 'scale(0.9)' }"
          :animate="{ opacity: 1, transform: 'scale(1)' }"
          :exit="{ opacity: 0, transform: 'scale(0.9)', transition: { duration: 0.1, ease: EASE_OUT } }"
          :transition="{ duration: 0.15, ease: EASE_OUT }"
        >
          {{ gearLabel }}
        </motion.span>
      </AnimatePresence>
      <span
        ref="valueText"
        data-value
        class="flex h-6 cursor-text items-center gap-0.5 rounded-[7px] px-1.5 transition-[background-color,box-shadow] duration-150 ease-[ease]"
        :class="editing ? 'bg-card shadow-raise' : 'hover:bg-card/70'"
      >
        <Input
          v-if="editing"
          :model-value="draft"
          data-value-input
          data-no-drag
          class="h-5 w-12 rounded-none border-0 bg-transparent p-0 text-right text-[13px] font-medium tabular-nums shadow-none focus-visible:ring-0 md:text-[13px]"
          inputmode="decimal"
          @update:model-value="draft = String($event)"
          @blur="commit"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          @keydown.esc.prevent="cancel"
        />
        <span
          v-else
          class="min-w-7 text-right text-[13px] font-medium tabular-nums transition-colors duration-150 ease-[ease]"
          :class="dragging ? 'text-lamp-ink' : 'text-foreground'"
        >
          {{ dragging ? fmt(modelValue) : shown }}
        </span>
        <span
          v-if="unit"
          class="text-[12px] text-muted-foreground"
          :class="{ '-ml-0.5': unit === '°' }"
        >{{ unit }}</span>
      </span>
    </span>
  </div>
</template>
