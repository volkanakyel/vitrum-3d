# Monocular Depth Carve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carve the real relief of a product (seat, backrest, recesses) from one photo by running a monocular depth model in the browser and feeding its map into the existing visual-hull carve as one more signed-distance term.

**Architecture:** A new dedicated Web Worker owns `@huggingface/transformers` and runs Depth Anything V2 small (WebGPU + fp16, else WASM + q8). Pure array maths in `app/utils/depth.ts` normalises, pads and shrinks the map. `hull.ts` gains an optional `depth` map on the front `HullView` and a `depth` strength option; `prepareCarve` adds a "behind the near surface" term along the front camera axis, shared by the mirror view. `useStudio` runs depth after the silhouette hull is shown and rebuilds the hull when the map arrives; a Depth slider in the Views card scales the cut.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript (strict, `noUncheckedIndexedAccess`), vitest (node env, `~` → `app`), `@huggingface/transformers` ^4.2 (onnxruntime-web inside), pnpm.

**Spec:** `docs/superpowers/specs/2026-09-15-monocular-depth-design.md`

## Global Constraints

- No image ever leaves the browser. Only model weights are downloaded (public host, cached by the browser).
- Model id default: `onnx-community/depth-anything-v2-small`, from Nuxt runtime config `public.depthModel`.
- Device: `webgpu` when `navigator.gpu` exists, else `wasm`. dtype `fp16` on WebGPU, `q8` on WASM.
- Depth map: `near` in 0..1, 1 = nearest, aligned to the front trace raster, shrunk to ≤ 256 px on the long side.
- Depth term: `t = p·d`, `tMax = (W|dx| + H|dy| + D|dz|)/2`, `tS = tMax − (1 − near)·2·tMax·strength`, `term = tS − t`; not added at all when strength is 0.
- Depth applies to the front view and its mirror only. Side and top photos are untouched.
- `@huggingface/transformers` is imported only inside `app/workers/depth.worker.ts`.
- Model failure of any kind → hull stands, `depthState = 'unavailable'`, toast "Depth model unavailable; carved from outlines only".
- TypeScript: index reads are `T | undefined`; use `arr[i]!` where the index is known valid.
- Verify with `pnpm typecheck` (0 errors) and `pnpm test` (all pass) after every task.
- **Git note:** on this machine `git` is blocked until `sudo xcodebuild -license` is accepted. If a commit step fails with the Xcode licence message, skip the commit and continue; tell the user at the end which commits were skipped.

---

## File map

| File | Responsibility |
| --- | --- |
| `app/utils/depth.ts` (new) | Pure maths: `DepthMap`, `normaliseDepth`, `padDepth`, `shrinkDepth`, `sampleNear`. |
| `tests/depth.test.ts` (new) | Unit tests for the above. |
| `app/utils/hull.ts` | `HullView.depth`, `HullOptions.depth`, depth term in `prepareCarve`. |
| `tests/hull.test.ts` | Depth carve tests. |
| `app/workers/depth.worker.ts` (new) | Loads the model once, runs inference, post-processes with `depth.ts`. |
| `app/utils/depther.ts` (new) | Main-thread client for the worker (one in-flight job, newest wins). |
| `nuxt.config.ts` | `runtimeConfig.public.depthModel`, Vite `optimizeDeps.exclude`. |
| `app/composables/useStudio.ts` | `ViewOptions.depth`, depth state, `runDepth`, `runHull` wiring, watchers. |
| `app/pages/studio/[[mode]].vue` | Pass depth state props to the panel. |
| `app/components/studio/ControlPanel.vue` | Depth slider and status hint in the Views card. |

---

### Task 1: Depth map maths (`depth.ts`)

**Files:**
- Create: `app/utils/depth.ts`
- Test: `tests/depth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DepthMap { near: Float32Array; w: number; h: number }
  export function normaliseDepth(raw: Float32Array, w: number, h: number, mask: Uint8Array, clipPct?: number): Float32Array
  export function padDepth(near: Float32Array, w: number, h: number, mask: Uint8Array): void
  export function shrinkDepth(near: Float32Array, w: number, h: number, max: number): DepthMap
  export function sampleNear(map: DepthMap, col: number, row: number): number
  ```
  `mask` is a `w*h` Uint8Array, 1 inside the silhouette (same layout `rasterizeMask` in `relief.ts` returns).

- [ ] **Step 1: Write the failing tests**

