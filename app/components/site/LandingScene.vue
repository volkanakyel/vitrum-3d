<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import type { Showcase } from '~/utils/showcase'

const props = withDefaults(defineProps<{ preset: string; paused?: boolean; clear?: number }>(), { paused: false, clear: 0 })
const emit = defineEmits<{ ready: []; unavailable: [] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const ready = ref(false)
let scene: Showcase | null = null
let disposed = false
let cleanup = () => {}

watch(() => props.preset, value => scene?.setPreset(value))
watch(() => props.paused, value => scene?.setPaused(value))
watch(() => props.clear, value => scene?.setHeroClear(value))

// The objects follow the cursor anywhere over the hero, not only over the canvas: from the
// headline above, they already turn up toward it. Below the stage they ease back to idle.
const REACH_ABOVE = 640
function onPointer(event: PointerEvent) {
  if (!canvas.value || event.pointerType === 'touch') return
  const rect = canvas.value.getBoundingClientRect()
  const inside = event.clientY > rect.top - REACH_ABOVE && event.clientY < rect.bottom + 40
  // Clamped to a little above the canvas so a cursor up on the headline tilts the objects, not flips them.
  const y = Math.max(-rect.height * 0.3, event.clientY - rect.top)
  scene?.setPointer(event.clientX - rect.left, y, inside)
}

function onPointerLeave() { scene?.setPointer(0, 0, false) }

useEventListener(window, 'pointermove', onPointer, { passive: true })
useEventListener(document, 'pointerleave', onPointerLeave)

onMounted(async () => {
  try {
    const { Showcase } = await import('~/utils/showcase')
    if (disposed || !canvas.value) return
    scene = new Showcase(canvas.value, { layout: 'hero', narrow: false, preset: props.preset })
    scene.setPaused(props.paused)
    scene.setHeroClear(props.clear)
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotion = () => scene?.setReducedMotion(motion.matches)
    let intersecting = true
    const updateVisibility = () => scene?.setVisible(intersecting && document.visibilityState === 'visible')
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false
      updateVisibility()
    })
    observer.observe(canvas.value)
    const resize = new ResizeObserver(() => scene?.resize())
    resize.observe(canvas.value)
    motion.addEventListener('change', onMotion)
    document.addEventListener('visibilitychange', updateVisibility)
    const onContextLost = (event: Event) => {
      event.preventDefault()
      ready.value = false
      scene?.setVisible(false)
      emit('unavailable')
    }
    canvas.value.addEventListener('webglcontextlost', onContextLost)
    cleanup = () => {
      observer.disconnect()
      resize.disconnect()
      motion.removeEventListener('change', onMotion)
      document.removeEventListener('visibilitychange', updateVisibility)
      canvas.value?.removeEventListener('webglcontextlost', onContextLost)
    }
    await scene.load()
    if (disposed) return
    scene.setPreset(props.preset)
    ready.value = true
    emit('ready')
  } catch {
    cleanup()
    scene?.dispose()
    scene = null
    emit('unavailable')
  }
})

onBeforeUnmount(() => {
  disposed = true
  cleanup()
  scene?.dispose()
})
</script>

<template>
  <div
    class="absolute inset-0 overflow-hidden"
    :data-ready="ready"
  >
    <canvas
      ref="canvas"
      class="absolute inset-0 block size-full object-cover opacity-0 transition-opacity duration-450 ease-[ease] motion-reduce:transition-none"
      :class="{ 'opacity-100': ready }"
      aria-hidden="true"
    />
  </div>
</template>
