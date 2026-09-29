<script setup lang="ts">
import type { Showcase } from '~/utils/showcase'

const props = withDefaults(defineProps<{ preset: string; paused?: boolean }>(), { paused: false })
const emit = defineEmits<{ ready: []; unavailable: [] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const ready = ref(false)
let scene: Showcase | null = null
let disposed = false
let cleanup = () => {}

watch(() => props.preset, value => scene?.setPreset(value))
watch(() => props.paused, value => scene?.setPaused(value))

function onPointer(event: PointerEvent) {
  if (!canvas.value || event.pointerType === 'touch') return
  const rect = canvas.value.getBoundingClientRect()
  scene?.setPointer(event.clientX - rect.left, event.clientY - rect.top)
}

function onPointerLeave() { scene?.setPointer(0, 0, false) }

onMounted(async () => {
  try {
    const { Showcase } = await import('~/utils/showcase')
    if (disposed || !canvas.value) return
    scene = new Showcase(canvas.value, { layout: 'hero', narrow: false, preset: props.preset })
    scene.setPaused(props.paused)
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
    <!-- The poster is a square render from the same camera. The camera's field of view is
         vertical, so the poster fills the stage height and sits centred, with its side edges
         feathered into the backdrop: when the canvas fades in, nothing jumps. -->
    <img
      class="absolute top-0 left-1/2 block aspect-square h-full w-auto max-w-none -translate-x-1/2 [mask-image:linear-gradient(to_right,transparent,#000_14%,#000_86%,transparent)]"
      src="/images/hero.webp"
      width="1000"
      height="1000"
      alt="GitHub, Spotify, Figma and Framer logos rendered as glass and metal 3D icons"
      fetchpriority="high"
    >
    <canvas
      ref="canvas"
      class="absolute inset-0 block size-full object-cover opacity-0 transition-opacity duration-450 ease-[ease] motion-reduce:transition-none"
      :class="{ 'opacity-100': ready }"
      aria-hidden="true"
      @pointermove="onPointer"
      @pointerleave="onPointerLeave"
    />
  </div>
</template>
