# Vitrum

Vitrum (Latin for glass) turns an icon, logo or product picture into a true-to-size 3D object in
glass, metal or full colour, rendered with Three.js and exported as GLB, STL or PNG. Everything
runs in the browser; no image leaves it and no mesh or art pack is ever downloaded. The objects
on the landing page are built the moment the page opens, from SVG paths and canvas drawings that
live in code.

Nuxt 4 · Tailwind v4 · shadcn-vue (Reka UI) · Motion for Vue · Three.js.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # server + client build in .output
pnpm generate     # static site (landing is prerendered, studio is client-only)
pnpm typecheck
pnpm test         # vitest: geometry builder and sample checks
pnpm test:e2e     # playwright: the sculpt sandbox smoke test (tests/*.spec.ts)
pnpm kit-api      # re-render the sculpt kit's API doc into the build prompt
pnpm eval         # sculpt quality harness over eval/photos (needs a key)
pnpm sculpt-smoke <photo>   # one live intake + spec call against a running dev server
```

To add shadcn-vue components: `npx shadcn-vue@latest add <name>` (they land in
`app/components/ui`).

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Landing page: a fixed WebGL showroom behind four scroll stations (hero, icons, products, materials) |
| `/studio/icon` | Studio in icon mode: flat artwork is traced and extruded, opens in glass |
| `/studio/product` | Studio in product mode: an object picture is inflated into a volume that keeps its colours |

The mode decides how a picture is read: icon opens as a thin slab on a wall, shot square on;
product opens as a volume about half as deep as it is wide, in its own colours, standing on a
floor with a cast shadow, shot three-quarter from above. Switching the mode re-opens the current
image the new way. Every geometry, finish and scene control stays available in both.

## How the studio works

1. **Rasterize.** The file (PNG, JPG, WebP or SVG) is drawn onto a canvas. A 512 px detection pass
   finds the artwork; when it fills less than ~60% of the page the source is cropped to it and
   traced again at the working resolution (512–2048 px).
2. **Mask.** A scalar field is built from dark pixels, light pixels, alpha, or colour distance from
   the page background. `Auto` tries every field, drops regions touching the border, and keeps the
   largest survivor.
3. **Trace.** `d3-contour` cuts the field at the threshold with sub-pixel interpolation; a
   Ramer–Douglas–Peucker pass simplifies. Steps 1–3 run in a Web Worker (`app/workers`), with a
   main-thread fallback through the same `Tracer` API.
4. **Geometry.** *Extrude* bevels the silhouette into a slab (`app/utils/extrude.ts`). *Stack* keeps
   an icon's tile and raises each colour as a layer. *Inflate* puffs the silhouette into a rounded
   volume from its distance field, mirrored front and back. *Relief* reads a height from every pixel.
   All models are built in millimetres.
5. **Finish.** Glass uses `MeshTransmissionMaterial` with a two-pass refraction and a small shader
   patch for total internal reflection at the rims. Metal and ceramic are single-pass PBR. Colour
   samples the picture at native resolution, padded past the outline so walls take the edge colour,
   then splits it into PBR maps (`app/utils/surface.ts`): the picture's own shading is divided out
   of the albedo (*flatten*) so the studio lights the volume, and its grain becomes a normal and
   roughness map (*grain*); *sheen* adds the grazing glow of cloth.
6. **Carve.** A product photo is rarely frontal, so in product mode the outline is traced as the
   whole object (`Object` source mode: anything off the page, soft floor shadows excluded) and
   carved along the camera that took it (`app/utils/hull.ts`): yaw and pitch from the *Views*
   section, the camera side read from the outline's slanted top edge. The object's mirror view
   (products are left–right symmetric) and its box (width from the silhouette, depth from the D
   field) are two more constraints; a side or top photo replaces the guessed depth with a measured
   one. Each constraint is a signed distance field, they meet in a smooth minimum, marching cubes
   pulls out the surface, and the photos are projected onto it at full resolution: each vertex
   carries a texture coordinate and a weight per photo (`projectHull`), the shader blends them,
   the front photo's grain gives the normal and roughness maps, and faces every camera saw only
   at a grazing angle fade to the object's mean colour. Photos are padded past their outline
   (page-coloured pixels the outline wrapped count as page) so no edge samples the background.
   This is the visual-hull idea from img2threejs, run in the browser on the trace worker.
   Silhouettes alone cannot tell a seat from a backrest, so a depth model adds the relief: Depth
   Anything V2 small runs in its own worker (`app/workers/depth.worker.ts`, WebGPU when there is
   one, else WASM; ~27 MB of weights fetched once and cached, the photo never leaves the browser),
   its map is normalised over the outline and padded past it (`app/utils/depth.ts`), and it joins
   the carve as one more field: nothing in front of the surface the photo shows, mirrored for the
   other side. The *Depth* slider scales the cut (0.4 by default: relative depth exaggerates far
   surfaces); at 0 the outline hull stands, and it also stands when the model cannot load.
7. **Stage.** Two rigs. A logo hangs on a wall in the glass studio: a dark room with bright
   softboxes, neutral tone curve, one hard key and a cool rim, a soft silhouette shadow behind
   it. An object stands on a floor in a product set, as img2threejs' look-dev lights do it: a
   neutral `RoomEnvironment`, ACES film curve, warm key casting a 4096 px PCF shadow onto a
   `ShadowMaterial` plane, cool fill, warm rim from behind, sky/ground ambient; the orbit stays
   above the floor. Colour presets follow measured dielectric responses (fabric 0.85 with sheen,
   velvet sheen 1, leather 0.62, bare wood 0.72, varnished 0.42 under a 0.75 coat); sheen takes
   the object's own colour, and the base is lifted by the 0.157 × sheen three takes back.
8. **Export.** GLB (metres; KHR transmission/ior/iridescence for glass, normal + roughness maps and
   KHR sheen for colour, vertex colours for a carved hull), binary STL (millimetres), 2× PNG.

## Sculpt (parts model)

Everything above runs in the browser and nothing leaves it. Sculpt is the one exception, and it is
opt-in per press: in the product studio, **Build the parts model** sends the imported photo to
Anthropic's API and asks Claude to rebuild the object as a *parts model* — a chair with a seat, a
back, four legs and its own materials, instead of one carved blob wearing the photo.

The loop is four model calls at most, and the model is on the stage after the second:

1. **Plan.** Claude reads the photo and writes a `SculptSpec`: components, dimensions, materials,
   what must match.
2. **Build.** Claude writes the whole model as one file of procedural three.js against an in-repo
   kit (`app/utils/sculpt/kit/`), looking at the photo as it writes. The file runs in an
   opaque-origin `<iframe sandbox="allow-scripts">` (`/sandbox`), is exported as a GLB and
   **lands on the stage as a draft**, on the turntable, about a minute in.
3. **Review** (with *Polish* on, the default). The sandbox renders four views, pasted into one
   comparison sheet next to the photo; a cheaper model scores it and lists measured defects.
4. **Fix** (only when the review scored under 0.85 with defects). One rebuild of the same file,
   with the defects and the measured box of every part; it replaces the draft. A fix that will not
   load leaves the draft standing.

Scene controls, GLB/STL/PNG export and the size fields all work on the model unchanged. The run
(spec, code, sheets, review, GLB) is cached in IndexedDB and can be reopened without paying again.
Expect 1–4 minutes and $0.30–0.90 per run.

**The photo goes to Anthropic.** The panel says so, and only this button does it: tracing, carving
and depth all still stay in the browser.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NUXT_ANTHROPIC_KEY` | *(unset)* | Server-only API key. Without it the sculpt routes reply 503 and the button is hidden. |
| `NUXT_ANTHROPIC_WORKSPACE_ID` | *(unset)* | Only needed when the key is not itself scoped to a workspace. |
| `NUXT_SCULPT_DAILY_BUDGET_USD` | `25` | Ceiling on what the sculpt routes may spend in one UTC day. `0` disables it. |
| `NUXT_PUBLIC_SCULPT_ENABLED` | `false` | Forces the panel on in the client. Normally unnecessary: the client asks `/api/sculpt/status`, which reports whether the server has a key. |

