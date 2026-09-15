import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js'
import { distanceToEdge, type ReliefMask } from './relief'
import { sampleNear, type DepthMap } from './depth'

/**
 * Carve: the volume that fits inside every silhouette there is, seen from where each photo was
 * actually taken.
 *
 * A product photo is rarely frontal. Extruding its outline straight back tilts the top, skews
 * the legs and smears the texture along the depth. Instead every view is an orthographic camera
 * with a yaw and a pitch, its outline becomes a signed distance field in that camera's plane,
 * and a voxel is inside when it is inside every field. Two more constraints make one photo
 * enough for most objects: the mirror view (products are left–right symmetric, so the same
 * outline seen from −yaw is a second silhouette for free) and the object's box (width from the
 * silhouette and the chosen depth), which clips the rhombus two oblique prisms would leave.
 * A side or top photo replaces the guessed depth with a measured one. The fields meet in a
 * smooth minimum, marching cubes pulls the surface out, and `paintHull` colours every vertex
 * from the photo whose camera faced it.
 *
 * Camera conventions: yaw 0 is straight in front (+z), +90 is at the object's right (+x);
 * pitch is the elevation above the horizon. Images: columns run along the camera's right
 * vector, rows down. A side photo shot from the object's left is yaw −90 (its front on the
 * right); a top photo with the front at the bottom is pitch 90, yaw 0.
 */
export type ViewSource = 'front' | 'side' | 'top'

export interface HullView {
  mask: ReliefMask
  source: ViewSource
  /** Camera yaw about +y in degrees. */
  yaw: number
  /** Camera elevation in degrees. */
  pitch: number
  /** Sample the outline mirrored left↔right: the symmetric twin of a photo. */
  mirror?: boolean
  /** Front only: the photo's relief (1 nearest .. 0 farthest), aligned to `mask`'s raster. Carved with `HullOptions.depth`. */
  depth?: DepthMap
}

export interface HullOptions {
  /** Cells along the longest side of the box; the mesh has ~6·r² triangles. */
  resolution: number
  /** Fillet radius where constraints meet, as a share of the smallest half-extent (0..1). */
  roundness: number
  /** Depth as a share of the width when neither a side nor a top photo measures it. */
  depthRatio: number
  /** Add the front photo's mirror view (left–right symmetric object). */
  symmetric: boolean
  /** Laplacian smoothing passes over the marched surface (0 keeps the raw voxel staircase). */
  smoothing?: number
  /**
   * Smoothing of each outline before it carves, as a share of the outline's longer side (0 keeps
   * the traced polygon, pixel steps and all; every step would otherwise extrude into a ridge).
   */
  outlineSmoothing?: number
  /** 0..1: how deep the front photo's depth map cuts behind the near surface. Default 1; 0 adds no term. */
  depth?: number
}

/** One camera the hull can be painted from. */
export interface PaintFrame {
  source: ViewSource
  /** Camera right, up and direction (object → camera) unit vectors. */
  r: [number, number, number]
  up: [number, number, number]
  d: [number, number, number]
  /** Raster column/row of the world origin, raster px per model unit, raster size. */
  c0: number
  r0: number
  s: number
  rw: number
  rh: number
  mirror: boolean
}

export interface HullData {
  /** Non-indexed triangles, in units where the model is exactly 1 wide, centred on the origin. */
  positions: Float32Array
  normals: Float32Array
  /** Box size in the same units: [1, height/width, depth/width]. */
  size: [number, number, number]
  /** Model units (front-raster px) per normalised unit: multiply positions by it to sample frames. */
  unit: number
  frames: PaintFrame[]
}

const RASTER = 320
const MARGIN = 2
const DEG = Math.PI / 180

interface Field {
  sdf: Float32Array
  w: number
  h: number
  /** Silhouette box in raster px. */
  bx: number
  by: number
  bw: number
  bh: number
}

/** Even-odd scanline fill of the mask's rings into a w×h grid (no canvas: runs anywhere). */
export function fillMask(mask: ReliefMask, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  const kx = w / mask.width, ky = h / mask.height
  const xs: number[] = []
  for (let y = 0; y < h; y++) {
    const sy = y + 0.5
    xs.length = 0
    for (const poly of mask.polygons) {
      for (const ring of [poly.exterior, ...poly.holes]) {
        for (let i = 0, n = ring.length; i < n; i++) {
          const [x0, y0] = ring[i]!, [x1, y1] = ring[(i + 1) % n]!
          const ay = y0 * ky, by = y1 * ky
          if ((sy >= ay) === (sy >= by)) continue
          xs.push((x0 + ((sy - ay) / (by - ay)) * (x1 - x0)) * kx)
        }
      }
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(xs[i]! - 0.5)), to = Math.min(w - 1, Math.floor(xs[i + 1]! - 0.5))
      for (let x = from; x <= to; x++) out[y * w + x] = 1
    }
  }
  return out
}

