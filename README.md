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
```

To add shadcn-vue components: `npx shadcn-vue@latest add <name>` (they land in
`app/components/ui`).

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Landing page: a fixed WebGL showroom behind four scroll stations (hero, icons, products, materials) |
| `/studio/icon` | Studio in icon mode: flat artwork is traced and extruded, opens in glass |
| `/studio/product` | Studio in product mode: an object picture is inflated into a volume that keeps its colours |

The mode only decides what a fresh import opens as. Every geometry, finish and scene control is
available in both.

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
   samples the picture at native resolution, padded past the outline so walls take the edge colour.
6. **Export.** GLB (metres, KHR transmission/ior/iridescence), binary STL (millimetres), 2× PNG.

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
| `app/components/studio/*` | control panel, viewer, loader, fields |
| `app/components/site/*` | navigation and footer |
| `app/components/ui/*` | generated shadcn-vue primitives |
| `tests/*` | vitest: extrude builder, corner rounding, sample integrity |
