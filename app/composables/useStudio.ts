import { useEventListener } from '@vueuse/core'
import { computed, inject, nextTick, onScopeDispose, provide, reactive, ref, shallowRef, watch, type InjectionKey } from 'vue'
import { abortable, delay, nextPaint } from '~/utils/async'
import { pictureInk, isNeutral } from '~/utils/pictureInk'
import type { ImportPhase } from '~/components/studio/StageLoader.vue'
import type { ModelDimensions, ViewName } from '~/utils/glassScene'
import { activeBackdropId, BACKDROP_PRESETS, DEFAULT_GLASS_PARAMS, LIQUID_BACKDROP_IDS, MATERIAL_PRESETS, type GlassParams, type Geometry, type MaterialPreset } from '~/utils/presets'
import { DEFAULT_RELIEF_OPTIONS, reliefAspect, type ReliefData, type ReliefOptions } from '~/utils/relief'
import { LOGO_SAMPLE_IDS, SAMPLES, sampleFile, type SamplePose } from '~/utils/samples'
import { SHEET_MIN_ITEMS, layoutBox, medianItemSize } from '~/utils/sheet'
import { DEFAULT_TRACE_OPTIONS, loadImage, type TraceOptions, type TraceResult } from '~/utils/trace'
import { Tracer } from '~/utils/tracer'

/** How a fresh import opens: the pillow's rounding and the colour finish a shaded picture gets. */
const ICON_PROFILE = { roundness: 0.6, detail: 0.35, colourPreset: 'satin' }
/** Marks with open counters. A deeper slab lets automatic tile detection fill them in. */
const OPEN_COUNTERS = new Set(['camera', 'chat', 'spark', 'heart'])
/**
 * Liquid glass is shot as a round body: a tube as deep as its stroke is wide, edges rounded the
 * whole way so no flat wall is left (a flat wall refracts one colour of the split across its
 * whole face). The bevel stops short of half the stroke so thinner parts do not fold over.
 */
const LIQUID_BODY = { bevel: 0.4, maxBevel: 0.12, segments: 14 }
/**
 * How an icon sheet opens: the marks spread apart into a set, each icon about this many mm across
 * and a slab as deep as a fifth of that, so twelve 20 mm icons do not stand as 14 mm deep bricks.
 */