/**
 * Signed distance to the outline in raster px: positive inside, negative outside. The pixel
 * transform is a staircase near the edge, and along the depth every step would become a ridge,
 * so within a few px of the outline the exact distance to the polygon is used.
 */
function fieldFor(raw: ReliefMask, outlineSmoothing = 0.012): Field {
  const mask = smoothOutline(raw, outlineSmoothing)
  const k = RASTER / Math.max(mask.width, mask.height)
  const w = Math.max(4, Math.round(mask.width * k)), h = Math.max(4, Math.round(mask.height * k))
  const grid = fillMask(mask, w, h)
  const inv = new Uint8Array(grid.length)
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let i = 0; i < grid.length; i++) {
    inv[i] = grid[i] ? 0 : 1
    if (!grid[i]) continue
    const x = i % w, y = (i / w) | 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX < 0) throw new Error('A view has no outline to carve with.')
  const din = distanceToEdge(grid, w, h), dout = distanceToEdge(inv, w, h)
  const sdf = new Float32Array(grid.length)
  for (let i = 0; i < sdf.length; i++) sdf[i] = din[i]! - dout[i]!
  const segs: number[] = []
  for (const poly of mask.polygons) {
    for (const ring of [poly.exterior, ...poly.holes]) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const [x0, y0] = ring[i]!, [x1, y1] = ring[(i + 1) % n]!
        segs.push(x0 * k, y0 * k, x1 * k, y1 * k)
      }
    }
  }
  const BAND = 4
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (Math.abs(sdf[i]!) > BAND) continue
    const px = x + 0.5, py = y + 0.5
    let best = Infinity
    for (let s = 0; s < segs.length; s += 4) {
      const ax = segs[s]!, ay = segs[s + 1]!, bx = segs[s + 2]!, by = segs[s + 3]!
      const vx = bx - ax, vy = by - ay
      const l2 = vx * vx + vy * vy || 1e-9
      const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2))
      const dx = px - (ax + t * vx), dy = py - (ay + t * vy)
      const d2 = dx * dx + dy * dy
      if (d2 < best) best = d2
    }
    sdf[i] = (grid[i] ? 1 : -1) * Math.sqrt(best)
  }
  return { sdf, w, h, bx: minX, by: minY, bw: maxX - minX + 1, bh: maxY - minY + 1 }
}

/** Bilinear sample of a field at raster coordinates, clamped to the raster. */
function sample(f: Field, u: number, v: number): number {
  const x = Math.min(f.w - 1.001, Math.max(0, u)), y = Math.min(f.h - 1.001, Math.max(0, v))
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0
  const i = y0 * f.w + x0
  const a = f.sdf[i]!, b = f.sdf[i + 1]!, c = f.sdf[i + f.w]!, d = f.sdf[i + f.w + 1]!
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
}

/** Polynomial smooth minimum: `min(a, b)` with a fillet of radius ~k where they cross. */
function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/** Camera basis for a yaw/pitch: right, up and the direction from the object to the camera. */
export function cameraBasis(yaw: number, pitch: number): { r: [number, number, number]; up: [number, number, number]; d: [number, number, number] } {
  const cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG), cp = Math.cos(pitch * DEG), sp = Math.sin(pitch * DEG)
  const d: [number, number, number] = [sy * cp, sp, cy * cp]
  const r: [number, number, number] = [cy, 0, -sy]
  // up = d × r
  const up: [number, number, number] = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]]
  return { r, up, d }
}

interface Placed {
  view: HullView
  field: Field
  basis: ReturnType<typeof cameraBasis>
  /** Raster px per model unit. */
  s: number
  /** Raster column/row of the world origin. */
  c0: number
  r0: number
}

/** The carve before meshing: box, placed views and the distance field, for the mesher and for tests. */
export interface Carve {
  W: number
  H: number
  D: number
  placed: Placed[]
  /** Signed distance of one constraint at a point: index 0 is the box, then the views in order. */
  part: (index: number, x: number, y: number, z: number) => number
  field: (x: number, y: number, z: number) => number
}

