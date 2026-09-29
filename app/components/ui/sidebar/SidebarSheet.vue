<script setup lang="ts">
import { useEventListener, usePreferredReducedMotion, useResizeObserver, useWindowSize } from '@vueuse/core'
import { animate } from 'motion-v'
import type { SheetSnap } from '~/composables/useStudioSheet'
import { useSidebar } from './utils'

/**
 * The phone controls: a sheet that never leaves. It rests at `peek` (grip, finishes and tabs) so
 * the model keeps the screen, rises to `half` to tune with the model still in view above, and to
 * `full` for long sections. There is no overlay: the stage stays live at every height, so turning
 * the model and moving a slider are one gesture apart, never a close-and-reopen.
 *
 * Drag starts on anything marked `data-sheet-grip` (the handle, the finish row, the tabs). The
 * release projects the flick velocity forward and springs to the nearest snap, keeping the flick's
 * speed, so a short fast swipe travels as far as a long slow one. `openMobile` mirrors the sheet
 * (open = above peek), so the stage's panel button and ⌘B still work.
 */
defineOptions({ inheritAttrs: false })

const { openMobile, setOpenMobile } = useSidebar()
const { height, peek, half, full, inset, snap } = useStudioSheet()
const reduced = usePreferredReducedMotion()
const { height: vh } = useWindowSize()

const root = ref<HTMLElement | null>(null)
const peekEnd = ref<HTMLElement | null>(null)
let anim: { stop: () => void } | null = null

function target(s: SheetSnap) {
  return s === 'peek' ? peek.value : s === 'half' ? half.value : full.value
}

function go(s: SheetSnap, velocity = 0, delay = 0) {
  snap.value = s
  anim?.stop()
  const to = target(s)
  if (reduced.value === 'reduce') {
    height.set(to)
    return
  }
  // Critically damped enough not to wobble at rest, loose enough that a flick carries through.
  anim = animate(height, to, { type: 'spring', stiffness: 420, damping: 42, mass: 1, velocity, delay })
}

function measure() {
  const el = root.value
  if (!el) return
  inset.value = Number.parseFloat(getComputedStyle(el).bottom) || 0
  peekEnd.value = el.querySelector<HTMLElement>('[data-sheet-peek]')
  if (peekEnd.value) {
    peek.value = Math.round(peekEnd.value.getBoundingClientRect().bottom - el.getBoundingClientRect().top + 14)
  }
  full.value = Math.round(vh.value - inset.value - 60)
  half.value = Math.min(full.value, Math.max(peek.value + 180, Math.round(vh.value * 0.52 - inset.value)))
}

// Written straight to the element: the sheet moves every frame of a drag without a Vue render.
const unsubscribe = height.on('change', (h) => {
  if (root.value) root.value.style.height = `${h}px`
})

onMounted(() => {
  measure()
  // Rises into place just after the stage, the same beat as the view dock on desktop.
  go('peek', 0, 0.12)
})
onBeforeUnmount(() => {
  unsubscribe()
  anim?.stop()
  height.set(0)
  peek.value = 0
})
useResizeObserver(peekEnd, () => {
  if (!drag) {
    measure()
    go(snap.value)
  }
})
watch(vh, () => {
  measure()
  if (!drag) go(snap.value)
})

// Keep the sidebar's open state in step, both ways.
watch(snap, (s) => setOpenMobile(s !== 'peek'))
watch(openMobile, (o) => {
  if (o && snap.value === 'peek') go('half')
  else if (!o && snap.value !== 'peek') go('peek')
})

// ─── Drag ────────────────────────────────────────────────────────────────────────────────────
type Drag = { id: number; y0: number; h0: number; live: boolean; samples: { y: number; t: number }[] }
let drag: Drag | null = null
/** Set when a drag ends, so the click that follows the release doesn't also press a tab. */
let swallowClick = false

/** Past either end the sheet follows the finger at a falling rate, like pulling on elastic. */
function rubber(over: number) {
  return (1 - 1 / (over / 180 + 1)) * 180
}

