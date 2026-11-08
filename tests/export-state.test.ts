import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GlassStudio } from '~/utils/glassScene'
import { DEFAULT_GLASS_PARAMS } from '~/utils/presets'
import { deferred } from './helpers/mount'

// The shader package includes browser-only remote imports; exports do not instantiate it here.
vi.mock('@pmndrs/vanilla', () => ({ MeshTransmissionMaterial: class {} }))
const writer = vi.hoisted(() => ({ parse: vi.fn() }))
vi.mock('three/addons/exporters/GLTFExporter.js', () => ({ GLTFExporter: class { parseAsync = writer.parse } }))

beforeEach(() => { vi.stubGlobal('window', { devicePixelRatio: 1 }); writer.parse.mockReset() })
afterEach(() => vi.unstubAllGlobals())

it('owns GLB geometry and textures while asynchronous encoding is in progress', async () => {
  const encoding = deferred<ArrayBuffer>()
  const sourceGeometry = new THREE.BoxGeometry(10, 10, 10)
  const sourceTexture = new THREE.Texture()
  const mesh = new THREE.Mesh(sourceGeometry)
  let written: THREE.Mesh | undefined
  writer.parse.mockImplementation((group: THREE.Group) => {
    written = group.children[0] as THREE.Mesh
    return encoding.promise
  })
  // GPU calls are outside this test; snapshot ownership and real Three.js resources are exercised.
  const studio = Object.assign(Object.create(GlassStudio.prototype), {
    mesh, target: { ...DEFAULT_GLASS_PARAMS, finish: 'print' },
    print: { map: sourceTexture, normalMap: null, roughnessMap: null },
    snapParams() {}, ensurePrintTexture() {}, buildSurface() {},
  }) as GlassStudio
  const pending = studio.exportGLB()
  const sourcePositions = sourceGeometry.getAttribute('position')
  const before = sourcePositions.getX(0)
  sourcePositions.setX(0, 999)
  expect(written!.geometry.getAttribute('position').getX(0)).toBe(before)
  expect((written!.material as THREE.MeshPhysicalMaterial).map).not.toBe(sourceTexture)
  encoding.resolve(new ArrayBuffer(4))
  await pending
})

it('restores capture settings before waiting for PNG encoding', async () => {
  let ratio = 1
  let encode!: BlobCallback
  const focus = { shift: 40, scale: 0.7 }
  const studio = Object.assign(Object.create(GlassStudio.prototype), {
    renderer: { getPixelRatio: () => ratio, setPixelRatio: (v: number) => { ratio = v } },
    canvas: { toBlob: (callback: BlobCallback) => { encode = callback } },
    focus, target: { ...DEFAULT_GLASS_PARAMS }, mesh: new THREE.Mesh(new THREE.BoxGeometry()),
    snapParams() {}, resize() {}, renderPasses() {},
  }) as GlassStudio
  const pending = studio.screenshot()
  expect(ratio).toBe(1)
  expect((studio as unknown as { focus: unknown }).focus).toEqual(focus)
  encode(new Blob(['png']))
  await pending
})

it('releases studio warm-up geometry when its lifetime ends during shader compilation', async () => {
  const lifetime = new AbortController()
  const compiling = deferred<void>()
  let released = false
  const renderer = {
    getRenderTarget: () => null, setRenderTarget() {},
    compileAsync(mesh: THREE.Mesh) {
      mesh.geometry.addEventListener('dispose', () => { released = true })
      return compiling.promise
    },
  }
  const studio = Object.assign(Object.create(GlassStudio.prototype), { renderer, lifetime }) as { warmUp(): Promise<void> }
  let settled = false
  void studio.warmUp().then(() => { settled = true })
  lifetime.abort()
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(settled).toBe(true)
  expect(released).toBe(true)
})
