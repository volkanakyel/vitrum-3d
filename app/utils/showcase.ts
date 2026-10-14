import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildExtrudeGeometry } from './extrude'
import { createStudioEnvironment } from './glassScene'
import { DEFAULT_GLASS_PARAMS, MATERIAL_PRESETS, type GlassParams } from './presets'
import { buildPrintTexture } from './printTexture'
import { DEFAULT_TRACE_OPTIONS, traceImage, type TraceResult } from './trace'
import { drawSample, HERO_FINISH, HERO_SPOTS, HERO_STORY, LOGO_SAMPLE_IDS, SAMPLES, type Sample } from './samples'

/**
 * The landing page's showroom. Every object is built from `SAMPLES` through the same trace →
 * extrude / inflate pipeline as the studio; nothing is downloaded.
 *
 * Three layouts share the renderer, environment and materials:
 *   hero    — a handful of glass and metal brand marks, gently floating with pointer tilt.
 *   story   — one object (the Vitrum mark) on the right, turning as the page scrolls. The camera
 *             never moves; scroll progress drives the object's rotation, so it always reads as
 *             "the thing being talked about" beside the text on the left.
 *   gallery — a fixed camera over one row of six icons.
 */
export type Layout = 'hero' | 'story' | 'gallery' | 'specimen'

interface Placed {
  id: string
  group: THREE.Group
  home: THREE.Vector3
  spin: number
  phase: number
}

export const GALLERY_ICONS = ['heart', 'bolt', 'star', 'play', 'leaf', 'ring']
const ICON_GAP = 150
const ROW_ICONS_Y = 0

export class Showcase {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private placed: Placed[] = []
  private progress = 0
  private shownProgress = 0
  /** Pointer in canvas px; `pointerIn` false when it is off the canvas (objects ease back to idle). */
  private pointer = new THREE.Vector2(-1e6, -1e6)
  private pointerIn = false
  private tmp = new THREE.Vector3()
  private raf = 0
  private last = 0
  private disposed = false
  private visible = true
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private paused = false
  private elapsed = 0
  private pmrem: THREE.PMREMGenerator
  private shadowTex: THREE.CanvasTexture
  private backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private static readonly BACKDROP_DISTANCE = 6000
  private story: THREE.Mesh | null = null
  private storyDepth = 12
  private storyTrace: { trace: TraceResult; source: HTMLCanvasElement } | null = null
  private target = new THREE.Vector3()
  /** Hero, narrow screens: canvas px from the top that the copy occupies; the marks stay below. */
  private heroClear = 0
  /** Fires once per object as it lands, so the page can reveal its caption. */
  onPlaced: ((id: string) => void) | null = null
  onReady: (() => void) | null = null