### Deployment posture

The `/api/sculpt/*` routes spend the owner's Anthropic credit and **have no authentication**. Real
auth and paid credits are the next phase. Until then they carry defence in depth only: a per-IP
rate limit (30 requests / 10 minutes), a daily spend ceiling, an 8 MB body cap, and server-side
validation of every image, spec and generated file. Both counters live in the serving process's
memory, so on a serverless platform they are per instance, not global.

**Do not set `NUXT_ANTHROPIC_KEY` on a publicly reachable deploy before the auth phase.** Run it
locally, or behind an access control of your own. A deploy without the key is safe and inert: the
routes refuse, and the studio simply does not offer the button.

The routes also need a long function timeout (`maxDuration: 300`, set in `nuxt.config.ts`), which
on Vercel means a Pro plan; Hobby caps functions at 60 s and a run will be cut off mid-file.

Further reading: [`eval/README.md`](eval/README.md) for the quality harness, and
[`docs/superpowers/specs/2026-09-16-sculpt-v2-design.md`](docs/superpowers/specs/2026-09-16-sculpt-v2-design.md)
for the design.

## Files

| Path | Purpose |
| --- | --- |
| `app/pages/index.vue` | landing page and its scroll stations |
| `app/pages/studio/[[mode]].vue` | the editor shell: toolbar, mode tabs, stage, dock, empty state |
| `app/composables/useStudio.ts` | editor state and the import → trace → build pipeline |
| `app/utils/showcase.ts` | landing showroom: one renderer, objects on a rail, camera docked per station |
| `app/utils/samples.ts` | sample sources drawn in code (icons, the mark, an armchair, a mug) |
| `app/utils/extrude.ts` | silhouette → bevelled solid, shared by studio and landing |
| `app/utils/glassScene.ts` | `GlassStudio`: renderer, environment, materials, relief builder, exports |
| `app/utils/presets.ts` | `GlassParams`, defaults and material presets |
| `app/utils/trace.ts`, `tracer.ts`, `relief.ts`, `printTexture.ts` | tracing, worker client, height fields, colour textures |
| `app/utils/surface.ts` | colour finish PBR maps from the picture: de-lit albedo, grain normal and roughness |
| `app/utils/hull.ts` | multi-view visual hull: outline distance fields → marching cubes, per-view projection (uv + weight per vertex) |
| `app/utils/sculpt/kit/*` | the sculpt kit: the geometry, surface, material and assembly helpers generated code is allowed to call |
| `app/utils/sculpt/{job,sandbox,sandboxRuntime,sheet,store,transport,glb}.ts` | job state machine, the sandbox host and its page-side runtime, comparison sheets, IndexedDB cache, route client, GLB safety check |
| `app/composables/useSculpt.ts` | Vue glue for a sculpt run: reactive job, start/cancel/answer/reopen |
| `server/utils/sculpt/*` | route cores, zod schemas, the Anthropic client, `validateCode`, the CSP strings, the rate-limit/budget guard |
| `server/utils/sculpt/prompts/*.md` | the plan, build and review prompts; `kit-api.md` is generated, `exemplar.md` is the kit fixture |
| `server/api/sculpt/*` | `plan`, `build`, `review` (POST) and `status` (GET) |
| `app/components/studio/*` | control panel, viewer, loader, fields |
| `app/components/site/*` | navigation and footer |
| `app/components/ui/*` | generated shadcn-vue primitives |
| `tests/*` | vitest: extrude builder, corner rounding, sample integrity, inflate normals, surface maps, hull carving |
