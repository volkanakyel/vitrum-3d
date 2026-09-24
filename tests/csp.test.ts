import { describe, expect, it } from 'vitest'
import { studioCsp } from '../server/utils/csp'

describe('studioCsp', () => {
  it('locks scripts to self in production, with no eval', () => {
    const csp = studioCsp(false)
    expect(csp).toContain('script-src \'self\' \'unsafe-inline\'')
    expect(csp).not.toContain('unsafe-eval')
  })
  it('allows Vite\'s HMR client and websocket only in dev', () => {
    const csp = studioCsp(true)
    expect(csp).toContain('\'unsafe-eval\'')
    expect(csp).toContain('ws:')
    expect(csp).toContain('wss:')
  })
  it('blocks plugins, a <base> tag and form posts either way', () => {
    for (const csp of [studioCsp(true), studioCsp(false)]) {
      expect(csp).toContain('object-src \'none\'')
      expect(csp).toContain('base-uri \'none\'')
      expect(csp).toContain('form-action \'none\'')
    }
  })
})
