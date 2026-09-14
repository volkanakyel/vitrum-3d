import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { MeshTransmissionMaterial } from '@pmndrs/vanilla'
import type { TraceResult } from './trace'
import { DEFAULT_GLASS_PARAMS, type Finish, type Geometry, type GlassParams } from './presets'
export * from './presets'
import { buildExtrudeGeometry } from './extrude'
import { buildPrintTexture, buildCropTexture } from './printTexture'
import { buildReliefGeometry, reliefScale, type ReliefData } from './relief'

/**
 * A dark studio with a few bright softboxes. High contrast is what makes glass read as glass:
 * bevels go dark where they mirror the room and flare where they catch a strip light.
 */
export function createStudioEnvironment(): THREE.Scene {
  const scene = new THREE.Scene()
  // Gradient dome: dark floor, mid-grey horizon, softer ceiling. Metals read their shape from
  // this gradient; a flat black room leaves them looking like cut-outs.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; void main(){
        float t = clamp(vP.y / 30.0 * 0.5 + 0.5, 0.0, 1.0);
        vec3 floor = vec3(0.10, 0.10, 0.115);
        vec3 horizon = vec3(0.40, 0.40, 0.44);
        vec3 ceil = vec3(0.92, 0.93, 0.96);
        vec3 c = t < 0.5 ? mix(floor, horizon, smoothstep(0.0, 0.5, t)) : mix(horizon, ceil, smoothstep(0.5, 1.0, t));
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  )
  scene.add(dome)
  const light = (w: number, h: number, color: number, intensity: number, pos: [number, number, number], look: [number, number, number] = [0, 0, 0]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    )
    m.position.set(...pos)
    m.lookAt(...look)
    scene.add(m)
  }
  light(14, 3, 0xffffff, 6, [0, 14, 4])          // long top softbox: main horizontal highlight
  light(2.5, 16, 0xffe2c0, 5, [-14, 2, 6])       // warm tall strip on the left
  light(2.5, 16, 0xc4d8ff, 5, [14, 2, 6])        // cool tall strip on the right
  light(10, 2, 0xffffff, 2.5, [0, -12, 8])       // faint fill from below
  light(6, 6, 0xffffff, 1.2, [0, 0, -16])        // back card seen through the glass
  light(16, 10, 0xffffff, 2.6, [0, 5, 18])       // broad front softbox: sheen on the face
  light(4, 1.2, 0xffffff, 8, [-6, 9, 10])        // small hard key: crisp specular streak
  return scene
}

export interface ModelDimensions {
  widthMm: number
  heightMm: number
  depthMm: number
  triangles: number
}

export class GlassStudio {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  readonly material: MeshTransmissionMaterial
  private fboMain: THREE.WebGLRenderTarget
  private fboBack: THREE.WebGLRenderTarget
  private timer = new THREE.Timer()
  private mesh: THREE.Mesh | null = null
  private trace: TraceResult | null = null
  /** Values the UI asked for. */
  private target: GlassParams = { ...DEFAULT_GLASS_PARAMS }
  /** Values currently applied; eased toward `target` every frame. */
  private params: GlassParams = { ...DEFAULT_GLASS_PARAMS }
  private built = { widthMm: NaN, depthMm: NaN, bevelMm: NaN, bevelSegments: NaN, reliefMm: NaN, layerMm: NaN, geometry: '' as Geometry | '', relief: null as ReliefData | null }
  private camGoal: THREE.Vector3 | null = null
  /** Wheel zoom eases toward this distance from the target; 0 when settled. */
  private zoomGoal = 0
  /** True from the first pointer or wheel event until the orbit has settled again. */
  private interacting = false
  private interactTimer: ReturnType<typeof setTimeout> | undefined
  private pop = 1
  private lastTime = 0
  private readonly colorKeys = ['tint', 'background'] as const
  private colorA = new THREE.Color()
  private colorB = new THREE.Color()
  private raf = 0
  private pmrem: THREE.PMREMGenerator
  private disposed = false
  private key: THREE.DirectionalLight
  private rim: THREE.DirectionalLight
  private backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private backdropCanvas = document.createElement('canvas')
  private shadowPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private shadowCanvas = document.createElement('canvas')
  readonly metal: THREE.MeshPhysicalMaterial
  readonly print: THREE.MeshPhysicalMaterial
  private source: HTMLImageElement | null = null
  private relief: ReliefData | null = null
  private printTex: THREE.CanvasTexture | null = null
  /** Which geometry the print texture was padded for; relief without a cutout wants the plain crop. */
  private printTexKind: Geometry | null = null
  /** How long the last geometry rebuild took; decides whether size changes ease or snap. */
  private lastRebuildMs = 0
  private static readonly GEOMETRY_KEYS = ['widthMm', 'depthMm', 'bevelMm', 'reliefMm', 'layerMm'] as const
  /** Called after every geometry rebuild (and after the mesh is dropped), so the HUD can read the real size. */
  onRebuild: (() => void) | null = null
  /** drei spreads the IOR by a small fraction per unit; this makes the slider's range visible. */
  private static readonly DISPERSION_GAIN = 2.5

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0