`tests/depth.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { normaliseDepth, padDepth, sampleNear, shrinkDepth } from '~/utils/depth'

/** A w×h mask with a centred square inside. */
function square(w: number, h: number, inset: number): Uint8Array {
  const m = new Uint8Array(w * h)
  for (let y = inset; y < h - inset; y++) for (let x = inset; x < w - inset; x++) m[y * w + x] = 1
  return m
}

describe('normaliseDepth', () => {
  it('maps the inside to 0..1 with the nearest at 1 and leaves the outside at 0', () => {
    const w = 8, h = 8, mask = square(w, h, 2)
    const raw = new Float32Array(w * h)
    for (let i = 0; i < raw.length; i++) raw[i] = mask[i] ? 10 + (i % w) : 999
    const near = normaliseDepth(raw, w, h, mask, 0)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < near.length; i++) {
      if (mask[i]) { lo = Math.min(lo, near[i]!); hi = Math.max(hi, near[i]!) } else expect(near[i]).toBe(0)
    }
    expect(lo).toBeCloseTo(0, 6)
    expect(hi).toBeCloseTo(1, 6)
    // Bigger raw value = nearer = closer to 1.
    expect(near[3 * w + 5]!).toBeGreaterThan(near[3 * w + 2]!)
  })

  it('clips the percentile tails so one spike does not flatten the rest', () => {
    const w = 10, h = 10, mask = square(w, h, 0)
    // A ramp 0..99 with one spike: without clipping the ramp would be squashed into 0..0.1.
    const raw = new Float32Array(w * h)
    for (let i = 0; i < raw.length; i++) raw[i] = i
    raw[0] = 1000
    const near = normaliseDepth(raw, w, h, mask, 0.02)
    expect(near[0]).toBe(1)
    expect(Math.abs(near[50]! - 0.5)).toBeLessThan(0.05)
  })

  it('a flat map (no range) is all 1 inside so the carve is a no-op', () => {
    const w = 6, h = 6, mask = square(w, h, 1)
    const raw = new Float32Array(w * h).fill(3)
    const near = normaliseDepth(raw, w, h, mask, 0.01)
    for (let i = 0; i < near.length; i++) expect(near[i]).toBe(mask[i] ? 1 : 0)
    expect(near.some(v => Number.isNaN(v))).toBe(false)
  })
})

describe('padDepth', () => {
  it('fills outside pixels with the nearest inside value', () => {
    const w = 9, h = 9, mask = square(w, h, 3)
    const near = new Float32Array(w * h)
    // Inside: left column of the square 0.2, right column 0.8, middle 0.5.
    for (let y = 3; y < 6; y++) { near[y * w + 3] = 0.2; near[y * w + 4] = 0.5; near[y * w + 5] = 0.8 }
    padDepth(near, w, h, mask)
    expect(near[4 * w + 0]).toBeCloseTo(0.2, 6)
    expect(near[4 * w + 8]).toBeCloseTo(0.8, 6)
    expect(near[0 * w + 4]).toBeCloseTo(0.5, 6)
    // Inside untouched.
    expect(near[4 * w + 4]).toBeCloseTo(0.5, 6)
    expect(near.some(v => Number.isNaN(v))).toBe(false)
  })

  it('an empty mask leaves the map untouched', () => {
    const w = 4, h = 4
    const near = new Float32Array(w * h).fill(0.3)
    padDepth(near, w, h, new Uint8Array(w * h))
    for (let i = 0; i < near.length; i++) expect(near[i]).toBeCloseTo(0.3, 6)
  })
})

describe('shrinkDepth', () => {
  it('box-averages to at most `max` on the long side and keeps the mean', () => {
    const w = 40, h = 20
    const near = new Float32Array(w * h)
    for (let i = 0; i < near.length; i++) near[i] = (i % w) / (w - 1)
    const map = shrinkDepth(near, w, h, 10)
    expect(map.w).toBe(10)
    expect(map.h).toBe(5)
    expect(map.near.length).toBe(50)
    const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length
    expect(mean(map.near)).toBeCloseTo(mean(near), 2)
    // Still increases left to right.
    expect(map.near[9]!).toBeGreaterThan(map.near[0]!)
  })

  it('returns the input as is when already small enough', () => {
    const near = new Float32Array(6).fill(0.5)
    const map = shrinkDepth(near, 3, 2, 256)
    expect(map.near).toBe(near)
    expect(map.w).toBe(3)
    expect(map.h).toBe(2)
  })
})

describe('sampleNear', () => {
  it('interpolates bilinearly and clamps at the border', () => {
    const map = { w: 2, h: 2, near: Float32Array.from([0, 1, 0, 1]) }
    expect(sampleNear(map, 0.5, 0.5)).toBeCloseTo(0.5, 6)
    expect(sampleNear(map, -5, -5)).toBeCloseTo(0, 6)
    expect(sampleNear(map, 50, 50)).toBeCloseTo(1, 6)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/depth.test.ts`
Expected: FAIL — `Failed to resolve import "~/utils/depth"`.

- [ ] **Step 3: Implement `app/utils/depth.ts`**

