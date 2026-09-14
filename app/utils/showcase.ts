import * as THREE from 'three'
import { buildExtrudeGeometry } from './extrude'
import { createStudioEnvironment, MATERIAL_PRESETS, DEFAULT_GLASS_PARAMS, type GlassParams } from './glassScene'
import { buildCropTexture, buildPrintTexture } from './printTexture'
import { buildReliefGeometry, computeRelief, DEFAULT_RELIEF_OPTIONS } from './relief'
import { DEFAULT_TRACE_OPTIONS, traceImage, type TraceResult } from './trace'
import { drawSample, SAMPLES, type Sample } from './samples'

/**
 * The landing page's showroom: one WebGL canvas fixed behind the page, a rail of real objects
 * built from `SAMPLES` through the same trace → extrude / inflate pipeline as the studio, and a
 * camera that docks at a station per page section as the visitor scrolls.
 *
 * Stations (in scene millimetres along x):
 *   0 hero      — the Vitrum mark in crystal, alone
 *   1 icons     — six icons in a row, each a different finish
 *   2 products  — two illustrated products inflated into colour volumes
 *   3 materials — one object whose finish the visitor changes
 */
export const STATIONS = ['hero', 'icons', 'products', 'materials'] as const
export type Station = (typeof STATIONS)[number]

interface Placed {
  id: string
  group: THREE.Group
  home: THREE.Vector3
  /** Radians per second of idle spin; sign alternates so neighbours turn against each other. */
  spin: number
  phase: number
}

interface CameraKey {
  position: THREE.Vector3
  target: THREE.Vector3
}

const RAIL = {
  hero: 0,
  icons: 900,
  products: 2900,
  materials: 3900,
} as const
const ICON_GAP = 150
const ICON_IDS = ['heart', 'bolt', 'star', 'play', 'leaf', 'ring']
const PRODUCT_IDS = ['armchair', 'mug']

export class Showcase {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private placed: Placed[] = []
  private keys: CameraKey[]
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
  private materialsObject: THREE.Mesh | null = null
  private materialsDepth = 12
  /** Fires once per object as it lands, so the page can reveal its caption. */
  onPlaced: ((id: string) => void) | null = null
  onReady: (() => void) | null = null

  constructor(private canvas: HTMLCanvasElement, private opts: { narrow: boolean } = { narrow: false }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.setClearColor(0xeceef2, 1)
    this.camera = new THREE.PerspectiveCamera(26, 1, 1, 12000)
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
    // A pool of cold light off-centre, so refraction has a gradient to bend.
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
    this.pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = this.pmrem.fromScene(createStudioEnvironment(), 0.02).texture

    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(-1, 1.2, 1.6)
    const rim = new THREE.DirectionalLight(0xdfe9ff, 1.2)
    rim.position.set(1.4, -0.4, -1)
    this.scene.add(key, rim)

    // One soft disc texture shared by every contact shadow.
    const sc = document.createElement('canvas')
    sc.width = sc.height = 256
    const g = sc.getContext('2d')!.createRadialGradient(128, 128, 0, 128, 128, 128)
    g.addColorStop(0, 'rgba(13,14,18,0.55)')
    g.addColorStop(0.45, 'rgba(13,14,18,0.18)')
    g.addColorStop(1, 'rgba(13,14,18,0)')
    const sctx = sc.getContext('2d')!
    sctx.fillStyle = g
    sctx.fillRect(0, 0, 256, 256)
    this.shadowTex = new THREE.CanvasTexture(sc)

    this.keys = this.buildKeys()
    this.resize()
    this.camera.position.copy(this.keys[0]!.position)
    this.last = performance.now()
    this.loop(this.last)
  }

  /** Camera stations. A narrow viewport pulls back so the rail still fits. */
  private buildKeys(): CameraKey[] {
    const n = this.opts.narrow
    const iconsCentre = RAIL.icons + (ICON_GAP * (ICON_IDS.length - 1)) / 2
    return [
      { position: new THREE.Vector3(n ? 0 : -90, 50, n ? 720 : 520), target: new THREE.Vector3(n ? 0 : -62, n ? -60 : 4, 0) },
      { position: new THREE.Vector3(iconsCentre, 90, n ? 4000 : 1750), target: new THREE.Vector3(iconsCentre, n ? 120 : 62, 0) },
      { position: new THREE.Vector3(RAIL.products + 120, 40, n ? 980 : 840), target: new THREE.Vector3(RAIL.products + (n ? 110 : 230), n ? 30 : 0, 0) },
      { position: new THREE.Vector3(RAIL.materials + (n ? 0 : -60), 30, n ? 560 : 480), target: new THREE.Vector3(RAIL.materials + (n ? 0 : -70), n ? 40 : -10, 0) },
    ]
  }

