import type { ImportPhase } from '~/components/studio/StageLoader.vue'
import type { ModelDimensions } from '~/utils/glassScene'
import { DEFAULT_GLASS_PARAMS, MATERIAL_PRESETS, type GlassParams } from '~/utils/presets'
import { DEFAULT_RELIEF_OPTIONS, reliefAspect, type ReliefData, type ReliefOptions } from '~/utils/relief'
import { SAMPLES, sampleFile } from '~/utils/samples'
import { DEFAULT_TRACE_OPTIONS, loadImage, type TraceOptions, type TraceResult } from '~/utils/trace'
import { Tracer } from '~/utils/tracer'

/**
 * Icon: flat artwork (logos, icons, type) traced and extruded, opened in glass.
 * Product: a photographed or illustrated object inflated into a volume that keeps its colours.
 * The mode sets what a fresh import opens as; every control stays available afterwards.
 */
export type StudioMode = 'icon' | 'product'
export const STUDIO_MODES: { id: StudioMode; label: string; hint: string; sample: string }[] = [
  { id: 'icon', label: 'Icon', hint: 'Logos, icons and type as crisp glass or metal', sample: 'vitrum' },
  { id: 'product', label: '3D product', hint: 'An object photo as a solid in its own colours', sample: 'armchair' },
]

export type ViewName = 'angle' | 'front' | 'side' | 'top'
export type ExportKind = 'glb' | 'stl' | 'png'

export interface ViewerHandle {
  exportGLB: (name?: string) => Promise<void>
  exportSTL: (name?: string) => void
  screenshot: (name?: string) => Promise<void>
  frame: () => void
  setView: (v: ViewName) => void
  snap: (p: Partial<GlassParams>, applyNow?: boolean) => void
}

const IMPORT_MIN_MS = 1400

