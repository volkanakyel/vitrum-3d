import type { PixelBox, TracedPolygon, TraceResult } from './trace'

/**
 * Icon sheets. A picture holding several separate marks (a set of icons, a sticker sheet) traces
 * into many polygons; these helpers group the polygons into the marks they belong to and spread
 * the marks apart, so a sheet lands on the stage as a set of objects rather than one fused slab.
 */

/** One mark on the sheet: the polygons it is made of, and their box in raster px. */
export interface TraceItem {
  polygons: number[]
  bbox: PixelBox
}

/**
 * Two parts belong to one mark when the gap between their outlines is under this share of the
 * smaller part's size: a hat and a brim split by a band, the letters of a wordmark, a dot over
 * an i. The gutter between the icons of a sheet is wider (about 0.3 of an icon on stock sheets).
 */
const JOIN_GAP = 0.22
/** Past this many regions the picture is texture (a photo, a pattern), not a sheet of marks. */
const MAX_PARTS = 400
/** A sheet: enough separate marks that each should stand as its own object. */
export const SHEET_MIN_ITEMS = 4

function boxOf(poly: TracedPolygon): PixelBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of poly.exterior) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

function union(a: PixelBox, b: PixelBox): PixelBox {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }
}

const sizeOf = (b: PixelBox) => Math.max(b.maxX - b.minX, b.maxY - b.minY)

/** Distance between two boxes along the axis they are furthest apart on; 0 when they overlap. */
function boxGap(a: PixelBox, b: PixelBox): number {
  return Math.max(0, a.minX - b.maxX, b.minX - a.maxX, a.minY - b.maxY, b.minY - a.maxY)
}

type Point = [number, number]

function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** Shortest distance from any vertex of one ring to any edge of the other, both ways. */
function ringGap(a: readonly Point[], b: readonly Point[]): number {
  let best = Infinity
  for (const [from, to] of [[a, b], [b, a]] as const) {
    for (const p of from) {
      for (let i = 0; i < to.length; i++) {
        const d = pointToSegment(p, to[i]!, to[(i + 1) % to.length]!)
        if (d < best) best = d
      }
    }
  }
  return best
}

/**
 * Group polygons into marks: union-find over every pair of parts whose outlines come within
 * `JOIN_GAP` of the smaller part's size. The test is pairwise on the real outlines, never on a
 * grown box, so two neighbouring icons that merely sit close (a scythe beside a bat) cannot chain
 * a whole row into one mark. Items come back in reading order, row by row.
 */
export function groupItems(polygons: readonly TracedPolygon[]): TraceItem[] {
  if (!polygons.length || polygons.length > MAX_PARTS) return []
  const boxes = polygons.map(boxOf)
  const parent = polygons.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)))
  for (let i = 0; i < polygons.length; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      if (root(i) === root(j)) continue
      const reach = JOIN_GAP * Math.min(sizeOf(boxes[i]!), sizeOf(boxes[j]!))
      // The box gap is a lower bound on the outline gap: most pairs end here.
      if (boxGap(boxes[i]!, boxes[j]!) >= reach) continue
      if (ringGap(polygons[i]!.exterior, polygons[j]!.exterior) < reach) parent[root(j)] = root(i)
    }
  }
  const byRoot = new Map<number, TraceItem>()
  polygons.forEach((_, i) => {
    const r = root(i)
    const item = byRoot.get(r)
    if (item) { item.polygons.push(i); item.bbox = union(item.bbox, boxes[i]!) }
    else byRoot.set(r, { polygons: [i], bbox: { ...boxes[i]! } })
  })
  return readingOrder([...byRoot.values()])
}

/** Rows by vertical overlap, then left to right within a row. */
function readingOrder(items: TraceItem[]): TraceItem[] {
  const byTop = [...items].sort((a, b) => a.bbox.minY - b.bbox.minY)
  const rows: TraceItem[][] = []
  for (const item of byTop) {
    const cy = (item.bbox.minY + item.bbox.maxY) / 2
    const row = rows.find(r => r.some(o => cy >= o.bbox.minY && cy <= o.bbox.maxY))
    if (row) row.push(item)
    else rows.push([item])
  }
  return rows.flatMap(r => r.sort((a, b) => a.bbox.minX - b.bbox.minX))
}

/** Where every polygon moves to when the marks are spread apart, and the box they then fill. */
export interface Arrangement {
  /** Raster px shift per polygon of the trace, by polygon index. */
  offsets: [number, number][]
  bbox: PixelBox
}

/**
 * Spread the marks apart: every mark's centre moves away from the set's centre by `spread` times
 * its distance, so a grid stays a grid and the gutters widen evenly while each mark keeps its own
 * size. Null when there is nothing to spread (one mark, or no spread).
 */
export function arrangeItems(t: Pick<TraceResult, 'polygons' | 'bbox' | 'items'>, spread: number): Arrangement | null {
  const items = t.items
  if (!items || items.length < 2 || !(spread > 0)) return null
  const cx = (t.bbox.minX + t.bbox.maxX) / 2
  const cy = (t.bbox.minY + t.bbox.maxY) / 2
  const offsets: [number, number][] = t.polygons.map(() => [0, 0])
  let bbox: PixelBox | null = null
  for (const item of items) {
    const ox = ((item.bbox.minX + item.bbox.maxX) / 2 - cx) * spread
    const oy = ((item.bbox.minY + item.bbox.maxY) / 2 - cy) * spread
    for (const i of item.polygons) offsets[i] = [ox, oy]
    const moved = { minX: item.bbox.minX + ox, minY: item.bbox.minY + oy, maxX: item.bbox.maxX + ox, maxY: item.bbox.maxY + oy }
    bbox = bbox ? union(bbox, moved) : moved
  }
  return { offsets, bbox: bbox! }
}

/** The box the extruded model fills, in raster px: the arranged set, or the trace as drawn. */
export function layoutBox(t: Pick<TraceResult, 'polygons' | 'bbox' | 'items'>, spread: number): PixelBox {
  return arrangeItems(t, spread)?.bbox ?? t.bbox
}

/** The trace's polygons moved to their arranged places (for drawing the contact shadow). */
export function arrangedPolygons(polygons: readonly TracedPolygon[], arrangement: Arrangement | null): readonly TracedPolygon[] {
  if (!arrangement) return polygons
  return polygons.map((p, i) => {
    const [ox, oy] = arrangement.offsets[i]!
    const move = (ring: TracedPolygon['exterior']) => ring.map(([x, y]) => [x + ox, y + oy] as [number, number])
    return { exterior: move(p.exterior), holes: p.holes.map(move) }
  })
}

/** Median longest side of the marks, in raster px: the size one icon of the set is drawn at. */
export function medianItemSize(items: readonly TraceItem[]): number {
  if (!items.length) return 0
  const sizes = items.map(i => sizeOf(i.bbox)).sort((a, b) => a - b)
  return sizes[sizes.length >> 1]!
}