function onDown(e: PointerEvent) {
  swallowClick = false
  if (e.button !== 0 || !(e.target as Element).closest('[data-sheet-grip]')) return
  drag = { id: e.pointerId, y0: e.clientY, h0: height.get(), live: false, samples: [{ y: e.clientY, t: e.timeStamp }] }
}

function onMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return
  const dy = e.clientY - drag.y0
  if (!drag.live) {
    // A tap or a sideways scroll of the finish row stays what it is until the finger commits.
    if (Math.abs(dy) < 6) return
    drag.live = true
    anim?.stop()
    drag.h0 = height.get() + Math.sign(dy) * 6
    root.value?.setPointerCapture(e.pointerId)
  }
  drag.samples.push({ y: e.clientY, t: e.timeStamp })
  if (drag.samples.length > 6) drag.samples.shift()
  let h = drag.h0 - dy
  if (h > full.value) h = full.value + rubber(h - full.value)
  else if (h < peek.value) h = peek.value - rubber(peek.value - h) * 0.5
  height.set(h)
}

function onUp(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return
  const d = drag
  drag = null
  if (!d.live) return
  swallowClick = true
  const a = d.samples[0]!
  const b = d.samples.at(-1)!
  const dt = Math.max(b.t - a.t, 1)
  // px/s, positive = growing. A finger that stopped before lifting carries no fling.
  const velocity = e.timeStamp - b.t > 80 ? 0 : (-(b.y - a.y) / dt) * 1000
  const projected = height.get() + velocity * 0.16
  const snaps: SheetSnap[] = ['peek', 'half', 'full']
  const next = snaps.reduce((best, s) =>
    Math.abs(target(s) - projected) < Math.abs(target(best) - projected) ? s : best,
  )
  if (next !== snap.value) navigator.vibrate?.(6)
  go(next, velocity)
}

function onClickCapture(e: MouseEvent) {
  if (!swallowClick) return
  swallowClick = false
  e.preventDefault()
  e.stopPropagation()
}

function toggle() {
  go(snap.value === 'peek' ? 'half' : 'peek')
}

useEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && snap.value !== 'peek') go('peek')
})
</script>

<template>
  <!-- Floats inset from the screen edges like the stage pane it sits on, frosted so the model
       still reads through the top of the sheet as it rises. -->
  <section
    ref="root"
    data-sidebar="sidebar"
    data-slot="sidebar"
    data-mobile="true"
    :data-snap="snap"
    role="region"
    aria-label="Controls"
    class="glass fixed inset-x-1.5 bottom-[max(6px,env(safe-area-inset-bottom))] z-30 flex flex-col overflow-hidden rounded-[26px] text-sidebar-foreground [--glass-blur:28px] [--glass-drop:0_1px_2px_rgba(13,14,18,.06),0_-10px_40px_-14px_rgba(13,14,18,.28)] [--glass-tint-top:rgba(248,249,251,.94)] [--glass-tint:rgba(236,238,242,.96)]"
    :style="{ height: `${height.get()}px` }"
    v-bind="$attrs"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @click.capture="onClickCapture"
  >
    <button
      type="button"
      data-sheet-grip
      class="group/grip mx-auto flex h-[22px] w-24 shrink-0 cursor-grab touch-none items-center justify-center outline-none active:cursor-grabbing"
      :aria-label="snap === 'peek' ? 'Expand controls' : 'Collapse controls'"
      :aria-expanded="snap !== 'peek'"
      @click="toggle"
    >
      <span class="h-[5px] w-9 rounded-full bg-foreground/15 transition-[width,background-color] duration-200 ease-out group-active/grip:w-11 group-active/grip:bg-foreground/30 group-focus-visible/grip:bg-ice motion-reduce:transition-none" />
    </button>
    <div class="flex min-h-0 w-full flex-1 flex-col">
      <slot />
    </div>
  </section>
</template>
