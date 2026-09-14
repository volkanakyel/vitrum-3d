import * as THREE from 'three'
import { buildExtrudeGeometry } from './extrude'
import { createStudioEnvironment } from './glassScene'
import { DEFAULT_GLASS_PARAMS, MATERIAL_PRESETS, type GlassParams } from './presets'
import { buildCropTexture, buildPrintTexture } from './printTexture'
import { buildReliefGeometry, computeRelief, DEFAULT_RELIEF_OPTIONS } from './relief'
import { DEFAULT_TRACE_OPTIONS, traceImage, type TraceResult } from './trace'
import { drawSample, SAMPLES, type Sample } from './samples'

/**
 * The landing page's showroom. Every object is built from `SAMPLES` through the same trace →
 * extrude / inflate pipeline as the studio; nothing is downloaded.
 *
 * Two layouts share the renderer, environment and materials:
 *   story   — one object (the Vitrum mark) on the right, turning as the page scrolls. The camera
 *             never moves; scroll progress drives the object's rotation, so it always reads as
 *             "the thing being talked about" beside the text on the left.
 *   gallery — a fixed camera over two rows: six icons above, two inflated products below.
 */
export type Layout = 'story' | 'gallery'

interface Placed {
  id: string
  group: THREE.Group
  home: THREE.Vector3
  spin: number
  phase: number
}

export const GALLERY_ICONS = ['heart', 'bolt', 'star', 'play', 'leaf', 'ring']
export const GALLERY_PRODUCTS = ['armchair', 'mug']
const ICON_GAP = 150
const ROW_ICONS_Y = 70
const ROW_PRODUCTS_Y = -210

export class Showcase {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private placed: Placed[] = []
  private progress = 0
  private shownProgress = 0
  private pointer = new THREE.Vector2()
  private shownPointer = new THREE.Vector2()
  private raf = 0
  private last = 0
  private disposed = false
  private visible = true
  private pmrem: THREE.PMREMGenerator
  private shadowTex: THREE.CanvasTexture
  private backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private static readonly BACKDROP_DISTANCE = 6000
  private story: THREE.Mesh | null = null
  private storyDepth = 12
  private storyTrace: { trace: TraceResult; source: HTMLCanvasElement } | null = null
  private target = new THREE.Vector3()
  /** Fires once per object as it lands, so the page can reveal its caption. */
  onPlaced: ((id: string) => void) | null = null
  onReady: (() => void) | null = null

