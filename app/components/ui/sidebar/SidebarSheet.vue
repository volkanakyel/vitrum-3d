<script setup lang="ts">
import { useEventListener, useResizeObserver, useWindowSize } from '@vueuse/core'
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
// Studio-only component: the last input being a key (Escape, ⌘B) means the sheet lands at once.
const { keyed } = useStudioContext()
const reduced = useReducedMotion()
const { height: vh } = useWindowSize()

const root = ref<HTMLElement | null>(null)
const peekEnd = ref<HTMLElement | null>(null)
let anim: { stop: () => void } | null = null

function target(s: SheetSnap) {
  return s === 'peek' ? peek.value : s === 'half' ? half.value : full.value
}

function go(s: SheetSnap, velocity = 0, delay = 0, instant = false) {
  snap.value = s
  anim?.stop()
  const to = target(s)
  if (reduced.value || instant) {
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
    // The resting sheet ends with the header that holds the tabs, padding (and safe area) included.
    const end = peekEnd.value.closest<HTMLElement>('[data-slot=sidebar-header]') ?? peekEnd.value
    peek.value = Math.round(end.getBoundingClientRect().bottom - el.getBoundingClientRect().top)
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
  if (!drag && !touch) {
    measure()
    go(snap.value)
  }
})
watch(vh, () => {
  measure()
  if (!drag && !touch) go(snap.value)
})

// Keep the sidebar's open state in step, both ways.
watch(snap, (s) => setOpenMobile(s !== 'peek'))
watch(openMobile, (o) => {
  if (o && snap.value === 'peek') go('half', 0, 0, keyed.value)
  else if (!o && snap.value !== 'peek') go('peek', 0, 0, keyed.value)
})

// ─── Drag ────────────────────────────────────────────────────────────────────────────────────
// Two ways in, one gesture. Pointer drags start on anything marked `data-sheet-grip` (the grip,
// the resting row, the tabs). Touch drags may also start on the settings themselves, the way a
// native sheet behaves: a swipe up grows the sheet until it is full, and only then scrolls; a swipe
// down on settings already scrolled to the top shrinks it. Anything that owns its own drag (a
// slider, an input, a sideways strip) is left alone.
type Drag = { y0: number; h0: number; live: boolean; samples: { y: number; t: number }[] }
let drag: (Drag & { id: number }) | null = null
let touch: (Drag & { id: number; x0: number; scroller: HTMLElement | null; decided: boolean }) | null = null
/** Set when a drag ends, so the click that follows the release doesn't also press a tab. */
let swallowClick = false

/** Past either end the sheet follows the finger at a falling rate, like pulling on elastic. */
function rubber(over: number) {
  return (1 - 1 / (over / 180 + 1)) * 180
}

function follow(d: Drag, y: number, t: number) {
  d.samples.push({ y, t })
  if (d.samples.length > 6) d.samples.shift()
  let h = d.h0 - (y - d.y0)
  if (h > full.value) h = full.value + rubber(h - full.value)
  else if (h < peek.value) h = peek.value - rubber(peek.value - h) * 0.5
  height.set(h)
}

function release(d: Drag, t: number) {
  swallowClick = true
  const a = d.samples[0]!
  const b = d.samples.at(-1)!
  const dt = Math.max(b.t - a.t, 1)
  // px/s, positive = growing. A finger that stopped before lifting carries no fling.
  const velocity = t - b.t > 80 ? 0 : (-(b.y - a.y) / dt) * 1000
  const projected = height.get() + velocity * 0.16
  const snaps: SheetSnap[] = ['peek', 'half', 'full']
  const next = snaps.reduce((best, s) =>
    Math.abs(target(s) - projected) < Math.abs(target(best) - projected) ? s : best,
  )
  if (next !== snap.value) navigator.vibrate?.(6)
  go(next, velocity)
}

function onDown(e: PointerEvent) {
  // A second finger mid-drag is ignored: switching fingers must not make the sheet jump. (A drag
  // that never went live may have lost its pointerup outside the sheet, so it can be replaced.)
  if (drag?.live || touch?.live) return
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
  follow(drag, e.clientY, e.timeStamp)
}

function onUp(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return
  const d = drag
  drag = null
  if (d.live) release(d, e.timeStamp)
}