```ts
/**
 * Monocular depth as the carve wants it. The model returns relative inverse depth (bigger =
 * nearer) at the photo's resolution; the carve wants a small map of *nearness* in 0..1 aligned to
 * the front trace raster, defined everywhere (bilinear samples stray past the outline) and free
 * of the model's edge spikes. Pure array maths: it runs in the worker and in node tests.
 */
export interface DepthMap {
  /** Nearness, 1 nearest .. 0 farthest, row-major, `w * h`. */
  near: Float32Array
  w: number
  h: number
}

/**
 * Normalise raw relative depth to 0..1 over the silhouette, clipping `clipPct` of each tail
 * (models spike at edges). Outside the mask is 0. A flat map (no range) becomes 1 inside so the
 * carve term is a no-op rather than a cliff.
 */
export function normaliseDepth(raw: Float32Array, w: number, h: number, mask: Uint8Array, clipPct = 0.01): Float32Array {
  const n = w * h
  const inside: number[] = []
  for (let i = 0; i < n; i++) if (mask[i]) inside.push(raw[i]!)
  const near = new Float32Array(n)
  if (!inside.length) return near
  const sorted = Float32Array.from(inside).sort()
  const lo = sorted[Math.min(sorted.length - 1, Math.floor(clipPct * sorted.length))]!
  const hi = sorted[Math.max(0, Math.ceil((1 - clipPct) * sorted.length) - 1)]!
  const range = hi - lo
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    near[i] = range < 1e-6 ? 1 : Math.min(1, Math.max(0, (raw[i]! - lo) / range))
  }
  return near
}

/**
 * Fill every outside pixel with the value of the nearest inside pixel (multi-source breadth-first
 * flood, 4-connected), in place, so the map continues smoothly past the outline. The silhouette
 * term owns the outline itself; this only stops bilinear samples falling off a cliff.
 */
export function padDepth(near: Float32Array, w: number, h: number, mask: Uint8Array): void {
  const n = w * h
  const queue = new Int32Array(n)
  const seen = new Uint8Array(n)
  let head = 0, tail = 0
  for (let i = 0; i < n; i++) if (mask[i]) { seen[i] = 1; queue[tail++] = i }
  if (!tail) return
  while (head < tail) {
    const i = queue[head++]!
    const x = i % w, y = (i - x) / w
    const v = near[i]!
    if (x > 0 && !seen[i - 1]) { seen[i - 1] = 1; near[i - 1] = v; queue[tail++] = i - 1 }
    if (x < w - 1 && !seen[i + 1]) { seen[i + 1] = 1; near[i + 1] = v; queue[tail++] = i + 1 }
    if (y > 0 && !seen[i - w]) { seen[i - w] = 1; near[i - w] = v; queue[tail++] = i - w }
    if (y < h - 1 && !seen[i + w]) { seen[i + w] = 1; near[i + w] = v; queue[tail++] = i + w }
  }
}

/** Box-average down by an integer factor until the long side is ≤ `max`. Returns the input when it already is. */
export function shrinkDepth(near: Float32Array, w: number, h: number, max: number): DepthMap {
  const f = Math.ceil(Math.max(w, h) / max)
  if (f <= 1) return { near, w, h }
  const ow = Math.ceil(w / f), oh = Math.ceil(h / f)
  const out = new Float32Array(ow * oh)
  for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) {
    let sum = 0, cnt = 0
    for (let y = oy * f; y < Math.min(h, oy * f + f); y++) for (let x = ox * f; x < Math.min(w, ox * f + f); x++) { sum += near[y * w + x]!; cnt++ }
    out[oy * ow + ox] = sum / cnt
  }
  return { near: out, w: ow, h: oh }
}

/** Bilinear sample at a fractional column/row, clamped to the map. */
export function sampleNear(map: DepthMap, col: number, row: number): number {
  const { w, h, near } = map
  const x = Math.min(w - 1, Math.max(0, col)), y = Math.min(h - 1, Math.max(0, row))
  const x0 = Math.min(w - 1, x | 0), y0 = Math.min(h - 1, y | 0)
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const a = near[y0 * w + x0]!, b = near[y0 * w + x1]!, c = near[y1 * w + x0]!, d = near[y1 * w + x1]!
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/depth.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck` → 0 errors.
```bash
git add app/utils/depth.ts tests/depth.test.ts
git commit -m "feat(depth): depth map maths — normalise, pad, shrink, sample"
```

---

### Task 2: Depth term in the carve (`hull.ts`)

**Files:**
- Modify: `app/utils/hull.ts` (`HullView` ~line 26, `HullOptions` ~line 37, `prepareCarve` ~line 226–286)
- Test: `tests/hull.test.ts`

**Interfaces:**
- Consumes: `DepthMap`, `sampleNear` from Task 1.
- Produces:
  ```ts
  export interface HullView { ...; depth?: DepthMap }          // front only
  export interface HullOptions { ...; depth?: number }        // 0..1, default 1
  ```
  `prepareCarve(views, opts).field(x, y, z)` includes the depth term for every placed view carrying `depth` (the front and its mirror share the map).

- [ ] **Step 1: Write the failing tests**

Append to `tests/hull.test.ts` (after the `buildHull` describe; reuse `rect`, `front`, `opts` helpers already at the top of the file; add `prepareCarve` to the import from `~/utils/hull` and add `import type { DepthMap } from '~/utils/depth'`):

