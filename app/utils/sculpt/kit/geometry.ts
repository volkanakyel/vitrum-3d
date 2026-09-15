/**
 * Sculpt kit — geometry primitives.
 *
 * Every builder takes the caller's `THREE` namespace so the kit never mixes
 * three.js instances with the sandbox that runs the generated code. All
 * geometries are returned centred on the origin with +Y up and computed
 * normals.
 */

export type ThreeNS = typeof import('three')
export type V3 = [number, number, number]
export type Quality = 'draft' | 'standard' | 'hero'

export interface Tessellation {
  /** segments around a revolved profile (cylinders, tubes, lathes) */
  radial: number
  /** segments along a cap arc, torus tube, or rounded corner */
  cap: number
  /** subdivisions per cushion face */
  pillow: number
  /** samples along a swept path */
  curve: number
}

export const TESSELLATION: Record<Quality, Tessellation> = {
  draft: { radial: 8, cap: 8, pillow: 12, curve: 32 },
  standard: { radial: 24, cap: 16, pillow: 24, curve: 96 },
  hero: { radial: 48, cap: 32, pillow: 48, curve: 192 },
}

const EPS = 1e-9

/** Weld vertices that share a position (within `tolerance`), keeping the first
 * vertex's other attributes. Kept local so the kit depends on nothing but the
 * `THREE` namespace it is handed. */
export function weldVertices(
  THREE: ThreeNS,
  geometry: import('three').BufferGeometry,
  keyNames: string[] = ['position'],
  tolerance = 1e-5,
): import('three').BufferGeometry {
  const position = geometry.getAttribute('position')
  if (!position) return geometry
  const names = Object.keys(geometry.attributes)
  const sources = names.map(name => geometry.getAttribute(name))
  const keys = keyNames
    .map(name => geometry.getAttribute(name))
    .filter((attribute): attribute is import('three').BufferAttribute => Boolean(attribute))
  const buckets: number[][] = names.map(() => [])
  const index = geometry.getIndex()
  const count = index ? index.count : position.count
  const factor = 1 / tolerance
  const lookup = new Map<string, number>()
  const nextIndex: number[] = []
  const parts: number[] = []

  for (let i = 0; i < count; i += 1) {
    const vertex = index ? index.getX(i) : i
    parts.length = 0
    for (const attribute of keys) {
      for (let c = 0; c < attribute.itemSize; c += 1) {
        parts.push(Math.round(attribute.getComponent(vertex, c) * factor))
      }
    }
    const key = parts.join(',')
    const existing = lookup.get(key)
    if (existing !== undefined) {
      nextIndex.push(existing)
      continue
    }
    const target = (buckets[0]?.length ?? 0) / (sources[0]?.itemSize ?? 1)
    for (let a = 0; a < sources.length; a += 1) {
      const source = sources[a]
      const bucket = buckets[a]
      if (!source || !bucket) continue
      for (let c = 0; c < source.itemSize; c += 1) {
        bucket.push(source.getComponent(vertex, c))
      }
    }
    lookup.set(key, target)
    nextIndex.push(target)
  }

  const merged = new THREE.BufferGeometry()
  for (let a = 0; a < names.length; a += 1) {
    const name = names[a]
    const source = sources[a]
    const bucket = buckets[a]
    if (!name || !source || !bucket) continue
    merged.setAttribute(name, new THREE.BufferAttribute(new Float32Array(bucket), source.itemSize))
  }
  merged.setIndex(nextIndex)
  return merged
}

/**
 * Average the vertex normals of every vertex that shares a position. Welding
 * by position *and* uv keeps the texture seams separate (so a face's uv square
 * is never stretched across an edge) but leaves the shared edge faceted; this
 * restores the smooth shading across it.
 */
export function smoothNormalsByPosition(
  THREE: ThreeNS,
  geometry: import('three').BufferGeometry,
  tolerance = 1e-5,
): void {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position || !normal) return
  const factor = 1 / tolerance
  const groups = new Map<string, number[]>()

  for (let i = 0; i < position.count; i += 1) {
    const key = `${Math.round(position.getX(i) * factor)},${Math.round(position.getY(i) * factor)},${Math.round(position.getZ(i) * factor)}`
    const group = groups.get(key)
    if (group) group.push(i)
    else groups.set(key, [i])
  }

  const sum = new THREE.Vector3()
  const one = new THREE.Vector3()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    sum.set(0, 0, 0)
    for (const i of group) sum.add(one.fromBufferAttribute(normal, i))
    if (sum.lengthSq() < 1e-12) continue
    sum.normalize()
    for (const i of group) normal.setXYZ(i, sum.x, sum.y, sum.z)
  }
  normal.needsUpdate = true
}