/** Elements that own their own drag: a swipe that starts on one is never the sheet's. */
const OWN_DRAG = '[data-sheet-grip],[role=slider],[data-slot^=slider],input,textarea,select,[data-sheet-nodrag]'

function onTouchStart(e: TouchEvent) {
  if (touch || drag?.live || e.touches.length !== 1) return
  const el = e.target as Element
  if (el.closest(OWN_DRAG)) return
  const t = e.touches[0]!
  touch = {
    id: t.identifier, x0: t.clientX, y0: t.clientY, h0: height.get(), live: false, decided: false,
    scroller: el.closest<HTMLElement>('[data-slot=scroll-area-viewport]'),
    samples: [{ y: t.clientY, t: e.timeStamp }],
  }
}

function onTouchMove(e: TouchEvent) {
  if (!touch) return
  const t = Array.from(e.changedTouches).find(c => c.identifier === touch!.id)
  if (!t) return
  const dx = t.clientX - touch.x0
  const dy = t.clientY - touch.y0
  if (!touch.decided) {
    // Decided on the very first move: the browser commits to a scroll on that move, and after it
    // the gesture can no longer be taken from it.
    if (!dx && !dy) return
    touch.decided = true
    const vertical = Math.abs(dy) > Math.abs(dx)
    const atTop = !touch.scroller || touch.scroller.scrollTop <= 0
    // Up while there is room to grow, or down from the top of the settings: the sheet moves.
    touch.live = vertical && ((dy < 0 && snap.value !== 'full') || (dy > 0 && atTop))
    if (!touch.live) {
      touch = null
      return
    }
    anim?.stop()
    touch.y0 = t.clientY
    touch.h0 = height.get()
  }
  // Holding the page still while the sheet follows the finger: this listener is the only
  // non-passive one, and it only cancels once the sheet owns the gesture.
  if (e.cancelable) e.preventDefault()
  follow(touch, t.clientY, e.timeStamp)
}

function onTouchEnd(e: TouchEvent) {
  if (!touch) return
  if (!Array.from(e.changedTouches).some(c => c.identifier === touch!.id)) return
  const d = touch
  touch = null
  if (d.live) release(d, e.timeStamp)
}

useEventListener(root, 'touchstart', onTouchStart, { passive: true })
useEventListener(root, 'touchmove', onTouchMove, { passive: false })
useEventListener(root, 'touchend', onTouchEnd, { passive: true })
useEventListener(root, 'touchcancel', onTouchEnd, { passive: true })

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
  // Keyboard-initiated: lands at once, no spring.
  if (e.key === 'Escape' && snap.value !== 'peek') go('peek', 0, 0, true)
})
</script>

<template>
  <!-- Floats 6px inside the stage pane it sits on, with corners concentric to the pane's (38 - 6),
       frosted so the model still reads through the top of the sheet as it rises. The bottom edge
       sits over the home indicator, like a native sheet; the header pads its content clear. -->
  <section
    ref="root"
    data-sidebar="sidebar"
    data-slot="sidebar"
    data-mobile="true"
    :data-snap="snap"
    role="region"
    aria-label="Controls"
    class="glass fixed inset-x-3 bottom-3 z-30 flex flex-col overflow-hidden rounded-[32px] overscroll-contain text-sidebar-foreground [--glass-blur:28px] [--glass-drop:0_1px_2px_rgba(38,40,46,.06),0_-10px_40px_-14px_rgba(38,40,46,.28)] [--glass-tint-top:rgba(248,249,251,.94)] [--glass-tint:rgba(236,238,242,.96)]"
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
      class="group/grip mx-auto flex h-5 w-32 shrink-0 cursor-grab touch-none items-center justify-center outline-none active:cursor-grabbing"
      :aria-label="snap === 'peek' ? 'Expand controls' : 'Collapse controls'"
      :aria-expanded="snap !== 'peek'"
      @click="toggle"
    >
      <!-- Stretches on press with `scale`, not `width`: no layout per frame. 44 / 36 = 1.22. -->
      <span class="h-[5px] w-9 rounded-full bg-foreground/15 transition-[scale,background-color] duration-200 ease-out group-active/grip:bg-foreground/30 group-focus-visible/grip:bg-lamp motion-safe:group-active/grip:scale-x-[1.22]" />
    </button>
    <div class="flex min-h-0 w-full flex-1 flex-col">
      <slot />
    </div>
  </section>
</template>
