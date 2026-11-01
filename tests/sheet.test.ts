import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildExtrudeGeometry } from '~/utils/extrude'
import { arrangeItems, groupItems, layoutBox, medianItemSize } from '~/utils/sheet'
import type { TracedPolygon, TraceResult } from '~/utils/trace'

const rect = (x: number, y: number, w: number, h: number): TracedPolygon =>
  ({ exterior: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], holes: [] })

/** A 3×2 sheet of 40 px icons on a 100 px pitch; the first icon is two parts split by a thin band. */
function sheet(): TracedPolygon[] {
  const out: TracedPolygon[] = []
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const x = 30 + col * 100, y = 30 + row * 100
      if (row === 0 && col === 0) out.push(rect(x, y, 40, 18), rect(x, y + 24, 40, 16))
      else out.push(rect(x, y, 40, 40))
    }
  }
  return out
}

function traceOf(polygons: TracedPolygon[]): TraceResult {
  return {
    polygons,
    items: groupItems(polygons),
    hasTile: false,
    width: 400,
    height: 300,
    bbox: { minX: 30, minY: 30, maxX: 270, maxY: 170 },
    resolvedMode: 'dark',
    threshold: 0.5,
    background: [255, 255, 255],
    coverage: 0.1,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    strokeWidth: 20,
    vertexCount: polygons.length * 4,
    palette: 2,
  }
}

describe('groupItems', () => {
  it('joins the parts of one icon and keeps the icons of a sheet apart, in reading order', () => {
    const items = groupItems(sheet())
    expect(items).toHaveLength(6)
    expect(items[0]!.polygons).toEqual([0, 1])
    expect(items.map(i => Math.round(i.bbox.minX))).toEqual([30, 130, 230, 30, 130, 230])
    expect(items.map(i => Math.round(i.bbox.minY))).toEqual([30, 30, 30, 130, 130, 130])
  })

  it('does not chain icons whose boxes sit close but whose outlines do not', () => {
    // A diagonal "scythe" whose box ends 8 px from a "bat", the bat's box 8 px from a "stone":
    // the real outlines are far apart, so the row stays three icons.
    const scythe: TracedPolygon = { exterior: [[0, 0], [10, 0], [100, 90], [100, 100], [90, 100], [0, 10]], holes: [] }
    const bat = rect(108, 0, 100, 30)
    const stone = rect(216, 60, 100, 40)
    expect(groupItems([scythe, bat, stone])).toHaveLength(3)
  })

  it('keeps tightly set letters as one mark', () => {
    const word = [rect(0, 0, 30, 40), rect(34, 0, 30, 40), rect(68, 0, 30, 40)]
    expect(groupItems(word)).toHaveLength(1)
  })

  it('gives up on texture-like traces with hundreds of regions', () => {
    const specks = Array.from({ length: 401 }, (_, i) => rect((i % 20) * 50, Math.floor(i / 20) * 50, 2, 2))
    expect(groupItems(specks)).toEqual([])
  })
})

describe('arrangeItems', () => {
  it('pushes every icon away from the centre and leaves each one its size', () => {
    const t = traceOf(sheet())
    const a = arrangeItems(t, 0.5)!
    expect(a.offsets[0]).toEqual([-50, -25])
    expect(a.offsets[1]).toEqual(a.offsets[0])
    expect(a.bbox).toEqual({ minX: -20, minY: 5, maxX: 320, maxY: 195 })
    expect(medianItemSize(t.items!)).toBe(40)
  })

  it('is a no-op without spread or with a single mark', () => {
    const t = traceOf(sheet())
    expect(arrangeItems(t, 0)).toBeNull()
    expect(layoutBox(t, 0)).toBe(t.bbox)
    expect(arrangeItems({ ...t, items: t.items!.slice(0, 1) }, 1)).toBeNull()
  })
})

describe('buildExtrudeGeometry on a sheet', () => {
  const build = (t: TraceResult, spread: number) =>
    buildExtrudeGeometry(t, { widthMm: 120, depthMm: 6, bevelMm: 1, bevelSegments: 2, layerMm: 2, stack: false, spread })!

  it('fits the arranged set to widthMm, so spread icons are built smaller per mm of W', () => {
    const t = traceOf(sheet())
    const drawn = build(t, 0)
    const spread = build(t, 0.5)
    const size = (g: THREE.BufferGeometry) => g.boundingBox!.getSize(new THREE.Vector3())
    expect(size(drawn.geometry).x).toBeCloseTo(120, 3)
    expect(size(spread.geometry).x).toBeCloseTo(120, 3)
    expect(spread.frame.scale).toBeCloseTo(120 / 340, 6)
    expect(spread.frame.arrangement).not.toBeNull()
  })

  it('keeps UVs pointing at each icon’s own pixels after it moves', () => {
    const t = traceOf([rect(30, 30, 40, 40), rect(230, 30, 40, 40)])
    const uvs = (spread: number) => {
      const uv = build(t, spread).geometry.getAttribute('uv')
      let min = Infinity, max = -Infinity
      for (let i = 0; i < uv.count; i++) { min = Math.min(min, uv.getX(i)); max = Math.max(max, uv.getX(i)) }
      return [min, max]
    }
    const [a0, a1] = uvs(0)
    const [b0, b1] = uvs(1)
    expect(b0).toBeCloseTo(a0, 4)
    expect(b1).toBeCloseTo(a1, 4)
  })
})