/* ------------------------------------------------------------------ boxes */

/**
 * Rounded, optionally pillowed box. The corners are rounded first by
 * projecting every vertex onto the rounded-box surface (clamp to the
 * box-minus-radius core, then push back out to `radius`); the faces are then
 * bowed outward along their own normal by
 * `bulge * (1 - (2u-1)^2) * (1 - (2v-1)^2)`, so the bulge is added *outside*
 * the nominal size and the finished bounds are `size + 2 * bulge`.
 */
export function pillowGeometry(
  THREE: ThreeNS,
  width: number,
  height: number,
  depth: number,
  radius: number,
  bulge: number,
  segments: number,
): import('three').BufferGeometry {
  const n = Math.max(1, Math.round(segments))
  const source = new THREE.BoxGeometry(width, height, depth, n, n, n)
  const position = source.getAttribute('position')
  const normal = source.getAttribute('normal')
  const uv = source.getAttribute('uv')

  const half = new THREE.Vector3(width / 2, height / 2, depth / 2)
  const r = Math.max(0, Math.min(radius, half.x, half.y, half.z))
  const inner = new THREE.Vector3(
    Math.max(half.x - r, EPS),
    Math.max(half.y - r, EPS),
    Math.max(half.z - r, EPS),
  )

  const v = new THREE.Vector3()
  const core = new THREE.Vector3()
  const delta = new THREE.Vector3()
  const faceNormal = new THREE.Vector3()

  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i)

    if (r > 0) {
      core.set(
        THREE.MathUtils.clamp(v.x, -inner.x, inner.x),
        THREE.MathUtils.clamp(v.y, -inner.y, inner.y),
        THREE.MathUtils.clamp(v.z, -inner.z, inner.z),
      )
      delta.copy(v).sub(core)
      if (delta.lengthSq() > EPS) {
        delta.setLength(r)
        v.copy(core).add(delta)
      }
    }

    if (bulge > 0 && uv) {
      faceNormal.fromBufferAttribute(normal, i)
      const u = uv.getX(i)
      const w = uv.getY(i)
      const fu = 1 - (2 * u - 1) ** 2
      const fw = 1 - (2 * w - 1) ** 2
      v.addScaledVector(faceNormal, bulge * fu * fw)
    }

    position.setXYZ(i, v.x, v.y, v.z)
  }

  const merged = weldVertices(THREE, source, ['position', 'uv'])
  source.dispose()
  merged.computeVertexNormals()
  smoothNormalsByPosition(THREE, merged)
  return merged
}

/* --------------------------------------------------------------- revolved */

export function cylinderGeometry(
  THREE: ThreeNS,
  tess: Tessellation,
  radius: number,
  height: number,
  topRadius: number,
  edge: number,
): import('three').BufferGeometry {
  if (edge <= 0) {
    return new THREE.CylinderGeometry(topRadius, radius, height, tess.radial, 1)
  }
  const e = Math.max(0, Math.min(edge, height / 2, radius, topRadius))
  const half = height / 2
  const profile: import('three').Vector2[] = [new THREE.Vector2(0, -half)]
  const steps = Math.max(2, Math.round(tess.cap / 2))

  for (let i = 0; i <= steps; i += 1) {
    const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2)
    profile.push(new THREE.Vector2(radius - e + Math.cos(a) * e, -half + e + Math.sin(a) * e))
  }
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * (Math.PI / 2)
    profile.push(new THREE.Vector2(topRadius - e + Math.cos(a) * e, half - e + Math.sin(a) * e))
  }
  profile.push(new THREE.Vector2(0, half))
  return new THREE.LatheGeometry(profile, tess.radial)
}

export function latheGeometry(
  THREE: ThreeNS,
  profile: [number, number][],
  segments: number,
): import('three').BufferGeometry {
  const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y))
  return new THREE.LatheGeometry(points, segments)
}

/* ----------------------------------------------------------------- extrude */

export function extrudeGeometry(
  THREE: ThreeNS,
  tess: Tessellation,
  outline: [number, number][],
  depth: number,
  bevel: number,
  holes: [number, number][][],
): import('three').BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const hole of holes) {
    shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))))
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: tess.cap,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: bevel > 0 ? Math.max(1, Math.round(tess.cap / 4)) : 0,
  })
  geometry.center()
  geometry.computeVertexNormals()
  return geometry
}

/* ------------------------------------------------------------------ sweeps */

/**
 * Sweep a circular section along `samples` using parallel-transport frames:
 * the reference normal is carried from sample to sample by the rotation that
 * takes the previous tangent to the current one, so the frame never rolls or
 * flips at an inflection the way Frenet frames do.
 */
