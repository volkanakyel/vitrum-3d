import { describe, expect, it, vi } from 'vitest'
import {
  buildSheet,
  CELL_PAIR,
  CELL_TRIO,
  computeLayout,
  GUTTER,
  JPEG_QUALITY,
  LABEL_H,
  MARGIN,
  MAX_LONG_SIDE,
} from '../app/utils/sculpt/sheet'
import type { CanvasCtxLike, CanvasLike, ImageLike } from '../app/utils/sculpt/sheet'

describe('computeLayout', () => {
  const layout = computeLayout()

  it('clamps the long side to MAX_LONG_SIDE', () => {
    expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(MAX_LONG_SIDE)
    // The base (unscaled) geometry for these constants exceeds the cap, so
    // the layout must actually have been scaled down, not just happen to fit.
    const row1ContentWidth = CELL_PAIR * 2 + GUTTER
    const row2ContentWidth = CELL_TRIO * 3 + GUTTER * 2
    const contentWidth = Math.max(row1ContentWidth, row2ContentWidth)
    const baseWidth = MARGIN * 2 + contentWidth
    const baseHeight = MARGIN * 2 + (LABEL_H + CELL_PAIR) + GUTTER + (LABEL_H + CELL_TRIO)
    expect(Math.max(baseWidth, baseHeight)).toBeGreaterThan(MAX_LONG_SIDE)
    expect(layout.scale).toBeLessThan(1)
  })

  it('sizes reference/photo cells identically and front/side/top identically', () => {
    const { reference, photo, front, side, top } = layout.cells
    expect(reference.w).toBe(reference.h)
    expect(reference.w).toBe(photo.w)
    expect(reference.h).toBe(photo.h)
    expect(front.w).toBe(front.h)
    expect(front.w).toBe(side.w)
    expect(front.w).toBe(top.w)
    // Row 1 (700 base) cells are bigger than row 2 (460 base) cells.
    expect(reference.w).toBeGreaterThan(front.w)
  })

  it('lays out row 1 (reference/photo) above row 2 (front/side/top), left to right', () => {
    const { reference, photo, front, side, top } = layout.cells
    expect(reference.y).toBe(photo.y)
    expect(front.y).toBe(side.y)
    expect(side.y).toBe(top.y)
    expect(front.y).toBeGreaterThan(reference.y)

    expect(photo.x).toBeGreaterThanOrEqual(reference.x + reference.w)
    expect(side.x).toBeGreaterThanOrEqual(front.x + front.w)
    expect(top.x).toBeGreaterThanOrEqual(side.x + side.w)
  })

  it('is deterministic and matches the expected pixel geometry', () => {
    // Pinned to the current constants (MARGIN 80, GUTTER 40, LABEL_H 24,
    // CELL_PAIR 700, CELL_TRIO 460) so a regression in the formula is caught.
    expect(layout.width).toBe(1568)
    expect(layout.height).toBe(1363)
    expect(layout.cells.reference).toEqual({ x: 87, y: 101, w: 678, h: 678, labelY: 95 })
    expect(layout.cells.photo).toEqual({ x: 803, y: 101, w: 678, h: 678, labelY: 95 })
    expect(layout.cells.front).toEqual({ x: 77, y: 840, w: 445, h: 445, labelY: 834 })
    expect(layout.cells.side).toEqual({ x: 561, y: 840, w: 445, h: 445, labelY: 834 })
    expect(layout.cells.top).toEqual({ x: 1045, y: 840, w: 445, h: 445, labelY: 834 })
  })
})

function makeStubCanvas(): { canvas: CanvasLike, drawCalls: { image: unknown, dx: number, dy: number, dw: number, dh: number }[] } {
  const drawCalls: { image: unknown, dx: number, dy: number, dw: number, dh: number }[] = []
  const ctx: CanvasCtxLike = {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: vi.fn(),
    drawImage: vi.fn((image: unknown, dx: number, dy: number, dw: number, dh: number) => {
      drawCalls.push({ image, dx, dy, dw, dh })
    }),
    fillText: vi.fn(),
  }
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,FAKE'),
  }
  return { canvas, drawCalls }
}

function blob(): Blob {
  return new Blob(['x'])
}

describe('buildSheet', () => {
  it('draws all five images into their layout cells and exports a JPEG data URL', async () => {
    const { canvas, drawCalls } = makeStubCanvas()
    const createCanvas = vi.fn((width: number, height: number) => {
      canvas.width = width
      canvas.height = height
      return canvas
    })
    // A 1000x500 image, so the fit is width-constrained in the square cells.
    const loadImage = vi.fn(async (): Promise<ImageLike> => ({ width: 1000, height: 500 }))

    const renders = [
      { name: 'reference', blob: blob() },
      { name: 'front', blob: blob() },
      { name: 'side', blob: blob() },
      { name: 'top', blob: blob() },
    ]

    const url = await buildSheet('data:image/jpeg;base64,PHOTO', renders, { createCanvas, loadImage })

    expect(url).toBe('data:image/jpeg;base64,FAKE')
    expect(createCanvas).toHaveBeenCalledWith(1568, 1363)
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', JPEG_QUALITY)
    expect(loadImage).toHaveBeenCalledTimes(5)
    // The photo (job.image) is loaded, not just the renders.
    expect(loadImage.mock.calls.some(([src]) => src === 'data:image/jpeg;base64,PHOTO')).toBe(true)

    expect(drawCalls).toHaveLength(5)
    const layout = computeLayout()
    // reference cell (row1 left): 1000x500 fit into 678x678 -> width-constrained.
    const referenceDraw = drawCalls[0]!
    const fitScale = layout.cells.reference.w / 1000
    expect(referenceDraw.dw).toBeCloseTo(1000 * fitScale)
    expect(referenceDraw.dh).toBeCloseTo(500 * fitScale)
    // Centered within the cell: some white padding above/below.
    expect(referenceDraw.dy).toBeGreaterThan(layout.cells.reference.y)
    expect(referenceDraw.dx).toBeCloseTo(layout.cells.reference.x)
  })

  it('throws when a required render is missing', async () => {
    const { canvas } = makeStubCanvas()
    const createCanvas = vi.fn(() => canvas)
    const loadImage = vi.fn(async (): Promise<ImageLike> => ({ width: 10, height: 10 }))
    await expect(buildSheet('data:image/jpeg;base64,PHOTO', [{ name: 'reference', blob: blob() }], { createCanvas, loadImage }))
      .rejects.toThrow(/missing render/)
  })
})