export function prepareCarve(views: HullView[], opts: HullOptions): Carve {
  const front = views.find(v => v.source === 'front')
  if (!front) throw new Error('The front outline is required.')
  const side = views.find(v => v.source === 'side') ?? null
  const top = views.find(v => v.source === 'top') ?? null
  const F = fieldFor(front.mask, opts.outlineSmoothing)
  const S = side ? fieldFor(side.mask, opts.outlineSmoothing) : null
  const T = top ? fieldFor(top.mask, opts.outlineSmoothing) : null

  // Model units are front-raster px. The front silhouette measures W cosθ + D sinθ across and
  // H cosφ + D sinφ down (a box seen from yaw θ, pitch φ); the depth comes from a side or top
  // photo when there is one, else from the ratio, and W and H follow.
  const cy = Math.cos(front.yaw * DEG), sy = Math.abs(Math.sin(front.yaw * DEG))
  const cp = Math.cos(front.pitch * DEG), sp = Math.abs(Math.sin(front.pitch * DEG))
  let W: number, D: number
  if (S) {
    // Side silhouette: its height is H, its width is D (both in its own px).
    const Hs = Math.max(1, (F.bh - 0) * 1)
    // First guess H from the front box, then scale the side view by it.
    const Hguess = Hs / cp
    const sSide = S.bh / Hguess
    D = S.bw / sSide
    W = Math.max(F.bw * 0.2, (F.bw - D * sy) / Math.max(cy, 0.2))
  } else if (T) {
    const ratio = T.bh / T.bw
    W = F.bw / (cy + ratio * sy)
    D = W * ratio
  } else {
    W = F.bw / (cy + opts.depthRatio * sy)
    D = W * opts.depthRatio
  }
  const H = Math.max(F.bh * 0.3, (F.bh - D * sp) / Math.max(cp, 0.2))

  const place = (view: HullView, field: Field, s: number): Placed => ({
    view, field, basis: cameraBasis(view.yaw, view.pitch), s,
    c0: field.bx + field.bw / 2, r0: field.by + field.bh / 2,
  })
  const placed: Placed[] = [place(front, F, 1)]
  if (opts.symmetric) placed.push(place({ ...front, yaw: -front.yaw, mirror: !front.mirror }, F, 1))
  if (S && side) placed.push(place(side, S, S.bh / H))
  if (T && top) placed.push(place(top, T, T.bw / W))

  const k = opts.roundness * 0.5 * Math.min(W, H, D)
  const strength = opts.depth ?? 1
  const viewDistance = (p: Placed, x: number, y: number, z: number): number => {
    const { r, up } = p.basis
    const u = x * r[0] + y * r[1] + z * r[2]
    const v = x * up[0] + y * up[1] + z * up[2]
    const col = p.c0 + (p.view.mirror ? -u : u) * p.s
    const row = p.r0 - v * p.s
    return sample(p.field, col, row) / p.s
  }
  // Behind the near surface the depth map describes, along this view's camera axis. `t` is the
  // point's coordinate toward the camera; the map's 1 (nearest) sits on the box's front plane and
  // its 0 (farthest) `strength` of the way to the back plane. Positive = behind = kept.
  const depthDistance = (p: Placed, map: DepthMap, x: number, y: number, z: number): number => {
    const { r, up, d } = p.basis
    const u = x * r[0] + y * r[1] + z * r[2]
    const v = x * up[0] + y * up[1] + z * up[2]
    const t = x * d[0] + y * d[1] + z * d[2]
    const col = (p.c0 + (p.view.mirror ? -u : u) * p.s) * (map.w / p.field.w)
    const row = (p.r0 - v * p.s) * (map.h / p.field.h)
    const near = sampleNear(map, col, row)
    const tMax = (W * Math.abs(d[0]) + H * Math.abs(d[1]) + D * Math.abs(d[2])) / 2
    const tS = tMax - (1 - near) * 2 * tMax * strength
    return tS - t
  }
  const box = (x: number, y: number, z: number) => Math.min(W / 2 - Math.abs(x), H / 2 - Math.abs(y), D / 2 - Math.abs(z))
  const field = (x: number, y: number, z: number): number => {
    // The object's box first, then every silhouette, then the depth behind each view that has one.
    let d = box(x, y, z)
    for (const p of placed) d = smin(d, viewDistance(p, x, y, z), k)
    if (strength > 0) for (const p of placed) if (p.view.depth) d = smin(d, depthDistance(p, p.view.depth, x, y, z), k)
    return d
  }
  const part = (index: number, x: number, y: number, z: number) => (index === 0 ? box(x, y, z) : viewDistance(placed[index - 1]!, x, y, z))
  return { W, H, D, placed, part, field }
}

