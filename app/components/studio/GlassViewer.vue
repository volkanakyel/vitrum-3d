<script setup lang="ts">
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { GlassStudio, type GlassParams, type ModelDimensions } from '~/utils/glassScene'
import type { ReliefData } from '~/utils/relief'
import type { TraceResult } from '~/utils/trace'

const props = defineProps<{ trace: TraceResult | null; relief: ReliefData | null; params: GlassParams; source?: HTMLImageElement | null }>()
const emit = defineEmits<{ dimensions: [ModelDimensions | null] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let studio: GlassStudio | null = null

function syncVisibility(): void {
  studio?.setPageVisible(document.visibilityState === 'visible')
}

onMounted(() => {
  studio = new GlassStudio(canvas.value!)
  syncVisibility()
  studio.snapParams({ ...props.params })
  // Sizes ease over several frames and rebuild as they go; the HUD reads the built mesh.
  studio.onRebuild = () => emit('dimensions', studio?.getDimensions() ?? null)
})
useEventListener(() => document, 'visibilitychange', syncVisibility)
useResizeObserver(canvas, () => studio?.resize(true))
onBeforeUnmount(() => {
  studio?.dispose()
  studio = null
})

watch(() => props.trace, t => studio?.setTrace(t, props.source ?? null))
watch(() => props.relief, r => studio?.setRelief(r))
watch(() => ({ ...props.params }), p => studio?.setParams(p))

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

defineExpose({
  /** Set parameters without easing; `applyNow` false when a new trace is about to rebuild. */
  snap: (p: Partial<GlassParams>, applyNow = true) => studio?.snapParams(p, applyNow),
  frame: () => studio?.frame(),
  /** Recentre and shrink the model for a sheet covering the bottom of the stage. */
  setFocus: (shift: number, scale: number) => studio?.setFocus(shift, scale),
  setView: (v: 'angle' | 'front' | 'side' | 'top') => studio?.setView(v),
  exportGLB: async (name = 'vitrum') => { if (studio) download(await studio.exportGLB(), `${name}.glb`) },
  exportSTL: (name = 'vitrum') => { if (studio) download(studio.exportSTL(), `${name}.stl`) },
  screenshot: async (name = 'vitrum') => { if (studio) download(await studio.screenshot(), `${name}.png`) },
  /** The same render as `screenshot`, handed back instead of downloaded. */
  capture: async (scale = 2) => (studio ? await studio.screenshot(scale) : null),
})
</script>

<template>
  <canvas
    ref="canvas"
    class="absolute inset-0 block size-full touch-none outline-none"
  />
</template>
