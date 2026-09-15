import type * as THREE from 'three'
import type { ImportPhase } from '~/components/studio/StageLoader.vue'
import type { HullSources, ModelDimensions, ViewName } from '~/utils/glassScene'
import { estimateCameraSide, type HullData, type HullView } from '~/utils/hull'
import { DEFAULT_GLASS_PARAMS, MATERIAL_PRESETS, type GlassParams } from '~/utils/presets'
import { DEFAULT_RELIEF_OPTIONS, rasterizeMask, reliefAspect, type ReliefData, type ReliefOptions } from '~/utils/relief'
import { SAMPLES, sampleFile } from '~/utils/samples'
import { DEFAULT_TRACE_OPTIONS, loadImage, rasterize, type TraceOptions, type TraceResult } from '~/utils/trace'
import { Tracer } from '~/utils/tracer'
import { Depther } from '~/utils/depther'
import type { DepthMap } from '~/utils/depth'
import type { Dims } from '~/utils/sculpt/types'
import type { DepthDevice } from '~/workers/depth.worker'

/**
 * Icon: flat artwork (logos, icons, type) traced and extruded, opened in glass.
 * Product: a photographed or illustrated object inflated into a volume that keeps its colours.
 * The mode sets what a fresh import opens as; every control stays available afterwards.
 */
export type StudioMode = 'icon' | 'product'
export const STUDIO_MODES: { id: StudioMode; label: string; title: string; hint: string; sample: string; icon: 'gem' | 'cuboid' }[] = [
  { id: 'icon', label: 'Icon', title: 'Icon studio', hint: 'Logos, icons and type as crisp glass or metal, shot on a wall', sample: 'vitrum', icon: 'gem' },
  { id: 'product', label: 'Product', title: 'Product studio', hint: 'A product photo rebuilt as a parts model you can walk around', sample: 'armchair', icon: 'cuboid' },
]

/**
 * What a mode opens an import as: the stage (wall or floor), the lens, and for a volume its
 * thickness and finish. A logo is a thin slab shot square on; an object is as deep as it is
 * wide, lit by the studio, and stands on a floor with a cast shadow.
 */
interface ModeProfile {
  /** Inflate depth as a share of the width; `null` keeps the current depth. */
  depthRatio: number | null
  roundness: number
  detail: number
  /** Material preset for a colour volume. */
  colourPreset: string
  /** The stage an import opens on: wall or floor, lens, backdrop and shadow. */
  stage: Pick<GlassParams, 'floor' | 'fov' | 'background' | 'vignette' | 'shadow'>
  /** Carve from the photo's real camera angle with the mirror view (products), or puff a pillow (icons). */
  symmetric: boolean
  /** How the outline is found: artwork on a page, or the whole object off the page. */
  traceMode: TraceOptions['mode']
}
const MODE_PROFILES: Record<StudioMode, ModeProfile> = {
  icon: {
    depthRatio: null, roundness: 0.6, detail: 0.35, colourPreset: 'satin', symmetric: false, traceMode: 'auto',
    stage: { floor: false, fov: DEFAULT_GLASS_PARAMS.fov, background: DEFAULT_GLASS_PARAMS.background, vignette: DEFAULT_GLASS_PARAMS.vignette, shadow: DEFAULT_GLASS_PARAMS.shadow },
  },
  // The reference product shot: 40° lens, flat white, a 0.18 shadow on the floor.
  product: {
    depthRatio: 0.55, roundness: 0.12, detail: 0.3, colourPreset: 'fabric', symmetric: true, traceMode: 'object',
    stage: { floor: true, fov: 40, background: '#ffffff', vignette: 0, shadow: 0.18 },
  },
}

/** Extra photos of the same object: their outlines carve the volume (`hull.ts`). */
export type ViewAxis = 'side' | 'top'
export interface StudioView {
  axis: ViewAxis
  image: HTMLImageElement
  trace: TraceResult
  /** Mirror the photo: a side taken from the other side, a top with the front at the top. */
  flip: boolean
  name: string
  preview: string
}
/** Hull cells along the longest side for each "Grid detail" choice. */
const HULL_RESOLUTION: Record<number, number> = { 256: 96, 512: 128, 1024: 176 }