export function useStudio(initialMode: StudioMode = 'icon') {
  const mode = ref<StudioMode>(initialMode)
  const image = shallowRef<HTMLImageElement | null>(null)
  const fileName = ref('')
  const trace = shallowRef<TraceResult | null>(null)
  const tracer = new Tracer()
  const traceOpts = reactive<TraceOptions>({ ...DEFAULT_TRACE_OPTIONS })
  const reliefOpts = reactive<ReliefOptions>({ ...DEFAULT_RELIEF_OPTIONS })
  const relief = shallowRef<ReliefData | null>(null)
  const glass = reactive<GlassParams>({ ...DEFAULT_GLASS_PARAMS })
  const dims = ref<ModelDimensions | null>(null)
  const busy = ref(false)
  const importing = ref<{ phase: ImportPhase; preview: string; name: string } | null>(null)
  const error = ref('')
  const dragging = ref(false)
  const exporting = ref<'' | ExportKind>('')
  const toast = ref('')
  const view = ref<ViewName>('angle')
  const viewer = ref<ViewerHandle | null>(null)

  let traceTimer: ReturnType<typeof setTimeout> | undefined
  let reliefTimer: ReturnType<typeof setTimeout> | undefined
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  /** Finish set by `pickGeometry` rather than the user; a user's own choice clears it. */
  let autoFinish: '' | 'print' = ''

  function notify(msg: string) {
    toast.value = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = ''), 2200)
  }

  function setView(v: ViewName) {
    view.value = v
    viewer.value?.setView(v)
  }

  function thumbnail(img: HTMLImageElement, size = 160): string {
    const iw = img.naturalWidth || img.width
    const ih = img.naturalHeight || img.height
    const k = size / Math.max(iw, ih)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(iw * k))
    c.height = Math.max(1, Math.round(ih * k))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  }
  const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()))
  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

  async function useFile(file: File) {
    error.value = ''
    if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg')) {
      error.value = 'Use a PNG, JPG, WebP or SVG.'
      return
    }
    const started = performance.now()
    importing.value = { phase: 'read', preview: '', name: file.name }
    busy.value = true
    trace.value = null
    relief.value = null
    try {
      const img = await loadImage(file)
      importing.value.preview = thumbnail(img)
      image.value = img
      tracer.setSource(img)
      fileName.value = file.name
      traceOpts.mode = 'auto'
      const hold = IMPORT_MIN_MS / 3
      await sleep(Math.max(0, hold - (performance.now() - started)))
      importing.value.phase = 'trace'
      await nextFrame()
      const traced = performance.now()
      await runTrace({ fitBevel: true, pickGeometry: true })
      if (glass.geometry === 'stack') { clearTimeout(traceTimer); await runTrace({ fitBevel: true }) }
      await sleep(Math.max(0, hold - (performance.now() - traced)))
      importing.value.phase = 'build'
      if (glass.geometry === 'inflate' || glass.geometry === 'relief') await runRelief()
      await sleep(Math.max(0, IMPORT_MIN_MS - (performance.now() - started)))
    } catch (e) {
      error.value = (e as Error).message
      busy.value = false
    } finally {
      importing.value = null
    }
  }

  /** Cap the bevel at ~30% of the traced stroke width so thin letters are not swallowed. */
  function fitBevelToStroke(t: TraceResult) {
    if (!t.strokeWidth) return
    const bw = Math.max(t.bbox.maxX - t.bbox.minX, 1e-6)
    const strokeMm = t.strokeWidth * (glass.widthMm / bw)
    const bevel = Math.max(0.2, Math.min(DEFAULT_GLASS_PARAMS.bevelMm, +(strokeMm * 0.3).toFixed(1)))
    viewer.value?.snap({ bevelMm: bevel }, false)
    glass.bevelMm = bevel
  }

  /**
   * Choose how a fresh import opens. Icon mode favours the crisp extrusion (or a stack when the
   * artwork sits on a tile); product mode favours an inflated colour volume. Either way a source
   * that clearly wants the other treatment (a photo in icon mode, a flat mark in product mode)
   * still gets what suits it, so nothing opens as a broken solid.
   */
  function pickGeometry(t: TraceResult) {
    const rich = !t.polygons.length || t.palette >= 24
    const subject = t.polygons.length > 0 && t.coverage < 0.9
    const productWanted = mode.value === 'product' && t.polygons.length > 0
    const asVolume = rich ? subject : productWanted
    glass.geometry = asVolume ? 'inflate' : rich ? 'relief' : t.hasTile ? 'stack' : 'extrude'
    reliefOpts.cutout = glass.geometry === 'inflate'
    traceOpts.stack = glass.geometry === 'stack'
    const colour = rich || (mode.value === 'product' && glass.geometry === 'inflate')
    if (colour) {
      autoFinish = 'print'
      const satin = MATERIAL_PRESETS.find(m => m.id === 'satin')!.values
      Object.assign(glass, satin)
      viewer.value?.snap({ ...satin, geometry: glass.geometry, reliefMm: DEFAULT_GLASS_PARAMS.reliefMm }, false)
    } else if (autoFinish === 'print' && glass.finish === 'print') {
      autoFinish = ''
      const clear = MATERIAL_PRESETS.find(m => m.id === 'clear')!.values
      Object.assign(glass, clear)
      viewer.value?.snap({ ...clear, geometry: glass.geometry }, false)
    }
  }
  watch(() => glass.finish, (f) => { if (f !== autoFinish) autoFinish = '' })

  async function runRelief(): Promise<void> {
    const t = trace.value
    const img = image.value
    if (!img || !t) return
    if (glass.geometry !== 'inflate' && glass.geometry !== 'relief') return
    busy.value = true
    try {
      const inflate = glass.geometry === 'inflate'
      const cut = (inflate || reliefOpts.cutout) && t.polygons.length > 0
      const mask = cut ? { polygons: t.polygons, width: t.width, height: t.height } : null
      const got = await tracer.relief({ ...reliefOpts, inflate }, cut ? t.crop : { x: 0, y: 0, w: 1, h: 1 }, mask)
      if (!got || image.value !== img) return
      if (import.meta.dev) console.debug(`[relief] ${Math.round(got.ms)} ms (${got.where}), ${got.result.width}×${got.result.height}`)
      relief.value = got.result
      error.value = ''
    } catch (e) {
      error.value = (e as Error).message
    }
    busy.value = false
  }

  async function runTrace(opts: { fitBevel?: boolean; pickGeometry?: boolean } = {}): Promise<void> {
    const img = image.value
    if (!img) return
    busy.value = true
    try {
      const traced = await tracer.trace(traceOpts)
      if (!traced || image.value !== img) return
      const { result, ms, where } = traced
      if (import.meta.dev) console.debug(`[trace] ${Math.round(ms)} ms (${where}), ${result.resolvedMode}, ${result.polygons.length} shapes`)
      if (opts.pickGeometry) pickGeometry(result)
      error.value = result.polygons.length || glass.geometry === 'relief'
        ? ''
        : 'No outline found. Try another source mode, or switch to Relief.'
      if (!result.polygons.length && glass.geometry === 'inflate') glass.geometry = 'relief'
      if (opts.fitBevel && result.polygons.length) fitBevelToStroke(result)
      trace.value = result
      if (glass.geometry !== 'extrude' && !opts.pickGeometry) void runRelief()
    } catch (e) {
      error.value = (e as Error).message
    }
    busy.value = false
  }

  watch(() => ({ ...traceOpts }), () => {
    clearTimeout(traceTimer)
    traceTimer = setTimeout(runTrace, 120)
  }, { deep: true })
  watch(() => ({ ...reliefOpts }), () => {
    if (importing.value) return
    clearTimeout(reliefTimer)
    reliefTimer = setTimeout(runRelief, 120)
  }, { deep: true })
  watch(() => glass.geometry, (g) => {
    const retrace = traceOpts.stack !== (g === 'stack')
    if (retrace) traceOpts.stack = g === 'stack'
    const have = relief.value && relief.value.mirror === (g === 'inflate')
    if ((g === 'inflate' || g === 'relief') && !have && !importing.value && !retrace) void runRelief()
    if (g === 'relief') error.value = ''
    else if (trace.value && !trace.value.polygons.length) error.value = 'No outline found. Try another source mode, or switch to Relief.'
  })
  watch(() => glass.depthMm, (d) => { if (glass.bevelMm > d / 2) glass.bevelMm = Math.max(0, +(d / 2).toFixed(1)) })

  function clearImage() {
    image.value = null
    tracer.setSource(null)
    trace.value = null
    relief.value = null
    fileName.value = ''
    dims.value = null
    error.value = ''
  }

  async function onDrop(e: DragEvent) {
    dragging.value = false
    const file = e.dataTransfer?.files?.[0]
    if (file) await useFile(file)
  }
  function onPick(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) void useFile(file)
    input.value = ''
  }
  async function onPaste(e: ClipboardEvent) {
    const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'))
    const file = item?.getAsFile()
    if (file) await useFile(file)
  }
  /** Open the mode's built-in sample (drawn in code, never downloaded). */
  async function loadSample(id?: string) {
    const wanted = id ?? STUDIO_MODES.find(m => m.id === mode.value)!.sample
    const sample = SAMPLES.find(s => s.id === wanted) ?? SAMPLES[0]!
    await useFile(await sampleFile(sample))
  }

  async function doExport(kind: ExportKind) {
    if (!viewer.value || exporting.value) return
    exporting.value = kind
    const name = (fileName.value.replace(/\.[^.]+$/, '') || 'vitrum') + (glass.geometry === 'extrude' ? '' : `-${glass.geometry}`)
    try {
      if (kind === 'glb') await viewer.value.exportGLB(name)
      else if (kind === 'stl') viewer.value.exportSTL(name)
      else await viewer.value.screenshot(name)
      notify(`${kind.toUpperCase()} saved`)
    } catch (e) {
      notify((e as Error).message)
    } finally {
      exporting.value = ''
    }
  }

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      void doExport('glb')
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'f') viewer.value?.frame()
    if (e.key === '1') setView('angle')
    if (e.key === '2') setView('front')
    if (e.key === '3') setView('side')
    if (e.key === '4') setView('top')
    if (e.key === 'r') glass.autoRotate = !glass.autoRotate
  }

  onMounted(() => {
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('paste', onPaste)
    window.removeEventListener('keydown', onKey)
    clearTimeout(traceTimer)
    clearTimeout(reliefTimer)
    clearTimeout(toastTimer)
    tracer.dispose()
  })

  const aspect = computed(() => {
    const r = relief.value
    const g = glass.geometry
    if ((g === 'inflate' || g === 'relief') && r && r.mirror === (g === 'inflate')) return reliefAspect(r)
    const t = trace.value
    if (!t) return 1
    return (t.bbox.maxY - t.bbox.minY) / Math.max(t.bbox.maxX - t.bbox.minX, 1e-6)
  })
  const heightMm = computed(() => glass.widthMm * aspect.value)
  function setHeight(v: number) {
    if (v > 0 && aspect.value > 0) glass.widthMm = v / aspect.value
  }

  return {
    mode, image, fileName, trace, traceOpts, reliefOpts, relief, glass, dims, busy, importing, error,
    dragging, exporting, toast, view, viewer, heightMm,
    setView, useFile, clearImage, onDrop, onPick, loadSample, doExport, setHeight, notify,
  }
}
