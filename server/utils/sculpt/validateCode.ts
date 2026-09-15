import { parse } from 'acorn'
import { full } from 'acorn-walk'
import type { Node } from 'acorn'

/**
 * What this is, and what it is not.
 *
 * This is a QUALITY GATE. It keeps the model honest: code that reaches for the
 * DOM, the network or a way back to a compiler is code that has misunderstood
 * the job, and catching it here turns a confusing runtime failure into one
 * clear retry with the violation quoted back.
 *
 * It is NOT the security boundary. The security boundary is the sandboxed
 * iframe: `/sandbox` is loaded as `<iframe sandbox="allow-scripts">`, so
 * generated code runs on an opaque origin with no cookies, no app API, no
 * parent DOM and (in production) `connect-src 'none'`. Treat any hole in the
 * list below as a bug worth fixing, never as an exploit — nothing downstream
 * of here is trusting it.
 */
export const FORBIDDEN = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'importScripts',
  'eval',
  'Function',
  'import',
  'require',
  'document',
  'window',
  'globalThis',
  'self',
  'parent',
  'top',
  'location',
  'navigator',
  'localStorage',
  'indexedDB',
  'postMessage',
  'Worker',
  // Routes back to a compiler or to another object's internals:
  // `({}).constructor.constructor('…')` is `Function`, and the three
  // prototype names are how generated code would reach a shared object every
  // later part of the page also sees.
  'constructor',
  'Reflect',
  'Proxy',
  '__proto__',
  'prototype',
] as const

/** Object-literal keys that set or read a prototype, which the walker does not visit as identifiers. */
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'] as const

export const MAX_CODE_BYTES = 40_000

interface AcornSyntaxError extends Error {
  loc?: { line: number; column: number }
}

export function validateCode(code: string): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []

  if (Buffer.byteLength(code) > MAX_CODE_BYTES) {
    errors.push(`code exceeds maximum size of ${MAX_CODE_BYTES} bytes`)
  }

  let ast: Node
  try {
    ast = parse(code, { ecmaVersion: 2022, sourceType: 'script' }) as unknown as Node
  }
  catch (e) {
    const err = e as AcornSyntaxError
    const message = err.message.match(/\(\d+:\d+\)/)
      ? err.message
      : `${err.message} (${err.loc?.line ?? 0}:${err.loc?.column ?? 0})`
    errors.push(message)
    for (const name of FORBIDDEN) {
      const re = new RegExp(`\\b${name}\\b`)
      if (re.test(code)) errors.push(`forbidden identifier used: ${name}`)
    }
    return { ok: false, errors }
  }

  const forbiddenHits = new Set<string>()
  let computedKeys = 0

  let createModelCount = 0
  for (const stmt of (ast as unknown as { body: Node[] }).body) {
    const fn = stmt as unknown as { type: string; id?: { name: string } | null; params: unknown[] }
    if (fn.type === 'FunctionDeclaration' && fn.id?.name === 'createModel' && fn.params.length === 3) {
      createModelCount += 1
    }
  }
  if (createModelCount !== 1) {
    errors.push('code must declare exactly one top-level "function createModel(kit, THREE, options)" with exactly 3 parameters')
  }

  full(ast, (node) => {
    const n = node as unknown as Record<string, unknown> & { type: string }

    if (n.type === 'Identifier') {
      const name = n.name as string
      if ((FORBIDDEN as readonly string[]).includes(name)) forbiddenHits.add(name)
    }

    if (n.type === 'MemberExpression') {
      const computed = n.computed as boolean
      const property = n.property as Record<string, unknown>
      if (!computed && property.type === 'Identifier') {
        const name = property.name as string
        if ((FORBIDDEN as readonly string[]).includes(name)) forbiddenHits.add(name)
      }
      if (computed) {
        // A computed key is only allowed when it is a plain string or number
        // literal, because that is the only form this validator can read. Any
        // expression — `a[b]`, `a['con' + 'structor']`, a template literal —
        // is a key whose value is decided at runtime, which would make every
        // name check above decorative. Index with `for (const x of xs)` or an
        // array method instead of `xs[i]`.
        const isLiteralKey = property.type === 'Literal'
          && (typeof property.value === 'string' || typeof property.value === 'number')
        if (!isLiteralKey) {
          computedKeys += 1
        }
        else if (typeof property.value === 'string' && (FORBIDDEN as readonly string[]).includes(property.value)) {
          forbiddenHits.add(property.value)
        }
      }
    }

    if (n.type === 'Property' && n.computed !== true) {
      const key = n.key as Record<string, unknown> | undefined
      const name = key?.type === 'Identifier'
        ? key.name as string
        : key?.type === 'Literal' && typeof key.value === 'string' ? key.value : ''
      if ((FORBIDDEN_KEYS as readonly string[]).includes(name)) forbiddenHits.add(name)
    }

    if (n.type === 'ImportDeclaration' || n.type === 'ImportExpression') {
      forbiddenHits.add('import')
    }

    if (n.type === 'MetaProperty') {
      forbiddenHits.add('import.meta')
    }

    if (n.type === 'WithStatement') {
      forbiddenHits.add('with')
    }

    if (n.type === 'CallExpression') {
      const callee = n.callee as Record<string, unknown>
      if (callee.type === 'Identifier' && (callee.name === 'setTimeout' || callee.name === 'setInterval')) {
        const args = n.arguments as Record<string, unknown>[]
        const firstArg = args[0]
        if (firstArg && firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
          errors.push(`${callee.name as string} must not be called with a string first argument`)
        }
      }
    }
  })

  for (const name of forbiddenHits) {
    errors.push(`forbidden identifier used: ${name}`)
  }

  if (computedKeys > 0) {
    errors.push(
      `computed member access must use a string or number literal key (${computedKeys} do not): `
      + 'write `a.b` or `a[0]`, and iterate with `for (const x of xs)` or an array method instead of `xs[i]`',
    )
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true }
}