    this.camera = new THREE.PerspectiveCamera(28, 1, 1, 10000)
    this.camera.position.set(-120, 60, 420)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    // Heavier damping (0.05–0.08) makes the model trail the cursor; this follows closely and
    // still glides to a stop. Wheel zoom is eased here (below) since the controls' dolly snaps.
    this.controls.dampingFactor = 0.15
    // Stay off the poles: at the exact top or bottom the azimuth spins and the drag feels stuck.
    this.controls.minPolarAngle = 0.03
    this.controls.maxPolarAngle = Math.PI - 0.03
    this.controls.addEventListener('start', () => {
      // A drag takes over from any camera glide, or it would fight the hand.
      this.camGoal = null
      this.setInteracting(true)
    })
    this.controls.addEventListener('end', () => this.setInteracting(false))
    // The controls' wheel handler dollies in steps; this captures the event first and eases.
    canvas.addEventListener('wheel', this.onWheel, { capture: true, passive: false })
    this.controls.autoRotateSpeed = 1.2
    this.controls.minDistance = 20
    this.controls.maxDistance = 4000

    this.pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = this.pmrem.fromScene(createStudioEnvironment(), 0.02).texture
    this.renderer.transmissionResolutionScale = 1
    this.scene.background = new THREE.Color(this.params.background)

    // Two hard lights give the crisp specular streaks a studio glass shot has.
    this.key = new THREE.DirectionalLight(0xffffff, 2.2)
    this.key.position.set(-1, 1.2, 1.6)
    this.rim = new THREE.DirectionalLight(0xdfe9ff, 1.4)
    this.rim.position.set(1.4, -0.4, -1)
    this.scene.add(this.key, this.rim)