  constructor(private canvas: HTMLCanvasElement, private opts: { layout: Layout; narrow: boolean; sample?: string; preset?: string }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.setClearColor(0xe4e4e2, 1)
    this.camera = new THREE.PerspectiveCamera(26, 1, 1, 12000)
    this.pmrem = new THREE.PMREMGenerator(this.renderer)
    const environment = createStudioEnvironment({ neutral: true })
    this.scene.environment = this.pmrem.fromScene(environment, 0.02).texture
    environment.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
        materials.forEach(material => material.dispose())
      }
    })

    // A photo-studio sweep pinned to the camera: the paper the objects sit in front of, and the
    // thing the glass has to refract. Without it transmission samples an empty buffer and reads
    // white. Neutral greys, a key-light falloff, a vignette and film grain keep it from reading
    // as a flat digital gradient, and give chrome and black something to mirror.
    const bg = document.createElement('canvas')
    bg.width = bg.height = 1024
    const bctx = bg.getContext('2d')!
    if (opts.layout === 'hero') {
      // The hero fills the screen behind the copy, so its paper is the page itself (--shell):
      // flat, with the same grain, and no pool or key that would draw an edge where it ends.
      bctx.fillStyle = '#eceef2'
      bctx.fillRect(0, 0, 1024, 1024)
    } else {
      const sweep = bctx.createLinearGradient(0, 0, 0, 1024)
      sweep.addColorStop(0, '#ededeb')
      sweep.addColorStop(0.55, '#e2e2e0')
      sweep.addColorStop(1, '#cfcfcc')
      bctx.fillStyle = sweep
      bctx.fillRect(0, 0, 1024, 1024)
      const key = bctx.createRadialGradient(330, 250, 0, 330, 250, 620)
      key.addColorStop(0, 'rgba(255,255,255,0.7)')
      key.addColorStop(1, 'rgba(255,255,255,0)')
      bctx.fillStyle = key
      bctx.fillRect(0, 0, 1024, 1024)
      const vignette = bctx.createRadialGradient(512, 470, 300, 512, 512, 780)
      vignette.addColorStop(0, 'rgba(24,24,26,0)')
      vignette.addColorStop(1, 'rgba(24,24,26,0.16)')
      bctx.fillStyle = vignette
      bctx.fillRect(0, 0, 1024, 1024)
    }
    // Film grain, except on the hero: stretched over a whole screen it turns to speckle, and the
    // page's own grain already lies over it.
    if (opts.layout !== 'hero') {
      const pixels = bctx.getImageData(0, 0, 1024, 1024)
      const px = pixels.data
      for (let i = 0; i < px.length; i += 4) {
        const n = (Math.random() - 0.5) * 9
        px[i] = px[i]! + n
        px[i + 1] = px[i + 1]! + n
        px[i + 2] = px[i + 2]! + n
      }
      bctx.putImageData(pixels, 0, 0)
    }
    const bgTex = new THREE.CanvasTexture(bg)
    bgTex.colorSpace = THREE.SRGBColorSpace
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: bgTex, toneMapped: false }))
    this.backdrop.position.z = -Showcase.BACKDROP_DISTANCE
    this.camera.add(this.backdrop)
    this.scene.add(this.camera)

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
    keyLight.position.set(-1, 1.2, 1.6)
    const rim = new THREE.DirectionalLight(0xf4f4f4, 1.2)
    rim.position.set(1.4, -0.4, -1)
    this.scene.add(keyLight, rim)

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
    this.last = performance.now()
    this.resize()
  }

  /** Fixed camera per layout. A narrow viewport stacks: object above the text. */
  private placeCamera() {
    const n = this.opts.narrow
    if (this.opts.layout === 'hero') {
      this.camera.position.set(0, 0, 840)
      this.target.set(0, 0, 0)
    } else if (this.opts.layout === 'specimen') {
      this.camera.position.set(0, 0, 570)
      this.target.set(0, 0, 0)
    } else if (this.opts.layout === 'story') {
      this.camera.position.set(0, 30, n ? 960 : 520)
      // Look left of the object on desktop so it sits in the right half; below it on phones so
      // it rides in the upper half above the copy.
      this.target.set(n ? 0 : -78, n ? -125 : 0, 0)
    } else {
      const centre = (ICON_GAP * (GALLERY_ICONS.length - 1)) / 2
      this.camera.position.set(centre, 0, n ? 4200 : 1420)
      this.target.set(centre, n ? -60 : -85, 0)
    }
    this.camera.lookAt(this.target)
  }

  /** Build the layout's objects, yielding between them so the page stays responsive. */
  async load() {
    const idle = () => new Promise<void>(r => setTimeout(r, 0))
    if (this.opts.layout === 'hero') {
      for (const spot of HERO_SPOTS) {
        if (this.disposed) return
        const sample = SAMPLES.find(s => s.id === (spot.id === 'story' ? HERO_STORY : spot.id))!
        const mesh = this.place(sample, new THREE.Vector3(0, 0, spot.z), spot.size, spot.id, spot.preset)
        if (spot.id === 'story') {
          this.story = mesh
          this.setPreset(this.opts.preset ?? HERO_FINISH)
        }
        this.layoutHero()
        await idle()
      }
      this.invalidate()
      this.onReady?.()
      return
    }
    if (this.opts.layout === 'specimen') {
      const sample = SAMPLES.find(s => s.id === this.opts.sample) ?? SAMPLES[0]!
      this.story = this.place(sample, new THREE.Vector3(), 145, 'story')
      if (this.opts.preset) this.setPreset(this.opts.preset)
      this.onReady?.()
      return
    }
    if (this.opts.layout !== 'gallery') {
      const brand = SAMPLES.find(s => s.id === 'vitrum')!
      this.story = this.place(brand, new THREE.Vector3(0, 0, 0), 120, 'story')
      this.onReady?.()
      return
    }
    for (const [i, id] of GALLERY_ICONS.entries()) {
      if (this.disposed) return
      this.place(SAMPLES.find(x => x.id === id)!, new THREE.Vector3(i * ICON_GAP, ROW_ICONS_Y, 0), 92)
      await idle()
    }
    this.onReady?.()
  }

  private trace(sample: Sample, stack = false): { trace: TraceResult; source: HTMLCanvasElement } {
    const source = drawSample(sample, 768)
    const trace = traceImage(source as unknown as ImageBitmap, { ...DEFAULT_TRACE_OPTIONS, resolution: 768, stack, mode: 'auto' })
    return { trace, source }
  }

  /** `sizeMm` is the longer side of the object, so a tall bolt and a wide heart read as one family. */
  private place(sample: Sample, home: THREE.Vector3, sizeMm: number, id = sample.id, presetId = sample.preset): THREE.Mesh | null {
    const stack = sample.id === 'play'
    const traced = this.trace(sample, stack)
    const { trace, source } = traced
    if (!trace.polygons.length) return null
    const aspect = (trace.bbox.maxY - trace.bbox.minY) / Math.max(1e-6, trace.bbox.maxX - trace.bbox.minX)
    const widthMm = aspect > 1 ? sizeMm / aspect : sizeMm
    const roundedIcon = ['camera', 'chat', 'spark', 'heart'].includes(sample.id)
    const isLogo = LOGO_SAMPLE_IDS.has(sample.id)
    const depth = sizeMm * (roundedIcon ? 0.16 : isLogo ? 0.14 : 0.2)
    // The star's tips need a smaller bevel than its broad face suggests; keep the inset
    // from crossing those narrow features.
    const bevelLimit = isLogo || ['star', 'bolt'].includes(sample.id) ? sizeMm * 0.012 : sample.id === 'spark' ? sizeMm * 0.02 : sizeMm * 0.038
    const bevel = Math.min(bevelLimit, Math.max(0.6, (trace.strokeWidth * widthMm) / Math.max(1, trace.bbox.maxX - trace.bbox.minX) * (roundedIcon ? 0.44 : 0.3)))
    const built = buildExtrudeGeometry(trace, { widthMm, depthMm: depth, bevelMm: bevel, bevelSegments: 8, layerMm: 2, stack })
    if (!built) return null
    const preset = MATERIAL_PRESETS.find(p => p.id === presetId)!
    const params = { ...DEFAULT_GLASS_PARAMS, ...preset.values, depthMm: depth }
    const material = this.material(params, () => buildPrintTexture(source as unknown as HTMLImageElement, trace))
    let geometry = built.geometry
    if (roundedIcon) {
      geometry.deleteAttribute('normal')
      const smooth = mergeVertices(geometry, 0.001)
      smooth.computeVertexNormals()
      geometry.dispose()
      geometry = smooth
    }
    const mesh = new THREE.Mesh(geometry, material)
    this.mount(id, mesh, home, widthMm, built.frame.bh * built.frame.scale, depth)
    if (id === 'story') { this.storyDepth = depth; this.storyTrace = traced }
    return mesh
  }

  private mount(id: string, mesh: THREE.Mesh, home: THREE.Vector3, w: number, h: number, depth: number) {
    const group = new THREE.Group()
    group.add(mesh)
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.25, toneMapped: false }),
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
        envMapIntensity: p.envIntensity * 1.3,
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
    this.invalidate()
  }

  private invalidate() {
    if (!this.raf && this.visible && !this.disposed) {
      this.last = performance.now()
      this.loop(this.last)
    }
  }

  setPaused(paused: boolean) { this.paused = paused; this.invalidate() }

  setReducedMotion(reduced: boolean) { this.reducedMotion = reduced; this.invalidate() }

  /** Render immediately before capture; no persistent drawing buffer needed. */
  capture() {
    this.renderer.render(this.scene, this.camera)
    return this.canvas.toDataURL('image/webp', 0.92)
  }

  /** Story: 0 at the top of the pinned section, 1 per beat. Drives the object's turn. */
  setProgress(p: number) {
    this.progress = Math.max(0, p)
  }

  /** Hero: where the copy ends, in canvas px, so narrow layouts keep the marks under it. */
  setHeroClear(px: number) {
    if (Math.abs(px - this.heroClear) < 1) return
    this.heroClear = px
    if (this.opts.layout === 'hero') this.layoutHero()
    this.invalidate()
  }

  /** Pointer in canvas CSS px; `inside` false once it leaves the canvas. Objects turn toward it. */
  setPointer(x: number, y: number, inside = true) {
    this.pointer.set(x, y)
    this.pointerIn = inside
  }

  /** Normalised screen position of a placed object's home, in [-1, 1]. */
  private screenOf(o: Placed): THREE.Vector3 {
    return this.tmp.copy(o.home).project(this.camera)
  }

  /** Where an object's centre lands on the canvas, in CSS px; null before it is placed. */
  project(id: string, out = new THREE.Vector3()): { x: number; y: number; z: number } | null {
    const o = this.placed.find(p => p.id === id)
    if (!o) return null
    out.copy(o.home).project(this.camera)
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
    if (this.opts.layout === 'hero') this.layoutHero()
    this.invalidate()
  }

  /**
   * Hero: one world unit is one CSS px (times `u`, which grows and shrinks the set with the
   * screen), so each object's spot is a fraction of the canvas and its size stays in proportion.
   * The camera backs off as the canvas grows instead of the objects spreading apart in depth.
   */
  private layoutHero() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1
    const narrow = w / h < 1.15
    const u = narrow ? Math.min(1, Math.max(0.55, w / 600)) : Math.min(1.3, Math.max(0.7, Math.min(w / 1440, h / 900)))
    const halfFov = Math.tan((this.camera.fov * Math.PI) / 360)
    this.camera.position.set(0, 0, h / 2 / halfFov / u)
    this.camera.lookAt(0, 0, 0)
    const hw = w / 2 / u, hh = h / 2 / u
    // Narrow: the band between the copy and the finish bar, in canvas px.
    const top = this.heroClear + 24, bottom = h - 104
    for (const o of this.placed) {
      const spot = HERO_SPOTS.find(s => s.id === o.id)
      if (!spot) continue
      // A short band keeps only the marks nearest the copy; the corner ones would crowd it.
      const at = narrow ? (spot.narrow && (spot.narrow[1] < 0.8 || bottom - top >= 200) ? spot.narrow : null) : spot.wide
      o.group.visible = !!at
      if (!at) continue
      const y = narrow ? (h / 2 - (top + at[1] * Math.max(0, bottom - top))) / u : at[1] * hh
      o.home.set(at[0] * hw, y, spot.z)
      o.group.position.x = o.home.x
      o.group.position.z = o.home.z
    }
  }

  private loop = (now: number) => {
    if (this.disposed) return
    if (!this.visible) { this.raf = 0; return }
    this.raf = this.reducedMotion || this.paused ? 0 : requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    const still = this.reducedMotion || this.paused
    if (!still) this.elapsed += dt
    const t = this.reducedMotion ? 2 : this.elapsed
    // Scroll eases so a fast wheel flick reads as one smooth turn.
    this.shownProgress += (this.progress - this.shownProgress) * (1 - Math.exp(-dt * 5))
    const layout = this.opts.layout
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1
    // Pointer in normalised device coords; parked far away when it is off the canvas.
    const pointerIn = this.pointerIn && !still
    const px = pointerIn ? (this.pointer.x / w) * 2 - 1 : 0
    const py = pointerIn ? -((this.pointer.y / h) * 2 - 1) : 0
    const follow = 1 - Math.exp(-dt * 6)

    for (const o of this.placed) {
      const g = o.group
      const landing = still ? 1 : Math.min(1, (g.userData.landing as number) + dt * 1.4)
      g.userData.landing = landing
      const e = 1 - Math.pow(1 - landing, 3)
      g.scale.setScalar(0.92 + 0.08 * e)

      // Where the cursor is relative to this object, on screen. The object turns to face it:
      // fully when the cursor is on or near it, fading out with distance, off when it leaves.
      const sp = this.screenOf(o)
      const dx = px - sp.x, dy = py - sp.y
      let reach = 1
      if (layout === 'gallery') {
        const dist = Math.hypot(dx * (w / h), dy)
        reach = 1 - Math.min(1, Math.max(0, (dist - 0.18) / 0.5))
        reach *= reach
      }
      const gain = pointerIn ? reach : 0
      const wantY = Math.max(-0.9, Math.min(0.9, dx * (layout === 'gallery' ? 2.2 : 1.1))) * gain
      const wantX = Math.max(-0.6, Math.min(0.6, -dy * (layout === 'gallery' ? 1.6 : 0.8))) * gain
      const look = g.userData.look as THREE.Vector2 | undefined ?? (g.userData.look = new THREE.Vector2())
      look.x += (wantX - look.x) * follow
      look.y += (wantY - look.y) * follow
      if (still) look.set(0, 0)

      if (layout === 'hero' || layout === 'specimen') {
        g.position.y = o.home.y - 24 * (1 - e) + Math.sin(t * 0.65 + (layout === 'hero' ? Math.abs(o.home.x) * 0.004 : o.phase)) * 4
        // A slow sway so the object never sits still; the cursor turns it further.
        if (layout === 'hero') {
          // Mirrored: every mark turns the same amount toward the centre and stands upright, so the
          // set reads as one arrangement; the centre mark keeps a slight turn to show its depth.
          const side = Math.sign(Math.round(o.home.x))
          const sway = Math.sin(t * 0.32 + (side < 0 ? 0 : Math.PI)) * 0.1 * (1 - gain * 0.6)
          g.rotation.y = (side ? -side * 0.34 : -0.3) + sway + look.y * 0.35
          g.rotation.x = Math.sin(t * 0.3) * 0.04 + look.x * 0.35 + 0.16
          g.rotation.z = 0
        } else {
          g.rotation.y = Math.sin(t * 0.32 + o.phase) * 0.16 * (1 - gain * 0.6) + look.y * 0.35 + (o.id === 'chat' ? 0.35 : -0.38)
          g.rotation.x = Math.sin(t * 0.3) * 0.04 + look.x * 0.35 + 0.2
          g.rotation.z = o.id === 'story' ? -0.17 : o.id === 'chat' ? 0.15 : Math.sin(o.phase) * 0.3
        }
      } else if (layout === 'story') {
        g.position.y = o.home.y - 40 * (1 - e) + Math.sin(t * 0.7 + o.phase) * 3
        // A third of a turn per scrolled beat, plus a slow idle sway and the cursor's pull.
        g.rotation.y = this.shownProgress * (Math.PI * 2 / 3) + Math.sin(t * 0.4) * 0.12 + look.y
        g.rotation.x = Math.sin(t * 0.3) * 0.05 + look.x
      } else {
        // Gallery objects hold their row exactly (captions hang under them); only the face turns.
        g.position.y = o.home.y - 40 * (1 - e)
        g.rotation.y = Math.sin(t * o.spin + o.phase) * 0.22 * (1 - gain) + look.y
        g.rotation.x = Math.sin(t * 0.35 + o.phase) * 0.03 * (1 - gain) + look.x
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
    this.scene.environment?.dispose()
    this.renderer.dispose()
  }
}
