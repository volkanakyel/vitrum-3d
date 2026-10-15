import type { Directive } from 'vue'

/**
 * `v-glass`: the specular sheen of a `.glass` surface follows the pointer. Writes --glass-x/--glass-y
 * (registered properties, so the sheen eases after the pointer) and puts the light back on the
 * top-left edge when the pointer leaves. Fine pointers only; touch keeps the resting highlight.
 */
type GlassEl = HTMLElement & { __glass?: () => void }

const glass: Directive<GlassEl> = {
  mounted(el) {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let frame = 0
    let x = 0
    let y = 0
    const paint = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      el.style.setProperty('--glass-x', `${((x - r.left) / r.width) * 100}%`)
      el.style.setProperty('--glass-y', `${((y - r.top) / r.height) * 100}%`)
    }
    const move = (e: PointerEvent) => {
      x = e.clientX
      y = e.clientY
      if (!frame) frame = requestAnimationFrame(paint)
    }
    const leave = () => {
      cancelAnimationFrame(frame)
      frame = 0
      el.style.removeProperty('--glass-x')
      el.style.removeProperty('--glass-y')
    }
    el.addEventListener('pointermove', move, { passive: true })
    el.addEventListener('pointerleave', leave)
    el.__glass = () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  },
  unmounted(el) {
    el.__glass?.()
  },
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('glass', glass)
})