export function sweepFromSamples(
  THREE: ThreeNS,
  samples: import('three').Vector3[],
  radiusAt: (t: number) => number,
  radialSegments: number,
  closed: boolean,
): import('three').BufferGeometry {
  const points = samples
    .filter((point, i) => i === 0 || point.distanceToSquared(samples[i - 1] as import('three').Vector3) > 1e-12)
    .map(point => point.clone())
  const geometry = new THREE.BufferGeometry()
  if (points.length < 2) return geometry

  // A closed sweep keeps a final ring that repeats the first one, so the uv
  // seam is explicit and the frame is guaranteed to line up across it.
  if (closed) {
    const start = points[0] as import('three').Vector3
    const end = points[points.length - 1] as import('three').Vector3
    if (end.distanceTo(start) < 1e-6) end.copy(start)
    else points.push(start.clone())
  }

  const n = points.length
  /** distinct samples: the wrap-around copy is not one of them */
  const period = closed ? n - 1 : n

  const tangents: import('three').Vector3[] = []
  for (let i = 0; i < n; i += 1) {
    const prev = closed
      ? points[(i - 1 + period) % period] as import('three').Vector3
      : points[Math.max(0, i - 1)] as import('three').Vector3
    const next = closed
      ? points[(i + 1) % period] as import('three').Vector3
      : points[Math.min(n - 1, i + 1)] as import('three').Vector3
    const tangent = next.clone().sub(prev)
    if (tangent.lengthSq() < 1e-16) tangent.copy(tangents[i - 1] ?? new THREE.Vector3(0, 0, 1))
    tangents.push(tangent.normalize())
  }

  const first = tangents[0] as import('three').Vector3
  const seed = Math.abs(first.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const normals: import('three').Vector3[] = [seed.clone().cross(first).normalize()]
  const rotation = new THREE.Quaternion()
  for (let i = 1; i < n; i += 1) {
    const prevTangent = tangents[i - 1] as import('three').Vector3
    const tangent = tangents[i] as import('three').Vector3
    rotation.setFromUnitVectors(prevTangent, tangent)
    const carried = (normals[i - 1] as import('three').Vector3).clone().applyQuaternion(rotation)
    carried.addScaledVector(tangent, -carried.dot(tangent))
    if (carried.lengthSq() < 1e-12) carried.copy(normals[i - 1] as import('three').Vector3)
    normals.push(carried.normalize())
  }

  // Holonomy: transporting a frame around a closed non-planar loop returns it
  // rotated about the tangent. Measure that residual twist and unwind it
  // linearly along the path so the last ring lands exactly on the first.
  if (closed && n > 2) {
    const startNormal = normals[0] as import('three').Vector3
    const startTangent = tangents[0] as import('three').Vector3
    const wrapped = normals[n - 1] as import('three').Vector3
    const startBinormal = startTangent.clone().cross(startNormal)
    const residual = Math.atan2(wrapped.dot(startBinormal), wrapped.dot(startNormal))
    if (Math.abs(residual) > 1e-12) {
      for (let i = 1; i < n; i += 1) {
        const tangent = tangents[i] as import('three').Vector3
        ;(normals[i] as import('three').Vector3).applyAxisAngle(tangent, (-residual * i) / (n - 1))
      }
    }
    wrapped.copy(startNormal)
  }

  const positions: number[] = []
  const uvs: number[] = []
  const radii: number[] = []
  const binormal = new THREE.Vector3()
  const point = new THREE.Vector3()

  for (let i = 0; i < n; i += 1) {
    const centre = points[i] as import('three').Vector3
    const tangent = tangents[i] as import('three').Vector3
    const normal = normals[i] as import('three').Vector3
    binormal.copy(tangent).cross(normal).normalize()
    const t = n === 1 ? 0 : i / (n - 1)
    const radius = Math.max(0, radiusAt(t))
    radii.push(radius)
    for (let j = 0; j < radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2
      point.copy(centre)
        .addScaledVector(normal, Math.cos(angle) * radius)
        .addScaledVector(binormal, Math.sin(angle) * radius)
      positions.push(point.x, point.y, point.z)
      uvs.push(t, j / radialSegments)
    }
  }

  const indices: number[] = []
  for (let i = 0; i < n - 1; i += 1) {
    const next = i + 1
    for (let j = 0; j < radialSegments; j += 1) {
      const jn = (j + 1) % radialSegments
      const a = i * radialSegments + j
      const b = i * radialSegments + jn
      const c = next * radialSegments + j
      const d = next * radialSegments + jn
      indices.push(a, b, c, b, d, c)
    }
  }

  if (!closed) {
    const startRadius = radii[0] ?? 0
    if (startRadius > 1e-6) {
      const centre = positions.length / 3
      const p = points[0] as import('three').Vector3
      positions.push(p.x, p.y, p.z)
      uvs.push(0.5, 0.5)
      for (let j = 0; j < radialSegments; j += 1) {
        indices.push(centre, (j + 1) % radialSegments, j)
      }
    }
    const endRadius = radii[n - 1] ?? 0
    if (endRadius > 1e-6) {
      const centre = positions.length / 3
      const p = points[n - 1] as import('three').Vector3
      const base = (n - 1) * radialSegments
      positions.push(p.x, p.y, p.z)
      uvs.push(0.5, 0.5)
      for (let j = 0; j < radialSegments; j += 1) {
        indices.push(centre, base + j, base + ((j + 1) % radialSegments))
      }
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.userData.sweep = { samples: n, radialSegments }
  return geometry
}

function toVectors(THREE: ThreeNS, points: V3[]): import('three').Vector3[] {
  return points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
}

export function tubeGeometry(
  THREE: ThreeNS,
  tess: Tessellation,
  points: V3[],
  radius: number,
  closed: boolean,
  tension: number,
): import('three').BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(toVectors(THREE, points), closed, 'catmullrom', tension)
  const samples = curve.getSpacedPoints(tess.curve)
  return sweepFromSamples(THREE, samples, () => radius, tess.radial, closed)
}

export function sweepGeometry(
  THREE: ThreeNS,
  tess: Tessellation,
  points: V3[],
  radius: number | ((t: number) => number),
  segments: number,
): import('three').BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(toVectors(THREE, points), false, 'catmullrom', 0.5)
  const samples = curve.getSpacedPoints(Math.max(2, Math.round(segments)))
  const radiusAt = typeof radius === 'function' ? radius : () => radius
  return sweepFromSamples(THREE, samples, radiusAt, tess.radial, false)
}

/** Polyline with a circular fillet of `cornerRadius` at every interior vertex,
 * swept at constant radius — the shape of sled rails, tube frames and handles. */
export function bentTubeGeometry(
  THREE: ThreeNS,
  tess: Tessellation,
  points: V3[],
  radius: number,
  cornerRadius: number,
): import('three').BufferGeometry {
  const corners = toVectors(THREE, points)
  const samples: import('three').Vector3[] = []
  if (corners.length === 0) return new THREE.BufferGeometry()
  samples.push((corners[0] as import('three').Vector3).clone())

  for (let i = 1; i < corners.length - 1; i += 1) {
    const prev = corners[i - 1] as import('three').Vector3
    const current = corners[i] as import('three').Vector3
    const next = corners[i + 1] as import('three').Vector3
    const toPrev = prev.clone().sub(current)
    const toNext = next.clone().sub(current)
    const lenPrev = toPrev.length()
    const lenNext = toNext.length()
    if (lenPrev < EPS || lenNext < EPS) continue
    toPrev.divideScalar(lenPrev)
    toNext.divideScalar(lenNext)

    const angle = Math.acos(THREE.MathUtils.clamp(toPrev.dot(toNext), -1, 1))
    if (cornerRadius <= 0 || angle > Math.PI - 1e-3 || angle < 1e-3) {
      samples.push(current.clone())
      continue
    }

    const halfAngle = angle / 2
    const maxRun = Math.min(lenPrev, lenNext) * 0.49
    const run = Math.min(cornerRadius / Math.tan(halfAngle), maxRun)
    const r = run * Math.tan(halfAngle)
    const bisector = toPrev.clone().add(toNext)
    if (bisector.lengthSq() < 1e-12) {
      samples.push(current.clone())
      continue
    }
    bisector.normalize()
    const centre = current.clone().addScaledVector(bisector, r / Math.sin(halfAngle))
    const start = current.clone().addScaledVector(toPrev, run).sub(centre)
    const end = current.clone().addScaledVector(toNext, run).sub(centre)
    const steps = Math.max(2, Math.round((tess.cap * (Math.PI - angle)) / Math.PI))
    const from = new THREE.Quaternion()
    const to = new THREE.Quaternion().setFromUnitVectors(start.clone().normalize(), end.clone().normalize())
    const slerped = new THREE.Quaternion()
    for (let k = 0; k <= steps; k += 1) {
      slerped.copy(from).slerp(to, k / steps)
      samples.push(start.clone().applyQuaternion(slerped).add(centre))
    }
  }

  const last = corners[corners.length - 1]
  if (last) samples.push(last.clone())
  return sweepFromSamples(THREE, samples, () => radius, tess.radial, false)
}
