<script setup lang="ts">
import { useDocumentVisibility, useEventListener, useIntersectionObserver, useMediaQuery, useResizeObserver } from '@vueuse/core'
import type { Showcase } from '~/utils/showcase'
import { heroMarks, heroRequests } from '~/utils/heroMarks'

const { preset, paused = false, clear = 0, copy } = defineProps<{
  preset: string
  paused?: boolean
  clear?: number
  /** The copy block (headline to actions) in canvas px: the marks grow out of its edges. */
  copy?: { left: number; top: number; right: number; bottom: number }
}>()
const emit = defineEmits<{ ready: []; unavailable: [] }>()
const canvas = useTemplateRef('canvas')
const ready = ref(false)
const shown = ref(false)
let scene: Showcase | null = null
let disposed = false
const buildId = useRuntimeConfig().app.buildId

watch(() => preset, value => scene?.setPreset(value))
watch(() => paused, value => scene?.setPaused(value))
watch(() => clear, value => scene?.setHeroClear(value))
watch(() => copy, value => value && scene?.setHeroCopy(value))

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

useEventListener(window, 'pointermove', onPointer, { passive: true })
useEventListener(document, 'pointerleave', () => scene?.setPointer(0, 0, false))

// Render only while the canvas is on screen and the tab is in front.
const intersecting = ref(true)
const tab = useDocumentVisibility()
const visible = computed(() => intersecting.value && tab.value === 'visible')
useIntersectionObserver(canvas, ([entry]) => { intersecting.value = entry?.isIntersecting ?? false })
watch(visible, value => scene?.setVisible(value))
useResizeObserver(canvas, () => scene?.resize())
// The scene reads the preference itself when it is built; this keeps it current afterwards.
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
watch(reducedMotion, value => scene?.setReducedMotion(value))
useEventListener(canvas, 'webglcontextlost', (event: Event) => {
  event.preventDefault()
  ready.value = false
  shown.value = false
  scene?.setVisible(false)
  emit('unavailable')
})

onMounted(async () => {
  try {
    // The marks are traced in workers from now, while Three.js loads and the renderer sets up.
    // (Not earlier, in setup: spawning workers there holds up hydration on a slow phone.) A reload
    // of the same build reads them back from the cache instead. Dev rebuilds them every time.
    const prebuilt = heroMarks(heroRequests(canvas.value?.clientWidth || window.innerWidth), import.meta.dev ? '' : buildId)
    const { Showcase } = await import('~/utils/showcase')
    if (disposed || !canvas.value) return prebuilt.terminate()
    scene = new Showcase(canvas.value, { layout: 'hero', narrow: false, preset, prebuilt })
    // Show the canvas as soon as the first mark lands; the rest arrive one by one behind it.
    scene.onPlaced = () => { shown.value = true }
    scene.setPaused(paused)
    scene.setHeroClear(clear)
    if (copy) scene.setHeroCopy(copy)
    scene.setVisible(visible.value)
    await scene.load()
    if (disposed) return
    scene.setPreset(preset)
    ready.value = true
    emit('ready')
  } catch {
    scene?.dispose()
    scene = null
    shown.value = false
    emit('unavailable')
  }
})

onBeforeUnmount(() => {
  disposed = true
  scene?.dispose()
  scene = null
})
</script>

<template>
  <div
    class="absolute inset-0 overflow-hidden"
    :data-ready="ready"
  >
    <canvas
      ref="canvas"
      class="absolute inset-0 block size-full object-cover opacity-0 transition-opacity duration-300 ease-[ease] motion-reduce:transition-none"
      :class="{ 'opacity-100': shown }"
      aria-hidden="true"
    />
  </div>
</template>
