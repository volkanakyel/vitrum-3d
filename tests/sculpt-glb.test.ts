import { describe, expect, it } from 'vitest'
import { glbHasExternalUris, glbJsonChunk } from '../app/utils/sculpt/glb'

/** A minimal, structurally valid GLB carrying `json` as its JSON chunk. */
function makeGlb(json: unknown, opts: { binChunk?: boolean } = {}): ArrayBuffer {
  const text = JSON.stringify(json)
  const jsonBytes = new TextEncoder().encode(text)
  const padded = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4).fill(0x20)
  padded.set(jsonBytes)

  const bin = opts.binChunk ? new Uint8Array([1, 2, 3, 4]) : null
  const total = 12 + 8 + padded.length + (bin ? 8 + bin.length : 0)
  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  view.setUint32(0, 0x46546C67, true) // 'glTF'
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, padded.length, true)
  view.setUint32(16, 0x4E4F534A, true) // 'JSON'
  bytes.set(padded, 20)
  if (bin) {
    const at = 20 + padded.length
    view.setUint32(at, bin.length, true)
    view.setUint32(at + 4, 0x004E4942, true) // 'BIN'
    bytes.set(bin, at + 8)
  }
  return buffer
}

describe('glbJsonChunk', () => {
  it('reads the JSON chunk back, past a BIN chunk', () => {
    const glb = makeGlb({ asset: { version: '2.0' } }, { binChunk: true })
    expect(JSON.parse(glbJsonChunk(glb)!)).toEqual({ asset: { version: '2.0' } })
  })

  it('refuses anything that is not a GLB', () => {
    expect(glbJsonChunk(new ArrayBuffer(4))).toBeNull()
    expect(glbJsonChunk(new TextEncoder().encode('{"asset":{}}').buffer as ArrayBuffer)).toBeNull()
  })
})

describe('glbHasExternalUris', () => {
  it('accepts the shape the sandbox exports: buffer views only', () => {
    const glb = makeGlb({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 4 }],
      images: [{ bufferView: 0, mimeType: 'image/png' }],
    }, { binChunk: true })
    expect(glbHasExternalUris(glb)).toBe(false)
  })

  it('accepts inline data URIs', () => {
    const glb = makeGlb({
      buffers: [{ byteLength: 4, uri: 'data:application/octet-stream;base64,AQIDBA==' }],
      images: [{ uri: 'DATA:image/png;base64,AAAA' }],
    })
    expect(glbHasExternalUris(glb)).toBe(false)
  })

  it('rejects a buffer or an image the loader would fetch', () => {
    expect(glbHasExternalUris(makeGlb({ buffers: [{ uri: 'https://example.com/weights.bin' }] }))).toBe(true)
    expect(glbHasExternalUris(makeGlb({ images: [{ uri: 'texture.png' }] }))).toBe(true)
    expect(glbHasExternalUris(makeGlb({ images: [{ uri: '/api/sculpt/status' }] }))).toBe(true)
    expect(glbHasExternalUris(makeGlb({ buffers: [{ uri: '  https://example.com/x.bin' }] }))).toBe(true)
  })

  it('rejects what it cannot read', () => {
    expect(glbHasExternalUris(new ArrayBuffer(0))).toBe(true)
    expect(glbHasExternalUris(makeGlb('not an object'))).toBe(true)
    expect(glbHasExternalUris(makeGlb({ buffers: 'nope' }))).toBe(true)
    expect(glbHasExternalUris(makeGlb({ images: [null] }))).toBe(true)
    expect(glbHasExternalUris(makeGlb({ buffers: [{ uri: 42 }] }))).toBe(true)
  })
})
