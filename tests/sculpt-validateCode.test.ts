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
  it('rejects a duplicate top-level createModel declaration', () => {
    const dup = `function createModel(kit, THREE, options) { return kit.root([]) }
function createModel(kit, THREE, options) { return kit.root([]) }`
    const r = validateCode(dup)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('createModel')
  })
  it.each(FORBIDDEN)('rejects the identifier %s', (name) => {
    const r = validateCode(`function createModel(kit, THREE, options) { const x = ${name}; return kit.root([]) }`)
    expect(r.ok).toBe(false); if (!r.ok) expect(r.errors.join(' ')).toContain(name)
  })
  it('rejects member access to forbidden names and computed strings', () => {
    expect(validateCode(`function createModel(kit, THREE, options) { const d = THREE.window; return kit.root([]) }`).ok).toBe(false)
    expect(validateCode(`function createModel(kit, THREE, options) { const d = THREE['document']; return kit.root([]) }`).ok).toBe(false)
  })

  it('rejects the ways back to a compiler or a prototype', () => {
    const cases = [
      `const f = ({}).constructor.constructor; f('x')()`,
      `const f = kit.root.constructor`,
      `const p = Reflect.get(kit, 'root')`,
      `const p = new Proxy(kit, {})`,
      `const p = kit.__proto__`,
      `const o = { __proto__: kit }`,
      `const o = { 'constructor': 1 }`,
      `kit.root.prototype.x = 1`,
    ]
    for (const body of cases) {
      const r = validateCode(`function createModel(kit, THREE, options) { ${body}; return kit.root([]) }`)
      expect(r.ok, body).toBe(false)
    }
  })

  it('rejects every computed key that is not a string or number literal', () => {
    const rejected = [
      `const x = parts[i]`,
      `const x = THREE['con' + 'structor']`,
      'const x = kit[`ro${\'ot\'}`]',
      `const x = kit[name]`,
      `const x = kit[0 + 1]`,
      `parts[i] = 1`,
    ]
    for (const body of rejected) {
      const r = validateCode(`function createModel(kit, THREE, options) { ${body}; return kit.root([]) }`)
      expect(r.ok, body).toBe(false)
      if (!r.ok) expect(r.errors.join(' '), body).toContain('computed member access')
    }
  })

  it('still allows plain literal keys and ordinary iteration', () => {
    const okCode = `function createModel(kit, THREE, options) {
  const parts = []
  for (const size of [0.1, 0.2]) parts.push(kit.part('p' + size, kit.box(size, size, size), kit.plastic({ color: '#888' })))
  const first = parts[0]
  const q = options['quality']
  return kit.root(parts)
}`
    expect(validateCode(okCode)).toEqual({ ok: true })
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
