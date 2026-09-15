/**
 * Sculpt kit — assembly. Parts are named meshes registered on the kit as they
 * are created; `root` collects them into `userData.sculpt.parts` and grounds
 * the finished model.
 */

import type { ThreeNS, V3 } from './geometry'

type BufferGeometry = import('three').BufferGeometry
type Material = import('three').Material
type Mesh = import('three').Mesh
type Object3D = import('three').Object3D
type Group = import('three').Group

export interface PartRegistry { parts: Record<string, Mesh> }

export interface Placement { position?: V3, rotation?: V3 }

/** `aoMap` samples `uv1`; kit geometries only carry `uv`, so mirror it. */
export function ensureUv1(geometry: BufferGeometry): void {
  const uv = geometry.getAttribute('uv')
  if (uv && !geometry.getAttribute('uv1')) geometry.setAttribute('uv1', uv)
}

function place(object: Object3D, o?: Placement): void {
  if (o?.position) object.position.set(o.position[0], o.position[1], o.position[2])
  if (o?.rotation) object.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2])
}

export function createPart(
  THREE: ThreeNS,
  registry: PartRegistry,
  id: string,
  geometry: BufferGeometry,
  material: Material,
  o?: Placement,
): Mesh {
  ensureUv1(geometry)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = id
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.sculptId = id
  place(mesh, o)
  registry.parts[id] = mesh
  return mesh
}

/** Mirror the geometry about a plane and reverse the winding, so the clone is
 * a true mirror with outward normals and an unscaled (1,1,1) transform. */
function mirrorGeometry(THREE: ThreeNS, geometry: BufferGeometry, axis: 'x' | 'z'): BufferGeometry {
  const clone = geometry.clone()
  clone.applyMatrix4(new THREE.Matrix4().makeScale(axis === 'x' ? -1 : 1, 1, axis === 'z' ? -1 : 1))
  const index = clone.getIndex()
  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      const first = index.getX(i)
      index.setX(i, index.getX(i + 2))
      index.setX(i + 2, first)
    }
    index.needsUpdate = true
  }
  else {
    for (const attribute of Object.values(clone.attributes)) {
      for (let i = 0; i + 2 < attribute.count; i += 3) {
        for (let c = 0; c < attribute.itemSize; c += 1) {
          const first = attribute.getComponent(i, c)
          attribute.setComponent(i, c, attribute.getComponent(i + 2, c))
          attribute.setComponent(i + 2, c, first)
        }
      }
      attribute.needsUpdate = true
    }
  }
  clone.computeBoundingBox()
  clone.computeBoundingSphere()
  return clone
}

export function mirrorPart(THREE: ThreeNS, registry: PartRegistry, part: Mesh, axis: 'x' | 'z'): Mesh {
  const material = part.material as Material
  const clone = new THREE.Mesh(mirrorGeometry(THREE, part.geometry, axis), material)
  const id = `${part.name}-mirror`
  clone.name = id
  clone.castShadow = part.castShadow
  clone.receiveShadow = part.receiveShadow
  clone.userData.sculptId = id
  clone.position.copy(part.position)
  clone.rotation.copy(part.rotation)
  if (axis === 'x') {
    clone.position.x = -part.position.x
    clone.rotation.y = -part.rotation.y
    clone.rotation.z = -part.rotation.z
  }
  else {
    clone.position.z = -part.position.z
    clone.rotation.x = -part.rotation.x
    clone.rotation.y = -part.rotation.y
  }
  registry.parts[id] = clone
  return clone
}

/** Drop `child` so its world-space bottom sits on the parent's world-space top. */
export function restOnObject(THREE: ThreeNS, child: Object3D, base: Object3D, overlap: number): Object3D {
  child.updateWorldMatrix(true, true)
  base.updateWorldMatrix(true, true)
  const childBox = new THREE.Box3().setFromObject(child)
  const baseBox = new THREE.Box3().setFromObject(base)
  if (childBox.isEmpty() || baseBox.isEmpty()) return child
  child.position.y += baseBox.max.y - overlap - childBox.min.y
  child.updateWorldMatrix(true, true)
  return child
}

export function createGroup(THREE: ThreeNS, id: string, children: Object3D[], o?: Placement): Group {
  const group = new THREE.Group()
  group.name = id
  for (const child of children) group.add(child)
  place(group, o)
  return group
}

export function createRoot(THREE: ThreeNS, registry: PartRegistry, children: Object3D[]): Group {
  const group = new THREE.Group()
  group.name = 'sculpt'
  for (const child of children) group.add(child)
  group.updateWorldMatrix(true, true)

  const box = new THREE.Box3().setFromObject(group)
  if (!box.isEmpty()) {
    const offsetX = -(box.min.x + box.max.x) / 2
    const offsetZ = -(box.min.z + box.max.z) / 2
    const offsetY = -box.min.y
    for (const child of group.children) {
      child.position.x += offsetX
      child.position.y += offsetY
      child.position.z += offsetZ
    }
    group.updateWorldMatrix(true, true)
  }

  group.userData.sculpt = { parts: registry.parts }
  return group
}
