# Monocular depth carve: real shape from one product photo

Date: 2026-09-15. Follows `2026-09-14-product-render-design.md`. The render now matches the
reference rig; the shape does not. One three-quarter photo plus its mirror carves a rounded
block, never a seat with a backrest, because a silhouette says nothing about the surface
inside it. A depth model does. This spec adds an in-browser monocular depth estimate and
feeds it into the existing carve as one more signed-distance constraint.

The promise stays: no image leaves the browser. The model's weights are downloaded once
(from a public model host, ~27 MB, cached by the browser); the photo is never uploaded.

## What changes for the user

- Product import: after the outline is traced and the silhouette hull is shown, the depth
  model runs on the front photo and the hull rebuilds with the real relief (seat, backrest,
  armrests, recesses). First run also downloads the model with a progress line; later runs
  are instant (cached weights) and take ~0.3 s on WebGPU, 2–6 s on WASM.
- Views card gains a **Depth** slider (0..1, default 0.4): how deep the photo's relief cuts.
  0 turns it off (today's silhouette hull). A caption says "Depth model, 27 MB, downloaded
  once, runs on your device."
- If the model cannot load (offline, blocked, old browser) the silhouette hull stands and a
  notice says depth is unavailable. Nothing else breaks.

## Approaches considered

1. **Depth as a carve constraint** (chosen). A relative depth map from the front camera
   becomes a "near surface" in the front camera's frame; the SDF keeps only points behind it.
   Mirror view gets the mirrored map for free. Side and top outlines still carve. One new
   term in `prepareCarve`, nothing else in the mesher, painter or renderer changes.
2. Depth-displaced front sheet, mirrored for the back. Bypasses the SDF: loses the side/top
   photos, needs its own meshing, seams at the mirror plane. Rejected.
3. Depth to normal map only. Cheap, changes shading not shape. Not what was asked.

## Architecture

```
useStudio.import ─► Tracer (trace worker) ─► hull (silhouette only)      shown at once
                 └► Depth  (depth worker)  ─► DepthMap ─► hull rebuilt with depth term
```

### `app/utils/depth.ts` (new, pure)
Array maths, unit-tested in node.

```ts
/** Relative nearness of the front photo, aligned to the front trace raster: 1 nearest, 0 farthest. */
export interface DepthMap { near: Float32Array; w: number; h: number }

/** Normalise raw relative depth (inverse depth: bigger = nearer) to 0..1 over the silhouette. */
export function normaliseDepth(raw: Float32Array, w: number, h: number, mask: Uint8Array, clipPct?: number): Float32Array
/** Fill outside the mask with the nearest inside value so bilinear samples never fall off a cliff at the outline. */
export function padDepth(near: Float32Array, w: number, h: number, mask: Uint8Array): void
/** Box-downsample to ≤ `max` on the long side; the carve samples it bilinearly. */
export function shrinkDepth(near: Float32Array, w: number, h: number, max: number): DepthMap
```

- `normaliseDepth` clips the 1st/99th percentile inside the mask (depth models spike at edges),
  maps to 0..1, sets outside-mask to 0.
- `padDepth` = nearest-inside fill by a multi-source breadth-first flood (4-connected, O(n))
  so the map continues smoothly past the outline; the silhouette term owns the outline itself.
- `shrinkDepth` to ≤ 256 px: the voxel grid is ≤ 176 cells, finer depth is wasted.

### `app/workers/depth.worker.ts` (new)
Owns `@huggingface/transformers` (v4) so the main bundle never imports it.

- `pipeline('depth-estimation', model, { device, dtype, progress_callback })`, lazily, once.
  `device = 'webgpu'` when `navigator.gpu` exists, else `'wasm'`. `dtype = 'fp16'` on WebGPU,
  `'q8'` on WASM (27 MB). Model id from Nuxt runtime config `public.depthModel`, default
  `onnx-community/depth-anything-v2-small`. `env.allowLocalModels = false`; browser cache on
  (default), so a second visit downloads nothing.
- Request `{ type: 'depth'; id; image: ImageData; mask: Uint8Array }` → the front trace crop
  at ≤ 518 px long side (the model's own input size; sending more is resampled anyway).
  `new RawImage(image.data, w, h, 4)` → pipeline → `predicted_depth` (returned at input size)
  → `normaliseDepth` → `padDepth` → `shrinkDepth(256)` → response
  `{ type: 'depth'; id; map: DepthMap; ms; device }` with the buffer transferred.
- Progress events `{ type: 'progress'; loaded; total; file }` while weights download.
- Errors → `{ type: 'error'; id; message }`. No main-thread fallback: without a worker there
  is no depth (the model is far too slow on the UI thread), and the hull stands without it.

### `app/utils/depther.ts` (new)
Thin client mirroring `Tracer`: one worker, one in-flight job, newest request wins, `dispose()`.
`depth(image, mask): Promise<{ map, ms, device } | null>`, `onProgress` callback,
`available` (false when `Worker` is missing or the worker errored at start).

### `hull.ts`
```ts
export interface HullView {
  ...
  /** Front only: the photo's relief, aligned to `mask`'s raster; carved with `depth` strength. */
  depth?: DepthMap
}
export interface HullOptions { ...; depth?: number /* 0..1, default 1 */ }
```
In `prepareCarve`, each placed view with a `depth` map (the front and, when symmetric, its
mirror, which shares the map: the mirror flips the column exactly as the mask sampler does)
adds a term:

```
t     = p · d                                    (camera axis coordinate, + toward the camera)
tMax  = (W|dx| + H|dy| + D|dz|) / 2              (the box's front extent along d)
tS    = tMax − (1 − near(col,row)) · 2 tMax · strength
term  = tS − t                                   (> 0 behind the near surface)
```
`near` is sampled bilinearly from the map at the mask's column/row scaled by `map.w / rw`.
The term joins the `smin` chain with the same `k`, after the silhouette terms; at strength 0
the term is not added at all, so the field is today's exactly. Alignment is
linear in normalised inverse depth over the box's full camera-axis extent: nearest visible
point on the front plane, farthest on the back plane. It is an approximation (true depth is
1/(a·disp + b)); the Depth slider is the user's correction and the tests pin the geometry,
not the metric. Revisit with a two-point affine fit if a photo reads visibly warped.

`buildHull` is unchanged (the term lives in `field`). Frames unchanged: the painter never
sees depth.

### `useStudio.ts`
- `ViewOptions.depth: number` (default 0.4). `depthMap: shallowRef<DepthMap | null>`,
  `depthState: ref<'idle' | 'loading' | 'ready' | 'unavailable'>`, `depthProgress: ref<number>`.
- `runHull` passes `depth: depthMap.value` on the front view and `depth: viewOpts.depth` in
  options. Slider drags rebuild the hull only; inference is never repeated for one photo.
- After import in product mode (and on mode switch to product): if `viewOpts.depth > 0`,
  build the front crop ImageData (≤ 518) + mask from the trace, call `depther.depth`, then
  `runHull()` again if the trace is still current. Import loader keeps its existing phases;
  depth arrives after the model is shown (progressive), with `busy` on while it runs.
- New image clears `depthMap`. Icon mode never calls the model.

### `ControlPanel.vue`
Views card: `SliderField` **Depth** bound to `viewOpts.depth`, hint from `depthState`:
loading → "Downloading depth model 43%", ready → "From the depth model (WebGPU)",
unavailable → "Depth model unavailable, outline only". The card hint's outline count says
"+ depth" when the map is in.

### `nuxt.config.ts`
`runtimeConfig.public.depthModel` (model id or self-hosted path; HF hub default).
`vite.optimizeDeps.exclude: ['@huggingface/transformers']` (worker-only, wasm assets).
ONNX runtime's wasm binaries load from the library's default CDN; self-host under
`public/ort/` via `env.backends.onnx.wasm.wasmPaths` only if CSP demands it (documented, not done).

## Error handling
- Worker fails to start / model fetch fails / WebGPU init throws → `depthState = 'unavailable'`,
  `notify('Depth model unavailable; carved from outlines only')`, hull unchanged.
- WebGPU present but inference throws (driver) → retry once on `wasm`, then unavailable.
- Trace replaced while inference runs → result dropped (id check, as `Tracer`).
- Empty/degenerate depth range (flat image) → `normaliseDepth` returns all 1s → term is a
  no-op; no NaN reaches the grid (tests cover this).

## Testing
- `tests/depth.test.ts`: `normaliseDepth` (range, clipping, outside → 0, flat input),
  `padDepth` (outside pixels equal nearest inside), `shrinkDepth` (size, mean preserved).
- `tests/hull.test.ts`: square front mask, yaw 0, symmetric off, depth map = step (top half
  far, bottom half near, strength 1): `prepareCarve().field` is negative at a point in the
  top-front quadrant and positive at the same (x,y) behind the step, and the silhouette
  edges are unchanged; `depth: 0` reproduces today's field exactly. Mirror case: yaw 30,
  symmetric on, map applied to both placed views.
- The model itself is not unit-tested (network, WebGPU). Manual check in Chrome with the
  reference chair photo: seat/backrest L visible in the side view; timings logged in dev.

## Out of scope
Depth for side/top photos; metric depth; texture from depth; model self-hosting in the repo;
any server.

## Verification (2026-09-15, Chrome, WebGPU)

Reference chair photo: `[depth] 3726 ms (webgpu), 173×145` after the first download, hull rebuilt
from 117k to 78k tris. At strength 1 the backrest collapsed to a fin (H 49 mm): the model reads the
backrest at nearness 0.11, the linear map puts its face on the back plane, and the mirror view's
term meets it there. At 0.27–0.4 the seat + backrest L appears (H 83–85 mm). Default strength is
therefore 0.4; the formula, tests and slider range are unchanged. A bad model id rejects with
`Unauthorized access to file … config.json`, which reaches the composable's catch and the
"unavailable" toast.

Follow-up: the mirrored map shears wide far faces into a wedge (backrest narrower than the seat).
A reduced strength for the mirror's term, or a two-point affine fit of the depth, would help.