export function buildHull(views: HullView[], opts: HullOptions): HullData {
  const { W, H, D, placed, field } = prepareCarve(views, opts)

  // Voxel grid with a margin of empty cells so the surface always closes.
  const cell = Math.max(W, H, D) / opts.resolution
  const nx = Math.ceil(W / cell) + 2 * MARGIN + 1, ny = Math.ceil(H / cell) + 2 * MARGIN + 1, nz = Math.ceil(D / cell) + 2 * MARGIN + 1
  const ox = -W / 2 - MARGIN * cell, oy = -H / 2 - MARGIN * cell, oz = -D / 2 - MARGIN * cell
  const grid = new Float32Array(nx * ny * nz)
  const at = (i: number, j: number, l: number) => (l * ny + j) * nx + i
  for (let l = 0; l < nz; l++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    grid[at(i, j, l)] = field(ox + i * cell, oy + j * cell, oz + l * cell)
  }
  const grad = (i: number, j: number, l: number, out: number[]) => {
    const ci = Math.min(nx - 2, Math.max(1, i)), cj = Math.min(ny - 2, Math.max(1, j)), cl = Math.min(nz - 2, Math.max(1, l))
    out[0] = grid[at(ci - 1, cj, cl)]! - grid[at(ci + 1, cj, cl)]!
    out[1] = grid[at(ci, cj - 1, cl)]! - grid[at(ci, cj + 1, cl)]!
    out[2] = grid[at(ci, cj, cl - 1)]! - grid[at(ci, cj, cl + 1)]!
  }

  const positions: number[] = []
  const normals: number[] = []
  const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] as const
  const EDGE = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const
  const vals = new Float32Array(8)
  const vert = new Float32Array(12 * 3), norm = new Float32Array(12 * 3)
  const ga = [0, 0, 0], gb = [0, 0, 0]
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let l = 0; l < nz - 1; l++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let index = 0
    for (let c = 0; c < 8; c++) {
      const [dx, dy, dz] = CORNER[c]!
      vals[c] = grid[at(i + dx, j + dy, l + dz)]!
      if (vals[c]! > 0) index |= 1 << c
    }
    const bits = edgeTable[index]!
    if (bits === 0) continue
    for (let e = 0; e < 12; e++) {
      if (!(bits & (1 << e))) continue
      const [a, b] = EDGE[e]!
      const va = vals[a]!, vb = vals[b]!
      const mu = Math.abs(vb - va) < 1e-9 ? 0.5 : va / (va - vb)
      const ca = CORNER[a]!, cb = CORNER[b]!
      vert[e * 3] = ox + (i + ca[0] + (cb[0] - ca[0]) * mu) * cell
      vert[e * 3 + 1] = oy + (j + ca[1] + (cb[1] - ca[1]) * mu) * cell
      vert[e * 3 + 2] = oz + (l + ca[2] + (cb[2] - ca[2]) * mu) * cell
      grad(i + ca[0], j + ca[1], l + ca[2], ga)
      grad(i + cb[0], j + cb[1], l + cb[2], gb)
      const gx = ga[0]! + (gb[0]! - ga[0]!) * mu, gy = ga[1]! + (gb[1]! - ga[1]!) * mu, gz = ga[2]! + (gb[2]! - ga[2]!) * mu
      const len = Math.hypot(gx, gy, gz) || 1
      norm[e * 3] = gx / len; norm[e * 3 + 1] = gy / len; norm[e * 3 + 2] = gz / len
    }
    const row = index * 16
    for (let t = 0; t < 16 && triTable[row + t]! !== -1; t += 3) {
      const e0 = triTable[row + t]!, e1 = triTable[row + t + 1]!, e2 = triTable[row + t + 2]!
      const ax = vert[e1 * 3]! - vert[e0 * 3]!, ay = vert[e1 * 3 + 1]! - vert[e0 * 3 + 1]!, az = vert[e1 * 3 + 2]! - vert[e0 * 3 + 2]!
      const bx = vert[e2 * 3]! - vert[e0 * 3]!, by = vert[e2 * 3 + 1]! - vert[e0 * 3 + 1]!, bz = vert[e2 * 3 + 2]! - vert[e0 * 3 + 2]!
      const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx
      const flip = fx * norm[e0 * 3]! + fy * norm[e0 * 3 + 1]! + fz * norm[e0 * 3 + 2]! < 0
      for (const e of flip ? [e0, e2, e1] : [e0, e1, e2]) {
        const px = vert[e * 3]!, py = vert[e * 3 + 1]!, pz = vert[e * 3 + 2]!
        positions.push(px, py, pz)
        normals.push(norm[e * 3]!, norm[e * 3 + 1]!, norm[e * 3 + 2]!)
        if (px < minX) minX = px; if (px > maxX) maxX = px
        if (py < minY) minY = py; if (py > maxY) maxY = py
        if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz
      }
    }
  }
  if (!positions.length) throw new Error('The outlines leave no volume to carve.')

  const pos = new Float32Array(positions)
  const nrm = new Float32Array(normals)
  smoothSurface(pos, nrm, cell, opts.smoothing ?? 2)

  // Normalise by the carved width and centre on the carved box. Frames keep the carve's own
  // origin, so `unit` and `offset` take a normalised vertex back into it.
  minX = minY = minZ = Infinity; maxX = maxY = maxZ = -Infinity
  for (let p = 0; p < pos.length; p += 3) {
    const px = pos[p]!, py = pos[p + 1]!, pz = pos[p + 2]!
    if (px < minX) minX = px; if (px > maxX) maxX = px
    if (py < minY) minY = py; if (py > maxY) maxY = py
    if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz
  }
  const cw = maxX - minX || 1
  const cx = (minX + maxX) / 2, cyy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2
  for (let p = 0; p < pos.length; p += 3) {
    pos[p] = (pos[p]! - cx) / cw
    pos[p + 1] = (pos[p + 1]! - cyy) / cw
    pos[p + 2] = (pos[p + 2]! - cz) / cw
  }
  const frames: PaintFrame[] = placed.map(p => ({
    source: p.view.source, r: p.basis.r, up: p.basis.up, d: p.basis.d,
    // Origin shifted to the carved centre so paint can multiply by `unit` and go.
    c0: p.c0 + (p.view.mirror ? -1 : 1) * (cx * p.basis.r[0] + cyy * p.basis.r[1] + cz * p.basis.r[2]) * p.s,
    r0: p.r0 - (cx * p.basis.up[0] + cyy * p.basis.up[1] + cz * p.basis.up[2]) * p.s,
    s: p.s, rw: p.field.w, rh: p.field.h, mirror: !!p.view.mirror,
  }))
  return {
    positions: pos,
    normals: nrm,
    size: [1, (maxY - minY) / cw, (maxZ - minZ) / cw],
    unit: cw,
    frames,
  }
}

