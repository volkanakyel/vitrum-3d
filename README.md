# Vitrum

Vitrum (Latin for glass) is a single-purpose icon studio: drop a logo, icon or wordmark and it
comes back as a true-to-size 3D object in glass, metal or full colour, traced and built entirely
in the browser. Export GLB, STL or a 2× PNG. Nothing is uploaded — the image never leaves the
device, and the app calls no external API.

Nuxt 4 · Tailwind v4 · shadcn-vue (Reka UI) · Motion for Vue · Three.js.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # server + client build in .output
pnpm generate     # static site (landing is prerendered, studio is client-only)
pnpm typecheck
pnpm test         # vitest: geometry builders, CSP, sample checks
pnpm test:e2e     # playwright (tests/*.spec.ts)
```

To add shadcn-vue components: `npx shadcn-vue@latest add <name>` (they land in
`app/components/ui`).

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Landing page: live material playground, rendered examples, workflow and shareable finishes |
| `/studio` | The icon studio: flat artwork is traced and extruded on the device, opens in glass |

## How it works

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
   roughness map (*grain*); *sheen* adds the grazing glow of cloth. Colour presets follow measured
   dielectric responses (fabric 0.85 with sheen, velvet sheen 1, leather 0.62, bare wood 0.72,
   varnished 0.42 under a 0.75 coat).
6. **Stage.** Two rigs, toggled by "Stand on a floor": a wall stage — a dark room with bright
   softboxes, neutral tone curve, one hard key and a cool rim, a soft silhouette shadow behind the
   model — and a floor stage — a small product-photography set: ACES film curve, a white key
   casting a soft PCF shadow, a warm fill, a white rim from behind, over a sky/ground hemisphere.
   The orbit stays above the floor while it is on.
7. **Export.** GLB (metres; KHR transmission/ior/iridescence for glass, normal + roughness maps and
   KHR sheen for colour), binary STL (millimetres), 2× PNG.

## Files

| Path | Purpose |
| --- | --- |
| `app/pages/index.vue` | landing page, material selection, examples and sharing |
| `app/components/site/LandingScene.vue` | lazy-loaded hero renderer with visibility, reduced-motion and static fallback handling |
| `app/pages/studio.vue` | the editor shell: toolbar, stage, view dock, empty state |
| `app/composables/useStudio.ts` | editor state and the import → trace → build pipeline |
| `app/utils/showcase.ts` | landing showroom and specimen renders, using the same trace and geometry builders as the studio |
| `app/utils/samples.ts` | sample marks drawn in code |
| `app/utils/extrude.ts` | silhouette → bevelled solid, shared by studio and landing |
| `app/utils/glassScene.ts` | `GlassStudio`: renderer, environment, materials, relief builder, exports |
| `app/utils/presets.ts` | `GlassParams`, defaults and material presets |
| `app/utils/trace.ts`, `tracer.ts`, `relief.ts`, `printTexture.ts` | tracing, worker client, height fields, colour textures |
| `app/utils/surface.ts` | colour finish PBR maps from the picture: de-lit albedo, grain normal and roughness |
| `app/components/studio/*` | control panel, viewer, loader, fields |
| `app/components/site/*` | navigation and footer |
| `app/components/ui/*` | generated shadcn-vue primitives |

## Landing page sharing

Set `NUXT_PUBLIC_SITE_URL` to the public origin (for example `https://your-domain.com`) **before building** so the prerendered Open Graph and Twitter images use absolute URLs. Without it, the image paths remain relative for local previews. The social image is `public/images/vitrum-social.png`.

Shared landing links preserve the material with `?finish=gold`. Example links use `/studio?sample=star&finish=chrome` to open that sample and finish directly. Preview images in `public/images` are captures of the actual Three.js scene, not external artwork. Only the hero uses a live canvas; offscreen rendering pauses, and reduced motion uses a still frame.
