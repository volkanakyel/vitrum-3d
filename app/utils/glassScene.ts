import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { MeshTransmissionMaterial } from '@pmndrs/vanilla'
import type { TraceResult } from './trace'
import { DEFAULT_GLASS_PARAMS, type Finish, type Geometry, type GlassParams } from './presets'
export * from './presets'
import { buildExtrudeGeometry } from './extrude'
import { fitExternal } from './externalFit'
import { buildPrintTexture, buildCropTexture, padSilhouette } from './printTexture'
import { buildReliefGeometry, reliefScale, type ReliefData } from './relief'
import { buildSurfaceCanvases, softenCanvas } from './surface'
import { projectHull, type HullData, type HullPaintView } from './hull'
import type { ReliefMask } from './relief'
import type { Crop } from './trace'

/** The photos a carved hull is painted from, each with the source region its outline covers. */
export interface HullSource {
  image: HTMLImageElement
  crop: Crop
  /** The view's outline in its trace raster, so paint never samples the page around the object. */
  mask: ReliefMask
}
export interface HullSources {
  front: HullSource
  side: HullSource | null
  top: HullSource | null
}

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

export type ViewName = 'angle' | 'front' | 'side' | 'top'

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
  /** A model built elsewhere (the sculpt parts model) standing in for the carve. */
  private external: THREE.Group | null = null
  /** The external group's own box, in its own metres, before the studio's fit. */
  private externalBox = new THREE.Box3()
  /** The same box after the fit: the millimetres the stage, HUD and camera work in. */
  private externalStageBox = new THREE.Box3()
  private trace: TraceResult | null = null
  /** Values the UI asked for. */
  private target: GlassParams = { ...DEFAULT_GLASS_PARAMS }
  /** Values currently applied; eased toward `target` every frame. */
  private params: GlassParams = { ...DEFAULT_GLASS_PARAMS }
  private built = { widthMm: NaN, depthMm: NaN, bevelMm: NaN, bevelSegments: NaN, reliefMm: NaN, layerMm: NaN, geometry: '' as Geometry | '', relief: null as ReliefData | null, hull: null as HullData | null }
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
  /** Product stage only: sky/ground ambient and a cool fill opposite the key. */
  private hemi: THREE.HemisphereLight
  private fill: THREE.DirectionalLight
  /** Which rig is up: `null` until the first `apply`. */
  private stage: 'wall' | 'floor' | null = null
  private envStudio: THREE.Texture
  private envRoom: THREE.Texture | null = null
  private backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private backdropCanvas = document.createElement('canvas')
  private shadowPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private shadowCanvas = document.createElement('canvas')
  readonly metal: THREE.MeshPhysicalMaterial
  readonly print: THREE.MeshPhysicalMaterial
  /**
   * The Color finish for a carved hull: the photos are projected onto it at full resolution,
   * blended per vertex by which camera saw the surface (`projectHull`), with the front photo's
   * grain as normal and roughness maps where the front camera faced it.
   */
  readonly printHull: THREE.MeshPhysicalMaterial
  private hullUniforms = { hullFront: { value: null as THREE.Texture | null }, hullSide: { value: null as THREE.Texture | null }, hullTop: { value: null as THREE.Texture | null } }
  private hullMaps: THREE.Texture[] = []
  /** 1×1 white: what an absent photo samples as (its weight is 0 anyway). */
  private blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  private hull: HullData | null = null
  private hullSources: HullSources | null = null
  /** `flatten|grain` the hull's photo maps were built with. */
  private hullPaintSig = ''
  private hullPaintTimer: ReturnType<typeof setTimeout> | undefined
  private source: HTMLImageElement | null = null
  private relief: ReliefData | null = null
  private printTex: THREE.CanvasTexture | null = null
  /** Which geometry the print texture was padded for; relief without a cutout wants the plain crop. */
  private printTexKind: Geometry | null = null
  /** The raw Color canvas; the albedo, normal and roughness maps are derived from it. */
  private printCanvas: HTMLCanvasElement | null = null
  private surface: { albedo: THREE.CanvasTexture | null; normal: THREE.CanvasTexture | null; roughness: THREE.CanvasTexture | null } = { albedo: null, normal: null, roughness: null }
  /** `flatten|grain` the surface maps were built for. */
  private surfaceSig = ''
  private surfaceTimer: ReturnType<typeof setTimeout> | undefined
  /** Floor under the model that catches the key light's shadow (product shots). */
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>
  /**
   * The two light rigs, as unit directions from the model. The wall rig is the glass studio's.
   * The floor rig is the reference product shot's (`orange-chair-bed`, `createOrangeChairBedLookDevLights('reference')`)
   * to the number: white key 2.2 from upper front left casting the shadow, warm fill 0.8 from
   * the front right, white rim 0.5 from behind and above, over a white sky / warm-grey ground
   * hemisphere at 0.9. Only the key's direction is scaled to the model, in `placeFloor`.
   */
  private static readonly RIGS = {
    wall: {
      keyDir: new THREE.Vector3(-1, 1.7, 1.4).normalize(),
      rimDir: new THREE.Vector3(1.4, -0.4, -1).normalize(),
    },
    floor: {
      keyDir: new THREE.Vector3(-2.2, 3.4, 2.6).normalize(),
      fillDir: new THREE.Vector3(2.4, 1.6, 2.0).normalize(),
      rimDir: new THREE.Vector3(0, 2.5, -3).normalize(),
    },
  } as const
  /** Parameters that land at once: integers, and the two that rebuild textures. */
  private static readonly SNAP_KEYS = ['bevelSegments', 'flatten', 'grain', 'soften'] as const
  /** Procedural weave bump shared by both Color materials: strength and cells per millimetre. */
  private weaveUniforms = { weaveStrength: { value: 0 }, weaveFreq: { value: 1 } }
  private view: ViewName = 'angle'
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
    // Only the key light casts, and only while the model stands on a floor. The reference used
    // PCFSoftShadowMap, deprecated in r185 (it falls back to PCF with a warning); PCF with a
    // small radius on a 2048 map gives the same wide, soft penumbra.
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

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
    this.envStudio = this.pmrem.fromScene(createStudioEnvironment(), 0.02).texture
    this.scene.environment = this.envStudio
    this.blank.needsUpdate = true
    this.renderer.transmissionResolutionScale = 1
    this.scene.background = new THREE.Color(this.params.background)

    // Two hard lights give the crisp specular streaks a studio glass shot has. The product rig
    // (floor on) re-aims and re-colours them: see `RIGS`.
    this.key = new THREE.DirectionalLight(0xffffff, 2.2)
    this.key.position.copy(GlassStudio.RIGS.wall.keyDir)
    this.key.shadow.mapSize.set(2048, 2048)
    this.key.shadow.radius = 3
    this.rim = new THREE.DirectionalLight(0xdfe9ff, 1.4)
    this.rim.position.copy(GlassStudio.RIGS.wall.rimDir)
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xd8d2cc, 0.9)
    this.hemi.visible = false
    this.fill = new THREE.DirectionalLight(0xfff4ec, 0.8)
    this.fill.position.copy(GlassStudio.RIGS.floor.fillDir)
    this.fill.visible = false
    this.scene.add(this.key, this.rim, this.hemi, this.fill)

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

    // Floor: invisible except for the shadow it receives; placed under the model per rebuild.
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: this.params.shadow, depthWrite: false }),
    )
    this.floor.name = 'floor'
    this.floor.rotation.x = -Math.PI / 2
    this.floor.receiveShadow = true
    this.floor.visible = false
    this.scene.add(this.floor)

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
      sheen: this.params.sheen,
      sheenRoughness: 0.55,
      sheenColor: 0xffffff,
      envMapIntensity: this.params.envIntensity,
    })

    this.printHull = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: this.params.roughness,
      clearcoat: this.params.clearcoat,
      clearcoatRoughness: 0.12,
      sheen: this.params.sheen,
      sheenRoughness: 0.55,
      sheenColor: 0xffffff,
      envMapIntensity: this.params.envIntensity,
    })
    this.patchHullProjection()
    this.patchWeave(this.print)
    this.patchWeave(this.printHull)

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
        if ((GlassStudio.SNAP_KEYS as readonly string[]).includes(key) || (snapGeometry && (GlassStudio.GEOMETRY_KEYS as readonly string[]).includes(key))) { p[key] = tv; continue }
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
    // three darkens the base by 0.157 × sheen to pay for the sheen lobe; lift the base back so a
    // cloth preset keeps the photo's brightness instead of going dull.
    const sheenGain = 1 / (1 - 0.157 * p.sheen)
    // The reference weave repeats 180 cells across its cushion: the same count across the width.
    this.weaveUniforms.weaveStrength.value = p.weave
    this.weaveUniforms.weaveFreq.value = 180 / Math.max(1, p.widthMm)
    for (const m of [this.print, this.printHull]) {
      m.roughness = p.roughness
      m.clearcoat = p.clearcoat
      m.sheen = p.sheen
      m.color.setScalar(sheenGain)
      m.envMapIntensity = p.envIntensity
    }
    // Clear glass shows what is behind it, and a black silhouette right behind a clear slab
    // reads as a grey slab. Fade the contact shadow by the glass's clarity, never by the mesh.
    const glassy = p.finish === 'glass'
    const shadowOpacity = glassy ? p.shadow * (1 - 0.7 * p.clarity) : p.shadow
    this.shadowPlane.material.opacity = shadowOpacity
    this.floor.material.opacity = shadowOpacity
    const floorChanged = this.key.castShadow !== p.floor
    this.setFloor(p.floor)
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
      if (p.finish === 'print') {
        if (this.hullActive()) this.scheduleHullPaint()
        else { this.ensurePrintTexture(); this.scheduleSurface() }
      }
      this.mesh.material = this.materialFor(p.finish)
      if (prevFinish !== p.finish) this.pop = 0
      // A new stage (wall ↔ floor) is a new shot: glide to its named angle.
      if (floorChanged) this.frame(true)
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
      (relief && !this.hullActive() && (Math.abs(b.reliefMm - p.reliefMm) > 0.01 || b.relief !== this.relief)) ||
      (this.hullActive() && b.hull !== this.hull)
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

  /**
   * Floor on: the key light casts, the model stands on the floor and the orbit stays above it.
   * Floor off: the blurred silhouette on the wall behind, and the full orbit.
   */
  private setFloor(on: boolean) {
    const has = !!this.mesh || !!this.external
    this.setStage(on ? 'floor' : 'wall')
    this.key.castShadow = on
    this.floor.visible = on && has
    // The external model brings its own shapes: the painted silhouette behind it would be wrong.
    this.shadowPlane.visible = !on && has && !this.external
    if (this.mesh) { this.mesh.castShadow = on; this.mesh.receiveShadow = on }
    this.external?.traverse((o) => { o.castShadow = on; o.receiveShadow = on })
    this.controls.maxPolarAngle = on ? Math.PI / 2 - 0.04 : Math.PI - 0.03
  }

  /**
   * Two stages. The wall (logo) stage is the glass studio: a dark room with bright softboxes,
   * neutral tone curve, one hard key and a cool rim, so bevels flare and go dark. The floor
   * (product) stage is the reference product shot: ACES film curve, the `RIGS.floor` lights,
   * and for the Color finish *no* environment map at all, so a matte surface is lit by the four
   * lights alone and shows no room reflections on its rims. Glass and metal cannot do without
   * reflections, so they keep a neutral room while on the floor.
   */
  private setStage(stage: 'wall' | 'floor') {
    if (this.stage === stage) { this.applyEnvironment(); return }
    this.stage = stage
    const product = stage === 'floor'
    const rig = product ? GlassStudio.RIGS.floor : GlassStudio.RIGS.wall
    this.renderer.toneMapping = product ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping
    this.applyEnvironment()
    this.hemi.visible = this.fill.visible = product
    this.key.color.set(0xffffff)
    this.key.intensity = 2.2
    this.rim.color.set(product ? 0xffffff : 0xdfe9ff)
    this.rim.intensity = product ? 0.5 : 1.4
    this.rim.position.copy(rig.rimDir)
    this.key.position.copy(rig.keyDir).multiplyScalar(this.keyDistance).add(this.modelCentre)
  }

  /** How far out along its direction the key light sits; set per model in `placeFloor`. */
  private keyDistance = 1
  /** The middle of the model the lights aim at; set per model in `placeFloor`. */
  private modelCentre = new THREE.Vector3()

  private applyEnvironment() {
    const product = this.stage === 'floor'
    const bare = product && this.params.finish === 'print'
    if (product && !bare && !this.envRoom) this.envRoom = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    const env = bare ? null : product ? this.envRoom : this.envStudio
    if (this.scene.environment !== env) this.scene.environment = env
    this.scene.environmentIntensity = product ? 0.35 : 1
  }

  /**
   * Teach the hull material to sample up to three photos by the per-vertex weights and texture
   * coordinates `projectHull` computed, falling back to the vertex colour where no camera saw
   * the surface. The front photo's grain maps only apply in proportion to the front weight.
   */
  private patchHullProjection() {
    const m = this.printHull
    const u = this.hullUniforms
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 hullUvFront; attribute vec2 hullUvSide; attribute vec2 hullUvTop;
          attribute vec3 hullWeight; attribute vec3 hullColor;
          varying vec2 vHullUvFront; varying vec2 vHullUvSide; varying vec2 vHullUvTop;
          varying vec3 vHullWeight; varying vec3 vHullColor;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vHullUvFront = hullUvFront; vHullUvSide = hullUvSide; vHullUvTop = hullUvTop;
          vHullWeight = hullWeight; vHullColor = hullColor;`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D hullFront; uniform sampler2D hullSide; uniform sampler2D hullTop;
          varying vec2 vHullUvFront; varying vec2 vHullUvSide; varying vec2 vHullUvTop;
          varying vec3 vHullWeight; varying vec3 vHullColor;`)
        .replace('#include <map_fragment>', `
          vec3 hullRgb = texture2D( hullFront, vHullUvFront ).rgb * vHullWeight.x
            + texture2D( hullSide, vHullUvSide ).rgb * vHullWeight.y
            + texture2D( hullTop, vHullUvTop ).rgb * vHullWeight.z;
          float hullSeen = min( 1.0, vHullWeight.x + vHullWeight.y + vHullWeight.z );
          diffuseColor.rgb *= hullRgb + vHullColor * ( 1.0 - hullSeen );`)
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vHullWeight.x;'))
        .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment.replace('roughnessFactor *= texelRoughness.g;', 'roughnessFactor *= mix( 1.0, texelRoughness.g, vHullWeight.x );'))
    }
    m.customProgramCacheKey = () => 'hull-projection'
  }

  /**
   * A woven bump computed in the shader from the object-space position, so every part of the
   * surface gets the same cell size whatever the texture coordinates did (the projected photo's
   * pixels stretch where a camera saw the surface at an angle; this does not). Two thread
   * directions over and under in a checker, as the reference's fabric canvas, bump-mapped by
   * screen derivatives, blended across the three axes by the normal, and faded out once a cell
   * is under two pixels so a far view does not shimmer.
   */
  private patchWeave(m: THREE.MeshPhysicalMaterial) {
    const inner = m.onBeforeCompile
    const innerKey = m.customProgramCacheKey
    const u = this.weaveUniforms
    m.onBeforeCompile = (shader, renderer) => {
      inner.call(m, shader, renderer)
      shader.uniforms.weaveStrength = u.weaveStrength
      shader.uniforms.weaveFreq = u.weaveFreq
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWeavePos; varying vec3 vWeaveNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeavePos = position; vWeaveNrm = normal;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float weaveStrength; uniform float weaveFreq;
          varying vec3 vWeavePos; varying vec3 vWeaveNrm;
          float weaveH( vec2 q ) {
            vec2 c = floor( q );
            float over = mod( c.x + c.y, 2.0 );
            vec2 f = fract( q );
            float t = over > 0.5 ? sin( f.x * 3.14159 ) : sin( f.y * 3.14159 );
            return t * ( 0.7 + 0.3 * over );
          }
          vec3 weaveNormal( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
            vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
            vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
            vec3 vN = surf_norm;
            vec3 R1 = cross( vSigmaY, vN );
            vec3 R2 = cross( vN, vSigmaX );
            float fDet = dot( vSigmaX, R1 ) * faceDirection;
            vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
            return normalize( abs( fDet ) * surf_norm - vGrad );
          }`)
        .replace('#include <emissivemap_fragment>', `
          if ( weaveStrength > 0.0 ) {
            vec3 wp = vWeavePos * weaveFreq;
            vec3 an = abs( normalize( vWeaveNrm ) );
            an /= max( an.x + an.y + an.z, 1e-4 );
            float wh = weaveH( wp.xy ) * an.z + weaveH( wp.zy ) * an.x + weaveH( wp.xz ) * an.y;
            float cellsPerPx = max( fwidth( wp.x ), max( fwidth( wp.y ), fwidth( wp.z ) ) );
            float fade = 1.0 - smoothstep( 0.25, 0.5, cellsPerPx );
            float k = 0.35 * weaveStrength * fade;
            if ( k > 0.0 ) normal = weaveNormal( - vViewPosition, normal, vec2( dFdx( wh ), dFdy( wh ) ) * k, faceDirection );
          }
          #include <emissivemap_fragment>`)
    }
    m.customProgramCacheKey = () => (innerKey ? innerKey.call(m) : '') + '+weave'
  }

  /** Floor under the model's lowest point; key light and its shadow camera fitted to the model. */
  private placeFloor() {
    const box = this.modelBox()
    if (!box) { this.floor.visible = false; return }
    const r = box.getSize(new THREE.Vector3()).length() / 2
    this.floor.scale.setScalar(r * 14)
    this.floor.position.y = box.min.y - r * 0.002
    this.keyDistance = r * 5
    // The carve is centred on the origin, an external model stands on the floor: the key light
    // and its shadow camera follow the model's middle so the shadow map covers it either way.
    box.getCenter(this.modelCentre)
    if (this.key.target.parent !== this.scene) this.scene.add(this.key.target)
    this.key.target.position.copy(this.modelCentre)
    const rig = this.params.floor ? GlassStudio.RIGS.floor : GlassStudio.RIGS.wall
    this.key.position.copy(rig.keyDir).multiplyScalar(this.keyDistance).add(this.modelCentre)
    const cam = this.key.shadow.camera
    cam.left = cam.bottom = -r * 1.7
    cam.right = cam.top = r * 1.7
    cam.near = r * 2
    cam.far = r * 9
    cam.updateProjectionMatrix()
    // Biases scale with the model: the mesh is in millimetres, a logo 100 wide, a coin 20. The
    // reference uses 0.02 m of normal bias on a 0.8 m chair; the same share of the size here.
    this.key.shadow.normalBias = r * 0.02
    this.key.shadow.bias = -0.0002
    this.setFloor(this.params.floor)
  }

  private materialFor(finish: Finish): THREE.Material {
    return finish === 'metal' ? this.metal : finish === 'print' ? (this.hullActive() ? this.printHull : this.print) : this.material
  }

  /** Inflate with a side or top view: the carved hull replaces the single-photo pillow. */
  private hullActive(): boolean {
    return this.params.geometry === 'inflate' && !!this.hull && !!this.hullSources
  }

  /** The carved volume and the photos to paint it from; `null` returns Inflate to the single-photo pillow. */
  setHull(hull: HullData | null, sources: HullSources | null) {
    const hadMesh = !!this.mesh
    this.hull = hull
    this.hullSources = sources
    this.hullPaintSig = ''
    if (this.params.geometry !== 'inflate') return
    const before = this.built.geometry
    this.rebuild()
    // A first hull (or the hull replacing the pillow) is a new object; a flip or a re-carve is not.
    const swapped = before !== this.built.geometry || (!!hull && this.built.hull === hull && before !== 'inflate')
    if (!hadMesh) this.camera.position.set(0, 0, 0)
    if (!hadMesh || swapped) this.frame()
    if (this.mesh && (!hadMesh || swapped)) this.pop = 0
  }

  /** Re-project the photos shortly after `flatten` or `grain` settles. */
  private scheduleHullPaint() {
    if (!this.hullActive() || this.surfaceSignature() === this.hullPaintSig) return
    clearTimeout(this.hullPaintTimer)
    this.hullPaintTimer = setTimeout(() => this.paintHullColors(), 90)
  }

  private dropHullMaps() {
    for (const t of this.hullMaps) t.dispose()
    this.hullMaps = []
    for (const k of ['hullFront', 'hullSide', 'hullTop'] as const) this.hullUniforms[k].value = this.blank
    this.printHull.normalMap = null
    this.printHull.roughnessMap = null
    this.printHull.needsUpdate = true
  }

  /**
   * Project the photos onto the hull. Each view's crop (front at up to 2048 px, the others at
   * 1024) is de-lit by `flatten` and padded past its outline so no edge samples the page; the
   * front photo also gives the grain maps. `projectHull` decides, per vertex, which photo
   * shows the surface and where.
   */
  private paintHullColors() {
    const hull = this.hull, src = this.hullSources, mesh = this.mesh
    if (!hull || !src || !mesh || this.disposed || mesh.geometry.getAttribute('position').count * 3 !== hull.positions.length) return
    const sig = this.surfaceSignature()
    if (sig === this.hullPaintSig) return
    this.hullPaintSig = sig
    const t0 = performance.now()
    this.dropHullMaps()
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy()
    const tex = (canvas: HTMLCanvasElement, srgb: boolean) => {
      const t = new THREE.CanvasTexture(canvas)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = maxAniso
      t.minFilter = THREE.LinearMipmapLinearFilter
      this.hullMaps.push(t)
      return t
    }
    const view = (v: HullSource | null, size: number, grain: number): { paint: HullPaintView; canvas: HTMLCanvasElement; normal: HTMLCanvasElement | null; roughness: HTMLCanvasElement | null } | null => {
      if (!v) return null
      const raw = buildCropTexture(v.image, v.crop, size)
      const maps = buildSurfaceCanvases(raw, { flatten: this.params.flatten, grain })
      // Outline at the photo's resolution: the trace raster and the crop cover the same region.
      // Pad past the outline first, then soften: the blur must never reach the page colour.
      const { canvas: padded, inside } = padSilhouette(maps.albedo, v.mask)
      const canvas = softenCanvas(padded, this.params.soften)
      const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height)
      return { paint: { data, inside }, canvas, normal: maps.normal, roughness: maps.roughness }
    }
    const front = view(src.front, 2048, this.params.grain)!
    const side = view(src.side, 1024, 0)
    const top = view(src.top, 1024, 0)
    const paint = projectHull(hull, { front: front.paint, side: side?.paint ?? null, top: top?.paint ?? null })
    const geo = mesh.geometry
    const n = paint.colors.length / 3
    geo.setAttribute('color', new THREE.BufferAttribute(paint.colors, 3))
    geo.setAttribute('hullColor', geo.getAttribute('color'))
    geo.setAttribute('hullWeight', new THREE.BufferAttribute(paint.weights, 3))
    const uvOf = (slot: number) => {
      const a = new Float32Array(n * 2)
      for (let i = 0; i < n; i++) { a[i * 2] = paint.uvs[i * 6 + slot * 2]!; a[i * 2 + 1] = paint.uvs[i * 6 + slot * 2 + 1]! }
      return new THREE.BufferAttribute(a, 2)
    }
    const uvFront = uvOf(0)
    geo.setAttribute('hullUvFront', uvFront)
    geo.setAttribute('hullUvSide', uvOf(1))
    geo.setAttribute('hullUvTop', uvOf(2))
    // The grain maps read the standard uv channel: the front projection.
    geo.setAttribute('uv', uvFront)
    this.hullUniforms.hullFront.value = tex(front.canvas, true)
    this.hullUniforms.hullSide.value = side ? tex(side.canvas, true) : this.blank
    this.hullUniforms.hullTop.value = top ? tex(top.canvas, true) : this.blank
    this.printHull.normalMap = front.normal ? tex(front.normal, false) : null
    this.printHull.normalScale.set(1, 1)
    this.printHull.roughnessMap = front.roughness ? tex(front.roughness, false) : null
    // Sheen in the object's own colour (its mean albedo): a black chair keeps a dark rim.
    let sr = 0, sg = 0, sb = 0
    for (let i = 0; i < paint.colors.length; i += 3) { sr += paint.colors[i]!; sg += paint.colors[i + 1]!; sb += paint.colors[i + 2]! }
    this.printHull.sheenColor.setRGB(sr / n, sg / n, sb / n, THREE.LinearSRGBColorSpace)
    this.printHull.needsUpdate = true
    if (import.meta.dev) console.debug(`[hull] projected in ${Math.round(performance.now() - t0)} ms (${sig})`)
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
    if (g === 'inflate' && this.hullActive()) return 'inflate'
    const r = this.relief
    if (g === 'extrude' || !r) return 'extrude'
    return r.mirror === (g === 'inflate') ? g : 'extrude'
  }

  private dropPrintTexture() {
    this.printTex?.dispose()
    this.printTex = null
    this.printTexKind = null
    this.printCanvas = null
    this.dropSurface()
    this.print.map = null
    this.print.sheenColorMap = null
    this.print.needsUpdate = true
  }

  private dropSurface() {
    clearTimeout(this.surfaceTimer)
    for (const k of ['albedo', 'normal', 'roughness'] as const) { this.surface[k]?.dispose(); this.surface[k] = null }
    this.surfaceSig = ''
    this.print.normalMap = null
    this.print.roughnessMap = null
  }

  private surfaceSignature() {
    return `${this.params.flatten.toFixed(2)}|${this.params.grain.toFixed(2)}|${this.params.soften.toFixed(2)}`
  }

  /** Rebuild the surface maps shortly after `flatten`/`grain` settle; a drag never builds per frame. */
  private scheduleSurface() {
    if (!this.printCanvas || this.surfaceSignature() === this.surfaceSig) return
    clearTimeout(this.surfaceTimer)
    this.surfaceTimer = setTimeout(() => this.buildSurface(), 90)
  }

  /**
   * The Color finish's albedo, normal and roughness maps from the print canvas: the picture's
   * lighting divided out and its grain turned into a normal map, per `flatten` and `grain`.
   */
  private buildSurface() {
    const c = this.printCanvas
    if (!c || this.disposed) return
    const sig = this.surfaceSignature()
    if (sig === this.surfaceSig) return
    const t0 = performance.now()
    const maps = buildSurfaceCanvases(c, { flatten: this.params.flatten, grain: this.params.grain })
    this.dropSurface()
    this.surfaceSig = sig
    const tex = (canvas: HTMLCanvasElement, srgb: boolean) => {
      const t = new THREE.CanvasTexture(canvas)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      t.minFilter = THREE.LinearMipmapLinearFilter
      return t
    }
    const albedo = softenCanvas(maps.albedo, this.params.soften)
    this.surface.albedo = albedo === c ? null : tex(albedo, true)
    this.surface.normal = maps.normal ? tex(maps.normal, false) : null
    this.surface.roughness = maps.roughness ? tex(maps.roughness, false) : null
    this.print.map = this.surface.albedo ?? this.printTex
    // Cloth sheen is the fibre's own colour at a grazing angle: black velvet never glows white.
    this.print.sheenColorMap = this.print.map
    this.print.normalMap = this.surface.normal
    this.print.normalScale.set(1, 1)
    this.print.roughnessMap = this.surface.roughness
    this.print.needsUpdate = true
    if (import.meta.dev) console.debug(`[surface] ${Math.round(performance.now() - t0)} ms (${sig})`)
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
    this.dropSurface()
    this.printTexKind = kind
    this.printCanvas = canvas
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
    this.printTex = tex
    this.print.map = tex
    this.print.sheenColorMap = tex
    this.print.needsUpdate = true
    this.buildSurface()
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

  /** The box the stage, the HUD and the camera measure: the carved geometry, or the placed external group. */
  private modelBox(): THREE.Box3 | null {
    if (this.external) return this.externalStageBox
    const mesh = this.mesh
    if (!mesh) return null
    const geo = mesh.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    return geo.boundingBox
  }

  /**
   * Stand a model built elsewhere (the sculpt parts model, in metres) on the
   * stage in place of the carve, scaled to `widthMm`. `null` disposes it and
   * rebuilds the carved mesh.
   */
  setExternalModel(group: THREE.Group | null) {
    // Clearing what was never set is a no-op: every import and every `clearImage`
    // calls this, and a stray rebuild would re-carve the old trace for nothing.
    if (!group && !this.external) return
    if (this.external) {
      this.scene.remove(this.external)
      this.disposeExternal(this.external)
      this.external = null
    }
    if (!group) {
      // `built` was left alone while the external model stood, so this rebuilds
      // exactly the mesh the carve controls describe.
      this.rebuild()
      this.frame()
      return
    }
    if (this.mesh) {
      this.scene.remove(this.mesh)
      this.mesh.geometry.dispose()
      this.mesh = null
    }
    this.shadowPlane.visible = false
    this.external = group
    group.scale.setScalar(1)
    group.position.set(0, 0, 0)
    group.updateMatrixWorld(true)
    this.externalBox = new THREE.Box3().setFromObject(group)
    this.fitExternalModel()
    this.scene.add(group)
    this.placeFloor()
    this.frame()
    this.onRebuild?.()
  }

  /** Scale and place the external group for the current `widthMm`. */
  private fitExternalModel() {
    const group = this.external
    if (!group) return
    const { scale, offset } = fitExternal(this.externalBox, this.params.widthMm)
    group.scale.setScalar(scale)
    group.position.copy(offset)
    group.updateMatrixWorld(true)
    this.externalStageBox = this.externalBox.clone()
      .applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale))
      .translate(offset)
  }

  private disposeExternal(group: THREE.Group) {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(m as unknown as Record<string, unknown>)) {
          // The studio's own environment maps are shared and outlive any model.
          if (value instanceof THREE.Texture && value !== this.envRoom && value !== this.envStudio) value.dispose()
        }
        m.dispose()
      }
    })
  }

  getDimensions(): ModelDimensions | null {
    if (this.external) {
      const size = this.externalStageBox.getSize(new THREE.Vector3())
      let triangles = 0
      this.external.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const index = mesh.geometry.getIndex()
        triangles += index ? index.count / 3 : mesh.geometry.getAttribute('position').count / 3
      })
      return { widthMm: size.x, heightMm: size.y, depthMm: size.z, triangles }
    }
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
    if (this.external) {
      // The carve is not rebuilt while a parts model stands; only its size follows the width.
      this.fitExternalModel()
      const p = this.params
      // Keep `built` level with the parameters so `apply()` does not ask again every frame.
      this.built = { ...this.built, widthMm: p.widthMm, depthMm: p.depthMm, bevelMm: p.bevelMm, bevelSegments: p.bevelSegments, reliefMm: p.reliefMm, layerMm: p.layerMm, geometry: this.activeGeometry(), relief: this.relief, hull: this.hull }
      this.placeFloor()
      this.onRebuild?.()
      return
    }
    if (this.mesh) {
      this.scene.remove(this.mesh)
      this.mesh.geometry.dispose()
      this.mesh = null
    }
    this.shadowPlane.visible = false
    const p = this.params
    const active = this.activeGeometry()
    if (active === 'inflate' && this.hullActive()) {
      this.rebuildHull()
      this.placeFloor()
      this.onRebuild?.()
      return
    }
    if (active === 'inflate' || active === 'relief') {
      this.rebuildRelief()
      this.placeFloor()
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
    this.built = { widthMm: p.widthMm, depthMm: p.depthMm, bevelMm: p.bevelMm, bevelSegments: p.bevelSegments, reliefMm: NaN, layerMm: p.layerMm, geometry: active, relief: null, hull: null }
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
    this.placeFloor()
    this.onRebuild?.()
  }

  /** The carved hull at `widthMm`, painted from its photos, with the front outline's shadow. */
  private rebuildHull() {
    const h = this.hull!, p = this.params, t = this.trace
    const t0 = performance.now()
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(h.positions.length)
    for (let i = 0; i < pos.length; i++) pos[i] = h.positions[i]! * p.widthMm
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(h.normals, 3))
    geo.computeBoundingBox()
    this.mesh = new THREE.Mesh(geo, this.materialFor(p.finish))
    this.mesh.name = 'hull'
    this.built = { widthMm: p.widthMm, depthMm: p.depthMm, bevelMm: NaN, bevelSegments: NaN, reliefMm: NaN, layerMm: NaN, geometry: 'inflate', relief: null, hull: h }
    this.scene.add(this.mesh)
    this.hullPaintSig = ''
    this.paintHullColors()
    const size = geo.boundingBox!.getSize(new THREE.Vector3())
    // The carved box's footprint; the photo's outline no longer lies in the model's own front plane.
    this.paintShadow(size.x, size.y, size.z, (ctx, sx, sy) => {
      ctx.rect(-size.x / 2 * sx, -size.y / 2 * sy, size.x * sx, size.y * sy)
    })
    this.lastRebuildMs = performance.now() - t0
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
    this.built = { widthMm: p.widthMm, depthMm: p.depthMm, bevelMm: NaN, bevelSegments: NaN, reliefMm: p.reliefMm, layerMm: NaN, geometry: r.mirror ? 'inflate' : 'relief', relief: r, hull: null }
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
    this.shadowPlane.visible = !this.params.floor
  }

  /** Named camera angles; `frame()` re-fits the distance. */
  setView(view: ViewName) {
    this.view = view
    this.frame(true)
  }

  /**
   * On a wall a logo is shot almost square on; on a floor an object gets the reference product
   * shot's camera (`1.15, 0.72, 2.05` at a target `0.45` up an `0.8` m chair): three-quarter,
   * a little above, from whichever side the photo was taken on, so the faces it painted best face
   * the camera.
   */
  private viewDir(): THREE.Vector3 {
    const front = this.hullActive() ? this.hull!.frames[0] : null
    const side = front && front.d[0] < 0 ? -1 : 1
    const dirs = {
      angle: this.params.floor ? [1.15 * side, 0.27, 2.05] : [-0.32, 0.14, 1],
      front: [0, this.params.floor ? 0.08 : 0, 1],
      side: [1, 0.08, 0.25],
      top: [0, 1, 0.001],
    } as const
    const d = dirs[this.view]
    return new THREE.Vector3(d[0], d[1], d[2]).normalize()
  }

  /**
   * Move the camera to a distance that fits the model. Keeps the direction the user orbited to;
   * `named` snaps to the last named view (Angle, Front, Side, Top) instead.
   */
  frame(named = false) {
    const box = this.modelBox()
    if (!box) return
    const size = box.getSize(new THREE.Vector3())
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const tanH = tanV * this.camera.aspect
    // Fit both axes with a margin for the HUD above and the view dock below.
    const dist = Math.max(size.y / 2 / tanV, size.x / 2 / tanH, size.z) * 2.3
    // A carved mesh is centred on the origin; a parts model stands on the floor, so the camera
    // looks at the middle of its box rather than at its feet.
    const target = this.external ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3()
    const eye = this.camera.position.clone().sub(this.controls.target)
    // No camera yet (the studio starts at the target): place it, do not glide.
    const placed = eye.lengthSq() >= 1
    const dir = !named && placed ? eye.normalize() : this.viewDir()
    const goal = target.clone().add(dir.multiplyScalar(dist))
    this.zoomGoal = 0
    if (!placed) this.camera.position.copy(goal)
    else this.camGoal = goal
    this.camera.near = Math.max(0.1, dist / 100)
    this.camera.far = dist * 20
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(target)
    this.placeBackdrop()
  }

  async exportGLB(): Promise<Blob> {
    if (this.external) {
      // glTF is already this model's own unit: export it in metres, at 1:1, with its own
      // materials. The clone shares geometries and materials; only the transform differs.
      const wrapper = new THREE.Group()
      wrapper.name = this.external.name || 'parts'
      const clone = this.external.clone(true)
      clone.scale.setScalar(1)
      clone.position.set(0, 0, 0)
      wrapper.add(clone)
      const exporter = new GLTFExporter()
      const result = await exporter.parseAsync(wrapper, { binary: true })
      return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
    }
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
      : p.finish === 'print' && this.hullActive()
      ? new THREE.MeshPhysicalMaterial({
        vertexColors: true, metalness: 0, roughness: p.roughness, clearcoat: p.clearcoat, clearcoatRoughness: 0.12,
        sheen: p.sheen, sheenRoughness: 0.55, sheenColor: 0xffffff,
      })
      : p.finish === 'print'
      ? new THREE.MeshPhysicalMaterial({
        color: 0xffffff, map: this.print.map, normalMap: this.print.normalMap, roughnessMap: this.print.roughnessMap,
        metalness: 0, roughness: p.roughness, clearcoat: p.clearcoat, clearcoatRoughness: 0.12,
        sheen: p.sheen, sheenRoughness: 0.55, sheenColor: 0xffffff,
      })
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
    if (this.external) {
      // STL carries no units: the studio's millimetres, as the carved mesh exports them. The
      // exporter reads each mesh's world matrix, which already holds the fit to `widthMm`.
      const exporter = new STLExporter()
      this.external.updateMatrixWorld(true)
      const data = exporter.parse(this.external, { binary: true }) as DataView<ArrayBuffer>
      return new Blob([data], { type: 'model/stl' })
    }
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
    this.dropSurface()
    clearTimeout(this.hullPaintTimer)
    this.dropHullMaps()
    this.blank.dispose()
    this.envRoom?.dispose()
    this.envStudio.dispose()
    this.print.dispose()
    this.printHull.dispose()
    this.floor.geometry.dispose()
    this.floor.material.dispose()
    this.disposed = true
    cancelAnimationFrame(this.raf)
    clearTimeout(this.interactTimer)
    this.canvas.removeEventListener('wheel', this.onWheel, { capture: true })
    this.controls.dispose()
    if (this.external) { this.disposeExternal(this.external); this.external = null }
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

