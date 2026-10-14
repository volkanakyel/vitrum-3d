import { useEventListener } from '@vueuse/core'
import type { InjectionKey } from 'vue'
import type { ImportPhase } from '~/components/studio/StageLoader.vue'
import type { ModelDimensions, ViewName } from '~/utils/glassScene'
import { DEFAULT_GLASS_PARAMS, MATERIAL_PRESETS, type GlassParams, type Geometry } from '~/utils/presets'
import { DEFAULT_RELIEF_OPTIONS, reliefAspect, type ReliefData, type ReliefOptions } from '~/utils/relief'
import { LOGO_SAMPLE_IDS, SAMPLES, sampleFile, type SamplePose } from '~/utils/samples'
import { DEFAULT_TRACE_OPTIONS, loadImage, type TraceOptions, type TraceResult } from '~/utils/trace'
import { Tracer } from '~/utils/tracer'

/** How a fresh import opens: the pillow's rounding and the colour finish a shaded picture gets. */
const ICON_PROFILE = { roundness: 0.6, detail: 0.35, colourPreset: 'satin' }
/** Marks with open counters. A deeper slab lets automatic tile detection fill them in. */
const OPEN_COUNTERS = new Set(['camera', 'chat', 'spark', 'heart'])

/** Shape a landing link opens with, after the trace has chosen its own defaults. */
function linkedSampleShape(id: string): Pick<GlassParams, 'geometry' | 'widthMm' | 'depthMm' | 'bevelMm'> {
  const geometry: Geometry = id === 'play' ? 'stack' : 'extrude'
  if (LOGO_SAMPLE_IDS.has(id)) return { geometry, widthMm: 100, depthMm: 14, bevelMm: 1 }
  const bevelMm = id === 'star' || id === 'bolt' ? 1.2 : id === 'spark' ? 2 : 3.8
  return { geometry, widthMm: 100, depthMm: OPEN_COUNTERS.has(id) ? 16 : 20, bevelMm }
}

export type ExportKind = 'glb' | 'stl' | 'png'

export interface ViewerHandle {
  exportGLB: (name?: string) => Promise<void>
  exportSTL: (name?: string) => void
  screenshot: (name?: string) => Promise<void>
  capture: (scale?: number) => Promise<Blob | null>
  frame: () => void
  setFocus: (shift: number, scale: number) => void
  setView: (v: ViewName) => void
  setPose: (pose: SamplePose | null) => void
  snap: (p: Partial<GlassParams>, applyNow?: boolean) => void
}

const IMPORT_MIN_MS = 1400
/** What every file picker in the studio takes. */
export const IMAGE_ACCEPT = 'image/*,.svg'
/** How the trace found the outline, in words. */
export const TRACE_MODE_LABEL: Record<TraceResult['resolvedMode'], string> = {
  dark: 'dark pixels',
  light: 'light pixels',
  alpha: 'alpha',
  color: 'colour distance',
}
/** "1 shape", "3 shapes". */
export function shapeCountLabel(t: TraceResult | null): string {
  const n = t?.polygons.length ?? 0
  return `${n} shape${n === 1 ? '' : 's'}`
}