```ts
describe('prepareCarve depth', () => {
  /** A 100×100 map matching the mask raster: top half halfway back (0.5), bottom half nearest (1). */
  const stepMap = (): DepthMap => {
    const near = new Float32Array(100 * 100).fill(0.5)
    for (let y = 50; y < 100; y++) for (let x = 0; x < 100; x++) near[y * 100 + x] = 1
    return { near, w: 100, h: 100 }
  }

  it('cuts the top half back to its near surface and keeps the bottom half whole', () => {
    const view: HullView = { ...front(rect(20, 20, 60, 60)), depth: stepMap() }
    const c = prepareCarve([view], opts({ depth: 1 }))
    // Camera on +z. Top half (y > 0) reads 0.5: its near surface is the z = 0 plane, so the front of the box is cut.
    expect(c.field(0, 15, 0.05 * c.D)).toBeLessThan(0)
    expect(c.field(0, 15, -0.05 * c.D)).toBeGreaterThan(0)
    // Bottom half (y < 0) reads 1: nothing cut, the front stays.
    expect(c.field(0, -15, 0.45 * c.D)).toBeGreaterThan(0)
    // Silhouette unchanged: outside the square stays outside.
    expect(c.field(c.W / 2 + 5, 0, 0)).toBeLessThan(0)
  })

  it('strength 0 leaves the field exactly as without a map', () => {
    const plain = prepareCarve([front(rect(20, 20, 60, 60))], opts())
    const withMap = prepareCarve([{ ...front(rect(20, 20, 60, 60)), depth: stepMap() }], opts({ depth: 0 }))
    for (const [x, y, z] of [[0, 0, 0], [0, 15, 0], [10, -20, 5], [-25, 25, -10]] as const) {
      expect(withMap.field(x, y, z)).toBe(plain.field(x, y, z))
    }
  })

  it('half strength cuts half as deep', () => {
    const mask = rect(20, 20, 60, 60)
    const full = prepareCarve([{ ...front(mask), depth: stepMap() }], opts({ depth: 1 }))
    const half = prepareCarve([{ ...front(mask), depth: stepMap() }], opts({ depth: 0.5 }))
    // Top half reads 0.5: at full strength its near surface sits at z = 0, at half strength at z = D/4.
    expect(half.field(0, 15, 0.2 * half.D)).toBeGreaterThan(0)
    expect(half.field(0, 15, 0.3 * half.D)).toBeLessThan(0)
    expect(full.field(0, 15, 0.2 * full.D)).toBeLessThan(0)
  })

  it('the mirror view carries the front map too', () => {
    const c = prepareCarve([{ ...front(rect(20, 20, 60, 60), 30), depth: stepMap() }], opts({ symmetric: true, depth: 1 }))
    expect(c.placed.length).toBe(2)
    expect(c.placed.every(p => p.view.depth)).toBe(true)
    expect(c.placed[1]!.view.mirror).toBe(true)
  })
})
```

Note `Carve.placed` is exported through the `Carve` interface but `Placed` is not; `p.view` is typed, so this compiles.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/hull.test.ts -t "prepareCarve depth"`
Expected: FAIL — the spread compiles, but `field(0, 15, 0.05 * D)` is `> 0` because no term exists yet.

- [ ] **Step 3: Add the types and the term**

In `app/utils/hull.ts`:

Add the import at the top:
```ts
import { sampleNear, type DepthMap } from './depth'
```

Extend `HullView` (after `mirror?: boolean`):
```ts
  /** Front only: the photo's relief (1 nearest .. 0 farthest), aligned to `mask`'s raster. Carved with `HullOptions.depth`. */
  depth?: DepthMap
```

Extend `HullOptions` (after `outlineSmoothing`):
```ts
  /** 0..1: how deep the front photo's depth map cuts behind the near surface. Default 1; 0 adds no term. */
  depth?: number
```

In `prepareCarve`, after `const k = ...` and `viewDistance`, add:
```ts
  const strength = opts.depth ?? 1
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
```
and change `field` to:
```ts
  const field = (x: number, y: number, z: number): number => {
    // The object's box first, then every silhouette, then the depth behind each view that has one.
    let d = box(x, y, z)
    for (const p of placed) d = smin(d, viewDistance(p, x, y, z), k)
    if (strength > 0) for (const p of placed) if (p.view.depth) d = smin(d, depthDistance(p, p.view.depth, x, y, z), k)
    return d
  }
```
`part` stays as it is (box + silhouettes; tests and the mesher's debug path do not need the depth term split out).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/hull.test.ts`
Expected: PASS, all hull tests including the four new ones. If `strength 0` fails with tiny float differences, check that the `if (strength > 0)` guard is in place — the term must not be added at all.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck` → 0 errors.
```bash
git add app/utils/hull.ts tests/hull.test.ts
git commit -m "feat(hull): carve behind a front depth map"
```

---

### Task 3: Depth worker and client

**Files:**
- Create: `app/workers/depth.worker.ts`
- Create: `app/utils/depther.ts`
- Modify: `nuxt.config.ts`
- Modify: `package.json` (via `pnpm add`)

**Interfaces:**
- Consumes: `normaliseDepth`, `padDepth`, `shrinkDepth`, `DepthMap` from Task 1.
- Produces:
  ```ts
  // depth.worker.ts
  export type DepthWorkerRequest = { type: 'depth'; id: number; image: ImageData; mask: Uint8Array; model: string }
  export type DepthWorkerResponse =
    | { type: 'depth'; id: number; map: DepthMap; ms: number; device: DepthDevice }
    | { type: 'progress'; id: number; loaded: number; total: number }
    | { type: 'error'; id: number; message: string }
  export type DepthDevice = 'webgpu' | 'wasm'
  // depther.ts
  export interface Depthed { map: DepthMap; ms: number; device: DepthDevice }
  export class Depther {
    readonly available: boolean
    onProgress: ((loaded: number, total: number) => void) | null
    constructor(model: string)
    depth(image: ImageData, mask: Uint8Array): Promise<Depthed | null>   // null when superseded
    dispose(): void
  }
  ```

- [ ] **Step 1: Install the library**

Run: `pnpm add @huggingface/transformers`
Expected: `package.json` gains `"@huggingface/transformers": "^4.2.0"` (or newer 4.x).

- [ ] **Step 2: Nuxt config**

In `nuxt.config.ts` add, inside `defineNuxtConfig({ ... })`:
```ts
  runtimeConfig: {
    public: {
      /** Depth model id on the Hugging Face hub, or a path under `/models/` when self-hosted. */
      depthModel: 'onnx-community/depth-anything-v2-small',
    },
  },
