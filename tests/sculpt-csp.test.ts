import { describe, expect, it } from 'vitest'
import { sandboxCsp, studioCsp } from '../server/utils/sculpt/csp'

function directive(csp: string, name: string): string | undefined {
  return csp.split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `) || part === name)
}

describe('sandboxCsp', () => {
  it('gives generated code no network at all in production', () => {
    const csp = sandboxCsp(false)
    expect(directive(csp, 'connect-src')).toBe('connect-src \'none\'')
    expect(csp).not.toContain('ws:')
    expect(csp).not.toContain('wss:')
  })

  it('relaxes only connect-src for dev, so Vite\'s HMR client can attach', () => {
    const dev = sandboxCsp(true)
    expect(directive(dev, 'connect-src')).toBe('connect-src \'self\' ws: wss:')
    const withoutConnect = (csp: string) => csp.split(';').filter(d => !d.includes('connect-src')).join(';')
    expect(withoutConnect(dev)).toBe(withoutConnect(sandboxCsp(false)))
  })

  it('keeps the rest of the page locked down in both variants', () => {
    for (const csp of [sandboxCsp(true), sandboxCsp(false)]) {
      expect(directive(csp, 'default-src')).toBe('default-src \'none\'')
      expect(directive(csp, 'frame-ancestors')).toBe('frame-ancestors \'self\'')
      expect(directive(csp, 'base-uri')).toBe('base-uri \'none\'')
      expect(directive(csp, 'form-action')).toBe('form-action \'none\'')
      // The page's whole job is running generated code through new Function().
      expect(directive(csp, 'script-src')).toContain('\'unsafe-eval\'')
    }
  })
})

describe('studioCsp', () => {
  it('allows exactly what the studio needs and nothing wider', () => {
    const csp = studioCsp(false)
    expect(directive(csp, 'default-src')).toBe('default-src \'self\'')
    // WASM for the depth model, inline for Nuxt's payload — but never eval.
    expect(directive(csp, 'script-src')).toContain('\'wasm-unsafe-eval\'')
    expect(directive(csp, 'script-src')).not.toContain('\'unsafe-eval\'')
    // The depth weights come from the Hugging Face hub and its CDN hosts.
    expect(directive(csp, 'connect-src')).toContain('https://huggingface.co')
    expect(directive(csp, 'connect-src')).toContain('https://*.hf.co')
    // onnxruntime-web's WASM backend and its loader module.
    expect(directive(csp, 'connect-src')).toContain('https://cdn.jsdelivr.net')
    expect(directive(csp, 'script-src')).toContain('https://cdn.jsdelivr.net')
    expect(directive(csp, 'worker-src')).toBe('worker-src \'self\' blob:')
    expect(directive(csp, 'img-src')).toBe('img-src \'self\' data: blob:')
    expect(directive(csp, 'object-src')).toBe('object-src \'none\'')
    expect(directive(csp, 'base-uri')).toBe('base-uri \'none\'')
    expect(directive(csp, 'form-action')).toBe('form-action \'none\'')
    expect(directive(csp, 'frame-src')).toBe('frame-src \'self\'')
    expect(csp).not.toContain('ws:')
  })

  it('adds only the dev server\'s eval and sockets in dev', () => {
    const dev = studioCsp(true)
    expect(directive(dev, 'script-src')).toContain('\'unsafe-eval\'')
    expect(directive(dev, 'connect-src')).toContain('ws:')
  })
})
