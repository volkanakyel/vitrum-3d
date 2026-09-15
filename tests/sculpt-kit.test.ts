import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createKit } from '~/utils/sculpt/kit'
import type { Kit, KitOptions } from '~/utils/sculpt/kit/kit'
import { validateCode } from '../server/utils/sculpt/validateCode'

/* ------------------------------------------------------------------ stubs */

interface StubImageData { data: Uint8ClampedArray, width: number, height: number }

function stubContext(width: number, height: number) {
  const calls: string[] = []
  const record = (name: string) => () => { calls.push(name) }
  return {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    fillRect: record('fillRect'),
    beginPath: record('beginPath'),
    arc: record('arc'),
    fill: record('fill'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    drawImage: record('drawImage'),
    createImageData: (w: number, h: number): StubImageData => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (_x: number, _y: number, w: number, h: number): StubImageData => {
      const data = new Uint8ClampedArray(w * h * 4)
      data.fill(128)
      return { data, width: w, height: h }
    },
    putImageData: record('putImageData'),
    canvasWidth: width,
    canvasHeight: height,
  }
}

function canvasFactory(w: number, h: number) {
  const ctx = stubContext(w, h)
  return { width: w, height: h, getContext: () => ctx } as unknown as HTMLCanvasElement
}

function makeKit(overrides: Partial<KitOptions> = {}): Kit {
  const options: KitOptions = { quality: 'standard', seed: 7, textureSize: 512, ...overrides }
  return createKit(THREE, options, canvasFactory)
}

function bounds(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox as THREE.Box3
  const size = new THREE.Vector3()
  box.getSize(size)
  return size
}

function hasNaN(geometry: THREE.BufferGeometry, name: string) {
  const attribute = geometry.getAttribute(name)
  if (!attribute) return true
  const array = attribute.array as ArrayLike<number>
  for (let i = 0; i < array.length; i += 1) {
    const value = array[i]
    if (value === undefined || Number.isNaN(value)) return true
  }
  return false
}

const fixturePath = fileURLToPath(new URL('./fixtures/orange-chair.kit.js', import.meta.url))
const kitTypesPath = fileURLToPath(new URL('../app/utils/sculpt/kit/kit.d.ts', import.meta.url))

/* ----------------------------------------------------------------- geometry */

describe('sculpt kit geometry', () => {
  it('pillow bulges outside the nominal size and is smooth', () => {
    const kit = makeKit()
    const geometry = kit.pillow(0.8, 0.2, 0.7, { radius: 0.05, bulge: 0.02 })
    const size = bounds(geometry)
    expect(size.x).toBeCloseTo(0.84, 3)
    expect(size.y).toBeCloseTo(0.24, 3)
    expect(size.z).toBeCloseTo(0.74, 3)

    const normals = geometry.getAttribute('normal')
    expect(normals).toBeTruthy()
    const v = new THREE.Vector3()
    for (let i = 0; i < normals.count; i += 1) {
      v.fromBufferAttribute(normals, i)
      expect(v.length()).toBeCloseTo(1, 5)
    }
    expect(geometry.getAttribute('position').count).toBeGreaterThan(1000)
  })

  it('bentTube spans both legs of an L with no NaN', () => {
    const kit = makeKit()
    const geometry = kit.bentTube([[0, 0, 0], [0.5, 0, 0], [0.5, 0, 0.4]], 0.02, 0.06)
    const box = (geometry.computeBoundingBox(), geometry.boundingBox as THREE.Box3)
    expect(box.min.x).toBeLessThan(0.01)
    expect(box.max.x).toBeGreaterThan(0.49)
    expect(box.min.z).toBeLessThan(0.01)
    expect(box.max.z).toBeGreaterThan(0.39)
    expect(hasNaN(geometry, 'position')).toBe(false)
    expect(hasNaN(geometry, 'normal')).toBe(false)
  })

  it('sweep tapers the last ring to zero without NaN normals', () => {
    const kit = makeKit()
    const points: [number, number, number][] = [
      [0, 0, 0],
      [0.2, 0.1, 0.1],
      [0.4, 0, -0.1],
      [0.6, -0.1, 0.1],
      [0.8, 0, 0],
    ]
    const geometry = kit.sweep(points, t => 0.05 * (1 - t), { segments: 64 })
    expect(hasNaN(geometry, 'position')).toBe(false)
    expect(hasNaN(geometry, 'normal')).toBe(false)

    const meta = geometry.userData.sweep as { samples: number, radialSegments: number }
    expect(meta).toBeTruthy()
    const position = geometry.getAttribute('position')
    const first = (meta.samples - 1) * meta.radialSegments
    const centre = new THREE.Vector3()
    const v = new THREE.Vector3()
    for (let i = first; i < first + meta.radialSegments; i += 1) {
      centre.add(v.fromBufferAttribute(position, i))
    }
    centre.divideScalar(meta.radialSegments)
    for (let i = first; i < first + meta.radialSegments; i += 1) {
      v.fromBufferAttribute(position, i)
      expect(v.distanceTo(centre)).toBeLessThan(1e-3)
    }
  })
})

/* ----------------------------------------------------------------- assembly */

describe('sculpt kit assembly', () => {
  it('restOn puts the child bottom on the parent top minus overlap', () => {
    const kit = makeKit()
    const base = kit.part('base', kit.box(1, 0.4, 1), kit.plastic({ color: '#888888' }), { position: [0, 0.2, 0] })
    const seat = kit.part('seat', kit.box(0.8, 0.2, 0.8), kit.plastic({ color: '#888888' }), { position: [0, 5, 0] })
    kit.restOn(seat, base, 0.01)
    base.updateWorldMatrix(true, true)
    seat.updateWorldMatrix(true, true)
    const baseBox = new THREE.Box3().setFromObject(base)
    const seatBox = new THREE.Box3().setFromObject(seat)
    expect(seatBox.min.y).toBeCloseTo(baseBox.max.y - 0.01, 6)
  })

  it('root centres and grounds the model and registers parts', () => {
    const kit = makeKit()
    const material = kit.plastic({ color: '#888888' })
    const seat = kit.part('seat', kit.box(0.6, 0.2, 0.5), material, { position: [0.3, 1.4, 0.2] })
    const mirrored = kit.mirror(seat, 'x')
    const root = kit.root([seat, mirrored])

    expect(root.name).toBe('sculpt')
    expect(mirrored.name).toBe('seat-mirror')
    expect(mirrored.position.x).toBeCloseTo(-seat.position.x + 0, 6)

    root.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(root)
    expect(box.min.y).toBeCloseTo(0, 6)
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 6)
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 6)
    expect(root.scale.x).toBe(1)

    const parts = (root.userData.sculpt as { parts: Record<string, THREE.Mesh> }).parts
    expect(Object.keys(parts).sort()).toEqual(['seat', 'seat-mirror'])
  })
})

