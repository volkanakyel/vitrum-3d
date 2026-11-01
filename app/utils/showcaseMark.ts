import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildExtrudeGeometry } from './extrude'
import { LOGO_SAMPLE_IDS, type Sample } from './samples'
import { DEFAULT_TRACE_OPTIONS, traceImage, type TraceResult, type TraceSource } from './trace'

/**
 * One landing-page mark, from its drawn source to a solid: trace, then extrude with the bevel and
 * depth that suit its kind. Free of the DOM, so the showcase worker runs it off the main thread
 * and the page falls back to it in place when workers are unavailable.
 */
export interface MarkRequest {
  /** Where the mark goes in the layout (`story` for the centre one). */
  id: string
  sampleId: string
  /** Longer side of the solid, in mm (scene units). */
  sizeMm: number
  /** Trace raster size, px. */
  res: number
}

/** A built mark as plain arrays, cheap to send between threads. */
export interface MarkData {
  id: string
  sampleId: string
  trace: TraceResult
  position: Float32Array
  normal: Float32Array
  uv: Float32Array | null
  index: Uint32Array | null
  widthMm: number
  heightMm: number
  depthMm: number
}

const ROUNDED_ICONS = new Set(['camera', 'chat', 'spark', 'heart'])

export function buildMark(req: MarkRequest, sample: Sample, source: TraceSource): MarkData | null {
  const stack = sample.id === 'play'
  const trace = traceImage(source, { ...DEFAULT_TRACE_OPTIONS, resolution: req.res, stack, mode: 'auto' })
  if (!trace.polygons.length) return null
  const { sizeMm } = req
  const bw = Math.max(1e-6, trace.bbox.maxX - trace.bbox.minX)
  const aspect = (trace.bbox.maxY - trace.bbox.minY) / bw
  const widthMm = aspect > 1 ? sizeMm / aspect : sizeMm
  const rounded = ROUNDED_ICONS.has(sample.id)
  const isLogo = LOGO_SAMPLE_IDS.has(sample.id)
  const depthMm = sizeMm * (rounded ? 0.16 : isLogo ? 0.14 : 0.2)
  // The star's tips and the logos' fine details need a smaller bevel than a broad face
  // suggests; keep the inset from crossing those narrow features.
  const bevelLimit = isLogo || sample.id === 'star' || sample.id === 'bolt' ? sizeMm * 0.012 : sample.id === 'spark' ? sizeMm * 0.02 : sizeMm * 0.038
  const bevel = Math.min(bevelLimit, Math.max(0.6, (trace.strokeWidth * widthMm) / bw * (rounded ? 0.44 : 0.3)))
  const built = buildExtrudeGeometry(trace, { widthMm, depthMm, bevelMm: bevel, bevelSegments: 8, layerMm: 2, stack })
  if (!built) return null
  let geometry = built.geometry
  if (rounded) {
    geometry.deleteAttribute('normal')
    const smooth = mergeVertices(geometry, 0.001)
    smooth.computeVertexNormals()
    geometry.dispose()
    geometry = smooth
  }
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  const index = geometry.getIndex()
  return {
    id: req.id,
    sampleId: sample.id,
    trace,
    position: geometry.getAttribute('position').array as Float32Array,
    normal: geometry.getAttribute('normal').array as Float32Array,
    uv: uv ? uv.array as Float32Array : null,
    index: index ? Uint32Array.from(index.array) : null,
    widthMm,
    heightMm: built.frame.bh * built.frame.scale,
    depthMm,
  }
}

/** The arrays a mark carries, for a zero-copy `postMessage`. */
export function markTransfer(m: MarkData): Transferable[] {
  const out: Transferable[] = [m.position.buffer, m.normal.buffer]
  if (m.uv) out.push(m.uv.buffer)
  if (m.index) out.push(m.index.buffer)
  return out
}

export function markGeometry(m: MarkData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3))
  if (m.uv) g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2))
  if (m.index) g.setIndex(new THREE.BufferAttribute(m.index, 1))
  g.computeBoundingSphere()
  return g
}