  /** Build every object, hero first, yielding between them so the page stays responsive. */
  async load() {
    const idle = () => new Promise<void>(r => setTimeout(r, 0))
    const brand = SAMPLES.find(s => s.id === 'vitrum')!
    this.place(brand, new THREE.Vector3(RAIL.hero, 0, 0), 110)
    await idle()
    // The materials object is a second copy of the mark, further down the rail.
    const m = this.place(brand, new THREE.Vector3(RAIL.materials, 0, 0), 110, 'materials')
    this.materialsObject = m
    await idle()
    for (const [i, id] of ICON_IDS.entries()) {
      const s = SAMPLES.find(x => x.id === id)!
      this.place(s, new THREE.Vector3(RAIL.icons + i * ICON_GAP, 0, 0), 92)
      await idle()
    }
    for (const [i, id] of PRODUCT_IDS.entries()) {
      const s = SAMPLES.find(x => x.id === id)!
      this.placeProduct(s, new THREE.Vector3(RAIL.products + i * 230, 0, 0), i === 0 ? 170 : 120)
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
    const { trace, source } = this.trace(sample, stack)
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
    if (id === 'materials') this.materialsDepth = depth
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
    const mesh = new THREE.Mesh(geo, material)
    this.mount(sample.id, mesh, home, size.x, size.y, size.z)
  }

  private mount(id: string, mesh: THREE.Mesh, home: THREE.Vector3, w: number, h: number, depth: number) {
    const group = new THREE.Group()
    group.add(mesh)
    // Contact shadow: a soft disc under the object, slightly behind its mid-plane.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.55, toneMapped: false }),
    )
    shadow.scale.set(w * 1.5, h * 1.5, 1)
    shadow.position.set(w * 0.02, -h * 0.02, -depth * 1.4)
    shadow.renderOrder = -1
    group.add(shadow)
    group.position.copy(home)
    // Land: rise from below the rail and settle.
    group.position.y = home.y - 40
    group.scale.setScalar(0.92)
    group.userData.landing = 0
    this.scene.add(group)
    const n = this.placed.length
    this.placed.push({ id, group, home: home.clone(), spin: (n % 2 ? -1 : 1) * 0.16, phase: n * 1.37 })
    this.onPlaced?.(id)
  }

  /** A single-pass physical material for each finish; glass uses three's own transmission. */
  private material(p: GlassParams, texture: () => HTMLCanvasElement): THREE.MeshPhysicalMaterial {
    if (p.finish === 'glass') {
      const m = new THREE.MeshPhysicalMaterial({
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
      return m
    }
    if (p.finish === 'metal') {
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(p.tint),
        metalness: p.metalness,
        roughness: p.roughness,
        clearcoat: p.clearcoat,
        clearcoatRoughness: 0.08,
        envMapIntensity: p.envIntensity,
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

  /** Swap the finish of the materials-station object. */
  setPreset(id: string) {
    const preset = MATERIAL_PRESETS.find(p => p.id === id)
    const mesh = this.materialsObject
    if (!preset || !mesh) return
    const params = { ...DEFAULT_GLASS_PARAMS, ...preset.values, depthMm: this.materialsDepth }
    const old = mesh.material as THREE.MeshPhysicalMaterial
    mesh.material = this.material(params, () => {
      const brand = SAMPLES.find(s => s.id === 'vitrum')!
      const { trace, source } = this.trace(brand)
      return buildPrintTexture(source as unknown as HTMLImageElement, trace)
    })
    old.map?.dispose()
    old.dispose()
  }

  /** 0 = hero, 1 = icons, … fractional between stations. */
  setProgress(p: number) {
    this.progress = Math.max(0, Math.min(STATIONS.length - 1, p))
  }

  /** Pointer in [-1, 1] across the viewport; the camera leans toward it. */
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

  has(id: string) {
    return this.placed.some(p => p.id === id)
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
    // Fill the frustum at the backdrop's distance, with a margin for the pointer lean.
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

    // Camera: ease toward the docked station, then lean with the pointer.
    this.shownProgress += (this.progress - this.shownProgress) * (1 - Math.exp(-dt * 6))
    this.shownPointer.lerp(this.pointer, 1 - Math.exp(-dt * 4))
    const i = Math.floor(this.shownProgress)
    const f = this.shownProgress - i
    const a = this.keys[Math.min(i, this.keys.length - 1)]!
    const b = this.keys[Math.min(i + 1, this.keys.length - 1)]!
    // Smoothstep so the camera rests at each station and glides between them.
    const s = f * f * (3 - 2 * f)
    const pos = a.position.clone().lerp(b.position, s)
    const tgt = a.target.clone().lerp(b.target, s)
    // Between stations the camera lifts and pulls back a little, like a crane move.
    const lift = Math.sin(s * Math.PI)
    pos.y += lift * 60
    pos.z += lift * 260
    pos.x += this.shownPointer.x * 18
    pos.y += this.shownPointer.y * 12
    this.camera.position.copy(pos)
    this.camera.lookAt(tgt)

    for (const o of this.placed) {
      const g = o.group
      const landing = Math.min(1, (g.userData.landing as number) + dt * 1.4)
      g.userData.landing = landing
      const e = 1 - Math.pow(1 - landing, 3)
      g.position.y = o.home.y - 40 * (1 - e) + Math.sin(t * 0.7 + o.phase) * 3
      g.scale.setScalar(0.92 + 0.08 * e)
      g.rotation.y = Math.sin(t * o.spin + o.phase) * 0.55 + this.shownPointer.x * 0.12
      g.rotation.x = Math.sin(t * 0.35 + o.phase) * 0.06 - this.shownPointer.y * 0.08
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
