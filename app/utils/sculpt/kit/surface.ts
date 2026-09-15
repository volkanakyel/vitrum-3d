/**
 * Sculpt kit — surface detail. These operators displace an existing geometry
 * (in place) so the silhouette carries the sewing detail that makes upholstery
 * read as upholstery: seams, tufting, piping and buttons.
 */

import type { ThreeNS, V3 } from './geometry'

type BufferGeometry = import('three').BufferGeometry
type Vector3 = import('three').Vector3

function ensureNormals(geometry: BufferGeometry): void {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
}

function distanceToSegment(THREE: ThreeNS, point: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a)
  const lengthSq = ab.lengthSq()
  if (lengthSq < 1e-12) return point.distanceTo(a)
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / lengthSq, 0, 1)
  return point.distanceTo(a.clone().addScaledVector(ab, t))
}

/** Cosine falloff: 1 at the centre of the groove, 0 at its edge. */
function falloff(distance: number, width: number): number {
  if (distance >= width) return 0
  return 0.5 + 0.5 * Math.cos((Math.PI * distance) / width)
}

/**
 * Press a recessed groove into the surface between two points. Vertices within
 * `width` of the segment are pushed inward along their normal by up to `depth`.
 */
export function seamGeometry(
  THREE: ThreeNS,
  geometry: BufferGeometry,
  from: V3,
  to: V3,
  width: number,
  depth: number,
): BufferGeometry {
  ensureNormals(geometry)
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const v = new THREE.Vector3()
  const n = new THREE.Vector3()

  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i)
    const d = distanceToSegment(THREE, v, a, b)
    const amount = falloff(d, width)
    if (amount <= 0) continue
    n.fromBufferAttribute(normal, i)
    v.addScaledVector(n, -depth * amount)
    position.setXYZ(i, v.x, v.y, v.z)
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Dimple a grid of buttoned tufts into the top and bottom faces of a cushion.
 * `nx`/`ny` are counts across X and Z, `depth` is the pull-in in metres.
 */
export function tuftGeometry(
  THREE: ThreeNS,
  geometry: BufferGeometry,
  nx: number,
  ny: number,
  depth: number,
): BufferGeometry {
  ensureNormals(geometry)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box || nx < 1 || ny < 1) return geometry

  const size = new THREE.Vector3()
  box.getSize(size)
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const v = new THREE.Vector3()
  const n = new THREE.Vector3()
  const radiusU = 0.5 / nx
  const radiusV = 0.5 / ny

  for (let i = 0; i < position.count; i += 1) {
    n.fromBufferAttribute(normal, i)
    if (Math.abs(n.y) < 0.5) continue
    v.fromBufferAttribute(position, i)
    const u = size.x > 1e-9 ? (v.x - box.min.x) / size.x : 0.5
    const w = size.z > 1e-9 ? (v.z - box.min.z) / size.z : 0.5
    const cu = (Math.min(nx - 1, Math.max(0, Math.round(u * nx - 0.5))) + 0.5) / nx
    const cw = (Math.min(ny - 1, Math.max(0, Math.round(w * ny - 0.5))) + 0.5) / ny
    const du = (u - cu) / radiusU
    const dw = (w - cw) / radiusV
    const d = Math.sqrt(du * du + dw * dw)
    const amount = falloff(d, 1)
    if (amount <= 0) continue
    v.addScaledVector(n, -depth * amount)
    position.setXYZ(i, v.x, v.y, v.z)
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Upholstery button: a shallow revolved dome sitting on a flat disc. */
export function buttonGeometry(
  THREE: ThreeNS,
  radius: number,
  depth: number,
  segments: number,
  capSegments: number,
): BufferGeometry {
  // The profile runs base-outward then up to the apex: a lathe profile walked
  // in the other direction comes out inside-out.
  const profile: import('three').Vector2[] = [new THREE.Vector2(0, 0)]
  const steps = Math.max(2, capSegments)
  for (let i = steps; i >= 0; i -= 1) {
    const a = (i / steps) * (Math.PI / 2)
    profile.push(new THREE.Vector2(radius * Math.sin(a), depth * Math.cos(a)))
  }
  return new THREE.LatheGeometry(profile, segments)
}