    // A soft vignette behind the model gives refraction and dispersion something to bend.
    this.backdropCanvas.width = this.backdropCanvas.height = 512
    const backdropTex = new THREE.CanvasTexture(this.backdropCanvas)
    backdropTex.colorSpace = THREE.SRGBColorSpace
    this.backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: backdropTex, toneMapped: false }),
    )
    this.backdrop.name = 'backdrop'
    this.scene.add(this.backdrop)
    this.paintBackdrop()

    // Soft contact shadow: a blurred silhouette of the traced shape, just behind the model.
    this.shadowCanvas.width = this.shadowCanvas.height = 1024
    const shadowTex = new THREE.CanvasTexture(this.shadowCanvas)
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: this.params.shadow, toneMapped: false }),
    )
    this.shadowPlane.name = 'shadow'
    this.shadowPlane.renderOrder = -1
    this.shadowPlane.visible = false
    this.scene.add(this.shadowPlane)

    this.metal = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(this.params.tint),
      metalness: this.params.metalness,
      roughness: this.params.roughness,
      clearcoat: this.params.clearcoat,
      clearcoatRoughness: 0.08,
      envMapIntensity: this.params.envIntensity,
    })

    // Print: the picture itself, lit as a lacquered or matte panel. The map is set per trace.
    this.print = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: this.params.roughness,
      clearcoat: this.params.clearcoat,
      clearcoatRoughness: 0.12,
      envMapIntensity: this.params.envIntensity,
    })

    // drei's transmission material: renders the scene into its own buffer twice (back faces, then
    // front faces) so the rims refract the glass behind them instead of a flat background.
    this.material = new MeshTransmissionMaterial({
      samples: 8,
      transmissionSampler: false,
      chromaticAberration: this.params.dispersion * GlassStudio.DISPERSION_GAIN,
      anisotropicBlur: this.params.blur,
      _transmission: this.params.clarity,
      thickness: this.params.depthMm,
      roughness: this.params.roughness,
      attenuationColor: new THREE.Color(this.params.tint),
      attenuationDistance: this.params.attenuationMm,
    })
    this.material.color.set(0xffffff)
    this.patchTotalInternalReflection()
    this.material.metalness = 0
    this.material.ior = this.params.ior
    this.material.clearcoat = this.params.clearcoat
    this.material.clearcoatRoughness = 0.04
    this.material.iridescence = this.params.edgeChroma
    this.material.iridescenceIOR = 1.3
    this.material.iridescenceThicknessRange = [120, 480]
    this.material.specularIntensity = 1
    this.material.envMapIntensity = this.params.envIntensity
    this.material.side = THREE.FrontSide

    const fboOpts: THREE.RenderTargetOptions = { type: THREE.HalfFloatType, samples: 4 }
    this.fboMain = new THREE.WebGLRenderTarget(1, 1, fboOpts)
    this.fboBack = new THREE.WebGLRenderTarget(1, 1, fboOpts)
    this.material.uniforms.buffer.value = this.fboMain.texture

    this.resize()
    this.loop()
    if (import.meta.dev) (window as unknown as { __studio: GlassStudio }).__studio = this
  }

  /**
   * @param paint Repaint right away. Resizing the canvas clears it, so a layout-driven resize
   *   (sidebar collapsing) would otherwise show a blank frame until the next tick of the loop.
   */
  resize(paint = false) {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.sizeBuffers()
    this.placeBackdrop()
    if (paint && !this.disposed) this.renderPasses()
  }

  /**
   * The refraction buffers at full resolution, or at 60% while the user orbits or zooms: the
   * glass passes are the frame's cost, and a slightly softer refraction mid-drag is invisible
   * where a stutter is not.
   */
  private sizeBuffers() {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    const pr = this.renderer.getPixelRatio() * (this.interacting ? 0.6 : 1)
    const bw = Math.min(2048, Math.round(w * pr))
    const bh = Math.min(2048, Math.round(h * pr))
    if (this.fboMain.width !== bw || this.fboMain.height !== bh) {
      this.fboMain.setSize(bw, bh)
      this.fboBack.setSize(Math.round(bw / 2), Math.round(bh / 2))
    }
  }

  private setInteracting(on: boolean) {
    clearTimeout(this.interactTimer)
    if (on) {
      if (!this.interacting) { this.interacting = true; this.sizeBuffers() }
      return
    }
    // Damping keeps the camera moving a little after the pointer lifts; restore after it settles.
    this.interactTimer = setTimeout(() => { this.interacting = false; this.sizeBuffers() }, 350)
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.controls.enabled || !this.controls.enableZoom) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const cur = this.zoomGoal || this.camera.position.distanceTo(this.controls.target)
    // Pixel deltas from a trackpad are small and continuous; a mouse notch is ~100. Both map to
    // a multiplicative step so zooming feels the same at every distance.
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
    const next = cur * Math.exp(px * 0.0022)
    this.zoomGoal = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, next))
    this.camGoal = null
    this.setInteracting(true)
    this.setInteracting(false)
  }

  private loop = (now = performance.now()) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, (now - this.lastTime) / 1000 || 0.016)
    this.lastTime = now
    this.ease(dt)
    this.controls.update()
    this.placeBackdrop()
    this.renderPasses()
  }

  /**
   * Exponential easing toward the target parameters. Every slider, colour and camera move
   * arrives over ~150 ms instead of snapping, which is what makes the viewer feel fluid.
   */
  private ease(dt: number) {
    const k = 1 - Math.exp(-dt * 14)
    const kCam = 1 - Math.exp(-dt * 8)
    const p = this.params as unknown as Record<string, number | string | boolean>
    const t = this.target as unknown as Record<string, number | string | boolean>
    let dirty = false
    // Easing a size means one full rebuild per frame. That is fluid while a rebuild fits in a
    // frame; on a dense photo trace (100 ms+) it turns into a stutter, so those snap instead.
    const snapGeometry = this.lastRebuildMs > 24
    for (const key of Object.keys(t)) {
      const tv = t[key]!, pv = p[key]!
      if (tv === pv) continue
      dirty = true
      if (typeof tv === 'number' && typeof pv === 'number') {
        if (key === 'bevelSegments' || (snapGeometry && (GlassStudio.GEOMETRY_KEYS as readonly string[]).includes(key))) { p[key] = tv; continue }
        const next = pv + (tv - pv) * k
        p[key] = Math.abs(tv - next) < Math.abs(tv) * 1e-4 + 1e-4 ? tv : next
      } else if (typeof tv === 'string' && (this.colorKeys as readonly string[]).includes(key)) {
        this.colorA.set(pv as string).lerp(this.colorB.set(tv), k)
        const hex = `#${this.colorA.getHexString()}`
        p[key] = hex === pv || this.colorA.equals(this.colorB) ? tv : hex
      } else {
        p[key] = tv
      }
    }
    if (dirty) this.apply()

    if (this.camGoal) {
      this.camera.position.lerp(this.camGoal, kCam)
      if (this.camera.position.distanceTo(this.camGoal) < 0.05) this.camGoal = null
    }
    if (this.zoomGoal) {
      // Ease the distance along the current view ray, so the zoom is smooth and never turns.
      const off = this.camera.position.clone().sub(this.controls.target)
      const d = off.length()
      const kZoom = 1 - Math.exp(-dt * 16)
      const nd = d + (this.zoomGoal - d) * kZoom
      this.camera.position.copy(this.controls.target).add(off.setLength(nd))
      if (Math.abs(this.zoomGoal - nd) < Math.max(0.02, nd * 5e-4)) this.zoomGoal = 0
    }
    if (this.pop < 1) {
      this.pop = Math.min(1, this.pop + dt / 0.45)
      const s = 1 - 0.05 * Math.sin(Math.PI * this.pop)
      this.mesh?.scale.setScalar(s)
    }
  }

  /** Push the eased parameters into materials, camera and scene. */
  private apply() {
    const p = this.params
    const prevFinish = this.mesh?.material === this.metal ? 'metal' : this.mesh?.material === this.print ? 'print' : 'glass'
    this.material.roughness = p.roughness
    this.material.ior = p.ior
    this.material.uniforms.chromaticAberration.value = p.dispersion * GlassStudio.DISPERSION_GAIN
    this.material.clearcoat = p.clearcoat
    this.material.envMapIntensity = p.envIntensity
    this.material.attenuationColor.set(p.tint)
    this.material.color.set(p.tint).lerp(new THREE.Color(0xffffff), 0.7)
    this.material.attenuationDistance = p.attenuationMm
    this.material.thickness = p.depthMm
    this.material.iridescence = p.edgeChroma
    const tir = (this.material as unknown as { tirUniforms: { tirStrength: { value: number }; rimChroma: { value: number } } }).tirUniforms
    tir.tirStrength.value = p.tir
    tir.rimChroma.value = p.edgeChroma
    this.material.uniforms.anisotropicBlur.value = p.blur
    this.material.uniforms._transmission.value = p.clarity
    this.metal.color.set(p.tint)
    this.metal.metalness = p.metalness
    this.metal.roughness = p.roughness
    this.metal.clearcoat = p.clearcoat
    this.metal.envMapIntensity = p.envIntensity
    this.print.roughness = p.roughness
    this.print.clearcoat = p.clearcoat
    this.print.envMapIntensity = p.envIntensity
    // Clear glass shows what is behind it, and a black silhouette right behind a clear slab
    // reads as a grey slab. Fade the contact shadow by the glass's clarity, never by the mesh.
    const glassy = p.finish === 'glass'
    this.shadowPlane.material.opacity = glassy ? p.shadow * (1 - 0.7 * p.clarity) : p.shadow
    ;(this.scene.background as THREE.Color).set(p.background)
    this.paintBackdrop()
    this.renderer.toneMappingExposure = p.exposure
    this.controls.autoRotate = p.autoRotate
    this.controls.autoRotateSpeed = p.rotateSpeed
    if (p.fov !== this.camera.fov) {
      this.camera.fov = p.fov
      this.camera.updateProjectionMatrix()
    }
    if (this.mesh) {
      if (p.finish === 'print') this.ensurePrintTexture()
      this.mesh.material = this.materialFor(p.finish)
      if (prevFinish !== p.finish) this.pop = 0
    }
    const b = this.built
    const active = this.activeGeometry()
    const relief = active === 'inflate' || active === 'relief'
    // A new geometry is a new object: pop it in and glide the camera to a fit, as a new trace does.
    const swapped = b.geometry !== '' && b.geometry !== this.activeGeometry()
    if (
      b.geometry !== this.activeGeometry() ||
      Math.abs(b.widthMm - p.widthMm) > 0.01 || Math.abs(b.depthMm - p.depthMm) > 0.01 ||
      (!relief && (Math.abs(b.bevelMm - p.bevelMm) > 0.005 || b.bevelSegments !== p.bevelSegments)) ||
      (active === 'stack' && Math.abs(b.layerMm - p.layerMm) > 0.01) ||
      (relief && (Math.abs(b.reliefMm - p.reliefMm) > 0.01 || b.relief !== this.relief))
    ) {
      this.rebuild()
      if (swapped && this.mesh) { this.pop = 0; this.frame() }
    }
  }

  /** Back-face pass, main pass, then the visible pass, as drei's MeshTransmissionMaterial does. */
  private renderPasses() {
    const gl = this.renderer
    const m = this.material
    const mesh = this.mesh
    if (!mesh || this.params.finish !== 'glass') {
      gl.setRenderTarget(null)
      gl.render(this.scene, this.camera)
      return
    }
    this.timer.update()
    m.uniforms.time.value = this.timer.getElapsed()
    const oldTone = gl.toneMapping
    gl.toneMapping = THREE.NoToneMapping

    // 1. Scene without the glass -> fboBack.
    mesh.visible = false
    gl.setRenderTarget(this.fboBack)
    gl.render(this.scene, this.camera)

    // 2. Back faces refracting fboBack -> fboMain.
    mesh.visible = true
    m.uniforms.buffer.value = this.fboBack.texture
    m.thickness = this.params.depthMm * 0.5
    m.side = THREE.BackSide
    gl.setRenderTarget(this.fboMain)
    gl.render(this.scene, this.camera)

    // 3. Front faces refracting fboMain -> screen.
    m.uniforms.buffer.value = this.fboMain.texture
    m.thickness = this.params.depthMm
    m.side = THREE.FrontSide
    gl.toneMapping = oldTone
    gl.setRenderTarget(null)
    gl.render(this.scene, this.camera)
  }

  private materialFor(finish: Finish): THREE.Material {
    return finish === 'metal' ? this.metal : finish === 'print' ? this.print : this.material
  }

  /**
   * @param source The original image, used for the Print finish texture. Sampled at native
   *   resolution (capped) so print detail is not limited by the trace raster.
   */
  setTrace(trace: TraceResult | null, source: HTMLImageElement | null = null) {
    const first = !this.mesh
    this.trace = trace
    this.source = source
    // The print texture is the most expensive thing an import can build (hundreds of ms on a
    // photo) and only the Print finish looks at it, so it is made on first use, not here.
    this.dropPrintTexture()
    if (this.params.finish === 'print') this.ensurePrintTexture()
    this.rebuild()
    if (first) this.camera.position.set(0, 0, 0)
    this.frame()
    if (this.mesh) this.pop = 0
  }

  /** Height grid for the Relief geometry; `null` drops back to the extruded silhouette. */
  setRelief(relief: ReliefData | null) {
    const hadMesh = !!this.mesh
    const cropChanged = !!relief && !!this.relief && (relief.crop.x !== this.relief.crop.x || relief.crop.y !== this.relief.crop.y || relief.crop.w !== this.relief.crop.w || relief.crop.h !== this.relief.crop.h)
    const maskChanged = !!relief && !!this.relief && !!relief.mask !== !!this.relief.mask
    this.relief = relief
    if (cropChanged || maskChanged) this.dropPrintTexture()
    if (this.params.geometry === 'extrude') return
    if (this.params.finish === 'print') this.ensurePrintTexture()
    const before = this.built.geometry
    this.rebuild()
    // Re-fit and pop only when a different object appears (first grid, or extrude → relief);
    // a smoothing or contrast drag replaces the grid in place and the camera must hold still.
    const swapped = before !== this.built.geometry
    if (!hadMesh) this.camera.position.set(0, 0, 0)
    if (!hadMesh || swapped) this.frame()
    if (this.mesh && (!hadMesh || swapped)) this.pop = 0
  }

  /**
   * Inflate and relief need their grid; until it arrives (or when it was cleared) the extruded
   * silhouette shows. A grid of the other kind (mirror flag) does not count.
   */
  private activeGeometry(): Geometry {
    const g = this.params.geometry
    if (g === 'stack') return this.trace?.layers ? 'stack' : 'extrude'
    const r = this.relief
    if (g === 'extrude' || !r) return 'extrude'
    return r.mirror === (g === 'inflate') ? g : 'extrude'
  }

  private dropPrintTexture() {
    this.printTex?.dispose()
    this.printTex = null
    this.printTexKind = null
    this.print.map = null
    this.print.needsUpdate = true
  }

  setParams(next: Partial<GlassParams>) {
    Object.assign(this.target, next)
  }

  /**
   * Set parameters without easing. With `applyNow` false the values only land on the state,
   * for the caller that is about to trigger a rebuild anyway (a new trace) and does not want
   * a second one from the easing loop.
   */
  snapParams(next: Partial<GlassParams>, applyNow = true) {
    Object.assign(this.target, next)
    Object.assign(this.params, next)
    if (applyNow) this.apply()
  }

  /** Build the Print finish texture from the source image, once per trace. */
  private ensurePrintTexture() {
    const kind = this.activeGeometry()
    if (this.printTex && this.printTexKind === kind) return
    if (!this.source) return
    // Relief without a cutout shows every pixel, so the picture is used as it is. Everything
    // else follows a silhouette and wants the edge colours padded past it.
    const cut = kind === 'relief' && this.relief ? !!this.relief.mask : true
    const canvas = cut
      ? (this.trace && this.trace.polygons.length ? buildPrintTexture(this.source, this.trace) : null)
      : buildCropTexture(this.source, this.relief!.crop)
    if (!canvas) return
    this.printTex?.dispose()
    this.printTexKind = kind
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
    this.printTex = tex
    this.print.map = tex
    this.print.needsUpdate = true
  }

  /**
   * Screen-space refraction can only show what is behind the glass, so rims that should go
   * dark through total internal reflection stay white. Blend the transmitted light toward the
   * environment reflection as the view angle grazes the surface, which is where TIR happens.
   */
  private patchTotalInternalReflection() {
    const m = this.material
    const inner = m.onBeforeCompile
    const tirUniforms = { tirStrength: { value: this.params.tir }, tirPower: { value: 1.5 }, rimChroma: { value: this.params.edgeChroma } }
    ;(m as unknown as { tirUniforms: typeof tirUniforms }).tirUniforms = tirUniforms
    m.onBeforeCompile = (shader, renderer) => {
      inner.call(m, shader, renderer)
      shader.uniforms.tirStrength = tirUniforms.tirStrength
      shader.uniforms.tirPower = tirUniforms.tirPower
      shader.uniforms.rimChroma = tirUniforms.rimChroma
      shader.fragmentShader = shader.fragmentShader
        .replace('uniform float chromaticAberration;', 'uniform float chromaticAberration;\nuniform float tirStrength;\nuniform float tirPower;\nuniform float rimChroma;')
        .replace(
          'totalDiffuse = mix( totalDiffuse, transmission.rgb, material.transmission );',
          `{
            float grazing = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), tirPower );
            float tir = saturate( grazing * tirStrength );
            #ifdef USE_ENVMAP
              vec3 tirRadiance = getIBLRadiance( geometryViewDir, normal, material.roughness ) * envMapIntensity;
            #else
              vec3 tirRadiance = vec3( 0.0 );
            #endif
            transmission.rgb = mix( transmission.rgb, tirRadiance, tir );
            // Thin-film rainbow on the rims: the hue turns with the view angle and drifts across
            // the surface, so a holographic glass shimmers as it rotates. Quadratic in the
            // strength so a touch of it stays a touch; at 1 it is the whole look.
            float chroma = rimChroma * rimChroma * smoothstep( 0.0, 0.9, grazing );
            float hue = grazing * 1.6 + dot( normal, vec3( 0.35, 0.55, 0.2 ) ) * 0.6 + vWorldPosition.y * 0.004;
            vec3 spectrum = 0.55 + 0.45 * cos( 6.28318 * ( hue + vec3( 0.0, 0.33, 0.67 ) ) );
            transmission.rgb = mix( transmission.rgb, transmission.rgb * spectrum * 1.35 + spectrum * 0.08, chroma );
            totalSpecular *= mix( vec3( 1.0 ), spectrum * 1.6, chroma );
          }
          totalDiffuse = mix( totalDiffuse, transmission.rgb, material.transmission );`,
        )
    }
    m.customProgramCacheKey = () => 'glass-tir'
  }

  private lastBackdrop = ''
  private paintBackdrop() {
    const sig = `${this.params.background}|${this.params.vignette}`
    if (sig === this.lastBackdrop) return
    this.lastBackdrop = sig
    const c = this.backdropCanvas
    const ctx = c.getContext('2d')!
    const base = new THREE.Color(this.params.background)
    const edge = base.clone().multiplyScalar(1 - this.params.vignette)
    const g = ctx.createRadialGradient(c.width / 2, c.height * 0.45, c.width * 0.12, c.width / 2, c.height / 2, c.width * 0.75)
    g.addColorStop(0, `#${base.getHexString()}`)
    g.addColorStop(1, `#${edge.getHexString()}`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, c.width, c.height)
    ;(this.backdrop.material.map as THREE.CanvasTexture).needsUpdate = true
  }

  /** Keep the backdrop filling the view a fixed distance behind the model. */
  private placeBackdrop() {
    const dist = this.camera.position.length()
    const behind = dist * 0.9
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const h = 2 * tanV * (dist + behind) * 3
    this.backdrop.scale.set(h * Math.max(this.camera.aspect, 1), h, 1)
    this.backdrop.position.copy(this.camera.position).normalize().multiplyScalar(-behind)
    this.backdrop.lookAt(this.camera.position)
  }

  getDimensions(): ModelDimensions | null {
    if (!this.mesh || !this.trace) return null
    // The geometry's own box: the pop animation scales the mesh and must not show in the HUD.
    const geo = this.mesh.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    const size = geo.boundingBox!.getSize(new THREE.Vector3())
    const idx = this.mesh.geometry.getIndex()
    const triangles = idx ? idx.count / 3 : this.mesh.geometry.getAttribute('position').count / 3
    return { widthMm: size.x, heightMm: size.y, depthMm: size.z, triangles }
  }

  /** Build the solid at exact millimetre size: an extruded silhouette or a relief of the picture. */
  private rebuild() {
    if (this.mesh) {
      this.scene.remove(this.mesh)
      this.mesh.geometry.dispose()
      this.mesh = null
    }
    this.shadowPlane.visible = false
    const p = this.params
    const active = this.activeGeometry()
    if (active === 'inflate' || active === 'relief') {
      this.rebuildRelief()
      this.onRebuild?.()
      return
    }
    const t = this.trace
    if (!t || !t.polygons.length) { this.onRebuild?.(); return }
    const t0 = performance.now()
    const built = buildExtrudeGeometry(t, { widthMm: p.widthMm, depthMm: p.depthMm, bevelMm: p.bevelMm, bevelSegments: p.bevelSegments, layerMm: p.layerMm, stack: active === 'stack' })
    if (!built) { this.onRebuild?.(); return }
    const merged = built.geometry
    const { bw, bh, scale, cx, cy } = built.frame
    this.mesh = new THREE.Mesh(merged, this.materialFor(p.finish))
    this.mesh.name = active === 'stack' ? 'stack' : 'glass-logo'
    this.built = { widthMm: p.widthMm, depthMm: p.depthMm, bevelMm: p.bevelMm, bevelSegments: p.bevelSegments, reliefMm: NaN, layerMm: p.layerMm, geometry: active, relief: null }
    this.scene.add(this.mesh)
    this.paintShadow(bw * scale, bh * scale, p.depthMm, (ctx, sx, sy) => {
      for (const poly of t.polygons) {
        for (const ring of [poly.exterior, ...poly.holes]) {
          ring.forEach(([x, y], i) => {
            const px = (x - cx) * scale * sx, py = (y - cy) * scale * sy
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
          })
          ctx.closePath()
        }
      }
    })
    this.lastRebuildMs = performance.now() - t0
    this.onRebuild?.()
  }

  /** The picture as a height field: every grid point a vertex, walls and a flat back. */
  private rebuildRelief() {
    const r = this.relief
    const p = this.params
    if (!r) return
    const t0 = performance.now()
    // Inflate: the depth is the whole thickness, half in front of the mid-plane, half behind.
    const geo = r.mirror
      ? buildReliefGeometry(r, { widthMm: p.widthMm, baseMm: 0, reliefMm: p.depthMm / 2 })
      : buildReliefGeometry(r, { widthMm: p.widthMm, baseMm: p.depthMm, reliefMm: p.reliefMm })
    // Centre on the origin; `computeBoundingBox` reuses its Box3, so copy the centre first.
    const centre = geo.boundingBox!.getCenter(new THREE.Vector3())
    geo.translate(-centre.x, -centre.y, -centre.z)
    geo.computeBoundingBox()
    this.mesh = new THREE.Mesh(geo, this.materialFor(p.finish))
    this.mesh.name = r.mirror ? 'inflate' : 'relief'
    this.built = { widthMm: p.widthMm, depthMm: p.depthMm, bevelMm: NaN, bevelSegments: NaN, reliefMm: p.reliefMm, layerMm: NaN, geometry: r.mirror ? 'inflate' : 'relief', relief: r }
    this.scene.add(this.mesh)
    const size = geo.boundingBox!.getSize(new THREE.Vector3())
    const t = this.trace
    if (r.mask && t && t.polygons.length) {
      // Cutout: the silhouette, mapped from trace raster px into the grid's millimetres and
      // then into the centred frame the geometry was translated to.
      const mmPerGrid = reliefScale(r, p.widthMm)
      const kx = (r.width / t.width) * mmPerGrid, ky = (r.height / t.height) * mmPerGrid
      const x0 = (-mmPerGrid * (r.width - 1)) / 2 - centre.x
      const y0 = (mmPerGrid * (r.height - 1)) / 2 - centre.y
      this.paintShadow(size.x, size.y, size.z, (ctx, sx, sy) => {
        for (const poly of t.polygons) {
          for (const ring of [poly.exterior, ...poly.holes]) {
            ring.forEach(([x, y], i) => {
              const px = (x0 + x * kx) * sx, py = -(y0 - y * ky) * sy
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
            })
            ctx.closePath()
          }
        }
      })
    } else {
      this.paintShadow(size.x, size.y, size.z, (ctx, sx, sy) => {
        ctx.rect(-size.x / 2 * sx, -size.y / 2 * sy, size.x * sx, size.y * sy)
      })
    }
    this.lastRebuildMs = performance.now() - t0
  }

  /**
   * Draw the model's footprint blurred onto a plane slightly behind and below it. `draw` adds
   * the outline to the current path in canvas px, centred, y down, with `sx`/`sy` px per mm.
   */
  private paintShadow(wModel: number, hModel: number, depth: number, draw: (ctx: CanvasRenderingContext2D, sx: number, sy: number) => void) {
    const c = this.shadowCanvas
    const ctx = c.getContext('2d')!
    const pad = 0.35
    const wMm = wModel * (1 + pad * 2)
    const hMm = hModel * (1 + pad * 2)
    const sx = c.width / wMm, sy = c.height / hMm
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.save()
    ctx.translate(c.width / 2, c.height / 2)
    ctx.filter = `blur(${Math.max(6, c.width * 0.02)}px)`
    ctx.fillStyle = 'rgba(0,0,0,1)'
    ctx.beginPath()
    draw(ctx, sx, sy)
    ctx.fill('evenodd')
    ctx.restore()
    ;(this.shadowPlane.material.map as THREE.CanvasTexture).needsUpdate = true
    this.shadowPlane.scale.set(wMm, hMm, 1)
    // Light comes from the upper left, so the shadow falls slightly down and to the right.
    this.shadowPlane.position.set(wMm * 0.015, -hMm * 0.02, -depth / 2 - depth * 0.6)
    this.shadowPlane.visible = true
  }

  /** Named camera angles; `frame()` re-fits the distance. */
  setView(view: 'angle' | 'front' | 'side' | 'top') {
    const dirs = { angle: [-0.32, 0.14, 1], front: [0, 0, 1], side: [1, 0.05, 0.25], top: [0, 1, 0.001] } as const
    const d = dirs[view]
    this.viewDir.set(d[0], d[1], d[2]).normalize()
    this.frame(true)
  }

  private viewDir = new THREE.Vector3(-0.32, 0.14, 1).normalize()

  /**
   * Move the camera to a distance that fits the model. Keeps the direction the user orbited to;
   * `named` snaps to the last named view (Angle, Front, Side, Top) instead.
   */
  frame(named = false) {
    if (!this.mesh) return
    const geo = this.mesh.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    const size = geo.boundingBox!.getSize(new THREE.Vector3())
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const tanH = tanV * this.camera.aspect
    // Fit both axes with a margin for the HUD above and the view dock below.
    const dist = Math.max(size.y / 2 / tanV, size.x / 2 / tanH, size.z) * 2.3
    const dir = !named && this.camera.position.lengthSq() >= 1 ? this.camera.position.clone().normalize() : this.viewDir
    const goal = dir.multiplyScalar(dist)
    this.zoomGoal = 0
    if (this.camera.position.lengthSq() < 1 || !this.mesh) this.camera.position.copy(goal)
    else this.camGoal = goal
    this.camera.near = Math.max(0.1, dist / 100)
    this.camera.far = dist * 20
    this.camera.updateProjectionMatrix()
    this.controls.target.set(0, 0, 0)
    this.placeBackdrop()
  }

  async exportGLB(): Promise<Blob> {
    if (!this.mesh) throw new Error('Nothing to export')
    // glTF uses metres; scale the millimetre mesh down on a wrapper.
    const wrapper = new THREE.Group()
    wrapper.name = 'glass-logo'
    wrapper.scale.setScalar(0.001)
    // The screen-space material zeroes `transmission`; export a standard KHR glass material.
    const p = this.target
    if (p.finish === 'print') this.ensurePrintTexture()
    const exportMaterial = p.finish === 'metal'
      ? new THREE.MeshPhysicalMaterial({ color: new THREE.Color(p.tint), metalness: p.metalness, roughness: p.roughness, clearcoat: p.clearcoat, clearcoatRoughness: 0.08 })
      : p.finish === 'print'
      ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: this.printTex, metalness: 0, roughness: p.roughness, clearcoat: p.clearcoat, clearcoatRoughness: 0.12 })
      : new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: p.roughness,
      transmission: 1,
      thickness: p.depthMm * 0.001,
      ior: p.ior,
      dispersion: p.dispersion * 2,
      clearcoat: p.clearcoat,
      clearcoatRoughness: 0.04,
      iridescence: p.edgeChroma,
      attenuationColor: new THREE.Color(p.tint),
      attenuationDistance: p.attenuationMm * 0.001,
    })
    exportMaterial.name = p.finish
    const clone = new THREE.Mesh(this.mesh.geometry, exportMaterial)
    clone.name = this.mesh.name
    wrapper.add(clone)
    const exporter = new GLTFExporter()
    try {
      const result = await exporter.parseAsync(wrapper, { binary: true })
      return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
    } finally {
      exportMaterial.dispose()
    }
  }

  exportSTL(): Blob {
    if (!this.mesh) throw new Error('Nothing to export')
    const exporter = new STLExporter()
    // The pop animation scales the mesh; the file must carry the true millimetres.
    const clone = new THREE.Mesh(this.mesh.geometry)
    const data = exporter.parse(clone, { binary: true }) as DataView<ArrayBuffer>
    return new Blob([data], { type: 'model/stl' })
  }

  async screenshot(scale = 2): Promise<Blob> {
    const prevRatio = this.renderer.getPixelRatio()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * scale, 4))
    this.resize()
    this.renderPasses()
    const blob = await new Promise<Blob>((resolve, reject) =>
      this.canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    )
    this.renderer.setPixelRatio(prevRatio)
    this.resize()
    return blob
  }

  dispose() {
    this.relief = null
    this.printTex?.dispose()
    this.print.dispose()
    this.disposed = true
    cancelAnimationFrame(this.raf)
    clearTimeout(this.interactTimer)
    this.canvas.removeEventListener('wheel', this.onWheel, { capture: true })
    this.controls.dispose()
    this.mesh?.geometry.dispose()
    this.backdrop.geometry.dispose()
    this.backdrop.material.map?.dispose()
    this.backdrop.material.dispose()
    this.material.dispose()
    this.metal.dispose()
    this.shadowPlane.geometry.dispose()
    this.shadowPlane.material.map?.dispose()
    this.shadowPlane.material.dispose()
    this.fboMain.dispose()
    this.fboBack.dispose()
    this.pmrem.dispose()
    this.renderer.dispose()
  }
}