/** Where the front photo was taken from, and whether the object's mirror view can be assumed. */
export interface ViewOptions {
  /** How far around the object the camera stood, in degrees: 0 straight on, 30–45 a typical product shot. */
  yaw: number
  /** Camera elevation in degrees. */
  pitch: number
  /** Which side the camera stood on; `auto` reads it from the outline's slanted top edge. */
  side: 'auto' | 'left' | 'right'
  /** Left–right symmetric object: the front photo's mirror counts as a second view. */
  symmetric: boolean
  /** 0..1: how deep the front photo's depth map cuts; 0 carves from outlines only. 0.4 suits relative-depth models, which exaggerate far surfaces. */
  depth: number
}
export const DEFAULT_VIEW_OPTIONS: ViewOptions = { yaw: 30, pitch: 10, side: 'auto', symmetric: true, depth: 0.4 }

export type DepthState = 'idle' | 'loading' | 'ready' | 'unavailable'
/** Long side of the photo crop sent to the depth model: its own input size, more is resampled away. */
const DEPTH_INPUT_PX = 518

export type ExportKind = 'glb' | 'stl' | 'png'

export interface ViewerHandle {
  exportGLB: (name?: string) => Promise<void>
  exportSTL: (name?: string) => void
  screenshot: (name?: string) => Promise<void>
  /** `screenshot` without the download — used by the dev hook the eval harness drives. */
  capture: (scale?: number) => Promise<Blob | null>
  frame: () => void
  setView: (v: ViewName) => void
  snap: (p: Partial<GlassParams>, applyNow?: boolean) => void
  setExternalModel: (group: THREE.Group | null) => void
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
  // Shallow: the image and trace inside a view are plain data for the worker, never proxied.
  const views = shallowReactive<Record<ViewAxis, StudioView | null>>({ side: null, top: null })
  const viewOpts = reactive<ViewOptions>({ ...DEFAULT_VIEW_OPTIONS })
  const hull = shallowRef<HullData | null>(null)
  const depther = new Depther(useRuntimeConfig().public.depthModel)
  /** The front photo's nearness map, once the model has run on the current trace. */
  const depthMap = shallowRef<DepthMap | null>(null)
  const depthState = ref<DepthState>(depther.available ? 'idle' : 'unavailable')
  const depthProgress = ref(0)
  const depthDevice = ref<DepthDevice | ''>('')
  depther.onProgress = (loaded, total) => { depthProgress.value = total ? loaded / total : 0 }
  /** Where the outline says the camera stood: −1 left, 1 right, 0 level (frontal). */
  const cameraSide = computed(() => {
    const t = trace.value
    return t && t.polygons.length ? estimateCameraSide({ polygons: t.polygons, width: t.width, height: t.height }) : 0
  })
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

  /**
   * The size a sculpt run is told to build to. Only a size the user set counts: every import
   * opens at the default width, and a guess passed as a measurement would mislead the planner.
   */
  function sculptDims(): Dims | null {
    if (glass.widthMm === DEFAULT_GLASS_PARAMS.widthMm) return null
    return { widthMm: glass.widthMm, heightMm: heightMm.value, depthMm: glass.depthMm }
  }
  const sculpt = useSculpt({
    image,
    dims: sculptDims,
    viewer,
    notify,
    // A parts model is a thing to walk around: it lands on the turntable, and the view
    // resets to the three-quarter angle the reference camera roughly shares.
    onLanded: () => {
      glass.autoRotate = true
      setView('angle')
      viewer.value?.frame()
    },
  })
  /** A parts model (draft or finished) stands on the stage: the carve controls no longer describe it. */
  const sculpted = computed(() => !!sculpt.job.value?.glb && sculpt.job.value.status !== 'cancelled')

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
    // A new object: the last run's parts model is not this one's. The run itself stays in the
    // history and can be reopened.
    sculpt.clear()
    trace.value = null
    relief.value = null
    // A new object: its side and top photos are not this one's.
    views.side = views.top = null
    hull.value = null
    depthMap.value = null
    if (depthState.value !== 'unavailable') depthState.value = 'idle'
    try {
      const img = await loadImage(file)
      importing.value.preview = thumbnail(img)
      image.value = img
      tracer.setSource(img)
      fileName.value = file.name
      traceOpts.mode = MODE_PROFILES[mode.value].traceMode
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
      await runHull()
      // Depth after the silhouette hull is shown; it rebuilds the hull when the map lands.
      void runDepth()
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
    const profile = MODE_PROFILES[mode.value]
    const stage: Partial<GlassParams> = { ...profile.stage }
    if (glass.geometry === 'inflate') {
      reliefOpts.roundness = profile.roundness
      reliefOpts.detail = profile.detail
      viewOpts.symmetric = profile.symmetric
      if (profile.depthRatio) stage.depthMm = Math.round(glass.widthMm * profile.depthRatio)
    } else if (glass.geometry === 'extrude' && glass.depthMm > glass.widthMm * 0.3) {
      // Back from a volume to a slab: the volume's depth would make a brick of a logo.
      stage.depthMm = DEFAULT_GLASS_PARAMS.depthMm
    }
    const colour = rich || (mode.value === 'product' && glass.geometry === 'inflate')
    if (colour) {
      autoFinish = 'print'
      const preset = MATERIAL_PRESETS.find(m => m.id === profile.colourPreset)!.values
      Object.assign(glass, preset, stage)
      viewer.value?.snap({ ...preset, ...stage, geometry: glass.geometry, reliefMm: DEFAULT_GLASS_PARAMS.reliefMm }, false)
    } else {
      const clear = autoFinish === 'print' && glass.finish === 'print' ? MATERIAL_PRESETS.find(m => m.id === 'clear')!.values : {}
      autoFinish = ''
      Object.assign(glass, clear, stage)
      viewer.value?.snap({ ...clear, ...stage, geometry: glass.geometry }, false)
    }
  }