/**
 * Which side of the object the camera stood on, from the outline alone. Shot from above, the
 * far end of a box appears higher in the picture than the near end, so a top edge that rises
 * toward the right means the right end is far: the camera stood on the left. Returns −1 for
 * left, +1 for right, 0 when the edge is level (a frontal shot).
 */
export function estimateCameraSide(mask: ReliefMask): -1 | 0 | 1 {
  const w = 200, h = Math.max(4, Math.round((200 * mask.height) / mask.width))
  const g = fillMask(mask, w, h)
  let minX = w, maxX = -1
  for (let i = 0; i < g.length; i++) if (g[i]) { const x = i % w; if (x < minX) minX = x; if (x > maxX) maxX = x }
  if (maxX - minX < 8) return 0
  const span = maxX - minX
  const topAt = (x0: number, x1: number) => {
    // Mean topmost row over a band of columns; NaN-free because the band is inside the box.
    let sum = 0, n = 0
    for (let x = x0; x <= x1; x++) {
      for (let y = 0; y < h; y++) if (g[y * w + x]) { sum += y; n++; break }
    }
    return n ? sum / n : h
  }
  const left = topAt(minX + Math.round(span * 0.08), minX + Math.round(span * 0.28))
  const right = topAt(maxX - Math.round(span * 0.28), maxX - Math.round(span * 0.08))
  const tilt = (left - right) / span
  if (Math.abs(tilt) < 0.012) return 0
  // Right end higher (smaller row) → right is far → camera on the left.
  return right < left ? -1 : 1
}

/** A photo the hull can be painted from: pixels covering the same region as its mask raster. */
export interface HullPaintView {
  data: { width: number; height: number; data: Uint8ClampedArray }
  /** 1 where a pixel is inside the view's outline (same size as `data`); samples outside are refused. */
  inside?: Uint8Array
}

/** sRGB byte → linear, for vertex colours (three reads the colour attribute as linear). */
const LIN = new Float32Array(256)
for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }

/** Slot order of the per-view attributes: front, side, top. */
export const VIEW_SLOTS: ViewSource[] = ['front', 'side', 'top']

export interface HullPaint {
  /** Linear RGB per vertex: the blended photo sample, or the object's mean colour where no camera saw it. */
  colors: Float32Array
  /**
   * Per vertex, how much each photo (front, side, top) covers it, normalised to sum to 1 where
   * any camera saw it and 0 elsewhere. The shader blends the photos by these and falls back to
   * `colors` for the rest, so unseen faces fade to the mean colour instead of a seam.
   */
  weights: Float32Array
  /** Per vertex, texture coordinates into each photo (u right, v up, three's flipY canvases): 3 × vec2. */
  uvs: Float32Array
}

