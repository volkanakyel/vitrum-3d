/**
 * Sculpt sandbox — page side.
 *
 * This module runs inside `/sandbox`, which the host embeds as
 * `<iframe sandbox="allow-scripts">`: an opaque origin with no cookies, no
 * storage and no same-origin handle back to the app. It is the only place
 * model-generated code is ever executed. The host speaks to it by
 * `postMessage` and gets pixels and a GLB back — nothing else crosses.
 */

import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { createKit } from './kit'
import type { KitOptions } from './kit'

export interface SandboxView {
  name: string
  /** degrees about +Y; 0 = camera on +Z (front), positive = camera to the object's right (+X) */
  yaw: number
  /** degrees above the horizon */
  pitch: number
  fov: number
  /** camera distance as a multiple of the bounding-sphere radius */
  distance: number
}

/** Every request carries the host's per-frame nonce; every reply echoes it. */
interface Envelope { id: number, nonce: string }

export type SandboxRequest =
  | (Envelope & { type: 'load', code: string, quality: KitOptions['quality'], seed: number })
  | (Envelope & { type: 'render', views: SandboxView[], size: number })
  | (Envelope & { type: 'export' })

export type SandboxResponse =
  | { type: 'ready' }
  | {
    type: 'loaded'
    id: number
    nonce: string
    parts: string[]
    triangles: number
    drawCalls: number
    bounds: { w: number, h: number, d: number }
  }
  | { type: 'rendered', id: number, nonce: string, views: { name: string, png: ArrayBuffer }[] }
  | { type: 'exported', id: number, nonce: string, glb: ArrayBuffer }
  | { type: 'error', id: number, nonce: string, message: string, stack?: string }

/** The generated factory gets this long before the watchdog gives up on it. */
const FACTORY_TIMEOUT_MS = 10_000
/** Matches the host's cap; a render request larger than this is a mistake or an attack. */
const MAX_RENDER_SIZE = 4096

/**
 * The host's nonce, learned from its first request and kept in module scope:
 * generated code runs inside `new Function` and has no way to reach this
 * binding, so it cannot forge a reply the host will accept.
 */
let sessionNonce: string | null = null

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** The product rig: a copy of the studio stage, so review renders match the app. */
function buildStage(): {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  key: THREE.DirectionalLight
  canvas: HTMLCanvasElement
} {
  const canvas = createCanvas(1024, 1024)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xFFFFFF)

  scene.add(new THREE.HemisphereLight(0xFFFFFF, 0xD8D2CC, 0.9))

  const key = new THREE.DirectionalLight(0xFFFFFF, 2.2)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0002
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xFFF4EC, 0.8)
  fill.position.set(2.4, 1.6, 2.0)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0xFFFFFF, 0.5)
  rim.position.set(0, 2.5, -3)
  scene.add(rim)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.18 }),
  )
  floor.receiveShadow = true
  floor.position.y = 0
  scene.add(floor)

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200)
  scene.add(camera)

  return { renderer, scene, camera, key, canvas }
}

/** Free every GPU resource a generated model may have allocated. */
function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material
    if (!material) return
    for (const one of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(one as unknown as Record<string, unknown>)) {
        if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose()
      }
      one.dispose()
    }
  })
}

function countGeometry(group: THREE.Group): { triangles: number, drawCalls: number } {
  let triangles = 0
  let drawCalls = 0
  group.traverse((object) => {
    const mesh = object as THREE.Mesh & { isMesh?: boolean, count?: number }
    if (!mesh.isMesh || !mesh.geometry) return
    drawCalls += 1
    const index = mesh.geometry.getIndex()
    const position = mesh.geometry.getAttribute('position')
    const per = index ? index.count / 3 : (position ? position.count / 3 : 0)
    triangles += per * (typeof mesh.count === 'number' ? mesh.count : 1)
  })
  return { triangles: Math.round(triangles), drawCalls }
}

function partNames(group: THREE.Group): string[] {
  const registry = (group.userData?.sculpt as { parts?: Record<string, unknown> } | undefined)?.parts
  if (registry && typeof registry === 'object') return Object.keys(registry)
  const names: string[] = []
  group.traverse((object) => {
    const mesh = object as THREE.Mesh & { isMesh?: boolean }
    if (mesh.isMesh && mesh.name) names.push(mesh.name)
  })
  return names
}

