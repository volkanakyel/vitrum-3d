import { describe, expect, it } from 'vitest'
import { LANDING_LOOK_IDS, landingLooks } from '~/data/landing'
import { MATERIAL_PRESETS } from '~/utils/presets'
import { SAMPLES, sampleById } from '~/utils/samples'

describe('samples', () => {
  it('have unique ids and a real material preset each', () => {
    const ids = new Set(SAMPLES.map(s => s.id))
    expect(ids.size).toBe(SAMPLES.length)
    for (const s of SAMPLES) expect(MATERIAL_PRESETS.some(p => p.id === s.preset), s.id).toBe(true)
  })
  it('finds a sample by id', () => {
    expect(sampleById('vitrum')?.label).toBe('Vitrum mark')
    expect(sampleById('nope')).toBeUndefined()
  })
  it('resolves the landing swatches in order', () => {
    expect(landingLooks().map(look => look.id)).toEqual([...LANDING_LOOK_IDS])
  })
})