/**
 * Project every vertex into the cameras: a vertex takes each photo in proportion to how squarely
 * that camera faced it (cosine squared), so a face the front camera saw obliquely and the side
 * camera saw square-on leans on the side photo. Faces no camera saw (the back) borrow through
 * the object from the camera behind them, faintly weighted, so nothing is left unpainted.
 *
 * The result carries both a colour (for export and as a fallback) and, per photo, the texture
 * coordinate and weight, so the renderer can sample the photos at full resolution.
 */
export function projectHull(hull: HullData, photos: Record<ViewSource, HullPaintView | null>): HullPaint {
  const { positions: P, normals: N, frames, unit } = hull
  const n = P.length / 3
  const colors = new Float32Array(P.length)
  const weights = new Float32Array(n * 3)
  const uvs = new Float32Array(n * 6)
  const painted = new Uint8Array(n)
  const confidence = new Float32Array(n)
  const usable = frames.filter(f => photos[f.source])
  const rgb = new Float32Array(3)
  /** Sample a view; false when the pixel (or its 2 px neighbourhood) is outside the outline. */
  const pick = (photo: HullPaintView, f: PaintFrame, col: number, row: number): boolean => {
    const W = photo.data.width, Hh = photo.data.height
    const x = Math.min(W - 1, Math.max(0, Math.round((col / f.rw) * W)))
    const y = Math.min(Hh - 1, Math.max(0, Math.round((row / f.rh) * Hh)))
    const inside = photo.inside
    if (inside) {
      // Anti-aliased edge pixels blend toward the page: stay 2 px clear of the outline.
      const m = Math.max(2, Math.round(W / 300))
      if (!inside[y * W + x] || !inside[y * W + Math.max(0, x - m)] || !inside[y * W + Math.min(W - 1, x + m)]
        || !inside[Math.max(0, y - m) * W + x] || !inside[Math.min(Hh - 1, y + m) * W + x]) return false
    }
    const p = (y * W + x) * 4
    rgb[0] = LIN[photo.data.data[p]!]!; rgb[1] = LIN[photo.data.data[p + 1]!]!; rgb[2] = LIN[photo.data.data[p + 2]!]!
    return true
  }
  const best = new Float32Array(3)
  // A mirrored view is the same photo flipped: it may only paint what its real camera cannot
  // see (the far side of a symmetric object). Where both see a face, letting them compete makes
  // the winner flip from vertex to vertex along every crease, and the flip is a colour step.
  const realOf = usable.map(f => (f.mirror ? usable.find(g => g.source === f.source && !g.mirror) ?? null : null))
  let mr = 0, mg = 0, mb = 0, mn = 0
  for (let i = 0, v = 0; i < P.length; i += 3, v++) {
    const x = P[i]! * unit, y = P[i + 1]! * unit, z = P[i + 2]! * unit
    const nx = N[i]!, ny = N[i + 1]!, nz = N[i + 2]!
    let r = 0, g = 0, b = 0, sum = 0, squarest = 0
    best.fill(0)
    for (let fi = 0; fi < usable.length; fi++) {
      const f = usable[fi]!
      const facing = nx * f.d[0] + ny * f.d[1] + nz * f.d[2]
      let w = facing > 0 ? facing * facing : 0.03 * facing * facing
      const real = realOf[fi]
      if (real) w *= 1 - smoothstep(0, 0.25, nx * real.d[0] + ny * real.d[1] + nz * real.d[2])
      if (w < 1e-4) continue
      const u = x * f.r[0] + y * f.r[1] + z * f.r[2]
      const up = x * f.up[0] + y * f.up[1] + z * f.up[2]
      const col = f.c0 + (f.mirror ? -u : u) * f.s, row = f.r0 - up * f.s
      if (!pick(photos[f.source]!, f, col, row)) continue
      r += rgb[0]! * w; g += rgb[1]! * w; b += rgb[2]! * w; sum += w
      squarest = Math.max(squarest, Math.abs(facing))
      const slot = VIEW_SLOTS.indexOf(f.source)
      weights[v * 3 + slot] = weights[v * 3 + slot]! + w
      // A photo and its mirror share one texture: the coordinate follows whichever faces the vertex more.
      if (w > best[slot]!) {
        best[slot] = w
        uvs[v * 6 + slot * 2] = col / f.rw
        uvs[v * 6 + slot * 2 + 1] = 1 - row / f.rh
      }
    }
    if (sum > 0) {
      colors[i] = r / sum; colors[i + 1] = g / sum; colors[i + 2] = b / sum
      // A face every camera saw only at a grazing angle (a desk top from a near-level camera) is
      // a few photo pixels stretched over its whole depth: let it fade toward the mean colour.
      // The back, borrowed square-on through the object, keeps its photo. The band ends well
      // under 0.5: a side face in a three-quarter photo sits at exactly cos 30° ≈ 0.5, and a
      // fade edge running through it snaps to the voxel grid as a staircase of colour.
      const seen = smoothstep(0.12, 0.3, squarest)
      for (let k = 0; k < 3; k++) weights[v * 3 + k] = (weights[v * 3 + k]! / sum) * seen
      painted[v] = 1
      confidence[v] = seen
      // The fallback colour comes from the well-seen faces, so a grazing band cannot tint it.
      mr += colors[i]! * seen; mg += colors[i + 1]! * seen; mb += colors[i + 2]! * seen; mn += seen
    }
  }
  // Faces no photo shows (an underside, the inside of an arch) take the object's mean colour.
  if (mn) {
    mr /= mn; mg /= mn; mb /= mn
    for (let i = 0; i < P.length; i += 3) {
      const c = painted[i / 3] ? confidence[i / 3]! : 0
      colors[i] = mr + (colors[i]! - mr) * c; colors[i + 1] = mg + (colors[i + 1]! - mg) * c; colors[i + 2] = mb + (colors[i + 2]! - mb) * c
    }
  }
  return { colors, weights, uvs }
}

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** Per-vertex colours only; see `projectHull`. */
export function paintHull(hull: HullData, photos: Record<ViewSource, HullPaintView | null>): Float32Array {
  return projectHull(hull, photos).colors
}

