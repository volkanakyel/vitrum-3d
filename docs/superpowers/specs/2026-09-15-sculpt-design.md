# Sculpt: agent-authored parts models from one product photo

Date: 2026-09-15. Follows `2026-09-15-monocular-depth-design.md`. Reference: img2threejs
(Apache-2.0, cloned at `.superpowers/ref/img2threejs`, study at `.superpowers/ref/img2threejs-study.md`).

Silhouette and depth carving yield one blob with the photo on it. img2threejs yields a chair with
cushions, straps and a rail because a model that knows what a chair is decomposes the photo into
parts, writes procedural geometry and materials, renders, compares and corrects. Sculpt brings that
loop into Vitrum: Claude (Anthropic API) authors and judges, the browser renders, the result is a
GLB the user can take anywhere.

Phase now: quality. Runs on the owner's API key, no accounts. Auth and credits come later and are
out of scope; nothing here should make them hard (every step is a stateless server call with a
job id).

## What the user sees

Product mode, after any import: a **Rebuild as parts** button. Pressing it opens the Sculpt panel:
a stage list (Read photo → Plan parts → Block out → Structure → Form → Materials → Surface → Done),
the model in the main viewport evolving after every pass, a strip of comparison sheets (photo |
render), token and cost counters, Cancel. Optional inputs before start: real width/height/depth
in mm (IKEA lists them; the studio's W/H/D fields feed this), a short hint ("two-seat sofa, oak
legs"). Duration 3–6 min, cost $1–3 on Opus. On finish the parts model replaces the carved hull;
scene controls (floor, lens, backdrop, shadow) apply, finish presets are hidden (materials belong
to the parts), export GLB/STL/PNG work unchanged. The job (spec, code, sheets, GLB) is cached in
IndexedDB and listed under the import so it can be reopened without paying again.

Privacy copy changes: this button sends the photo to Anthropic. The trace/hull/depth paths still
never upload anything.

## Architecture

```
browser (job orchestrator, sandbox renderer, sheet builder, IndexedDB)
   │  POST /api/sculpt/intake   {image, hint, dims}            → Intake JSON
   │  POST /api/sculpt/spec     {intake, image}                → SculptSpec
   │  POST /api/sculpt/build    {spec, pass, code?, defects?}  → code (validated)
   │  POST /api/sculpt/review   {spec, pass, sheet, image}     → Review JSON
   └─ each route: one Claude call, stateless, ≤ 180 s, key from runtime config
sandbox iframe (opaque origin): sculpt kit + three, runs generated code, screenshots, exports GLB
```

### Server (`server/api/sculpt/*.post.ts`, `server/utils/sculpt/*`)
- `@anthropic-ai/sdk`. Key: `runtimeConfig.anthropicKey` (env `NUXT_ANTHROPIC_KEY`). Models from
  runtime config: `sculptModelAuthor` default `claude-opus-5` (intake, spec, build),
  `sculptModelReview` default `claude-sonnet-5` (review). Streaming on, response assembled
  server-side; `maxDuration` 300 for Vercel.
- Every call uses a tool definition with the JSON schema of the expected output (structured
  output); `build` returns `{ code, notes }`. Prompts are Markdown files in
  `server/utils/sculpt/prompts/` (intake.md, spec.md, build-<pass>.md, review.md), adapted from
  img2threejs' `grimoire/intake/image_analysis.md`, `quality_contract.md`, `validation_rubric.md`,
  `build/geometry_patterns.md`, `review/self_correction.md`, `docs/standard-prompts/polish.md`.
  The kit's API reference (`sculpt-kit.d.ts` rendered to Markdown at build) is appended to every
  build prompt so the model composes against real functions.
- `validateCode(code)`: `acorn` parse as a script; must define top-level `function createModel(kit, THREE, options)`;
  forbidden identifiers anywhere: `fetch, XMLHttpRequest, WebSocket, importScripts, eval, Function,
  import, require, document, window, globalThis, self, parent, top, location, navigator, localStorage,
  indexedDB, postMessage, Worker, with`; no string-to-code (`setTimeout('…')`); ≤ 40 kB. The kit
  passes the model a `THREE` namespace object and its own helpers; generated code touches nothing else.
  Fails → the build route asks the model once more with the violation; second failure → 422.
- `validateSpec(spec)`: zod schema below. Fails → one retry with errors; then 422.
- Rate/size limits: image ≤ 4 MB, resized client-side to ≤ 1568 px long side before upload.
- No persistence server-side in this phase. Every response carries `usage` (input/output tokens)
  and `costUsd` computed from a price table in runtime config.

### Spec (`SculptSpec`, zod in `server/utils/sculpt/schema.ts`, shared type in `app/utils/sculpt/types.ts`)
A furniture-sized subset of img2threejs' ObjectSculptSpec 2.1:
```
{ name, id, camera: { yaw, pitch, fov, distance, confidence },
  dimensions: { widthM, heightM, depthM, source: 'user' | 'estimated' },
  symmetry: 'left-right' | 'none',
  suitability: { verdict: 'pass' | 'conditional' | 'reject', reasons[] },
  detailInventory: [{ id, zone, kind, evidence, mapsTo }],
  components: [{ id, name, level: 'macro'|'meso'|'micro', parent, importance, confidence,
      primitive: 'box'|'pillow'|'cylinder'|'capsule'|'torus'|'tube'|'lathe'|'extrude'|'sweep'|'instanced',
      dimensions: { w, h, d }, position[3], rotation[3], edge: { radius, segments },
      attachment: { parent, contact: 'rests-on'|'inserted'|'wrapped'|'bolted', overlap },
      material, localFeatures: [{ id, kind, description, evidence }] }],
  materials: [{ id, family: 'fabric'|'leather'|'wood'|'metal'|'plastic'|'glass'|'stone',
      subtype, baseColor, roughness, metalness, sheen, clearcoat, pattern: { kind, scale, amplitude },
      weave?: { threadsPerCm, contrast }, wear: { edge, dirt } }],
  repetition: [{ id, kind: 'mirror'|'linear', count, pitch, axis, target }],
  reviewViews: ['reference', 'front', 'side', 'top'],
  mustMatch: string[], niceToHave: string[] }
```
Units are metres (real dimensions when the user gave them, else estimated from the object class);
the studio scales the group to `widthMm`. Root scale stays `[1,1,1]` (img2threejs lesson).

### Sculpt kit (`app/utils/sculpt/kit/*`, bundled into the sandbox page; unit-tested in node where DOM-free)
The deterministic half. Generated code calls only this and `THREE`.
- Geometry: `pillow(w,h,d,{radius, bulge, segments})` (rounded box with outward bow, the cushion
  primitive), `box`, `roundedBox`, `cylinder`, `capsule`, `torus`, `tube(path, radius)`,
  `sweep(path, profile, {taper})` with parallel-transport frames, `lathe(profile)`, `extrude(shape, depth, bevel)`,
  `bentTube(points, radius, cornerRadius)` (sled rails, frames), `instanced(geometry, transforms)`.
  Tessellation tiers from `options.quality` ('draft' ≤ 6k, 'standard' ≤ 60k, 'hero') like
  img2threejs' subdivision tiers.
- Surface detail: `seam(mesh, path, {width, depth})`, `piping(path, radius)`, `stitchLine`,
  `button(radius)`, `tuft(mesh, grid)` (as geometry displacement or normal-map stamps).
- Materials: `fabric({color, weave, sheen})`, `leather`, `wood({grain, tone})`, `paintedMetal`,
  `brushedMetal`, `plastic`, `glass` → `MeshPhysicalMaterial` with 1024² canvas maps (albedo sRGB,
  roughness/normal/AO NoColorSpace), seeded PRNG (mulberry32) for repeatability. Ported from the
  reference chair's fabric code and img2threejs `geometry_patterns.md` material recipes.
- Assembly: `part(id, geometry, material, {position, rotation})`, `mirror(part)`, `group`,
  `restOn(child, parent, overlap)` (touching contact, no floating), `root()` returning
  `THREE.Group` with `userData.sculpt = { parts: Record<id, Mesh> }`.
- `kit.d.ts` is the single API document; a script renders it to `prompts/kit-api.md`.

### Sandbox (`public/sandbox/index.html` + `app/sandbox/main.ts` built by a Vite lib config into `public/sandbox/sandbox.js`)
- Loaded as `<iframe sandbox="allow-scripts" src="/sandbox/">`: opaque origin, no cookies, no app
  API, no parent DOM. Page CSP: `default-src 'none'; script-src 'self' 'unsafe-eval'; img-src data: blob:`.
- Protocol (postMessage, both ways, `{ type, id, ... }`):
  `load { code, spec, quality }` → runs `new Function('kit','THREE','options', code + '\nreturn createModel(kit, THREE, options)')`
  inside try/catch with a 10 s watchdog; replies `loaded { parts, triangles, drawCalls, bounds }` or
  `error { message, stack }`.
  `render { views: [{ name, yaw, pitch, fov, distance }], size }` → PNG blobs per view, rig = copy
  of the product stage (hemi 0.9 / key 2.2 / fill 0.8 / rim 0.5, ACES, white), floor shadow.
  `export {}` → GLB ArrayBuffer (GLTFExporter, canvas textures baked as PNG, transferred).
- On the main side `app/utils/sculpt/sandbox.ts` wraps this in promises with timeouts and
  recreates the iframe on any error (a crashed sandbox never affects the app).

### Job orchestrator (`app/utils/sculpt/job.ts`, pure state machine + effects; `useSculpt` composable)
```
intake → spec → for pass of [blockout, structural, form, material, surface]:
   build(pass) → sandbox.load → render(reviewViews) → sheet → review(pass)
      continue    → next pass
      refine-code → build(pass, defects) (≤ 2 per pass, ≤ 8 total)
      refine-spec → spec(with critique) then rebuild this pass (counts as a fix)
      request-input → pause, show the question, resume with the answer
      stop        → finish
→ export GLB → studio.setExternalModel → cache
```
State: `{ id, image, hint, dims, intake, spec, passes: [{ id, code, sheets[], reviews[] }],
usage: { input, output, costUsd }, status, error }`, persisted after every step to IndexedDB
(`sculpt-jobs`), so a reload can resume from the last completed step.

The comparison sheet (`sheet.ts`): one PNG, reference on the left at the solved camera view,
render on the right, then the three ortho views in a row, labels burned in, ≤ 1568 px long side.
One sheet per review call (img2threejs' token-economy rule).

Review output (structured): `{ action, fidelity: 0..1, layers: { silhouetteProportion,
componentStructure, formDetail, materialSurface, lightingCamera }, defects: [{ component, what,
measured, fix }], cameraAdjust?: { yaw, pitch, fov, distance }, question? }`. `continue` needs
fidelity ≥ 0.7 and every `mustMatch` feature judged present; the last pass (surface) needs ≥ 0.8
to finish as "good", else finishes as "approximate" (shown to the user).

### Studio integration
- `GlassStudio.setExternalModel(group | null)`: removes the carved mesh, adds the group centred on
  the floor, scaled so its width = `widthMm`, casts/receives shadows; `exportGLB/STL` walk the
  group; `dims` report the group's box; `rebuild()` is a no-op while an external model is set;
  `setExternalModel(null)` restores the carve.
- `useStudio`: `sculpt` sub-state and actions (`start`, `cancel`, `answer`, `reopen(jobId)`);
  finish hides finish presets; `clearImage` clears the model.
- `SculptPanel.vue` (stage list, sheets strip, counters, question box, cancel) inside the product
  ControlPanel; `MaterialPicker` hidden for a sculpted model.

### Quality harness (`scripts/sculpt-eval.ts`, dev only)
Playwright drives the real studio against a folder of photos (`eval/photos/*.jpg|png`, with an
optional `dims.json`), runs Sculpt end to end, writes `eval/out/<name>/{spec.json, code-*.js,
sheet-*.png, review-*.json, final.glb, final.png, run.json}` and a summary table (fidelity per
layer, passes, fixes, tokens, cost, seconds). Prompts and kit are iterated against this table.
Target before the credits phase: fidelity ≥ 0.8 on 8 of 10 IKEA furniture photos, median cost ≤ $2,
median time ≤ 5 min.

## Error handling
- Any route error, validation failure after retry, sandbox crash after one reload, or watchdog →
  job `failed` with the message; the studio keeps the previous model; the user can retry from the
  last completed pass (state is persisted).
- Anthropic 429/529 → exponential backoff, 3 tries, then failed.
- Cancel aborts the in-flight fetch (`AbortController`) and keeps completed passes.
- Missing key → the button is disabled with "Set NUXT_ANTHROPIC_KEY".

## Testing
- node/vitest: zod schema (valid fixture from the orange chair, invalid variants), `validateCode`
  (each forbidden identifier, size, missing factory), job state machine with a fake transport
  (pass order, fix budgets, refine-spec rebuild, request-input pause/resume, resume from
  persisted state), sheet layout maths, kit geometry (pillow bounds/normals, sweep frame
  continuity, restOn contact) with a canvas stub for materials.
- Sandbox protocol: a Playwright smoke test loads `/sandbox/`, sends a fixture factory (the orange
  chair rewritten on the kit, kept in `tests/fixtures/orange-chair.kit.js`), expects `loaded`,
  a render and a GLB.
- Eval harness run on 10 photos is the acceptance test for the phase.

## Out of scope
Auth, credits, server persistence, multi-photo input, character/animation, LOD, user editing of
the spec (later: a parts list the user can nudge), self-hosted models.
