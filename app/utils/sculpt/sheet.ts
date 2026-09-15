/**
 * Comparison sheet builder.
 *
 * Draws a single JPEG the review model can look at: row 1 is the render from
 * the estimated reference camera next to the source photo (700x700, aspect
 * fit, white letterboxing); row 2 is front/side/top (460x460). Everything is
 * scaled down together if the long side would exceed `MAX_LONG_SIDE`.
 *
 * The canvas and image loading are injected so this is testable in node: the
 * geometry (`computeLayout`) is pure, and `buildSheet` only ever talks to the
 * DOM through `createCanvas` / `loadImage`, which default to real browser
 * APIs but are swapped for stubs in tests.
 */

export const CELL_PAIR = 700
export const CELL_TRIO = 460
export const LABEL_H = 24
export const GUTTER = 16
export const MARGIN = 24
export const MAX_LONG_SIDE = 1568
export const JPEG_QUALITY = 0.85

export interface SheetCell { x: number, y: number, w: number, h: number, labelY: number }
export interface SheetLayout {
  width: number
  height: number
  scale: number
  cells: {
    reference: SheetCell
    photo: SheetCell
    front: SheetCell
    side: SheetCell
    top: SheetCell
  }
}

export interface LayoutOverrides {
  margin?: number
  gutter?: number
}

/**
 * Pure layout geometry, already scaled to respect `MAX_LONG_SIDE`. With the
 * real constants (margin 24, gutter 16) the 700/460 grid already fits under
 * 1568 on its long side, so `buildSheet` never actually downscales; the
 * `overrides` parameter exists only so tests can force the overflow path
 * (a real caller never passes it).
 */
export function computeLayout(overrides: LayoutOverrides = {}): SheetLayout {
  const margin = overrides.margin ?? MARGIN
  const gutter = overrides.gutter ?? GUTTER

  const row1ContentWidth = CELL_PAIR * 2 + gutter
  const row2ContentWidth = CELL_TRIO * 3 + gutter * 2
  const contentWidth = Math.max(row1ContentWidth, row2ContentWidth)
  const row1Offset = (contentWidth - row1ContentWidth) / 2
  const row2Offset = (contentWidth - row2ContentWidth) / 2

  const row1TotalH = LABEL_H + CELL_PAIR
  const row2TotalH = LABEL_H + CELL_TRIO

  const baseWidth = margin * 2 + contentWidth
  const baseHeight = margin * 2 + row1TotalH + gutter + row2TotalH
  const longSide = Math.max(baseWidth, baseHeight)
  const scale = Math.min(1, MAX_LONG_SIDE / longSide)

  const row1Y = margin + LABEL_H
  const row2Y = margin + row1TotalH + gutter + LABEL_H

  const referenceX = margin + row1Offset
  const photoX = referenceX + CELL_PAIR + gutter

  const frontX = margin + row2Offset
  const sideX = frontX + CELL_TRIO + gutter
  const topX = sideX + CELL_TRIO + gutter

  const cell = (x: number, y: number, size: number): SheetCell => ({
    x: Math.round(x * scale),
    y: Math.round(y * scale),
    w: Math.round(size * scale),
    h: Math.round(size * scale),
    labelY: Math.round((y - 6) * scale),
  })

  return {
    width: Math.round(baseWidth * scale),
    height: Math.round(baseHeight * scale),
    scale,
    cells: {
      reference: cell(referenceX, row1Y, CELL_PAIR),
      photo: cell(photoX, row1Y, CELL_PAIR),
      front: cell(frontX, row2Y, CELL_TRIO),
      side: cell(sideX, row2Y, CELL_TRIO),
      top: cell(topX, row2Y, CELL_TRIO),
    },
  }
}

export interface CanvasCtxLike {
  fillStyle: string
  font: string
  textAlign: string
  textBaseline: string
  fillRect: (x: number, y: number, w: number, h: number) => void
  drawImage: (image: unknown, dx: number, dy: number, dw: number, dh: number) => void
  fillText: (text: string, x: number, y: number) => void
}

export interface CanvasLike {
  width: number
  height: number
  getContext: (type: '2d') => CanvasCtxLike | null
  toDataURL: (type?: string, quality?: number) => string
}

export type ImageLike = { width: number, height: number }

export interface BuildSheetOptions {
  createCanvas?: (width: number, height: number) => CanvasLike
  loadImage?: (src: Blob | string) => Promise<ImageLike>
}

function defaultCreateCanvas(width: number, height: number): CanvasLike {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas as unknown as CanvasLike
}

async function defaultLoadImage(src: Blob | string): Promise<ImageLike> {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src
  return await createImageBitmap(blob)
}

/**
 * `reference` is the source photograph (data URL); `renders` must contain
 * entries named `reference`, `front`, `side` and `top`.
 */
export async function buildSheet(
  reference: string,
  renders: { name: string, blob: Blob }[],
  options: BuildSheetOptions = {},
): Promise<string> {
  const createCanvas = options.createCanvas ?? defaultCreateCanvas
  const loadImage = options.loadImage ?? defaultLoadImage

  const layout = computeLayout()
  const canvas = createCanvas(layout.width, layout.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, layout.width, layout.height)

  const find = (name: string): Blob => {
    const render = renders.find(r => r.name === name)
    if (!render) throw new Error(`missing render: ${name}`)
    return render.blob
  }

  const entries: { cell: SheetCell, src: Blob | string, label: string }[] = [
    { cell: layout.cells.reference, src: find('reference'), label: 'render' },
    { cell: layout.cells.photo, src: reference, label: 'photo' },
    { cell: layout.cells.front, src: find('front'), label: 'front' },
    { cell: layout.cells.side, src: find('side'), label: 'side' },
    { cell: layout.cells.top, src: find('top'), label: 'top' },
  ]

  for (const entry of entries) {
    const img = await loadImage(entry.src)
    const fitScale = Math.min(entry.cell.w / img.width, entry.cell.h / img.height)
    const dw = img.width * fitScale
    const dh = img.height * fitScale
    const dx = entry.cell.x + (entry.cell.w - dw) / 2
    const dy = entry.cell.y + (entry.cell.h - dh) / 2

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(entry.cell.x, entry.cell.y, entry.cell.w, entry.cell.h)
    ctx.drawImage(img, dx, dy, dw, dh)

    ctx.fillStyle = '#000000'
    ctx.font = `${Math.round(LABEL_H * layout.scale)}px sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(entry.label, entry.cell.x, entry.cell.labelY)
  }

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}