```
and change the `vite` block to:
```ts
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: { include: ['three', 'd3-contour'], exclude: ['@huggingface/transformers'] },
  },
```

- [ ] **Step 3: Write the worker**

`app/workers/depth.worker.ts`:
```ts
import { env, pipeline, RawImage, type DepthEstimationPipeline } from '@huggingface/transformers'
import { normaliseDepth, padDepth, shrinkDepth, type DepthMap } from '~/utils/depth'

/**
 * Depth worker. Owns the depth model so the main bundle never imports the ML runtime. The front
 * photo's crop comes in as `ImageData` (≤ 518 px, the model's own input size) with the silhouette
 * mask at the same size; the nearness map goes back shrunk to ≤ 256 px. The model's weights are
 * fetched once from the model host and cached by the browser; the image never leaves the page.
 */
export type DepthDevice = 'webgpu' | 'wasm'
export type DepthWorkerRequest = { type: 'depth'; id: number; image: ImageData; mask: Uint8Array; model: string }
export type DepthWorkerResponse =
  | { type: 'depth'; id: number; map: DepthMap; ms: number; device: DepthDevice }
  | { type: 'progress'; id: number; loaded: number; total: number }
  | { type: 'error'; id: number; message: string }

/** Long side of the carve's copy of the map; the voxel grid is ≤ 176 cells, finer is wasted. */
const MAP_PX = 256

env.allowLocalModels = false

const ctx = self as unknown as DedicatedWorkerGlobalScope
let device: DepthDevice = 'gpu' in navigator ? 'webgpu' : 'wasm'
let estimator: Promise<DepthEstimationPipeline> | null = null
let loadedModel = ''

function load(model: string, id: number): Promise<DepthEstimationPipeline> {
  if (estimator && loadedModel === model) return estimator
  loadedModel = model
  estimator = pipeline('depth-estimation', model, {
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'q8',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.file.endsWith('.onnx')) {
        ctx.postMessage({ type: 'progress', id, loaded: p.loaded, total: p.total } satisfies DepthWorkerResponse)
      }
    },
  }).catch((err: unknown) => {
    estimator = null
    throw err
  })
  return estimator
}

async function infer(msg: DepthWorkerRequest): Promise<DepthMap> {
  const est = await load(msg.model, msg.id)
  const { width: w, height: h } = msg.image
  const image = new RawImage(msg.image.data, w, h, 4)
  const out = await est(image)
  const result = Array.isArray(out) ? out[0]! : out
  const raw = result.predicted_depth.data as Float32Array
  const [ph, pw] = result.predicted_depth.dims as [number, number]
  if (pw !== w || ph !== h) throw new Error(`Depth came back ${pw}×${ph} for a ${w}×${h} photo`)
  const near = normaliseDepth(raw, w, h, msg.mask)
  padDepth(near, w, h, msg.mask)
  return shrinkDepth(near, w, h, MAP_PX)
}

ctx.onmessage = async (e: MessageEvent<DepthWorkerRequest>) => {
  const msg = e.data
  if (msg.type !== 'depth') return
  const t0 = performance.now()
  try {
    let map: DepthMap
    try {
      map = await infer(msg)
    } catch (err) {
      // A GPU that advertises WebGPU but cannot run the graph: once more on the CPU.
      if (device !== 'webgpu') throw err
      console.warn('[depth] WebGPU failed, retrying on wasm:', err)
      device = 'wasm'
      estimator = null
      map = await infer(msg)
    }
    ctx.postMessage({ type: 'depth', id: msg.id, map, ms: performance.now() - t0, device } satisfies DepthWorkerResponse, [map.near.buffer])
  } catch (err) {
    ctx.postMessage({ type: 'error', id: msg.id, message: (err as Error).message } satisfies DepthWorkerResponse)
  }
}
```
If `pnpm typecheck` complains about the `progress_callback` parameter (`p.file` possibly missing on the union), narrow it with `'file' in p` before reading `p.file`, and cast `p.loaded`/`p.total` with `?? 0`. If `predicted_depth.dims` is typed `number[]`, the `as [number, number]` cast stands.

- [ ] **Step 4: Write the client**

`app/utils/depther.ts`:
```ts
import type { DepthMap } from './depth'
import type { DepthDevice, DepthWorkerRequest, DepthWorkerResponse } from '~/workers/depth.worker'

export interface Depthed {
  map: DepthMap
  /** Milliseconds for the whole request, model download included the first time. */
  ms: number
  device: DepthDevice
}

type Settle = { resolve: (v: Depthed | null) => void; reject: (e: Error) => void }
type Job = Settle & { id: number; image: ImageData; mask: Uint8Array }

/**
 * Runs the depth model in its own worker (`depth.worker.ts`). One request in flight; a newer one
 * replaces the waiting one, which resolves `null`. There is no main-thread fallback: the model is
 * far too slow on the UI thread, so without a worker there is no depth and `available` is false.
 */