/* ---------------------------------------------------------------- materials */

describe('sculpt kit materials', () => {
  it('fabric builds sRGB albedo and data maps with sheen', () => {
    const kit = makeKit()
    const material = kit.fabric({ color: '#e0431c' })
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(material.roughnessMap?.colorSpace).toBe(THREE.NoColorSpace)
    expect(material.normalMap?.colorSpace).toBe(THREE.NoColorSpace)
    expect(material.sheen).toBeGreaterThan(0)
    expect(material.sheenRoughness).toBeCloseTo(0.6, 6)
  })

  it('random is deterministic per seed', () => {
    const a = makeKit({ seed: 3 })
    const b = makeKit({ seed: 3 })
    const c = makeKit({ seed: 4 })
    const seqA = [a.random(), a.random(), a.random()]
    const seqB = [b.random(), b.random(), b.random()]
    const seqC = [c.random(), c.random(), c.random()]
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual(seqC)
  })
})

/* ------------------------------------------------------------------ fixture */

describe('orange chair fixture', () => {
  const code = readFileSync(fixturePath, 'utf8')

  it('passes the generated-code validator', () => {
    expect(validateCode(code)).toEqual({ ok: true })
  })

  it('builds a grounded sculpt group', () => {
    const kit = makeKit()
    const options: KitOptions = { quality: 'standard', seed: 7, textureSize: 512 }
    const build = new Function('kit', 'THREE', 'options', `${code}\nreturn createModel(kit, THREE, options)`) as (
      kit: Kit, three: typeof THREE, options: KitOptions,
    ) => THREE.Group
    const root = build(kit, THREE, options)

    expect(root).toBeInstanceOf(THREE.Group)
    expect(root.name).toBe('sculpt')
    const parts = (root.userData.sculpt as { parts: Record<string, THREE.Mesh> }).parts
    expect(Object.keys(parts).length).toBeGreaterThanOrEqual(5)

    root.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(root)
    const size = new THREE.Vector3()
    box.getSize(size)
    expect(size.x).toBeCloseTo(0.8, 1)
    expect(box.min.y).toBeCloseTo(0, 6)
  })
})

/* ------------------------------------------------------------- api contract */

