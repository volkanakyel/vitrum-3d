import { expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { Showcase } from '~/utils/showcase'
import { deferred } from './helpers/mount'

vi.mock('@pmndrs/vanilla', () => ({ MeshTransmissionMaterial: class {} }))
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

it('settles hero load and releases warm-up materials when disposed before marks arrive', async () => {
  const marks = deferred<never[]>()
  let released = 0
  const renderer = { compileAsync: async () => {}, dispose() {} }
  const scene = new THREE.Scene()
  const showcase = Object.assign(Object.create(Showcase.prototype), {
    opts: { layout: 'hero', hero: { requests: [], build: { marks: marks.promise, terminate() {} } } },
    disposed: false, lifetime: new AbortController(), renderer, scene, camera: new THREE.PerspectiveCamera(),
    shadowTex: new THREE.Texture(), backdrop: { material: new THREE.MeshBasicMaterial() },
    pmrem: { dispose() {} }, envLiquid: null,
    material() {
      const material = new THREE.MeshBasicMaterial()
      material.addEventListener('dispose', () => { released++ })
      return material
    },
  }) as Showcase
  vi.stubGlobal('cancelAnimationFrame', () => {})
  let state = 'pending'
  void showcase.load().then(() => { state = 'done' }, err => { state = err.name })
  await flush()
  showcase.dispose()
  await flush()
  expect(state).toBe('AbortError')
  expect(released).toBeGreaterThan(0)
  vi.unstubAllGlobals()
})
