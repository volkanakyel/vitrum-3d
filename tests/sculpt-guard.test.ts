import { describe, expect, it } from 'vitest'
import {
  budgetExceeded,
  clientIp,
  createGuardState,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  recordSpend,
  spendToday,
  takeToken,
  utcDay,
} from '../server/utils/sculpt/guard'

const T0 = Date.UTC(2026, 8, 15, 12, 0, 0)

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIp('203.0.113.7, 70.41.3.18, 150.172.238.178', '10.0.0.1')).toBe('203.0.113.7')
    expect(clientIp('  203.0.113.7  ', '10.0.0.1')).toBe('203.0.113.7')
  })

  it('falls back to the socket address, then to one shared bucket', () => {
    expect(clientIp(undefined, '10.0.0.1')).toBe('10.0.0.1')
    expect(clientIp('', '10.0.0.1')).toBe('10.0.0.1')
    expect(clientIp(undefined, undefined)).toBe('unknown')
  })
})

describe('takeToken', () => {
  it('allows the quota and refuses the request after it', () => {
    const state = createGuardState()
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(takeToken(state, '1.1.1.1', T0 + i).allowed, `request ${i}`).toBe(true)
    }
    const blocked = takeToken(state, '1.1.1.1', T0 + RATE_LIMIT_MAX)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(RATE_LIMIT_WINDOW_MS / 1000)
  })

  it('counts each address separately', () => {
    const state = createGuardState()
    for (let i = 0; i < RATE_LIMIT_MAX; i++) takeToken(state, '1.1.1.1', T0, 3)
    expect(takeToken(state, '1.1.1.1', T0, 3).allowed).toBe(false)
    expect(takeToken(state, '2.2.2.2', T0, 3).allowed).toBe(true)
  })

  it('opens a fresh window once the old one has passed', () => {
    const state = createGuardState()
    expect(takeToken(state, '1.1.1.1', T0, 1).allowed).toBe(true)
    expect(takeToken(state, '1.1.1.1', T0 + 1, 1).allowed).toBe(false)
    expect(takeToken(state, '1.1.1.1', T0 + RATE_LIMIT_WINDOW_MS, 1).allowed).toBe(true)
  })

  it('forgets addresses whose window has expired', () => {
    const state = createGuardState()
    takeToken(state, '1.1.1.1', T0, 1, 1000)
    expect(state.windows.size).toBe(1)
    takeToken(state, '2.2.2.2', T0 + 2000, 1, 1000)
    expect([...state.windows.keys()]).toEqual(['2.2.2.2'])
  })
})

describe('the daily budget', () => {
  it('is not exceeded before anything is spent', () => {
    const state = createGuardState()
    expect(budgetExceeded(state, T0, 25)).toBe(false)
  })

  it('bites once the day\'s spend reaches the ceiling', () => {
    const state = createGuardState()
    recordSpend(state, T0, 24.5)
    expect(budgetExceeded(state, T0, 25)).toBe(false)
    recordSpend(state, T0, 0.5)
    expect(spendToday(state, T0)).toBeCloseTo(25)
    expect(budgetExceeded(state, T0, 25)).toBe(true)
  })

  it('resets at UTC midnight', () => {
    const state = createGuardState()
    recordSpend(state, T0, 40)
    expect(budgetExceeded(state, T0, 25)).toBe(true)
    const nextDay = Date.UTC(2026, 8, 16, 0, 30, 0)
    expect(utcDay(nextDay)).toBe('2026-09-16')
    expect(budgetExceeded(state, nextDay, 25)).toBe(false)
    recordSpend(state, nextDay, 1)
    expect(spendToday(state, nextDay)).toBe(1)
  })

  it('ignores a zero ceiling and nonsense costs', () => {
    const state = createGuardState()
    recordSpend(state, T0, 100)
    expect(budgetExceeded(state, T0, 0)).toBe(false)
    recordSpend(state, T0, Number.NaN)
    recordSpend(state, T0, -5)
    expect(spendToday(state, T0)).toBe(100)
  })
})