/**
 * Marching cubes leaves the surface faceted at the cell size and, where a silhouette edge runs
 * at an angle to the grid, staircased. Weld the triangle soup by position, run a few Laplacian
 * passes (each vertex halfway to its neighbours. mean: a vertex never leaves the silhouette, the
 * hull only tightens by a fraction of a cell at its corners, which a visual hull can spare) and
 * take the vertex normals from the smoothed faces. In place; `cell` sets the weld tolerance.
 */
export function smoothSurface(pos: Float32Array, nrm: Float32Array, cell: number, passes: number): void {
  const n = pos.length / 3
  if (!n || passes <= 0) return
  const q = cell * 1e-3
  const ids = new Int32Array(n)
  const map = new Map<string, number>()
  const ux: number[] = [], uy: number[] = [], uz: number[] = []
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!
    const key = `${Math.round(x / q)},${Math.round(y / q)},${Math.round(z / q)}`
    let id = map.get(key)
    if (id === undefined) { id = ux.length; map.set(key, id); ux.push(x); uy.push(y); uz.push(z) }
    ids[i] = id
  }
  const m = ux.length
  const adj: number[][] = Array.from({ length: m }, () => [])
  const link = (a: number, b: number) => { if (a !== b && !adj[a]!.includes(b)) { adj[a]!.push(b); adj[b]!.push(a) } }
  for (let t = 0; t < n; t += 3) {
    const a = ids[t]!, b = ids[t + 1]!, c = ids[t + 2]!
    link(a, b); link(b, c); link(c, a)
  }
  const step = (k: number) => {
    const nx = new Float64Array(m), ny = new Float64Array(m), nz = new Float64Array(m)
    for (let v = 0; v < m; v++) {
      const nb = adj[v]!
      if (!nb.length) { nx[v] = ux[v]!; ny[v] = uy[v]!; nz[v] = uz[v]!; continue }
      let sx = 0, sy = 0, sz = 0
      for (const w of nb) { sx += ux[w]!; sy += uy[w]!; sz += uz[w]! }
      nx[v] = ux[v]! + k * (sx / nb.length - ux[v]!)
      ny[v] = uy[v]! + k * (sy / nb.length - uy[v]!)
      nz[v] = uz[v]! + k * (sz / nb.length - uz[v]!)
    }
    for (let v = 0; v < m; v++) { ux[v] = nx[v]!; uy[v] = ny[v]!; uz[v] = nz[v]! }
  }
  for (let i = 0; i < passes; i++) step(0.5)
  // Area-weighted vertex normals from the smoothed faces.
  const vn = new Float64Array(m * 3)
  for (let t = 0; t < n; t += 3) {
    const a = ids[t]!, b = ids[t + 1]!, c = ids[t + 2]!
    const abx = ux[b]! - ux[a]!, aby = uy[b]! - uy[a]!, abz = uz[b]! - uz[a]!
    const acx = ux[c]! - ux[a]!, acy = uy[c]! - uy[a]!, acz = uz[c]! - uz[a]!
    const fx = aby * acz - abz * acy, fy = abz * acx - abx * acz, fz = abx * acy - aby * acx
    for (const v of [a, b, c]) { vn[v * 3] = vn[v * 3]! + fx; vn[v * 3 + 1] = vn[v * 3 + 1]! + fy; vn[v * 3 + 2] = vn[v * 3 + 2]! + fz }
  }
  // Marching cubes normals wobble from cell to cell along a crease, and the paint reads the
  // normal to decide which photo saw a vertex, so a wobble becomes a stepped colour edge.
  // A few Laplacian passes over the normals settle them without moving a vertex.
  for (let i = 0; i < m; i++) {
    const len = Math.hypot(vn[i * 3]!, vn[i * 3 + 1]!, vn[i * 3 + 2]!) || 1
    vn[i * 3] = vn[i * 3]! / len; vn[i * 3 + 1] = vn[i * 3 + 1]! / len; vn[i * 3 + 2] = vn[i * 3 + 2]! / len
  }
  for (let pass = 0; pass < passes + 2; pass++) {
    const next = new Float64Array(m * 3)
    for (let v = 0; v < m; v++) {
      let x = vn[v * 3]!, y = vn[v * 3 + 1]!, z = vn[v * 3 + 2]!
      for (const w of adj[v]!) { x += vn[w * 3]!; y += vn[w * 3 + 1]!; z += vn[w * 3 + 2]! }
      const len = Math.hypot(x, y, z) || 1
      next[v * 3] = x / len; next[v * 3 + 1] = y / len; next[v * 3 + 2] = z / len
    }
    vn.set(next)
  }
  for (let i = 0; i < n; i++) {
    const v = ids[i]!
    pos[i * 3] = ux[v]!; pos[i * 3 + 1] = uy[v]!; pos[i * 3 + 2] = uz[v]!
    nrm[i * 3] = vn[v * 3]!; nrm[i * 3 + 1] = vn[v * 3 + 1]!; nrm[i * 3 + 2] = vn[v * 3 + 2]!
  }
}