describe('kit.d.ts parity', () => {
  it('declares exactly the methods the runtime exposes', () => {
    const source = readFileSync(kitTypesPath, 'utf8')
    const block = source.match(/export interface Kit \{([\s\S]*?)\n\}/)
    expect(block).toBeTruthy()
    const body = block?.[1] ?? ''
    const declared = [...body.matchAll(/^\s{2}(\w+)\(/gm)].map(m => m[1] as string).sort()
    expect(declared.length).toBeGreaterThan(20)

    const kit = makeKit()
    const runtime = Object.keys(kit).filter(key => typeof (kit as unknown as Record<string, unknown>)[key] === 'function').sort()
    expect(runtime).toEqual(declared)
  })
})

/* -------------------------------------------------------------- full sweep */

describe('every kit method builds usable output', () => {
  for (const quality of ['draft', 'standard', 'hero'] as const) {
    it(`at ${quality} quality`, () => {
      const kit = makeKit({ quality })
      const geometries: Record<string, THREE.BufferGeometry> = {
        box: kit.box(1, 1, 1),
        roundedBox: kit.roundedBox(1, 0.5, 0.8, 0.05),
        pillow: kit.pillow(1, 0.3, 0.8, {}),
        cylinder: kit.cylinder(0.1, 0.5),
        chamferedCylinder: kit.cylinder(0.1, 0.5, { topRadius: 0.06, edge: 0.01 }),
        capsule: kit.capsule(0.05, 0.3),
        torus: kit.torus(0.2, 0.02, { arc: Math.PI }),
        tube: kit.tube([[0, 0, 0], [0.2, 0.2, 0], [0.4, 0, 0]], 0.02),
        closedTube: kit.tube([[0, 0, 0], [0.2, 0, 0.2], [0, 0, 0.4], [-0.2, 0, 0.2]], 0.02, { closed: true }),
        bentTube: kit.bentTube([[0, 0, 0], [0.4, 0, 0], [0.4, 0, 0.3], [0, 0, 0.3]], 0.02, 0.05),
        sweep: kit.sweep([[0, 0, 0], [0.3, 0.1, 0], [0.6, 0, 0]], 0.03),
        lathe: kit.lathe([[0, 0], [0.1, 0], [0.12, 0.2], [0.05, 0.3], [0, 0.3]]),
        extrude: kit.extrude([[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]], 0.05, {
          bevel: 0.005,
          holes: [[[-0.03, -0.03], [0.03, -0.03], [0.03, 0.03], [-0.03, 0.03]]],
        }),
        piping: kit.piping([[0, 0, 0], [0.2, 0, 0], [0.4, 0, 0.1]], 0.006),
        button: kit.button(0.016, { depth: 0.005 }),
        seam: kit.seam(kit.pillow(0.8, 0.2, 0.6), [-0.3, 0.1, 0], [0.3, 0.1, 0], { width: 0.02, depth: 0.006 }),
        tuft: kit.tuft(kit.pillow(0.8, 0.2, 0.6), { nx: 3, ny: 2, depth: 0.02 }),
      }

      for (const [name, geometry] of Object.entries(geometries)) {
        expect(geometry.getAttribute('position').count, name).toBeGreaterThan(3)
        expect(hasNaN(geometry, 'position'), name).toBe(false)
        expect(hasNaN(geometry, 'normal'), name).toBe(false)
      }

      const plastic = kit.plastic({ color: '#222222' })
      const painted = kit.paintedMetal({ color: '#b8161c' })
      const brushed = kit.brushedMetal({})
      const glass = kit.glass()
      for (const material of [kit.fabric({ color: '#e0431c' }), kit.leather({ color: '#4a2f22' }), kit.wood({ color: '#9a6b3f' }), painted, brushed, plastic, glass]) {
        expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial)
      }
      expect(painted.clearcoat).toBe(1)
      expect(painted.map).toBeNull()
      expect(brushed.metalness).toBe(1)
      expect(glass.transmission).toBe(1)
      expect(glass.thickness).toBeCloseTo(0.01, 6)

      const instanced = kit.instanced(geometries.box as THREE.BufferGeometry, plastic, [
        { position: [0, 0, 0] },
        { position: [1, 0, 0], rotation: [0, 0.4, 0], scale: 0.5 },
      ])
      expect(instanced.count).toBe(2)
      const matrix = new THREE.Matrix4()
      instanced.getMatrixAt(1, matrix)
      expect(matrix.elements.every(Number.isFinite)).toBe(true)

      const frame = kit.group('frame', [
        kit.part('leg', geometries.cylinder as THREE.BufferGeometry, plastic, { position: [0.2, 0, 0] }),
      ], { position: [0, 0.1, 0] })
      expect(frame.name).toBe('frame')
      const root = kit.root([frame])
      expect(Object.keys((root.userData.sculpt as { parts: Record<string, THREE.Mesh> }).parts)).toEqual(['leg'])
    })
  }

  it('tessellates more finely at higher quality', () => {
    const counts = (['draft', 'standard', 'hero'] as const)
      .map(quality => makeKit({ quality }).pillow(1, 1, 1).getAttribute('position').count)
    expect(counts[0] as number).toBeLessThan(counts[1] as number)
    expect(counts[1] as number).toBeLessThan(counts[2] as number)
  })
})
