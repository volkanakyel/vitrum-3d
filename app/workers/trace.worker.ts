import { buildHull, type HullData, type HullOptions, type HullView } from '~/utils/hull'
import { computeRelief, type ReliefData, type ReliefMask, type ReliefOptions } from '~/utils/relief'
import { traceImage, type Crop, type TraceOptions, type TraceResult } from '~/utils/trace'

/**
 * Trace worker. The main thread transfers the source once as an `ImageBitmap`; every trace
 * request after that only carries options, so a slider drag never re-encodes the image.
 */
export type TraceWorkerRequest =
  | { type: 'source'; bitmap: ImageBitmap | null }
  | { type: 'trace'; id: number; opts: TraceOptions }
  | { type: 'relief'; id: number; opts: ReliefOptions; crop: Crop; mask: ReliefMask | null }
  | { type: 'hull'; id: number; views: HullView[]; opts: HullOptions }

export type TraceWorkerResponse =
  | { type: 'result'; id: number; result: TraceResult; ms: number }
  | { type: 'relief'; id: number; result: ReliefData; ms: number }
  | { type: 'hull'; id: number; result: HullData; ms: number }
  | { type: 'error'; id: number; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope
let source: ImageBitmap | null = null

ctx.onmessage = (e: MessageEvent<TraceWorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'source') {
    source?.close()
    source = msg.bitmap
    return
  }
  if (msg.type === 'hull') {
    // Outlines only, no pixels: the hull needs no source image.
    try {
      const t0 = performance.now()
      const result = buildHull(msg.views, msg.opts)
      ctx.postMessage({ type: 'hull', id: msg.id, result, ms: performance.now() - t0 } satisfies TraceWorkerResponse, [result.positions.buffer, result.normals.buffer])
    } catch (err) {
      ctx.postMessage({ type: 'error', id: msg.id, message: (err as Error).message } satisfies TraceWorkerResponse)
    }
    return
  }
  if (!source) {
    ctx.postMessage({ type: 'error', id: msg.id, message: 'No image to trace' } satisfies TraceWorkerResponse)
    return
  }
  try {
    const t0 = performance.now()
    if (msg.type === 'relief') {
      const result = computeRelief(source, msg.opts, msg.crop, msg.mask)
      const transfer: Transferable[] = [result.heights.buffer]
      if (result.mask) transfer.push(result.mask.buffer)
      ctx.postMessage({ type: 'relief', id: msg.id, result, ms: performance.now() - t0 } satisfies TraceWorkerResponse, transfer)
      return
    }
    const result = traceImage(source, msg.opts)
    ctx.postMessage({ type: 'result', id: msg.id, result, ms: performance.now() - t0 } satisfies TraceWorkerResponse)
  } catch (err) {
    ctx.postMessage({ type: 'error', id: msg.id, message: (err as Error).message } satisfies TraceWorkerResponse)
  }
}