export function useStudio() {
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
  /**
   * The last input was a key. Whatever changes next is a shortcut's (or arrow key's) result and
   * lands without motion: a pill gliding after a keypress only makes the key feel slow.
   */
  const keyed = ref(false)

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

  /** Something is on the stage, or on its way. */
  const subject = computed(() => !!image.value)
  /** A model stands on the stage that can be framed, viewed and exported. */
  const ready = computed(() => !!trace.value)

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
  // Two frames: the first rAF fires before paint, so heavy work started there would block the
  // very frame that shows the new phase.
  const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

  /** Drop everything the last import built: the trace, the relief. */
  function reset() {
    trace.value = null
    relief.value = null
    dims.value = null
  }

  async function useFile(file: File, pose: SamplePose | null = null) {
    error.value = ''
    if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg')) {
      error.value = 'Use a PNG, JPG, WebP or SVG.'
      return
    }
    const started = performance.now()
    importing.value = { phase: 'read', preview: '', name: file.name }
    busy.value = true
    reset()
    // Before the trace lands, so the first frame already uses the pose's angle.
    view.value = 'angle'
    viewer.value?.setPose(pose)
    try {
      const img = await loadImage(file)
      importing.value.preview = thumbnail(img)
      image.value = img
      fileName.value = file.name
      tracer.setSource(img)
      const hold = IMPORT_MIN_MS / 3
      await sleep(Math.max(0, hold - (performance.now() - started)))
      importing.value.phase = 'trace'
      await nextFrame()
      const traced = performance.now()
      await runTrace({ fitBevel: true, pickGeometry: true })
      if (glass.geometry === 'stack') { clearTimeout(traceTimer); await runTrace({ fitBevel: true }) }
      await sleep(Math.max(0, hold - (performance.now() - traced)))
      importing.value.phase = 'build'
      await nextFrame()
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
   * Choose how a fresh import opens: the crisp extrusion, a stack when the artwork sits on
   * a tile, a relief for a shaded picture, or an inflated colour volume for a shaded subject on
   * a page. Nothing opens as a broken solid.
   */
  function pickGeometry(t: TraceResult) {
    const rich = !t.polygons.length || t.palette >= 24
    const subjectOnPage = t.polygons.length > 0 && t.coverage < 0.9
    glass.geometry = rich ? (subjectOnPage ? 'inflate' : 'relief') : t.hasTile ? 'stack' : 'extrude'
    reliefOpts.cutout = glass.geometry === 'inflate'
    traceOpts.stack = glass.geometry === 'stack'
    const stage: Partial<GlassParams> = {}
    if (glass.geometry === 'inflate') {
      reliefOpts.roundness = ICON_PROFILE.roundness
      reliefOpts.detail = ICON_PROFILE.detail
    } else if (glass.geometry === 'extrude' && glass.depthMm > glass.widthMm * 0.3) {
      // Back from a volume to a slab: the volume's depth would make a brick of a logo.
      stage.depthMm = DEFAULT_GLASS_PARAMS.depthMm
    }
    if (rich) {
      autoFinish = 'print'
      const preset = MATERIAL_PRESETS.find(m => m.id === ICON_PROFILE.colourPreset)!.values
      Object.assign(glass, preset, stage)
      viewer.value?.snap({ ...preset, ...stage, geometry: glass.geometry, reliefMm: DEFAULT_GLASS_PARAMS.reliefMm }, false)
    } else {
      const clear = autoFinish === 'print' && glass.finish === 'print' ? MATERIAL_PRESETS.find(m => m.id === 'clear')!.values : {}
      autoFinish = ''
      Object.assign(glass, clear, stage)
      viewer.value?.snap({ ...clear, ...stage, geometry: glass.geometry }, false)
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
    reliefTimer = setTimeout(() => { void runRelief() }, 120)
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
    reset()
    image.value = null
    tracer.setSource(null)
    fileName.value = ''
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
  /** Open a built-in sample mark (drawn in code, never downloaded). */
  async function loadSample(id = 'vitrum'): Promise<void> {
    const sample = SAMPLES.find(s => s.id === id) ?? SAMPLES[0]!
    await useFile(await sampleFile(sample), sample.pose ?? null)
  }

  /**
   * Open a sample from a landing link (`?sample=&finish=`). The trace runs first, then the
   * link's finish and silhouette override what automatic detection picked.
   */
  async function openLinkedSample(sampleId: string, finishId?: string): Promise<void> {
    const sample = SAMPLES.find(s => s.id === sampleId)
    if (!sample) return
    try {
      await loadSample(sample.id)
      const finish = MATERIAL_PRESETS.find(p => p.id === finishId) ?? MATERIAL_PRESETS.find(p => p.id === sample.preset)
      if (finish) Object.assign(glass, finish.values)
      Object.assign(glass, linkedSampleShape(sample.id))
    } catch {
      error.value = 'This example could not be opened. Choose a sample or upload your own artwork.'
    }
  }

  async function doExport(kind: ExportKind) {
    if (!viewer.value || exporting.value) return
    exporting.value = kind
    const base = fileName.value.replace(/\.[^.]+$/, '') || 'vitrum'
    const name = base + (glass.geometry === 'extrude' ? '' : `-${glass.geometry}`)
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
    if (isEditableTarget(e.target)) return
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

  /** Sections of the glass back to their defaults (a panel section's reset). */
  function resetGlass<K extends keyof GlassParams>(...keys: K[]) {
    const out: Partial<GlassParams> = {}
    for (const k of keys) out[k] = DEFAULT_GLASS_PARAMS[k]
    Object.assign(glass, out)
  }

  useEventListener('paste', onPaste)
  useEventListener('keydown', onKey)
  // Capture, so the flag is set before any component reacts to the same key or pointer.
  useEventListener('keydown', () => (keyed.value = true), { capture: true })
  useEventListener('pointerdown', () => (keyed.value = false), { capture: true })
  onBeforeUnmount(() => {
    clearTimeout(traceTimer)
    clearTimeout(reliefTimer)
    clearTimeout(toastTimer)
    tracer.dispose()
  })

  /** Height over width: a relief's grid, or the traced outline's own box. */
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
    image, fileName, trace, traceOpts, reliefOpts, relief, glass, dims, busy, importing, error,
    dragging, exporting, toast, view, viewer, heightMm, subject, ready, keyed,
    setView, useFile, clearImage, onDrop, onPick, loadSample, openLinkedSample, doExport, setHeight, notify,
    resetGlass,
  }
}

export type Studio = ReturnType<typeof useStudio>
const STUDIO: InjectionKey<Studio> = Symbol('studio')

/** Hands the page's studio to every panel below it, so the sections need no props threaded through. */
export function provideStudio(studio: Studio) {
  provide(STUDIO, studio)
}
export function useStudioContext(): Studio {
  const studio = inject(STUDIO)
  if (!studio) throw new Error('useStudioContext() needs provideStudio() in a parent component')
  return studio
}
