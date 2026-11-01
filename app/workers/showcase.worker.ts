import { sampleById } from '~/utils/samples'
import { buildMark, markTransfer, type MarkData, type MarkRequest } from '~/utils/showcaseMark'

/**
 * Builds the landing hero's marks off the main thread: draw each sample, trace it, extrude it.
 * On a phone that is the better part of a second of work that would otherwise freeze the
 * headline's entrance. Each mark is posted as soon as it is ready; `done` closes the batch.
 */
export type ShowcaseWorkerRequest = { marks: MarkRequest[] }
export type ShowcaseWorkerResponse =
  | { type: 'mark'; mark: MarkData }
  | { type: 'done' }
  | { type: 'error'; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (e: MessageEvent<ShowcaseWorkerRequest>) => {
  try {
    for (const req of e.data.marks) {
      const sample = sampleById(req.sampleId)
      if (!sample) continue
      const canvas = new OffscreenCanvas(req.res, req.res)
      sample.draw(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, req.res)
      const bitmap = canvas.transferToImageBitmap()
      const mark = buildMark(req, sample, bitmap)
      bitmap.close()
      if (mark) ctx.postMessage({ type: 'mark', mark } satisfies ShowcaseWorkerResponse, markTransfer(mark))
    }
    ctx.postMessage({ type: 'done' } satisfies ShowcaseWorkerResponse)
  } catch (err) {
    ctx.postMessage({ type: 'error', message: (err as Error).message } satisfies ShowcaseWorkerResponse)
  }
}
