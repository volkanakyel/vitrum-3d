import { parse } from 'acorn'
import { full } from 'acorn-walk'
import type { Node } from 'acorn'

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
] as const

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
      if (computed && property.type === 'Literal' && typeof property.value === 'string') {
        const value = property.value
        if ((FORBIDDEN as readonly string[]).includes(value)) forbiddenHits.add(value)
      }
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

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true }
}
