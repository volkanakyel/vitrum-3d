import { describe, expect, it } from 'vitest'
import { MATERIAL_PRESETS } from '~/utils/presets'
import { SAMPLES, sampleById } from '~/utils/samples'

describe('samples', () => {
  it('have unique ids and a real material preset each', () => {
    const ids = new Set(SAMPLES.map(s => s.id))
    expect(ids.size).toBe(SAMPLES.length)
    for (const s of SAMPLES) expect(MATERIAL_PRESETS.some(p => p.id === s.preset), s.id).toBe(true)
  })
  it('cover both studio modes', () => {
    expect(SAMPLES.some(s => s.kind === 'icon')).toBe(true)
    expect(SAMPLES.some(s => s.kind === 'product')).toBe(true)
    expect(sampleById('armchair')?.kind).toBe('product')
  })
})
