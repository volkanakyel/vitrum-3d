import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Ring, TraceResult, TracedPolygon } from './trace'

/** Everything the extrude builder needs from the studio parameters; all in millimetres. */
export interface ExtrudeBuild {
  widthMm: number
  depthMm: number
  bevelMm: number
  bevelSegments: number
  /** Stack only: how far each colour layer rises above the base. */
  layerMm: number
  /** Raise the trace's colour layers as their own slabs on top of the base. */
  stack: boolean
}

/** How the trace's raster maps onto the built geometry, for shadows and overlays. */
export interface ExtrudeFrame {
  /** Raster px per side of the traced box. */
  bw: number
  bh: number
  /** Millimetres per raster px. */
  scale: number
  /** Centre of the traced box in raster px. */
  cx: number
  cy: number
}

export interface Extruded {
  geometry: THREE.BufferGeometry
  frame: ExtrudeFrame
}

/**
 * The traced silhouette as a bevelled solid, centred on the origin, sized by `widthMm`. Every
 * ring becomes a `THREE.Shape` extruded with an inward bevel so the outline stays exactly on the
 * trace; sharp tips are rounded first so the inset bevel cannot fold over itself. Stack traces
 * add each colour region as a thinner slab seated on the base's face. UVs are a planar
 * projection back into image space so the Color finish samples the picture behind every face.
 */
export function buildExtrudeGeometry(t: TraceResult, p: ExtrudeBuild): Extruded | null {
  if (!t.polygons.length) return null
  const bw = t.bbox.maxX - t.bbox.minX
  const bh = t.bbox.maxY - t.bbox.minY
  const scale = p.widthMm / Math.max(bw, 1e-6)
  const cx = (t.bbox.minX + t.bbox.maxX) / 2
  const cy = (t.bbox.minY + t.bbox.maxY) / 2
  const toMm = ([x, y]: Ring[number]) => new THREE.Vector2((x - cx) * scale, -(y - cy) * scale)
  const uvAt = (x: number, y: number): [number, number] => [
    (x / scale + cx) / t.width,
    1 - (cy - y / scale) / t.height,
  ]
  const UVGenerator: THREE.UVGenerator = {
    generateTopUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number) {
      return [a, b, c].map(i => new THREE.Vector2(...uvAt(v[i * 3]!, v[i * 3 + 1]!)))
    },
    generateSideWallUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number, d: number) {
      return [a, b, c, d].map(i => new THREE.Vector2(...uvAt(v[i * 3]!, v[i * 3 + 1]!)))
    },
  }

  // Bevel cannot exceed half the depth; with bevelOffset = -bevel the outline stays exact.
  const bevel = Math.max(0, Math.min(p.bevelMm, p.depthMm / 2 - 0.01))
  const coreDepth = Math.max(0.01, p.depthMm - 2 * bevel)
  const cornerR = Math.max(bevel * 0.9, p.widthMm * 0.004)
  /** One region as a core `depth` thick plus an inward bevel, its sharp corners rounded to `radius`. */
  const extrude = (poly: TracedPolygon, depth: number, bevelMm: number, bevelSegments: number, radius: number) => {
    const shape = new THREE.Shape(roundSharpCorners(poly.exterior.map(toMm), radius))
    for (const hole of poly.holes) shape.holes.push(new THREE.Path(roundSharpCorners(hole.map(toMm), radius)))
    return new THREE.ExtrudeGeometry(shape, {
      depth,
      curveSegments: 1,
      bevelEnabled: bevelMm > 0,
      bevelThickness: bevelMm,
      bevelSize: bevelMm,
      bevelOffset: -bevelMm,
      bevelSegments,
      UVGenerator,
    })
  }
  const geometries: THREE.BufferGeometry[] = t.polygons.map(poly => extrude(poly, coreDepth, bevel, p.bevelSegments, cornerR))
  if (p.stack && t.layers) {
    const topZ = coreDepth + bevel
    const layerBevel = Math.max(0, Math.min(bevel * 0.6, p.layerMm * 0.45))
    const layerCore = Math.max(0.01, p.layerMm - 2 * layerBevel)
    const layerR = Math.max(layerBevel * 0.9, p.widthMm * 0.003)
    const layerSegments = Math.max(1, Math.round(p.bevelSegments / 2))
    for (const layer of t.layers) {
      for (const poly of layer.polygons) {
        const geo = extrude(poly, layerCore, layerBevel, layerSegments, layerR)
        // ExtrudeGeometry spans z ∈ [-bevel, depth + bevel]; seat the layer just under the face.
        geo.translate(0, 0, topZ - 0.05 + layerBevel)
        geometries.push(geo)
      }
    }
  }
  const merged = geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries, false)!
  if (merged !== geometries[0]) geometries.forEach(g => g.dispose())
  merged.computeBoundingBox()
  const bb = merged.boundingBox!
  merged.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2)
  merged.computeVertexNormals()
  return { geometry: merged, frame: { bw, bh, scale, cx, cy } }
}

/**
 * Replace every corner sharper than `maxDeg` with an arc of radius `r`. An inset bevel folds
 * over itself at a sharp tip and throws a spike; a rounded tip keeps the mesh clean.
 */
export function roundSharpCorners(pts: THREE.Vector2[], r: number, maxDeg = 72): THREE.Vector2[] {
  const n = pts.length
  if (n < 3 || r <= 0) return pts
  const out: THREE.Vector2[] = []
  const cos = Math.cos((maxDeg * Math.PI) / 180)
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n]!, cur = pts[i]!, next = pts[(i + 1) % n]!
    const a = prev.clone().sub(cur), b = next.clone().sub(cur)
    const la = a.length(), lb = b.length()
    if (la < 1e-6 || lb < 1e-6) continue
    a.divideScalar(la)
    b.divideScalar(lb)
    const c = a.dot(b)
    if (c <= cos) { out.push(cur); continue }
    const theta = Math.acos(Math.min(1, Math.max(-1, c)))
    let tLen = r / Math.tan(theta / 2)
    tLen = Math.min(tLen, la * 0.45, lb * 0.45)
    const radius = tLen * Math.tan(theta / 2)
    const p0 = cur.clone().addScaledVector(a, tLen)
    const p1 = cur.clone().addScaledVector(b, tLen)
    const bis = a.clone().add(b).normalize()
    const centre = cur.clone().addScaledVector(bis, radius / Math.sin(theta / 2))
    const a0 = Math.atan2(p0.y - centre.y, p0.x - centre.x)
    const a1 = Math.atan2(p1.y - centre.y, p1.x - centre.x)
    let d = a1 - a0
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    const steps = Math.max(3, Math.ceil(Math.abs(d) / (Math.PI / 12)))
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + (d * k) / steps
      out.push(new THREE.Vector2(centre.x + Math.cos(ang) * radius, centre.y + Math.sin(ang) * radius))
    }
  }
  return out.length >= 3 ? out : pts
}