const SHEET_PROFILE = { spread: 0.4, iconMm: 40, depth: 0.2 }

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
/** An extruded icon sheet: enough separate marks that they stand as a set. */
export function isSheet(t: TraceResult | null): boolean {
  return (t?.items?.length ?? 0) >= SHEET_MIN_ITEMS
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
  const tracing = ref(false)
  const relieving = ref(false)
  const importing = ref<{ phase: ImportPhase; preview: string; name: string } | null>(null)
  const busy = computed(() => !!importing.value || tracing.value || relieving.value)
  const error = ref('')
  const viewerError = ref('')
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
  let disposed = false
  let documentRevision = 0
  let traceRevision = 0
  let reliefRevision = 0
  let currentImport: AbortController | null = null
  let classifying = false
  const traceValid = ref(false)
  const needsGrid = () => glass.geometry === 'inflate' || glass.geometry === 'relief'

  function invalidateRelief() {
    reliefRevision++
    clearTimeout(reliefTimer)
    reliefTimer = undefined
    relieving.value = false
    relief.value = null
  }

  function cancelDocument() {
    documentRevision++
    traceRevision++
    currentImport?.abort()
    currentImport = null
    importing.value = null
    clearTimeout(traceTimer)
    traceTimer = undefined
    tracing.value = false
    traceValid.value = false
    invalidateRelief()
    tracer.setSource(null)
  }
  /** Finish set by `pickGeometry` rather than the user; a user's own choice clears it. */
  let autoFinish: '' | 'print' = ''
  let materialChoice = 0
  let userFinish = false
  let liquidBackdropOwned = false

  /** Explicit edit events retain user intent even when the chosen value equals the current one. */
  function editMaterial(values: Partial<GlassParams>) {
    materialChoice++
    userFinish = true
    autoFinish = ''
    Object.assign(glass, values)
  }
  function selectMaterial(preset: MaterialPreset) {
    if (preset.group === 'liquid') liquidBackdropOwned = true
    editMaterial(preset.values)
  }
  function editBackdrop(values: Partial<GlassParams>) {
    liquidBackdropOwned = false
    Object.assign(glass, values)
  }
  function editShape(values: Partial<GlassParams>) {
    beforeLiquid = null
    Object.assign(glass, values)
  }

  function notify(msg: string) {
    if (disposed) return
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
  /** The colours the picture puts on the model, for the Color finish's swatches. */
  const ink = computed(() => (image.value ? pictureInk(image.value) : []))
  // A black, white or grey mark painted with its own colour makes every Color surface the same
  // flat tone: paint it instead. A picture with real colour keeps it. Re-decided per import.
  watch(ink, (c) => {
    if (c.length) glass.colorSource = c.length === 1 && isNeutral(c[0]!) ? 'paint' : 'picture'
  })
  /** A model stands on the stage that can be framed, viewed and exported. */
  const ready = computed(() => !viewerError.value && !!dims.value && !!trace.value && (
    needsGrid() ? !!relief.value && relief.value.mirror === (glass.geometry === 'inflate')
      : trace.value.polygons.length > 0 && (glass.geometry !== 'stack' || !!trace.value.layers)
  ))
  const canExport = computed(() => ready.value && traceValid.value && !busy.value && !error.value && !exporting.value)

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
  /** Drop everything the last import built. */
  function reset() {
    trace.value = null
    relief.value = null
    dims.value = null
  }

  async function importFile(
    source: File | (() => Promise<File>), name: string, pose: SamplePose | null = null,
    linked?: { sampleId: string; finishId?: string },
  ) {
    if (disposed) return
    cancelDocument()
    reset()
    image.value = null
    fileName.value = ''
    error.value = ''
    beforeLiquid = null
    const controller = currentImport = new AbortController()
    const { signal } = controller
    const state = { phase: 'read' as ImportPhase, preview: '', name }
    importing.value = state
    const started = performance.now()
    const owned = () => !disposed && currentImport === controller && !signal.aborted
    view.value = 'angle'
    viewer.value?.setPose(pose)
    const finish = linked && (MATERIAL_PRESETS.find(p => p.id === linked.finishId)
      ?? MATERIAL_PRESETS.find(p => p.id === SAMPLES.find(s => s.id === linked.sampleId)?.preset))
    if (finish) { selectMaterial(finish); viewer.value?.snap(finish.values) }
    const choice = materialChoice
    try {
      const file = typeof source === 'function' ? await abortable(source(), signal) : source
      signal.throwIfAborted()
      importing.value!.name = file.name
      const img = await abortable(loadImage(file, signal), signal)
      signal.throwIfAborted()
      importing.value!.preview = thumbnail(img)
      image.value = img
      fileName.value = file.name
      tracer.setSource(img)
      const hold = IMPORT_MIN_MS / 3
      await delay(Math.max(0, hold - (performance.now() - started)), signal)
      importing.value!.phase = 'trace'
      await nextPaint(signal)
      const traced = performance.now()
      await abortable(runTrace({ fitBevel: true, pickGeometry: true }), signal)
      signal.throwIfAborted()
      if (!traceValid.value) return
      if (glass.geometry === 'stack') {
        await abortable(runTrace({ fitBevel: true }), signal)
        signal.throwIfAborted()
        if (!traceValid.value) return
      }
      await delay(Math.max(0, hold - (performance.now() - traced)), signal)
      importing.value!.phase = 'build'
      await nextPaint(signal)
      if (needsGrid()) await abortable(runRelief(), signal)
      await delay(Math.max(0, IMPORT_MIN_MS - (performance.now() - started)), signal)
      if (linked && traceValid.value) {
        if (finish && choice === materialChoice) Object.assign(glass, finish.values)
        Object.assign(glass, linkedSampleShape(linked.sampleId))
        if (glass.finish === 'liquid' && trace.value && glass.geometry === 'extrude') rounden(trace.value)
        viewer.value?.snap({ ...glass })
      }
    } catch (e) {
      if (owned()) error.value = (e as Error).message
    } finally {
      if (owned()) {
        importing.value = null
        currentImport = null
        // Options may change after the build step while its minimum display time elapses.
        // Finish that deferred work now; a still-pending trace will start its own grid.
        if (traceValid.value && needsGrid() && !relief.value && !relieving.value && !error.value) await runRelief()
      }
    }
  }

  async function useFile(file: File, pose: SamplePose | null = null) {
    if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg')) {
      if (!disposed && !importing.value) error.value = 'Use a PNG, JPG, WebP or SVG.'
      return
    }
    await importFile(file, file.name, pose)
  }

  /** Cap the bevel at ~30% of the traced stroke width so thin letters are not swallowed. */
  /** Typical stroke width of the traced artwork at the model's size, in mm. */
  function strokeMm(t: TraceResult): number {
    const box = glass.geometry === 'extrude' ? layoutBox(t, glass.spread) : t.bbox
    return t.strokeWidth * (glass.widthMm / Math.max(box.maxX - box.minX, 1e-6))
  }

  /** The round body Liquid is rendered as, for an extrusion of this trace. */
  function liquidBody(t: TraceResult): Pick<GlassParams, 'depthMm' | 'bevelMm' | 'bevelSegments'> {
    const bevel = +Math.max(0.5, Math.min(strokeMm(t) * LIQUID_BODY.bevel, glass.widthMm * LIQUID_BODY.maxBevel)).toFixed(1)
    return { bevelMm: bevel, depthMm: +(bevel * 2 + 0.1).toFixed(1), bevelSegments: LIQUID_BODY.segments }
  }
  /** The shape Liquid replaced, to put back when the finish changes again (null: nothing to undo). */
  let beforeLiquid: { shape: Pick<GlassParams, 'depthMm' | 'bevelMm' | 'bevelSegments'>; body: Pick<GlassParams, 'depthMm' | 'bevelMm' | 'bevelSegments'> } | null = null
  function rounden(t: TraceResult) {
    const body = liquidBody(t)
    if (!beforeLiquid) beforeLiquid = { shape: { depthMm: glass.depthMm, bevelMm: glass.bevelMm, bevelSegments: glass.bevelSegments }, body }
    else beforeLiquid.body = body
    Object.assign(glass, body)
  }

  function fitBevelToStroke(t: TraceResult) {
    if (!t.strokeWidth) return
    if (glass.finish === 'liquid' && glass.geometry === 'extrude') {
      viewer.value?.snap(liquidBody(t), false)
      rounden(t)
      return
    }
    const strokeMm_ = strokeMm(t)
    const bevel = Math.max(0.2, Math.min(DEFAULT_GLASS_PARAMS.bevelMm, +(strokeMm_ * 0.3).toFixed(1)))
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
    } else if (glass.geometry === 'extrude' && isSheet(t)) {
      Object.assign(stage, sheetShape(t))
    } else if (glass.geometry === 'extrude' && glass.depthMm > glass.widthMm * 0.3) {
      // Back from a volume to a slab: the volume's depth would make a brick of a logo.
      stage.depthMm = DEFAULT_GLASS_PARAMS.depthMm
    }
    // A single mark opens as drawn, at the studio's size: only a sheet comes in spread and scaled.
    if (stage.spread === undefined && glass.spread) {
      Object.assign(stage, { spread: 0, widthMm: DEFAULT_GLASS_PARAMS.widthMm, depthMm: DEFAULT_GLASS_PARAMS.depthMm })
    }
    if (rich && !userFinish) {
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

  /** Spread, size and depth that make a sheet's marks a set of icons at a real-world size. */
  function sheetShape(t: TraceResult): Pick<GlassParams, 'spread' | 'widthMm' | 'depthMm'> {
    const spread = SHEET_PROFILE.spread
    const box = layoutBox(t, spread)
    const icon = Math.max(medianItemSize(t.items!), 1e-6)
    return {
      spread,
      widthMm: Math.round(SHEET_PROFILE.iconMm * (box.maxX - box.minX) / icon),
      depthMm: SHEET_PROFILE.iconMm * SHEET_PROFILE.depth,
    }
  }

  watch(() => glass.finish, (f, was) => {
    if (f !== autoFinish) autoFinish = ''
    // Liquid brings its charcoal wall and a round body; leaving it for another finish takes both
    // back, unless the user has since picked a backdrop or tuned the shape themselves.
    if (f === 'liquid' && was !== 'liquid' && trace.value?.strokeWidth && glass.geometry === 'extrude') rounden(trace.value)
    if (was === 'liquid' && f !== 'liquid') {
      if (liquidBackdropOwned && LIQUID_BACKDROP_IDS.has(activeBackdropId(glass) ?? '')) Object.assign(glass, BACKDROP_PRESETS[0]!.values)
      const b = beforeLiquid?.body
      if (b && glass.depthMm === b.depthMm && glass.bevelMm === b.bevelMm && glass.bevelSegments === b.bevelSegments) {
        // The depth and smoothness come back as they were; the edge is fitted to the outline
        // on the stage now, which may not be the one Liquid was picked on.
        Object.assign(glass, { depthMm: beforeLiquid!.shape.depthMm, bevelSegments: beforeLiquid!.shape.bevelSegments })
        if (trace.value) fitBevelToStroke(trace.value)
      }
      beforeLiquid = null
      liquidBackdropOwned = false
    }
  })

  async function runRelief(): Promise<void> {
    clearTimeout(reliefTimer)
    reliefTimer = undefined
    const t = trace.value
    const img = image.value
    if (disposed || !img || !t || !traceValid.value || !needsGrid()) return
    const revision = ++reliefRevision
    const doc = documentRevision
    const geometry = glass.geometry
    const current = () => !disposed && doc === documentRevision && revision === reliefRevision && trace.value === t && glass.geometry === geometry
    relieving.value = true
    try {
      const inflate = geometry === 'inflate'
      const cut = (inflate || reliefOpts.cutout) && t.polygons.length > 0
      const mask = cut ? { polygons: t.polygons, width: t.width, height: t.height } : null
      const got = await tracer.relief({ ...reliefOpts, inflate }, cut ? t.crop : { x: 0, y: 0, w: 1, h: 1 }, mask)
      if (!got || !current()) return
      relief.value = got.result
      error.value = ''
    } catch (e) {
      if (current()) error.value = (e as Error).message
    } finally {
      if (current()) relieving.value = false
    }
  }

  async function runTrace(opts: { fitBevel?: boolean; pickGeometry?: boolean } = {}): Promise<void> {
    clearTimeout(traceTimer)
    traceTimer = undefined
    const img = image.value
    if (disposed || !img) return
    const revision = ++traceRevision
    const doc = documentRevision
    const current = () => !disposed && doc === documentRevision && revision === traceRevision
    tracing.value = true
    traceValid.value = false
    invalidateRelief()
    try {
      const traced = await tracer.trace(traceOpts)
      if (!traced || !current()) return
      const { result } = traced
      // Classification changes dependent options; this import explicitly runs the follow-up jobs.
      classifying = true
      try {
        if (opts.pickGeometry) pickGeometry(result)
        if (!result.polygons.length && glass.geometry === 'inflate') glass.geometry = 'relief'
        if (opts.fitBevel && result.polygons.length) fitBevelToStroke(result)
      } finally { classifying = false }
      error.value = result.polygons.length || glass.geometry === 'relief'
        ? '' : 'No outline found. Try another source mode, or switch to Relief.'
      trace.value = result
      traceValid.value = true
      if (needsGrid() && !importing.value) await runRelief()
    } catch (e) {
      if (current()) error.value = (e as Error).message
    } finally {
      if (current()) tracing.value = false
    }
  }

  watch(() => ({ ...traceOpts }), () => {
    if (classifying || disposed) return
    traceRevision++
    traceValid.value = false
    invalidateRelief()
    clearTimeout(traceTimer)
    tracing.value = !!image.value
    if (image.value) traceTimer = setTimeout(() => { void runTrace() }, 120)
  }, { flush: 'sync' })
  watch(() => ({ ...reliefOpts }), () => {
    if (classifying || disposed) return
    invalidateRelief()
    if (importing.value || !traceValid.value || !needsGrid()) return
    relieving.value = true
    reliefTimer = setTimeout(() => { void runRelief() }, 120)
  }, { flush: 'sync' })
  watch(() => glass.geometry, (g) => {
    if (classifying || disposed) return
    invalidateRelief()
    const retrace = traceOpts.stack !== (g === 'stack')
    if (retrace) traceOpts.stack = g === 'stack'
    if (needsGrid() && !importing.value && !retrace && traceValid.value) void runRelief()
    if (traceValid.value && (g === 'relief' || trace.value?.polygons.length)) error.value = ''
    else if (trace.value && !trace.value.polygons.length) error.value = 'No outline found. Try another source mode, or switch to Relief.'
  }, { flush: 'sync' })
  watch(() => glass.depthMm, (d) => { if (glass.bevelMm > d / 2) glass.bevelMm = Math.max(0, +(d / 2).toFixed(1)) })

  function clearImage() {
    cancelDocument()
    beforeLiquid = null
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
    await importFile(() => sampleFile(sample), `${sample.id}.png`, sample.pose ?? null)
  }

  /** A linked sample owns rasterization, import, and the final shape/finish override together. */
  async function openLinkedSample(sampleId: string, finishId?: string): Promise<void> {
    const sample = SAMPLES.find(s => s.id === sampleId)
    if (!sample) return
    await importFile(() => sampleFile(sample), `${sample.id}.png`, sample.pose ?? null, { sampleId, finishId })
  }

  async function doExport(kind: ExportKind) {
    if (disposed || !viewer.value || !canExport.value) return
    exporting.value = kind
    const handle = viewer.value
    const revision = documentRevision
    const base = fileName.value.replace(/\.[^.]+$/, '') || 'vitrum'
    const name = base + (glass.geometry === 'extrude' ? '' : `-${glass.geometry}`)
    try {
      // Vue must deliver the current trace/grid before the renderer flushes its target parameters.
      await nextTick()
      if (disposed || revision !== documentRevision || busy.value || !traceValid.value || !ready.value || error.value) return
      handle.snap({ ...glass })
      if (kind === 'glb') await handle.exportGLB(name)
      else if (kind === 'stl') handle.exportSTL(name)
      else await handle.screenshot(name)
      if (revision === documentRevision) notify(`${kind.toUpperCase()} saved`)
    } catch (e) {
      if (revision === documentRevision) notify((e as Error).message)
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
    if (e.metaKey || e.ctrlKey || e.altKey || !ready.value) return
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
    if (keys.some(k => ['depthMm', 'bevelMm', 'bevelSegments', 'geometry'].includes(k))) beforeLiquid = null
    if (keys.some(k => ['background', 'background2', 'backdropFill', 'backdropAngle', 'vignette'].includes(k))) liquidBackdropOwned = false
    Object.assign(glass, out)
  }

  useEventListener('paste', onPaste)
  useEventListener('keydown', onKey)
  // Capture, so the flag is set before any component reacts to the same key or pointer.
  useEventListener('keydown', () => (keyed.value = true), { capture: true })
  useEventListener('pointerdown', () => (keyed.value = false), { capture: true })
  onScopeDispose(() => {
    disposed = true
    cancelDocument()
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
    const box = g === 'extrude' ? layoutBox(t, glass.spread) : t.bbox
    return (box.maxY - box.minY) / Math.max(box.maxX - box.minX, 1e-6)
  })
  const heightMm = computed(() => glass.widthMm * aspect.value)
  /**
   * Spread a sheet's marks apart without resizing them: W is the whole set, so it grows with the
   * gutters and every icon keeps its millimetres.
   */
  function setSpread(v: number) {
    const t = trace.value
    if (!t) return
    const width = (s: number) => { const b = layoutBox(t, s); return Math.max(b.maxX - b.minX, 1e-6) }
    glass.widthMm = +(glass.widthMm * width(v) / width(glass.spread)).toFixed(2)
    glass.spread = v
  }
  function setHeight(v: number) {
    if (v > 0 && aspect.value > 0) glass.widthMm = v / aspect.value
  }

  return {
    image, ink, fileName, trace, traceOpts, reliefOpts, relief, glass, dims, busy, importing, error,
    dragging, exporting, toast, view, viewer, viewerError, heightMm, subject, ready, canExport, keyed,
    setView, useFile, clearImage, onDrop, onPick, loadSample, openLinkedSample, doExport, setHeight, setSpread, notify,
    resetGlass, selectMaterial, editMaterial, editBackdrop, editShape,
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
