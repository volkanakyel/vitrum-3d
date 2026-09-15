import { describe, expect, it } from 'vitest'
import { specSchema, toolSchema, validateSpec } from '../server/utils/sculpt/schema'
import type { SculptSpec } from '../app/utils/sculpt/types'

function makeSpec(): SculptSpec {
  return {
    name: 'Orange chair bed',
    id: 'orange-chair-bed',
    objectClass: 'convertible armchair',
    suitability: { verdict: 'pass', reasons: [] },
    symmetry: 'left-right',
    camera: { yaw: 25, pitch: 12, fov: 35, distance: 2.4, confidence: 0.9 },
    dimensions: { widthM: 0.8, heightM: 0.9, depthM: 0.75, source: 'estimated' },
    detailInventory: [],
    notes: [],
    components: [
      {
        id: 'base',
        name: 'Base frame',
        level: 'macro',
        parent: null,
        importance: 1,
        confidence: 0.9,
        primitive: 'box',
        dimensions: { w: 0.8, h: 0.15, d: 0.75 },
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        edge: { radius: 0.02, segments: 4 },
        attachment: null,
        material: 'metal-red',
        localFeatures: [],
      },
      {
        id: 'seat',
        name: 'Seat cushion',
        level: 'macro',
        parent: 'base',
        importance: 0.9,
        confidence: 0.85,
        primitive: 'pillow',
        dimensions: { w: 0.78, h: 0.18, d: 0.7 },
        position: [0, 0.15, 0],
        rotation: [0, 0, 0],
        edge: { radius: 0.06, segments: 8 },
        attachment: { parent: 'base', contact: 'rests-on', overlap: 0.02 },
        material: 'fabric-orange',
        localFeatures: [],
      },
      {
        id: 'backrest',
        name: 'Backrest cushion',
        level: 'macro',
        parent: 'seat',
        importance: 0.8,
        confidence: 0.8,
        primitive: 'pillow',
        dimensions: { w: 0.78, h: 0.4, d: 0.15 },
        position: [0, 0.5, -0.3],
        rotation: [0.1, 0, 0],
        edge: { radius: 0.06, segments: 8 },
        attachment: { parent: 'seat', contact: 'rests-on', overlap: 0.02 },
        material: 'fabric-orange',
        localFeatures: [],
      },
      {
        id: 'rail',
        name: 'Front rail',
        level: 'macro',
        parent: 'base',
        importance: 0.5,
        confidence: 0.75,
        primitive: 'cylinder',
        dimensions: { w: 0.8, h: 0.03, d: 0.03 },
        position: [0, 0.02, 0.36],
        rotation: [0, 0, 1.5708],
        edge: { radius: 0.015, segments: 12 },
        attachment: { parent: 'base', contact: 'bolted', overlap: 0.01 },
        material: 'metal-red',
        localFeatures: [],
      },
    ],
    materials: [
      {
        id: 'fabric-orange',
        family: 'fabric',
        subtype: 'weave',
        baseColor: '#e0431c',
        roughness: 0.88,
        metalness: 0,
        sheen: 1,
        clearcoat: 0,
        pattern: { kind: 'plain', scale: 1, amplitude: 0 },
        weave: { threadsPerCm: 12, contrast: 0.2 },
        wear: { edge: 0.1, dirt: 0.05 },
      },
      {
        id: 'metal-red',
        family: 'metal',
        subtype: 'painted',
        baseColor: '#7a1f1f',
        roughness: 0.4,
        metalness: 0.8,
        sheen: 0,
        clearcoat: 0.2,
        pattern: { kind: 'none', scale: 1, amplitude: 0 },
        wear: { edge: 0.15, dirt: 0.02 },
      },
    ],
    repetition: [],
    mustMatch: ['backrest sits on seat', 'red rail under front'],
    niceToHave: [],
  }
}

describe('validateSpec', () => {
  it('accepts a valid spec', () => {
    const r = validateSpec(makeSpec())
    expect(r.ok).toBe(true)
  })

  it('rejects a duplicate component id', () => {
    const spec = makeSpec()
    spec.components[1]!.id = 'base'
    const r = validateSpec(spec)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('base')
  })

  it('rejects an unknown material reference', () => {
    const spec = makeSpec()
    spec.components[0]!.material = 'no-such-material'
    const r = validateSpec(spec)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('no-such-material')
  })

  it('rejects two root components', () => {
    const spec = makeSpec()
    spec.components[1]!.parent = null
    const r = validateSpec(spec)
    expect(r.ok).toBe(false)
  })

  // The spec prompt asks for these two by name; the enum has to admit them.
  it('accepts the bentTube and roundedBox primitives', () => {
    for (const primitive of ['bentTube', 'roundedBox'] as const) {
      const spec = makeSpec()
      spec.components[0]!.primitive = primitive
      expect(validateSpec(spec).ok, primitive).toBe(true)
    }
  })

  it('rejects a primitive the kit has no builder for', () => {
    const spec = makeSpec()
    ;(spec.components[0] as { primitive: string }).primitive = 'nurbs'
    expect(validateSpec(spec).ok).toBe(false)
  })

  it('rejects fov out of range', () => {
    const spec = makeSpec()
    spec.camera.fov = 90
    const r = validateSpec(spec)
    expect(r.ok).toBe(false)
  })
})

describe('toolSchema', () => {
  it('produces a strict object json schema for specSchema', () => {
    const schema = toolSchema(specSchema)
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
  })
})