  /**
   * Switch the mode and open the current image again the way the new mode would, so the switch
   * shows on the stage at once instead of waiting for the next import.
   */
  async function setMode(m: StudioMode) {
    if (mode.value === m) return
    mode.value = m
    if (!image.value || importing.value) return
    traceOpts.mode = MODE_PROFILES[m].traceMode
    clearTimeout(traceTimer)
    clearTimeout(reliefTimer)
    await runTrace({ fitBevel: true, pickGeometry: true })
    if (glass.geometry === 'stack') { clearTimeout(traceTimer); await runTrace({ fitBevel: true }) }
    if (glass.geometry === 'inflate' || glass.geometry === 'relief') await runRelief()
    depthMap.value = null
    if (depthState.value !== 'unavailable') depthState.value = 'idle'
    await runHull()
    void runDepth()
    setView('angle')
    notify(`Opened as ${STUDIO_MODES.find(x => x.id === m)!.label.toLowerCase()}`)
  }

  /**
   * Carve the volume from every view there is: the front photo from its real camera angle, its
   * mirror when the object is symmetric, a side and top photo when given. With none of those
   * (an icon) the single-photo Inflate pillow stands and the hull is dropped.
   */
  async function runHull(): Promise<void> {
    const t = trace.value
    if (glass.geometry !== 'inflate' || !t || !t.polygons.length || (!viewOpts.symmetric && !views.side && !views.top)) {
      hull.value = null
      return
    }
    busy.value = true
    try {
      const mask = (tr: TraceResult) => ({ polygons: tr.polygons, width: tr.width, height: tr.height })
      // Signed yaw: negative when the camera stood on the object's left.
      const side = viewOpts.side === 'auto' ? (cameraSide.value || -1) : viewOpts.side === 'left' ? -1 : 1
      const hullViews: HullView[] = [{ mask: mask(t), source: 'front', yaw: side * viewOpts.yaw, pitch: viewOpts.pitch, depth: viewOpts.depth > 0 ? depthMap.value ?? undefined : undefined }]
      // Side photo from the object's left shows its front on the right; mirrored, from the right.
      if (views.side) hullViews.push({ mask: mask(views.side.trace), source: 'side', yaw: views.side.flip ? 90 : -90, pitch: 0 })
      // Top photo with the front at the bottom; mirrored, turned half round.
      if (views.top) hullViews.push({ mask: mask(views.top.trace), source: 'top', yaw: views.top.flip ? 180 : 0, pitch: 90 })
      const got = await tracer.hull(hullViews, {
        resolution: HULL_RESOLUTION[reliefOpts.resolution] ?? 128,
        roundness: reliefOpts.roundness,
        depthRatio: glass.depthMm / glass.widthMm,
        symmetric: viewOpts.symmetric,
        depth: viewOpts.depth,
      })
      if (!got || trace.value !== t) { busy.value = false; return }
      if (import.meta.dev) console.debug(`[hull] ${Math.round(got.ms)} ms (${got.where}), ${got.result.positions.length / 9} tris`)
      // The views fix the depth; the D field follows so the numbers and the model agree.
      const depthMm = +(glass.widthMm * got.result.size[2]).toFixed(1)
      viewer.value?.snap({ depthMm }, false)
      glass.depthMm = depthMm
      hull.value = got.result
      error.value = ''
    } catch (e) {
      error.value = (e as Error).message
    }
    busy.value = false
  }