  constructor(private canvas: HTMLCanvasElement, private opts: { layout: Layout; narrow: boolean }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.setClearColor(0xeceef2, 1)
    this.camera = new THREE.PerspectiveCamera(26, 1, 1, 12000)
    this.pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = this.pmrem.fromScene(createStudioEnvironment(), 0.02).texture

    // A soft backdrop pinned to the camera: the light table the objects sit on, and the thing
    // the glass has to refract. Without it transmission samples an empty buffer and reads white.
    const bg = document.createElement('canvas')
    bg.width = bg.height = 1024
    const bctx = bg.getContext('2d')!
    const grad = bctx.createRadialGradient(512, 430, 60, 512, 512, 700)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.45, '#eff1f5')
    grad.addColorStop(1, '#d6d9e1')
    bctx.fillStyle = grad
    bctx.fillRect(0, 0, 1024, 1024)
    const pool = bctx.createRadialGradient(640, 380, 0, 640, 380, 420)
    pool.addColorStop(0, 'rgba(47,111,237,0.16)')
    pool.addColorStop(1, 'rgba(47,111,237,0)')
    bctx.fillStyle = pool
    bctx.fillRect(0, 0, 1024, 1024)
    const bgTex = new THREE.CanvasTexture(bg)
    bgTex.colorSpace = THREE.SRGBColorSpace
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: bgTex, toneMapped: false }))
    this.backdrop.position.z = -Showcase.BACKDROP_DISTANCE
    this.camera.add(this.backdrop)
    this.scene.add(this.camera)

    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(-1, 1.2, 1.6)
    const rim = new THREE.DirectionalLight(0xdfe9ff, 1.2)
    rim.position.set(1.4, -0.4, -1)
    this.scene.add(key, rim)

    const sc = document.createElement('canvas')
    sc.width = sc.height = 256
    const sctx = sc.getContext('2d')!
    const g = sctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    g.addColorStop(0, 'rgba(13,14,18,0.5)')
    g.addColorStop(0.45, 'rgba(13,14,18,0.16)')
    g.addColorStop(1, 'rgba(13,14,18,0)')
    sctx.fillStyle = g
    sctx.fillRect(0, 0, 256, 256)
    this.shadowTex = new THREE.CanvasTexture(sc)

    this.placeCamera()
    this.resize()
    this.last = performance.now()
    this.loop(this.last)
  }

  /** Fixed camera per layout. A narrow viewport stacks: object above the text. */
  private placeCamera() {
    const n = this.opts.narrow
    if (this.opts.layout === 'story') {
      this.camera.position.set(0, 30, n ? 960 : 520)
      // Look left of the object on desktop so it sits in the right half; below it on phones so
      // it rides in the upper half above the copy.
      this.target.set(n ? 0 : -78, n ? -125 : 0, 0)
    } else {
      const centre = (ICON_GAP * (GALLERY_ICONS.length - 1)) / 2
      this.camera.position.set(centre, 0, n ? 4200 : 1320)
      this.target.set(centre, n ? -60 : -64, 0)
    }
    this.camera.lookAt(this.target)
  }

  /** Build the layout's objects, yielding between them so the page stays responsive. */
  async load() {
    const idle = () => new Promise<void>(r => setTimeout(r, 0))
    if (this.opts.layout === 'story') {
      const brand = SAMPLES.find(s => s.id === 'vitrum')!
      this.story = this.place(brand, new THREE.Vector3(0, 0, 0), 120, 'story')
      this.onReady?.()
      return
    }
    const centre = (ICON_GAP * (GALLERY_ICONS.length - 1)) / 2
    for (const [i, id] of GALLERY_ICONS.entries()) {
      this.place(SAMPLES.find(x => x.id === id)!, new THREE.Vector3(i * ICON_GAP, ROW_ICONS_Y, 0), 92)
      await idle()
    }
    const productX = [centre - 150, centre + 150]
    for (const [i, id] of GALLERY_PRODUCTS.entries()) {
      this.placeProduct(SAMPLES.find(x => x.id === id)!, new THREE.Vector3(productX[i]!, ROW_PRODUCTS_Y, 0), i === 0 ? 170 : 120)
      await idle()
    }
    this.onReady?.()
  }

  private trace(sample: Sample, stack = false): { trace: TraceResult; source: HTMLCanvasElement } {
    const source = drawSample(sample, 768)
    const trace = traceImage(source as unknown as ImageBitmap, { ...DEFAULT_TRACE_OPTIONS, resolution: 768, stack, mode: 'auto' })
    return { trace, source }
  }

  private place(sample: Sample, home: THREE.Vector3, widthMm: number, id = sample.id): THREE.Mesh | null {
    const stack = sample.id === 'play'
    const traced = this.trace(sample, stack)
    const { trace, source } = traced
    if (!trace.polygons.length) return null
    const depth = widthMm * 0.12
    const bevel = Math.min(3, Math.max(0.6, (trace.strokeWidth * widthMm) / Math.max(1, trace.bbox.maxX - trace.bbox.minX) * 0.3))
    const built = buildExtrudeGeometry(trace, { widthMm, depthMm: depth, bevelMm: bevel, bevelSegments: 8, layerMm: 2, stack })
    if (!built) return null
    const preset = MATERIAL_PRESETS.find(p => p.id === sample.preset)!
    const params = { ...DEFAULT_GLASS_PARAMS, ...preset.values, depthMm: depth }
    const material = this.material(params, () => buildPrintTexture(source as unknown as HTMLImageElement, trace))
    const mesh = new THREE.Mesh(built.geometry, material)
    this.mount(id, mesh, home, widthMm, built.frame.bh * built.frame.scale, depth)
    if (id === 'story') { this.storyDepth = depth; this.storyTrace = traced }
    return mesh
  }

  private placeProduct(sample: Sample, home: THREE.Vector3, widthMm: number) {
    const { trace, source } = this.trace(sample)
    if (!trace.polygons.length) return
    const mask = { polygons: trace.polygons, width: trace.width, height: trace.height }
    const relief = computeRelief(source as unknown as ImageBitmap, { ...DEFAULT_RELIEF_OPTIONS, inflate: true, resolution: 448, roundness: 0.6, detail: 0.35, smooth: 1.5 }, trace.crop, mask)
    const depth = widthMm * 0.32
    const geo = buildReliefGeometry(relief, { widthMm, baseMm: 0, reliefMm: depth / 2 })
    const centre = geo.boundingBox!.getCenter(new THREE.Vector3())
    geo.translate(-centre.x, -centre.y, -centre.z)
    geo.computeBoundingBox()
    const size = geo.boundingBox!.getSize(new THREE.Vector3())
    const preset = MATERIAL_PRESETS.find(p => p.id === sample.preset)!
    const params = { ...DEFAULT_GLASS_PARAMS, ...preset.values, depthMm: depth }
    const material = this.material(params, () => buildCropTexture(source as unknown as HTMLImageElement, relief.crop))
    this.mount(sample.id, new THREE.Mesh(geo, material), home, size.x, size.y, size.z)
  }

  private mount(id: string, mesh: THREE.Mesh, home: THREE.Vector3, w: number, h: number, depth: number) {
    const group = new THREE.Group()
    group.add(mesh)
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.5, toneMapped: false }),
    )
    shadow.scale.set(w * 1.5, h * 1.5, 1)
    shadow.position.set(w * 0.02, -h * 0.02, -depth * 1.4)
    shadow.renderOrder = -1
    group.add(shadow)
    group.position.copy(home)
    group.position.y = home.y - 40
    group.scale.setScalar(0.92)
    group.userData.landing = 0
    this.scene.add(group)
    const n = this.placed.length
    this.placed.push({ id, group, home: home.clone(), spin: (n % 2 ? -1 : 1) * 0.16, phase: n * 1.37 })
    this.onPlaced?.(id)
  }

  /** A single-pass physical material per finish; glass uses three's own transmission. */
  private material(p: GlassParams, texture: () => HTMLCanvasElement): THREE.MeshPhysicalMaterial {
    if (p.finish === 'glass') {
      return new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: p.roughness,
        transmission: p.clarity,
        thickness: p.depthMm,
        ior: p.ior,
        dispersion: p.dispersion * 6,
        attenuationColor: new THREE.Color(p.tint),
        attenuationDistance: p.attenuationMm,
        clearcoat: p.clearcoat,
        clearcoatRoughness: 0.04,
        iridescence: p.edgeChroma,
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [120, 480],
        envMapIntensity: p.envIntensity,
        specularIntensity: 1,
      })
    }
    if (p.finish === 'metal') {
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(p.tint),
        metalness: p.metalness,
        roughness: p.roughness,
        clearcoat: p.clearcoat,
        clearcoatRoughness: 0.08,
        envMapIntensity: p.envIntensity * 1.25,
      })
    }
    const map = new THREE.CanvasTexture(texture())
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 8
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map,
      metalness: 0,
      roughness: p.roughness,
      clearcoat: p.clearcoat,
      clearcoatRoughness: 0.12,
      envMapIntensity: p.envIntensity,
    })
  }

  /** Swap the story object's finish. */
  setPreset(id: string) {
    const preset = MATERIAL_PRESETS.find(p => p.id === id)
    const mesh = this.story
    if (!preset || !mesh || !this.storyTrace) return
    const params = { ...DEFAULT_GLASS_PARAMS, ...preset.values, depthMm: this.storyDepth }
    const old = mesh.material as THREE.MeshPhysicalMaterial
    const { trace, source } = this.storyTrace
    mesh.material = this.material(params, () => buildPrintTexture(source as unknown as HTMLImageElement, trace))
    old.map?.dispose()
    old.dispose()
  }

  /** Story: 0 at the top of the pinned section, 1 per beat. Drives the object's turn. */
  setProgress(p: number) {
    this.progress = Math.max(0, p)
  }

  /** Pointer in [-1, 1] across the viewport; objects lean toward it. */
  setPointer(x: number, y: number) {
    this.pointer.set(x, y)
  }

  /** Where an object's centre lands on the canvas, in CSS px; null before it is placed. */
  project(id: string, out = new THREE.Vector3()): { x: number; y: number; z: number } | null {
    const o = this.placed.find(p => p.id === id)
    if (!o) return null
    out.copy(o.group.position).project(this.camera)
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight
    return { x: (out.x * 0.5 + 0.5) * w, y: (-out.y * 0.5 + 0.5) * h, z: out.z }
  }

  setVisible(v: boolean) {
    this.visible = v
    if (v && !this.raf && !this.disposed) { this.last = performance.now(); this.loop(this.last) }
  }

  resize() {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    const bh = 2 * Showcase.BACKDROP_DISTANCE * Math.tan((this.camera.fov * Math.PI) / 360) * 1.3
    this.backdrop.scale.set(bh * this.camera.aspect, bh, 1)
  }

  private loop = (now: number) => {
    if (this.disposed) return
    if (!this.visible) { this.raf = 0; return }
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    const t = now / 1000
    // Scroll and pointer both ease so a fast wheel flick reads as one smooth turn.
    this.shownProgress += (this.progress - this.shownProgress) * (1 - Math.exp(-dt * 5))
    this.shownPointer.lerp(this.pointer, 1 - Math.exp(-dt * 4))
    const story = this.opts.layout === 'story'

    for (const o of this.placed) {
      const g = o.group
      const landing = Math.min(1, (g.userData.landing as number) + dt * 1.4)
      g.userData.landing = landing
      const e = 1 - Math.pow(1 - landing, 3)
      g.position.y = o.home.y - 40 * (1 - e) + Math.sin(t * 0.7 + o.phase) * 3
      g.scale.setScalar(0.92 + 0.08 * e)
      if (story) {
        // One full turn over the three scrolled beats, plus a slow idle sway so it never sits still.
        g.rotation.y = this.shownProgress * (Math.PI * 2 / 3) + Math.sin(t * 0.4) * 0.12 + this.shownPointer.x * 0.1
        g.rotation.x = Math.sin(t * 0.3) * 0.05 - this.shownPointer.y * 0.06
      } else {
        g.rotation.y = Math.sin(t * o.spin + o.phase) * 0.5 + this.shownPointer.x * 0.1
        g.rotation.x = Math.sin(t * 0.35 + o.phase) * 0.05 - this.shownPointer.y * 0.06
      }
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.scene.traverse(obj => {
      const m = obj as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.MeshPhysicalMaterial | undefined
      if (mat) { mat.map?.dispose(); mat.dispose() }
    })
    this.shadowTex.dispose()
    this.backdrop.material.map?.dispose()
    this.pmrem.dispose()
    this.renderer.dispose()
  }
}