/**
 * Round the pixel steps off a traced outline: each ring is resampled at one-pixel spacing and
 * box-filtered along its length over a window of `share` × the outline's longer side, so a
 * jagged edge becomes a fair curve while corners larger than the window survive.
 */
export function smoothOutline(mask: ReliefMask, share: number): ReliefMask {
  if (share <= 0) return mask
  const r = Math.max(1, Math.round(share * Math.max(mask.width, mask.height)))
  const smoothRing = (ring: [number, number][]): [number, number][] => {
    const n = ring.length
    if (n < 8) return ring
    // Resample at unit spacing along the closed ring.
    const pts: [number, number][] = []
    for (let i = 0; i < n; i++) {
      const [x0, y0] = ring[i]!, [x1, y1] = ring[(i + 1) % n]!
      const len = Math.hypot(x1 - x0, y1 - y0)
      const steps = Math.max(1, Math.round(len))
      for (let t = 0; t < steps; t++) pts.push([x0 + ((x1 - x0) * t) / steps, y0 + ((y1 - y0) * t) / steps])
    }
    const m = pts.length
    if (m < 2 * r + 4) return ring
    // Box filter over ±r samples via prefix sums on the doubled ring.
    const sx = new Float64Array(m + 1), sy = new Float64Array(m + 1)
    for (let i = 0; i < m; i++) { sx[i + 1] = sx[i]! + pts[i]![0]; sy[i + 1] = sy[i]! + pts[i]![1] }
    const sum = (a: number, b: number, acc: Float64Array) => {
      // Sum of samples a..b-1 with wrap-around.
      let t = 0
      while (a < 0) { a += m; b += m }
      const a0 = a % m, span = b - a
      if (a0 + span <= m) return acc[a0 + span]! - acc[a0]!
      t += acc[m]! - acc[a0]!
      t += acc[a0 + span - m]!
      return t
    }
    const out: [number, number][] = []
    const win = 2 * r + 1
    // Keep roughly one point per 2 px so the polygon stays light.
    const stride = 2
    for (let i = 0; i < m; i += stride) out.push([sum(i - r, i + r + 1, sx) / win, sum(i - r, i + r + 1, sy) / win])
    return out
  }
  return {
    ...mask,
    polygons: mask.polygons.map(poly => ({ ...poly, exterior: smoothRing(poly.exterior), holes: poly.holes.map(smoothRing) })),
  }
}
