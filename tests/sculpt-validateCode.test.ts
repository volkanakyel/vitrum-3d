import { describe, expect, it } from 'vitest'
import { validateCode, FORBIDDEN } from '../server/utils/sculpt/validateCode'

const ok = `function createModel(kit, THREE, options) {
  const seat = kit.part('seat', kit.pillow(0.8, 0.2, 0.7, { radius: 0.06, bulge: 0.02 }), kit.fabric({ color: '#e0431c' }))
  return kit.root([seat])
}`

describe('validateCode', () => {
  it('accepts a minimal factory', () => { expect(validateCode(ok)).toEqual({ ok: true }) })
  it('rejects a syntax error with a position', () => {
    const r = validateCode('function createModel(kit, THREE, options) { return kit.root([ }')
    expect(r.ok).toBe(false); if (!r.ok) expect(r.errors[0]).toMatch(/\(\d+:\d+\)/)
  })
  it('rejects a missing or mis-arity factory', () => {
    expect(validateCode('function create(kit) {}').ok).toBe(false)
    expect(validateCode('function createModel(kit) { return kit.root([]) }').ok).toBe(false)
  })
  it.each(FORBIDDEN)('rejects the identifier %s', (name) => {
    const r = validateCode(`function createModel(kit, THREE, options) { const x = ${name}; return kit.root([]) }`)
    expect(r.ok).toBe(false); if (!r.ok) expect(r.errors.join(' ')).toContain(name)
  })
  it('rejects member access to forbidden names and computed strings', () => {
    expect(validateCode(`function createModel(kit, THREE, options) { const d = THREE.window; return kit.root([]) }`).ok).toBe(false)
    expect(validateCode(`function createModel(kit, THREE, options) { const d = THREE['document']; return kit.root([]) }`).ok).toBe(false)
  })
  it('rejects with, import(), import.meta and string timers', () => {
    expect(validateCode(`function createModel(kit, THREE, options) { with (kit) {} return kit.root([]) }`).ok).toBe(false)
    expect(validateCode(`function createModel(kit, THREE, options) { setTimeout('x', 1); return kit.root([]) }`).ok).toBe(false)
  })
  it('rejects oversize code', () => {
    const big = ok + '\n// ' + 'x'.repeat(41_000)
    expect(validateCode(big).ok).toBe(false)
  })
})