  /**
   * Run the depth model on the front photo and carve with its map. Product mode only, after the
   * silhouette hull is on screen: the model needs a download the first time and a second or two
   * on a CPU, so the outline hull stands in until the relief arrives.
   */
  async function runDepth(): Promise<void> {
    const t = trace.value, img = image.value
    if (!img || !t || !t.polygons.length || mode.value !== 'product' || glass.geometry !== 'inflate' || viewOpts.depth <= 0) return
    if (depthState.value === 'unavailable') return
    depthState.value = 'loading'
    depthProgress.value = 0
    busy.value = true
    try {
      const data = rasterize(img, DEPTH_INPUT_PX, t.crop)
      const mask = rasterizeMask({ polygons: t.polygons, width: t.width, height: t.height }, data.width, data.height)
      const got = await depther.depth(data, mask)
      if (!got || trace.value !== t) {
        busy.value = false
        // Superseded by a newer request: that one owns the state. Stale trace: back to idle so the next hull change can retry.
        if (got && depthState.value === 'loading') depthState.value = 'idle'
        return
      }
      if (import.meta.dev) console.debug(`[depth] ${Math.round(got.ms)} ms (${got.device}), ${got.map.w}×${got.map.h}`)
      depthMap.value = got.map
      depthDevice.value = got.device
      depthState.value = 'ready'
      await runHull()
    } catch (e) {
      if (import.meta.dev) console.warn('[depth]', e)
      depthMap.value = null
      depthState.value = 'unavailable'
      notify('Depth model unavailable; carved from outlines only')
      busy.value = false
    }
  }