function errorMessage(error: unknown): { message: string, stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

/**
 * True only when this document is a framed, sandboxed one: an opaque origin
 * (`window.origin === 'null'`) inside someone else's page. Loaded any other
 * way — top level, or framed without the `sandbox` attribute, which would put
 * it on the app's real origin — the runtime must not run generated code.
 */
function isIsolated(): boolean {
  return window.parent !== window && window.origin === 'null'
}

type Stage = ReturnType<typeof buildStage>

export class SandboxRuntime {
  /** Built on the first request: a refused page must not hold a GL context. */
  #stageRef: Stage | null = null
  #group: THREE.Group | null = null
  #disposed = false
  #busy = false
  readonly #active: boolean
  readonly #onMessage: (event: MessageEvent) => void

  constructor() {
    this.#active = isIsolated()
    this.#onMessage = (event: MessageEvent) => {
      // Only the embedder may drive this page.
      if (event.source !== window.parent) return
      const request = event.data as SandboxRequest
      if (!request || typeof request !== 'object' || typeof request.nonce !== 'string') return
      // The first request settles whose page this is; nothing else is served.
      if (sessionNonce === null) sessionNonce = request.nonce
      else if (request.nonce !== sessionNonce) return
      if (this.#busy) {
        this.#post({ type: 'error', id: request.id, nonce: request.nonce, message: 'busy' })
        return
      }
      this.#busy = true
      void this.#handle(request).finally(() => { this.#busy = false })
    }
    if (!this.#active) {
      console.error(
        '[sandbox] refusing to run: this page only executes generated code inside '
        + 'an <iframe sandbox="allow-scripts">, on an opaque origin.',
      )
      return
    }
    window.addEventListener('message', this.#onMessage)
  }

  get #stage(): Stage {
    this.#stageRef ??= buildStage()
    return this.#stageRef
  }

  /** Announce readiness once the module is live. */
  announce(): void {
    if (!this.#active) return
    this.#post({ type: 'ready' })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    window.removeEventListener('message', this.#onMessage)
    if (this.#group) disposeGroup(this.#group)
    this.#group = null
    this.#stageRef?.renderer.dispose()
    this.#stageRef = null
  }

  #post(message: SandboxResponse, transfer: Transferable[] = []): void {
    // Opaque origin: '*' is the only target origin available. Nothing secret
    // travels this way — the host checks the source window on its side.
    window.parent.postMessage(message, '*', transfer)
  }

  async #handle(request: SandboxRequest): Promise<void> {
    try {
      switch (request.type) {
        case 'load': return await this.#load(request)
        case 'render': return await this.#render(request)
        case 'export': return await this.#export(request)
        default: return
      }
    }
    catch (error) {
      const { message, stack } = errorMessage(error)
      this.#post({
        type: 'error',
        id: request.id,
        nonce: request.nonce,
        message,
        stack,
      })
    }
  }

  async #load(request: Extract<SandboxRequest, { type: 'load' }>): Promise<void> {
    if (this.#group) {
      this.#stage.scene.remove(this.#group)
      disposeGroup(this.#group)
      this.#group = null
    }

    const kit = createKit(
      THREE,
      { quality: request.quality, seed: request.seed, textureSize: 1024 },
      createCanvas,
    )

    let timer = 0
    const watchdog = new Promise<never>((_, reject) => {
      timer = window.setTimeout(
        () => reject(new Error(`createModel timed out after ${FACTORY_TIMEOUT_MS} ms`)),
        FACTORY_TIMEOUT_MS,
      )
    })
    // A synchronous infinite loop cannot be interrupted from here; the host's
    // own timeout tears the whole iframe down for that case.
    const run = (async () => {
      const factory = new Function(
        'kit',
        'THREE',
        'options',
        `${request.code}\nreturn createModel(kit, THREE, options)`,
      ) as (kit: unknown, three: unknown, options: unknown) => unknown
      return factory(kit, THREE, {})
    })()

    let result: unknown
    try {
      result = await Promise.race([run, watchdog])
    }
    finally {
      window.clearTimeout(timer)
    }

    const group = result as THREE.Group
    if (!group || !(group as { isGroup?: boolean }).isGroup) {
      throw new Error('createModel must return a THREE.Group (use kit.root([...]))')
    }

    group.traverse((object) => {
      const mesh = object as THREE.Mesh & { isMesh?: boolean }
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
    })

    this.#group = group
    this.#stage.scene.add(group)
    group.updateWorldMatrix(true, true)

    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3())
    const { triangles, drawCalls } = countGeometry(group)
    this.#post({
      type: 'loaded',
      id: request.id,
      nonce: request.nonce,
      parts: partNames(group),
      triangles,
      drawCalls,
      bounds: { w: size.x, h: size.y, d: size.z },
    })
  }

  async #render(request: Extract<SandboxRequest, { type: 'render' }>): Promise<void> {
    const group = this.#group
    if (!group) throw new Error('nothing loaded')
    const { renderer, scene, camera, key, canvas } = this.#stage
    const size = Math.min(MAX_RENDER_SIZE, Math.max(16, Math.round(request.size)))
    canvas.width = size
    canvas.height = size
    renderer.setSize(size, size, false)

    const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere())
    const radius = sphere.radius || 1
    const centre = sphere.center

    // The key light follows the object so the shadow reads at any scale.
    key.position.copy(centre).add(new THREE.Vector3(-2.2, 3.4, 2.6).normalize().multiplyScalar(radius * 5))
    key.target.position.copy(centre)
    key.target.updateMatrixWorld()
    const extent = radius * 6
    key.shadow.camera.left = -extent
    key.shadow.camera.right = extent
    key.shadow.camera.top = extent
    key.shadow.camera.bottom = -extent
    key.shadow.camera.near = 0.01
    key.shadow.camera.far = radius * 20
    key.shadow.camera.updateProjectionMatrix()

    const views: { name: string, png: ArrayBuffer }[] = []
    for (const view of request.views) {
      const yaw = THREE.MathUtils.degToRad(view.yaw)
      const pitch = THREE.MathUtils.degToRad(view.pitch)
      const distance = view.distance * radius
      camera.fov = view.fov
      camera.aspect = 1
      camera.near = Math.max(0.001, distance - radius * 4)
      camera.far = distance + radius * 12
      camera.position.set(
        centre.x + distance * Math.cos(pitch) * Math.sin(yaw),
        centre.y + distance * Math.sin(pitch),
        centre.z + distance * Math.cos(pitch) * Math.cos(yaw),
      )
      camera.lookAt(centre)
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error(`could not encode view ${view.name}`)
      views.push({ name: view.name, png: await blob.arrayBuffer() })
    }

    this.#post(
      { type: 'rendered', id: request.id, nonce: request.nonce, views },
      views.map(v => v.png),
    )
  }

  async #export(request: Extract<SandboxRequest, { type: 'export' }>): Promise<void> {
    const group = this.#group
    if (!group) throw new Error('nothing loaded')
    const glb = await new GLTFExporter().parseAsync(group, { binary: true }) as ArrayBuffer
    this.#post({ type: 'exported', id: request.id, nonce: request.nonce, glb }, [glb])
  }
}
