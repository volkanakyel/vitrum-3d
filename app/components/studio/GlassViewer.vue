<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { GlassStudio, type GlassParams, type ModelDimensions } from '~/utils/glassScene'
import type { SamplePose } from '~/utils/samples'
import type { ReliefData } from '~/utils/relief'
import type { TraceResult } from '~/utils/trace'

const props = defineProps<{ trace: TraceResult | null; relief: ReliefData | null; params: GlassParams; source?: HTMLImageElement | null }>()
const emit = defineEmits<{ dimensions: [ModelDimensions | null]; error: [string] }>()

const canvasEl = useTemplateRef<HTMLCanvasElement>('canvas')
let studio: GlassStudio | null = null
let disposed = false
let pose: SamplePose | null = null
/** A camera move started from the keyboard cuts instead of gliding. */
const { keyed } = useStudioContext()

function syncVisibility(): void {
  studio?.setPageVisible(document.visibilityState === 'visible')
}

function stop() {
  studio?.dispose()
  studio = null
  emit('dimensions', null)
}
function start() {
  if (disposed) return
  stop()
  try {
    const created = new GlassStudio(canvasEl.value!)
    studio = created
    created.onRebuild = () => emit('dimensions', created.getDimensions())
    created.snapParams({ ...props.params })
    created.setPose(pose)
    created.setTrace(props.trace, props.source ?? null)
    created.setRelief(props.relief)
    syncVisibility()
    emit('error', '')
  } catch {
    stop()
    emit('error', 'The 3D viewer could not start. Reload to try again.')
  }
}
onMounted(start)
useEventListener(canvasEl, 'webglcontextlost', (event: Event) => {
  event.preventDefault()
  stop()
  emit('error', 'The 3D view was interrupted. Waiting for graphics to recover.')
})
useEventListener(canvasEl, 'webglcontextrestored', start)
useEventListener(() => document, 'visibilitychange', syncVisibility)
useResizeObserver(canvasEl, () => studio?.resize(true))
onBeforeUnmount(() => {
  disposed = true
  stop()
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

async function save(render: (s: GlassStudio) => Promise<Blob>, name: string) {
  const owner = studio
  if (!owner) throw new Error('Viewer unavailable')
  const blob = await render(owner)
  if (disposed || studio !== owner) throw new Error('Viewer unavailable')
  download(blob, name)
}

defineExpose({
  /** Set parameters without easing; `applyNow` false when a new trace is about to rebuild. */
  snap: (p: Partial<GlassParams>, applyNow = true) => studio?.snapParams(p, applyNow),
  frame: () => studio?.frame(false, keyed.value),
  /** Recentre and shrink the model for a sheet covering the bottom of the stage. */
  setFocus: (shift: number, scale: number) => studio?.setFocus(shift, scale),
  setView: (v: 'angle' | 'front' | 'side' | 'top') => studio?.setView(v, keyed.value),
  setPose: (value: SamplePose | null) => { pose = value; studio?.setPose(value) },
  exportGLB: (name = 'vitrum') => save(s => s.exportGLB(), `${name}.glb`),
  exportSTL: (name = 'vitrum') => { if (!studio) throw new Error('Viewer unavailable'); download(studio.exportSTL(), `${name}.stl`) },
  screenshot: (name = 'vitrum') => save(s => s.screenshot(), `${name}.png`),
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
