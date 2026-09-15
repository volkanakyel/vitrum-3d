import { describe, expect, it } from 'vitest'
import { isQuotaExceeded, prunePlan } from '../app/utils/sculpt/store'

describe('isQuotaExceeded', () => {
  it('recognises both shapes browsers use', () => {
    const modern = new Error('out of room')
    modern.name = 'QuotaExceededError'
    expect(isQuotaExceeded(modern)).toBe(true)
    expect(isQuotaExceeded({ code: 22 })).toBe(true)
  })

  it('leaves every other failure alone', () => {
    expect(isQuotaExceeded(new Error('failed to save job'))).toBe(false)
    expect(isQuotaExceeded({ name: 'AbortError' })).toBe(false)
    expect(isQuotaExceeded(null)).toBe(false)
    expect(isQuotaExceeded('QuotaExceededError')).toBe(false)
  })
})

describe('prunePlan', () => {
  const entries = [
    { id: 'a', createdAt: 4 },
    { id: 'b', createdAt: 1 },
    { id: 'c', createdAt: 3 },
    { id: 'd', createdAt: 2 },
  ]

  it('drops the oldest half, oldest first', () => {
    expect(prunePlan(entries, 'a')).toEqual(['b', 'd'])
  })

  it('never drops the job being saved', () => {
    expect(prunePlan(entries, 'b')).not.toContain('b')
    expect(prunePlan(entries, 'b')).toEqual(['d', 'c'])
  })

  it('drops at least one when there is anything to drop', () => {
    expect(prunePlan([{ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 2 }], 'a')).toEqual(['b'])
  })

  it('has nothing to say when the store holds only this job', () => {
    expect(prunePlan([{ id: 'a', createdAt: 1 }], 'a')).toEqual([])
    expect(prunePlan([], 'a')).toEqual([])
  })
})
