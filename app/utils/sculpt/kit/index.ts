/**
 * Sculpt kit — runtime. The object returned here is the entire surface a
 * generated `createModel(kit, THREE, options)` may touch; `kit.d.ts` is the
 * hand-written contract for the same object and is rendered into the model
 * prompt by `scripts/kit-api.ts`. The two must stay in step — the runtime is
 * typed as `Kit`, so a drift on either side is a type error.
 */

import {
  bentTubeGeometry,
  cylinderGeometry,
  extrudeGeometry,
  latheGeometry,
  pillowGeometry,
  sweepGeometry,
  TESSELLATION,
  tubeGeometry,
} from './geometry'
import { createMaterials, mulberry32 } from './materials'
import { buttonGeometry, seamGeometry, tuftGeometry } from './surface'
import { printMaterial } from './print'
import { createGroup, createPart, createRoot, ensureUv1, mirrorPart, restOnObject } from './assembly'
import type { PartRegistry } from './assembly'
import type { Kit } from './kit'

export type { Kit, KitOptions, V3 } from './kit'
export { TESSELLATION } from './geometry'

export const createKit: typeof import('./kit').createKit = function createKit(THREE, options, canvasFactory) {
  const tess = TESSELLATION[options.quality] ?? TESSELLATION.standard
  const textureSize = options.textureSize ?? 1024
  const random = mulberry32(options.seed ?? 1)
  const registry: PartRegistry = { parts: {} }
  const materials = createMaterials(THREE, canvasFactory, textureSize, random)

  const kit: Kit = {
    box(w, h, d) {
      return new THREE.BoxGeometry(w, h, d)
    },
    roundedBox(w, h, d, radius) {
      return pillowGeometry(THREE, w, h, d, radius, 0, tess.pillow)
    },
    pillow(w, h, d, o) {
      return pillowGeometry(THREE, w, h, d, o?.radius ?? 0.06, o?.bulge ?? 0.02, tess.pillow)
    },
    cylinder(radius, height, o) {
      return cylinderGeometry(THREE, tess, radius, height, o?.topRadius ?? radius, o?.edge ?? 0)
    },
    capsule(radius, length) {
      return new THREE.CapsuleGeometry(radius, length, tess.cap, tess.radial)
    },
    torus(radius, tube, o) {
      // three builds a torus in XY; furniture hoops, rings and handles sit flat.
      return new THREE.TorusGeometry(radius, tube, tess.cap, tess.radial, o?.arc ?? Math.PI * 2)
        .rotateX(-Math.PI / 2)
    },
    tube(points, radius, o) {
      return tubeGeometry(THREE, tess, points, radius, o?.closed ?? false, o?.tension ?? 0.5)
    },
    bentTube(points, radius, cornerRadius) {
      return bentTubeGeometry(THREE, tess, points, radius, cornerRadius)
    },
    sweep(points, radius, o) {
      return sweepGeometry(THREE, tess, points, radius, o?.segments ?? tess.curve)
    },
    lathe(profile, o) {
      return latheGeometry(THREE, profile, o?.segments ?? tess.radial)
    },
    extrude(shape, depth, o) {
      return extrudeGeometry(THREE, tess, shape, depth, o?.bevel ?? 0, o?.holes ?? [])
    },
    instanced(geometry, material, transforms) {
      ensureUv1(geometry)
      const mesh = new THREE.InstancedMesh(geometry, material, transforms.length)
      mesh.castShadow = true
      mesh.receiveShadow = true
      const matrix = new THREE.Matrix4()
      const position = new THREE.Vector3()
      const quaternion = new THREE.Quaternion()
      const euler = new THREE.Euler()
      const scale = new THREE.Vector3()
      for (let i = 0; i < transforms.length; i += 1) {
        const transform = transforms[i]
        if (!transform) continue
        position.set(transform.position[0], transform.position[1], transform.position[2])
        const rotation = transform.rotation ?? [0, 0, 0]
        euler.set(rotation[0], rotation[1], rotation[2])
        quaternion.setFromEuler(euler)
        const s = transform.scale ?? 1
        scale.set(s, s, s)
        mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale))
      }
      mesh.instanceMatrix.needsUpdate = true
      return mesh
    },
    seam(geometry, from, to, o) {
      return seamGeometry(THREE, geometry, from, to, o?.width ?? 0.01, o?.depth ?? 0.004)
    },
    piping(points, radius) {
      return tubeGeometry(THREE, tess, points, radius, false, 0.5)
    },
    button(radius, o) {
      return buttonGeometry(THREE, radius, o?.depth ?? 0.005, tess.radial, Math.max(3, Math.round(tess.cap / 2)))
    },
    tuft(geometry, grid) {
      return tuftGeometry(THREE, geometry, grid.nx, grid.ny, grid.depth)
    },
    fabric: materials.fabric,
    leather: materials.leather,
    wood: materials.wood,
    paintedMetal: materials.paintedMetal,
    brushedMetal: materials.brushedMetal,
    plastic: materials.plastic,
    glass: materials.glass,
    print(o) {
      return printMaterial(THREE, canvasFactory, options.photo ?? null, textureSize, o)
    },
    part(id, geometry, material, o) {
      return createPart(THREE, registry, id, geometry, material, o)
    },
    mirror(part, axis) {
      return mirrorPart(THREE, registry, part, axis ?? 'x')
    },
    restOn(child, parent, overlap) {
      return restOnObject(THREE, child, parent, overlap ?? 0)
    },
    group(id, children, o) {
      return createGroup(THREE, id, children, o)
    },
    root(children) {
      return createRoot(THREE, registry, children)
    },
    random,
  }

  return kit
}
