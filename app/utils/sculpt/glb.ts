/**
 * A single check on the GLB that comes back from the sandbox, run before
 * three's `GLTFLoader` is allowed near it.
 *
 * The sandbox is an opaque origin with no network, which is exactly why its
 * output must not be able to buy one back: a glTF `buffer` or `image` may
 * carry a `uri`, and the loader resolves a non-`data:` one by fetching it —
 * from the APP's origin, with the app's cookies, because that is where the
 * parse happens. A model that wanted to phone home, or to read a same-origin
 * URL it should not see, would do it here and nowhere else.
 *
 * So: every buffer and image in a sculpt GLB must be either a chunk-local
 * `bufferView` or an inline `data:` URI, which is what `GLTFExporter` with
 * binary output produces anyway.
 */

const MAGIC_GLTF = 0x46546C67
const CHUNK_JSON = 0x4E4F534A

/**
 * True when the GLB declares any buffer or image that the loader would have to
 * FETCH. Also true when the container cannot be read at all: what we cannot
 * inspect, we do not hand to the loader.
 */
export function glbHasExternalUris(buffer: ArrayBuffer): boolean {
  const json = glbJsonChunk(buffer)
  if (json === null) return true

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  }
  catch {
    return true
  }
  if (typeof parsed !== 'object' || parsed === null) return true

  const doc = parsed as { buffers?: unknown, images?: unknown }
  return hasExternalUri(doc.buffers) || hasExternalUri(doc.images)
}

function hasExternalUri(list: unknown): boolean {
  if (list === undefined) return false
  if (!Array.isArray(list)) return true
  return list.some((entry) => {
    if (typeof entry !== 'object' || entry === null) return true
    const uri = (entry as { uri?: unknown }).uri
    if (uri === undefined) return false
    if (typeof uri !== 'string') return true
    // Only an inline payload is allowed; anything else is a fetch, including
    // the relative paths a hand-written glTF would use.
    return !/^data:/i.test(uri.trim())
  })
}

/** The GLB's JSON chunk as text, or `null` if this is not a readable GLB. */
export function glbJsonChunk(buffer: ArrayBuffer): string | null {
  if (buffer.byteLength < 20) return null
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== MAGIC_GLTF) return null

  const total = Math.min(view.getUint32(8, true), buffer.byteLength)
  let offset = 12
  while (offset + 8 <= total) {
    const length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (start + length > total) return null
    if (type === CHUNK_JSON) {
      return new TextDecoder().decode(new Uint8Array(buffer, start, length))
    }
    // Chunks are 4-byte aligned; a length that is not is a malformed file.
    if (length % 4 !== 0) return null
    offset = start + length
  }
  return null
}