export class Depther {
  readonly available: boolean
  /** Weights download progress, first run only. */
  onProgress: ((loaded: number, total: number) => void) | null = null
  private worker: Worker | null = null
  private nextId = 1
  private inflight: Job | null = null
  private pending: Job | null = null

  constructor(private readonly model: string) {
    this.available = typeof Worker !== 'undefined'
    if (!this.available) return
    try {
      this.worker = new Worker(new URL('../workers/depth.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<DepthWorkerResponse>) => this.onMessage(e.data)
      this.worker.onerror = (e) => {
        if (import.meta.dev) console.warn('[depth] worker failed:', e.message)
        this.fail(new Error(e.message || 'Depth worker failed'))
      }
    } catch (err) {
      this.worker = null
      this.available = false
    }
  }

  /** Nearness map for a front photo crop and its silhouette mask (same size). Resolves `null` when superseded. */
  depth(image: ImageData, mask: Uint8Array): Promise<Depthed | null> {
    return new Promise((resolve, reject) => {
      const job: Job = { id: this.nextId++, image, mask, resolve, reject }
      if (!this.worker) { reject(new Error('Depth model unavailable')); return }
      if (this.inflight) {
        this.pending?.resolve(null)
        this.pending = job
        return
      }
      this.start(job)
    })
  }

  private start(job: Job) {
    this.inflight = job
    const msg: DepthWorkerRequest = { type: 'depth', id: job.id, image: job.image, mask: job.mask, model: this.model }
    try {
      this.worker!.postMessage(msg)
    } catch (err) {
      this.finish(job, () => job.reject(err as Error))
    }
  }

  private onMessage(msg: DepthWorkerResponse) {
    const job = this.inflight
    if (!job || job.id !== msg.id) return
    if (msg.type === 'progress') { this.onProgress?.(msg.loaded, msg.total); return }
    if (msg.type === 'depth') this.finish(job, () => job.resolve({ map: msg.map, ms: msg.ms, device: msg.device }))
    else this.finish(job, () => job.reject(new Error(msg.message)))
  }

  private fail(err: Error) {
    const job = this.inflight
    this.worker?.terminate()
    this.worker = null
    this.pending?.reject(err)
    this.pending = null
    if (job) this.finish(job, () => job.reject(err))
  }

  private finish(job: Job, settle: () => void) {
    if (this.inflight === job) this.inflight = null
    settle()
    if (this.inflight || !this.pending) return
    const next = this.pending
    this.pending = null
    this.start(next)
  }

  dispose() {
    this.pending?.resolve(null)
    this.pending = null
    this.inflight?.resolve(null)
    this.inflight = null
    this.worker?.terminate()
    this.worker = null
  }
}
```
`available` is `readonly` but assigned in the constructor's catch: that is allowed in TypeScript (constructor assignments to readonly fields). If it complains about the earlier assignment, make it `readonly available: boolean = false` and assign once at the end.

- [ ] **Step 5: Smoke check in the browser**

Run `pnpm dev` (keep the Chrome tab in front: background tabs stall rAF). Open `/studio/product`, and in the devtools console:
```js
const { Depther } = await import('/app/utils/depther.ts')
const d = new Depther('onnx-community/depth-anything-v2-small')
d.onProgress = (l, t) => console.log('dl', Math.round(100 * l / t) + '%')
const c = document.createElement('canvas'); c.width = 64; c.height = 64
const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff'; g.fillRect(16, 16, 32, 32)
const img = g.getImageData(0, 0, 64, 64)
const mask = new Uint8Array(64 * 64).fill(1)
console.log(await d.depth(img, mask))
```
Expected: progress lines, then `{ map: { near: Float32Array(4096), w: 64, h: 64 }, ms, device: 'webgpu' | 'wasm' }`, no thrown error. If the module import path fails under Nuxt's dev server, skip this step and verify through the app in Task 6 instead. If the worker cannot resolve `@huggingface/transformers` (Vite "Failed to resolve import"), check `pnpm ls @huggingface/transformers` and restart the dev server; the package is client-only, so no SSR config applies.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck` → 0 errors. `pnpm test` → all pass.
```bash
git add app/workers/depth.worker.ts app/utils/depther.ts nuxt.config.ts package.json pnpm-lock.yaml
git commit -m "feat(depth): depth model worker and client"
```

---

### Task 4: Studio wiring (`useStudio.ts`, page)

**Files:**
- Modify: `app/composables/useStudio.ts` (`ViewOptions` ~line 66–76, state ~line 93–120, `useFile` ~line 151–189, `setMode` ~line 240–258, `runHull` ~line 265–300, watchers ~line 404–412, `clearImage`, return ~line 523)
- Modify: `app/pages/studio/[[mode]].vue` (destructure ~line 20–24, `<ControlPanel>` props ~line 53–75)

**Interfaces:**
- Consumes: `Depther`, `Depthed` (Task 3); `DepthMap` (Task 1); `HullView.depth`, `HullOptions.depth` (Task 2); existing `rasterize(img, resolution, crop)` from `~/utils/trace` and `rasterizeMask(mask, w, h)` from `~/utils/relief`.
- Produces (returned from `useStudio`, passed to the panel):
  ```ts
  export type DepthState = 'idle' | 'loading' | 'ready' | 'unavailable'
  viewOpts.depth: number            // 0..1, default 1
  depthState: Ref<DepthState>
  depthProgress: Ref<number>        // 0..1 weights download
  depthDevice: Ref<DepthDevice | ''>
  ```

- [ ] **Step 1: Options and state**

In `useStudio.ts`, add imports:
```ts
import { rasterize, ... } from '~/utils/trace'          // add `rasterize` to the existing import
import { rasterizeMask, ... } from '~/utils/relief'     // add `rasterizeMask` to the existing import
import { Depther } from '~/utils/depther'
import type { DepthMap } from '~/utils/depth'
import type { DepthDevice } from '~/workers/depth.worker'
```
Extend `ViewOptions`:
```ts
  /** 0..1: how deep the front photo's depth map cuts; 0 carves from outlines only. */
  depth: number
```
and `DEFAULT_VIEW_OPTIONS`:
```ts
export const DEFAULT_VIEW_OPTIONS: ViewOptions = { yaw: 30, pitch: 10, side: 'auto', symmetric: true, depth: 1 }
```
Add next to `DEFAULT_VIEW_OPTIONS`:
```ts
export type DepthState = 'idle' | 'loading' | 'ready' | 'unavailable'
/** Long side of the photo crop sent to the depth model: its own input size, more is resampled away. */
const DEPTH_INPUT_PX = 518
```
Inside `useStudio`, after `const hull = shallowRef<HullData | null>(null)`:
```ts
  const depther = new Depther(useRuntimeConfig().public.depthModel)
  /** The front photo's nearness map, once the model has run on the current trace. */
  const depthMap = shallowRef<DepthMap | null>(null)
  const depthState = ref<DepthState>(depther.available ? 'idle' : 'unavailable')
  const depthProgress = ref(0)
  const depthDevice = ref<DepthDevice | ''>('')
  depther.onProgress = (loaded, total) => { depthProgress.value = total ? loaded / total : 0 }
```

- [ ] **Step 2: `runDepth`**

Add after `runHull`:
```ts
  /**
   * Run the depth model on the front photo and carve with its map. Product mode only, after the
   * silhouette hull is on screen: the model needs a download the first time and a second or two
   * on a CPU, so the outline hull stands in until the relief arrives.
   */
  async function runDepth(): Promise<void> {
    const t = trace.value, img = image.value
    if (!img || !t || !t.polygons.length || mode.value !== 'product' || glass.geometry !== 'inflate' || viewOpts.depth <= 0) return
    if (depthState.value === 'unavailable') return
    depthState.value = 'loading'
    depthProgress.value = 0
    busy.value = true
    try {
      const data = rasterize(img, DEPTH_INPUT_PX, t.crop)
      const mask = rasterizeMask({ polygons: t.polygons, width: t.width, height: t.height }, data.width, data.height)
      const got = await depther.depth(data, mask)
      if (!got || trace.value !== t) { busy.value = false; return }
      if (import.meta.dev) console.debug(`[depth] ${Math.round(got.ms)} ms (${got.device}), ${got.map.w}×${got.map.h}`)
      depthMap.value = got.map
      depthDevice.value = got.device
      depthState.value = 'ready'
      await runHull()
    } catch (e) {
      if (import.meta.dev) console.warn('[depth]', e)
      depthMap.value = null
      depthState.value = 'unavailable'
      notify('Depth model unavailable; carved from outlines only')
      busy.value = false
    }
  }
```
`runHull` sets `busy = false` itself on the success path, which is why the early returns and the catch reset it explicitly.

- [ ] **Step 3: Feed the map into `runHull`**

In `runHull`, change the front view line to:
```ts
      const hullViews: HullView[] = [{ mask: mask(t), source: 'front', yaw: side * viewOpts.yaw, pitch: viewOpts.pitch, depth: viewOpts.depth > 0 ? depthMap.value ?? undefined : undefined }]
```
and the options object to:
```ts
      const got = await tracer.hull(hullViews, {
        resolution: HULL_RESOLUTION[reliefOpts.resolution] ?? 128,
        roundness: reliefOpts.roundness,
        depthRatio: glass.depthMm / glass.widthMm,
        symmetric: viewOpts.symmetric,
        depth: viewOpts.depth,
      })
```

- [ ] **Step 4: Trigger points and resets**

In `useFile`, in the reset block after `hull.value = null` add:
```ts
    depthMap.value = null
    if (depthState.value !== 'unavailable') depthState.value = 'idle'
```
and after `await runHull()` (still inside the `try`) add:
```ts
      // Depth after the silhouette hull is shown; it rebuilds the hull when the map lands.
      void runDepth()
```
Find `clearImage` (grep `function clearImage`) and add the same two reset lines there.

In `setMode`, after its `await runHull()` add `void runDepth()`.

Change the hull watcher to include the slider and re-run the model when it is turned back on without a map:
```ts
  watch(() => [viewOpts.yaw, viewOpts.pitch, viewOpts.symmetric, glass.depthMm, viewOpts.side, viewOpts.depth], (now, was) => {
    if (importing.value) return
    // The depth field only drives the carve when no side or top photo measures it.
    if (now[3] !== was?.[3] && (views.side || views.top)) return
    clearTimeout(hullTimer)
    hullTimer = setTimeout(() => {
      if (viewOpts.depth > 0 && !depthMap.value && depthState.value === 'idle') void runDepth()
      else void runHull()
    }, 150)
  })
```

Add to the return object: `depthState, depthProgress, depthDevice,` (after `hull,`).

- [ ] **Step 5: Page props**

In `app/pages/studio/[[mode]].vue`, add `depthState, depthProgress, depthDevice` to the destructure (after `hull`), and on `<ControlPanel>` after `:hull="hull"`:
```vue
        :depth-state="depthState"
        :depth-progress="depthProgress"
        :depth-device="depthDevice"
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck` → 0 errors (ControlPanel does not declare the props yet; Vue allows unknown attrs, but if `vue-tsc` flags them, do Task 5 Step 1 first). `pnpm test` → all pass.

- [ ] **Step 7: Commit**

```bash
git add app/composables/useStudio.ts "app/pages/studio/[[mode]].vue"
git commit -m "feat(studio): run the depth model on product imports and carve with it"
```

---

### Task 5: Depth slider and status (`ControlPanel.vue`)

**Files:**
- Modify: `app/components/studio/ControlPanel.vue` (props ~line 31–46, Views card ~line 496–556)

**Interfaces:**
- Consumes: `DepthState` from `~/composables/useStudio`, `viewOpts.depth`, props from Task 4.

- [ ] **Step 1: Props and hint**

Add to the `defineProps` generic (after `hull?: HullData | null`):
```ts
  depthState?: DepthState
  depthProgress?: number
  depthDevice?: string
```
Add `DepthState` to the existing `~/composables/useStudio` type import. After `sideRead`, add:
```ts
const depthHint = computed(() => {
  const s = props.depthState
  if (s === 'loading') return props.depthProgress ? `Downloading the depth model, ${Math.round(props.depthProgress * 100)}%` : 'Reading the photo\'s depth…'
  if (s === 'ready') return `From the depth model (${props.depthDevice === 'webgpu' ? 'WebGPU' : 'CPU'}). Runs on your device; the photo never leaves it.`
  if (s === 'unavailable') return 'Depth model unavailable: carved from outlines only'
  return 'How deep the photo\'s relief cuts. Depth model, 27 MB, downloaded once, runs on your device.'
})
const depthOn = computed(() => props.depthState === 'ready' && (props.viewOpts?.depth ?? 0) > 0)
```

- [ ] **Step 2: Card hint and slider**

Change the Views `SectionGroup` `:hint` to:
```vue
                :hint="hull ? `Carved from ${1 + (viewOpts?.symmetric ? 1 : 0) + (views?.side ? 1 : 0) + (views?.top ? 1 : 0)} outlines${depthOn ? ' + depth' : ''}` : 'One photo: a pillow'"
```
After the `Symmetric object` switch `<div>` (inside `<template v-if="viewOpts">`), add:
```vue
                  <SliderField
                    v-model="viewOpts.depth"
                    label="Depth"
                    :hint="depthHint"
                    :min="0"
                    :max="1"
                    :step="0.05"
                    :decimals="2"
                    :default-value="VO.depth"
                  />
```
The card's reset already does `Object.assign(viewOpts, VO)`, which restores `depth: 1`.

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm typecheck` → 0 errors.
```bash
git add app/components/studio/ControlPanel.vue
git commit -m "feat(panel): depth slider and model status in the Views card"
```

---

### Task 6: Browser verification with the reference chair

**Files:**
- Temporary: copy `../orange-chair-bed`'s chair photo (the one used for the previous passes; find it with `ls ../orange-chair-bed/preview ../orange-chair-bed/docs`) to `public/__ref-chair.png`; delete it at the end.
- Modify: `/Users/volkanakyel/.claude/projects/-Users-volkanakyel-Developer-vitrum-3d/memory/product-render-recipe.md` (append depth notes).

- [ ] **Step 1: Run it**

`pnpm dev`, open `/studio/product` in Chrome, keep the tab in front. Import the chair photo (set the file input's `files` through a `DataTransfer` and dispatch `change`, as in the previous passes). Watch the console for `[hull]` then `[depth] … ms (webgpu|wasm)` then a second `[hull]`.

- [ ] **Step 2: Check the shape**

Switch to the side view. Expected: an L, seat lower and in front, backrest behind and taller; the top no longer a wedge. Drag Depth to 0: the rounded block from before returns. Back to 1: L returns without re-running the model (no second `[depth]` log). Take screenshots of angle and side.

- [ ] **Step 3: Check the failure path**

In devtools → Network, set Offline, clear site data (Application → Storage → Clear site data) so the weights are not cached, reload, import again. Expected: silhouette hull appears, toast "Depth model unavailable; carved from outlines only", Views hint reads "Depth model unavailable: carved from outlines only", no uncaught errors. Set Online again.

- [ ] **Step 4: Clean up and record**

Delete `public/__ref-chair.png`. Append to the memory file `product-render-recipe.md` a short "Depth (2026-09-15)" paragraph: worker-owned `@huggingface/transformers`, model id, device/dtype choice, map alignment (trace raster → field px scale), linear alignment approximation and the Depth slider as the user's correction, first-run download size, and where the failure toast comes from. Run `pnpm typecheck` and `pnpm test` one last time.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: depth carve notes"
```