  /** Add a side or top photo of the same object; its outline joins the carve. */
  async function addView(axis: ViewAxis, file: File) {
    if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg')) {
      error.value = 'Use a PNG, JPG, WebP or SVG.'
      return
    }
    busy.value = true
    error.value = ''
    const t = new Tracer()
    try {
      const img = await loadImage(file)
      t.setSource(img)
      const got = await t.trace({ ...DEFAULT_TRACE_OPTIONS, resolution: 512, mode: 'object' })
      if (!got || !got.result.polygons.length) {
        error.value = `No outline found in the ${axis} photo. Use a picture on a plain background.`
        return
      }
      views[axis] = { axis, image: img, trace: got.result, flip: false, name: file.name, preview: thumbnail(img, 96) }
      if (glass.geometry !== 'inflate') glass.geometry = 'inflate'
      else await runHull()
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      t.dispose()
      busy.value = false
    }
  }
  function removeView(axis: ViewAxis) {
    views[axis] = null
    void runHull()
  }
  function flipView(axis: ViewAxis) {
    const v = views[axis]
    if (!v) return
    views[axis] = { ...v, flip: !v.flip }
    void runHull()
  }
  function onPickView(axis: ViewAxis, e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) void addView(axis, file)
    input.value = ''
  }
  /** What the renderer paints the hull from: each view's photo and the region its outline covers. */
  const hullSources = computed<HullSources | null>(() => {
    const img = image.value, t = trace.value
    if (!img || !t) return null
    const mask = (tr: TraceResult) => ({ polygons: tr.polygons, width: tr.width, height: tr.height })
    const src = (v: StudioView | null) => v ? { image: v.image, crop: v.trace.crop, mask: mask(v.trace) } : null
    return { front: { image: img, crop: t.crop, mask: mask(t) }, side: src(views.side), top: src(views.top) }
  })
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
      const prev = trace.value
      const realigned = !!prev && (prev.width !== result.width || prev.height !== result.height
        || prev.crop.x !== result.crop.x || prev.crop.y !== result.crop.y || prev.crop.w !== result.crop.w || prev.crop.h !== result.crop.h)
      if (realigned && depthMap.value) {
        // The map was aligned to the old crop; carve from outlines until the model has run again.
        depthMap.value = null
        if (depthState.value !== 'unavailable') depthState.value = 'idle'
      }
      trace.value = result
      if (glass.geometry !== 'extrude' && !opts.pickGeometry) void runRelief()
      if (!opts.pickGeometry) void runHull()
      if (!opts.pickGeometry && realigned) void runDepth()
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
    reliefTimer = setTimeout(() => { void runRelief(); if (hull.value) void runHull() }, 120)
  }, { deep: true })
  let hullTimer: ReturnType<typeof setTimeout> | undefined
  watch(() => [viewOpts.yaw, viewOpts.pitch, viewOpts.symmetric, glass.depthMm, viewOpts.side, viewOpts.depth], (now, was) => {
    if (importing.value) return
    // The depth field only drives the carve when no side or top photo measures it.
    if (now[3] !== was?.[3] && (views.side || views.top)) return
    clearTimeout(hullTimer)
    hullTimer = setTimeout(() => {
      void runHull()
      if (viewOpts.depth > 0 && !depthMap.value && depthState.value === 'idle') void runDepth()
    }, 150)
  })
  watch(() => glass.geometry, (g) => {
    const retrace = traceOpts.stack !== (g === 'stack')
    if (retrace) traceOpts.stack = g === 'stack'
    const have = relief.value && relief.value.mirror === (g === 'inflate')
    if ((g === 'inflate' || g === 'relief') && !have && !importing.value && !retrace) void runRelief()
    if (!importing.value && !retrace) void runHull()
    if (g === 'relief') error.value = ''
    else if (trace.value && !trace.value.polygons.length) error.value = 'No outline found. Try another source mode, or switch to Relief.'
  })
  watch(() => glass.depthMm, (d) => { if (glass.bevelMm > d / 2) glass.bevelMm = Math.max(0, +(d / 2).toFixed(1)) })

  function clearImage() {
    // The parts model was built from this photo: it goes with it.
    sculpt.clear()
    image.value = null
    tracer.setSource(null)
    trace.value = null
    relief.value = null
    views.side = views.top = null
    hull.value = null
    depthMap.value = null
    if (depthState.value !== 'unavailable') depthState.value = 'idle'
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
    clearTimeout(hullTimer)
    clearTimeout(toastTimer)
    tracer.dispose()
    depther.dispose()
  })

  const aspect = computed(() => {
    const r = relief.value
    const g = glass.geometry
    if (g === 'inflate' && hull.value) return hull.value.size[1]
    if ((g === 'inflate' || g === 'relief') && r && r.mirror === (g === 'inflate')) return reliefAspect(r)
    const t = trace.value
    if (!t) return 1
    return (t.bbox.maxY - t.bbox.minY) / Math.max(t.bbox.maxX - t.bbox.minX, 1e-6)
  })
  const heightMm = computed(() => glass.widthMm * aspect.value)
  function setHeight(v: number) {
    if (v > 0 && aspect.value > 0) glass.widthMm = v / aspect.value
  }

  /**
   * Dev-only handle for the sculpt eval harness (`scripts/sculpt-eval.ts`),
   * which drives the real studio from Playwright: `state()` is the stable
   * "the import has settled, a run may start" signal, `screenshot()` is the
   * viewer render as a data URL (the exposed `screenshot` downloads instead).
   * `useSculpt` created `window.__vitrum`; this only adds to it.
   */
  if (import.meta.dev && import.meta.client) {
    const hook: StudioDevHook = {
      state: () => ({
        mode: mode.value,
        fileName: fileName.value,
        hasImage: !!image.value,
        hasTrace: !!trace.value,
        hasHull: !!hull.value,
        busy: busy.value,
        importing: !!importing.value,
        error: error.value,
        dims: dims.value ? { ...dims.value } : null,
        size: { widthMm: glass.widthMm, heightMm: heightMm.value, depthMm: glass.depthMm },
      }),
      screenshot: async () => {
        const blob = await viewer.value?.capture()
        if (!blob) return null
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error('could not read the screenshot'))
          reader.readAsDataURL(blob)
        })
      },
    }
    // `useSculpt` runs first and creates the object; if that ever changes, say
    // so loudly rather than leaving the harness waiting on a hook that is half
    // there.
    if (window.__vitrum) window.__vitrum.studio = hook
    else console.warn('[vitrum] window.__vitrum was not created by useSculpt — the studio dev hook is not attached')
  }

  return {
    mode, image, fileName, trace, traceOpts, reliefOpts, relief, views, viewOpts, cameraSide, hull, depthState, depthProgress, depthDevice, hullSources, glass, dims, busy, importing, error,
    dragging, exporting, toast, view, viewer, heightMm, sculpt, sculpted,
    setView, setMode, useFile, clearImage, onDrop, onPick, onPickView, removeView, flipView, loadSample, doExport, setHeight, notify,
  }
}

/** What `scripts/sculpt-eval.ts` reads off the studio; dev builds only. */
export interface StudioDevHook {
  state: () => {
    mode: StudioMode
    fileName: string
    hasImage: boolean
    hasTrace: boolean
    hasHull: boolean
    busy: boolean
    importing: boolean
    error: string
    dims: ModelDimensions | null
    size: { widthMm: number, heightMm: number, depthMm: number }
  }
  /** The viewer render as a PNG data URL, or `null` before the viewer is up. */
  screenshot: () => Promise<string | null>
}

declare global {
  interface Window {
    /** Dev-only handle for the sculpt eval harness; `useSculpt` creates it, `useStudio` adds `studio`. */
    __vitrum?: { sculpt: SculptApi, studio?: StudioDevHook }
  }
}
