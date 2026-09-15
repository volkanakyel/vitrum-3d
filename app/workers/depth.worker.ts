import { env, pipeline, RawImage, type DepthEstimationPipeline } from '@huggingface/transformers'
import { normaliseDepth, padDepth, shrinkDepth, type DepthMap } from '~/utils/depth'

/**
 * Depth worker. Owns the depth model so the main bundle never imports the ML runtime. The front
 * photo's crop comes in as `ImageData` (≤ 518 px, the model's own input size) with the silhouette
 * mask at the same size; the nearness map goes back shrunk to ≤ 256 px. The model's weights are
 * fetched once from the model host and cached by the browser; the image never leaves the page.
 */
export type DepthDevice = 'webgpu' | 'wasm'
export type DepthWorkerRequest = { type: 'depth'; id: number; image: ImageData; mask: Uint8Array; model: string }
export type DepthWorkerResponse =
  | { type: 'depth'; id: number; map: DepthMap; ms: number; device: DepthDevice }
  | { type: 'progress'; id: number; loaded: number; total: number }
  | { type: 'error'; id: number; message: string }

/** Long side of the carve's copy of the map; the voxel grid is ≤ 176 cells, finer is wasted. */
const MAP_PX = 256

env.allowLocalModels = false

const ctx = self as unknown as DedicatedWorkerGlobalScope
let device: DepthDevice = 'gpu' in navigator ? 'webgpu' : 'wasm'
let estimator: Promise<DepthEstimationPipeline> | null = null
let loadedModel = ''

function load(model: string, id: number): Promise<DepthEstimationPipeline> {
  if (estimator && loadedModel === model) return estimator
  loadedModel = model
  estimator = pipeline('depth-estimation', model, {
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'q8',
    progress_callback: (p) => {
      if (p.status === 'progress' && 'file' in p && p.file.endsWith('.onnx')) {
        ctx.postMessage({ type: 'progress', id, loaded: p.loaded ?? 0, total: p.total ?? 0 } satisfies DepthWorkerResponse)
      }
    },
  }).catch((err: unknown) => {
    estimator = null
    throw err
  })
  return estimator
}

async function infer(msg: DepthWorkerRequest): Promise<DepthMap> {
  const est = await load(msg.model, msg.id)
  const { width: w, height: h } = msg.image
  const image = new RawImage(msg.image.data, w, h, 4)
  const out = await est(image)
  const result = Array.isArray(out) ? out[0]! : out
  const raw = result.predicted_depth.data as Float32Array
  const [ph, pw] = result.predicted_depth.dims as [number, number]
  if (pw !== w || ph !== h) throw new Error(`Depth came back ${pw}×${ph} for a ${w}×${h} photo`)
  const near = normaliseDepth(raw, w, h, msg.mask)
  padDepth(near, w, h, msg.mask)
  return shrinkDepth(near, w, h, MAP_PX)
}

ctx.onmessage = async (e: MessageEvent<DepthWorkerRequest>) => {
  const msg = e.data
  if (msg.type !== 'depth') return
  const t0 = performance.now()
  try {
    let map: DepthMap
    try {
      map = await infer(msg)
    } catch (err) {
      // A GPU that advertises WebGPU but cannot run the graph: once more on the CPU.
      if (device !== 'webgpu') throw err
      console.warn('[depth] WebGPU failed, retrying on wasm:', err)
      device = 'wasm'
      estimator = null
      map = await infer(msg)
    }
    ctx.postMessage({ type: 'depth', id: msg.id, map, ms: performance.now() - t0, device } satisfies DepthWorkerResponse, [map.near.buffer])
  } catch (err) {
    ctx.postMessage({ type: 'error', id: msg.id, message: (err as Error).message } satisfies DepthWorkerResponse)
  }
}
