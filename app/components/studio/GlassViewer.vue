<script setup lang="ts">
import { GlassStudio, type GlassParams, type ModelDimensions } from '~/utils/glassScene'
import type { ReliefData } from '~/utils/relief'
import type { TraceResult } from '~/utils/trace'

const props = defineProps<{ trace: TraceResult | null; relief: ReliefData | null; params: GlassParams; source?: HTMLImageElement | null }>()
const emit = defineEmits<{ dimensions: [ModelDimensions | null] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let studio: GlassStudio | null = null
let ro: ResizeObserver | null = null

onMounted(() => {
  studio = new GlassStudio(canvas.value!)
  studio.snapParams({ ...props.params })
  // Sizes ease over several frames and rebuild as they go; the HUD reads the built mesh.
  studio.onRebuild = () => emit('dimensions', studio?.getDimensions() ?? null)
  ro = new ResizeObserver(() => studio?.resize(true))
  ro.observe(canvas.value!)
})
onBeforeUnmount(() => {
  ro?.disconnect()
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
  setView: (v: 'angle' | 'front' | 'side' | 'top') => studio?.setView(v),
  exportGLB: async (name = 'vitrum') => { if (studio) download(await studio.exportGLB(), `${name}.glb`) },
  exportSTL: (name = 'vitrum') => { if (studio) download(studio.exportSTL(), `${name}.stl`) },
  screenshot: async (name = 'vitrum') => { if (studio) download(await studio.screenshot(), `${name}.png`) },
})
</script>

<template>
  <canvas ref="canvas" class="viewer" />
</template>

<style scoped>
.viewer { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; }
</style>
