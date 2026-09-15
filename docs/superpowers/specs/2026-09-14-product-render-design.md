# Product render: what the orange chair bed does that Vitrum did not

Date: 2026-09-14. Reference: `../orange-chair-bed` (an `img2threejs` hand-authored procedural
model of one object). Vitrum builds any object from any picture, so nothing per-object can be
copied; what can be copied is the *rendering recipe* that makes that chair read as a real object.

## Differences that matter

| Reference | Vitrum before | Vitrum after |
| --- | --- | --- |
| True volume: 0.80 × 0.55 × 0.78 m, pillowed boxes | Inflate opens 100 × 87 × **11** mm: a pancake | Product profile opens at depth ≈ 0.5 × width, pillow roundness |
| Fabric PBR: flat albedo + weave `roughnessMap` + weave `bumpMap` + seam creases | Photo as albedo under a lacquer (`clearcoat 0.35`), no micro maps | `surface.ts`: albedo de-lit, normal map + roughness map derived from the picture's own grain; sheen for cloth |
| Baked light removed (albedo is a flat colour), light comes from the scene | Photo's baked shading rendered again under studio lights (double lighting) | `flatten` divides the albedo by its low-pass luminance |
| Key light casts a PCF-soft shadow on a `ShadowMaterial` floor; object stands on y = 0 | Blurred silhouette on a plane *behind* the model; object floats | `floor` scene switch: shadow-casting key, floor plane under the model, orbit clamped above the floor |
| 40° lens, three-quarter view from above | 28° lens, near-frontal angle | Product profile: 35° lens, `angle` view from 30° yaw / 18° pitch |
| ACES tone mapping | Neutral | Neutral kept: product colours stay true; glass presets tuned for it |

## Design

### `app/utils/surface.ts` (new, pure)
`buildSurfaceMaps(image: ImageData, opts)` returns three `ImageData`: albedo (optionally
de-lit), normal (Sobel of the high-pass luminance, tangent space, +Y up), roughness (base ±
grain). Pure array math so it is unit-tested in node; `surfaceCanvases()` wraps it for the
renderer. Maps are built at ≤1024 px, the albedo at the print texture's own size.

### `GlassParams` additions (presets.ts)
`flatten` 0..1 (de-light), `grain` 0..1 (normal + roughness variance), `sheen` 0..1 (cloth
sheen), `floor` boolean (stand on a floor with a cast shadow). Print presets set all three; the
`acrylic` preset becomes `fabric` (rough, no lacquer, sheen, grain, flattened).

### GlassStudio (glassScene.ts)
- `print` material gains `normalMap`, `roughnessMap`, `sheen`; maps are rebuilt from the print
  texture when `flatten`/`grain` change (debounced by the easing loop's `built` signature).
- Floor: `THREE.Mesh(PlaneGeometry, ShadowMaterial)` at the mesh's bottom; the key light casts
  (`PCFSoftShadowMap`, 2048), its shadow camera hugs the model on every rebuild. The old
  contact-shadow plane stays for `floor: false` (icons on a wall).
- `setView('angle')` picks the product angle when `floor` is on.
- GLB export carries the normal/roughness maps and `KHR_materials_sheen`.

### Mode (useStudio.ts, studio page)
`MODE_PROFILES`: what each mode opens an import as — geometry, depth ratio, volume, finish
preset, floor, lens. Switching the mode re-applies the profile to the current image (not only
to the next import), so the switch is visible. The switch is in the header on desktop and in
the panel header on mobile, with the mode's hint as a tooltip.

### Views: multi-view carve (added 2026-09-15)
A single three-quarter photo cannot yield a chair's L-shaped side. img2threejs' one transferable
deterministic idea is the visual hull. `hull.ts` takes the front outline plus an optional side and
top outline, builds a signed distance field per view (EDT, exact polygon distance within 4 px of
the edge), combines them with a smooth minimum whose fillet is the Volume section's *Roundness*,
and runs marching cubes (three's edge/tri tables) on a grid of 96/128/176 cells. Normals come from
the field gradient; triangles are wound to agree with it. Colours are painted per vertex from the
photo each vertex faces (normal component squared; missing views hand their weight to the front
photo), de-lit with *Flatten*. The hull runs on the trace worker; the single-photo Inflate path is
untouched and returns when the extra views are removed. Conventions: side photo columns run
back→front (front on the right), top photo rows run back→front (front at the bottom); each view
has a Mirror toggle. Limits: a hull is an upper bound (no concavity a view does not see); a bumpy
front outline extrudes into ridges along the depth.

### Oriented carve (2026-09-15, second pass)
The desk showed the single-view carve's limit: a three-quarter photo extruded straight back tilts
the top and skews the legs, and the tracer's stretched fields dropped the lit top face entirely.
Changes: (1) `Object` trace mode, an absolute colour distance from the page with bright grey
(shadow) pixels rejected, used for product imports and extra views; (2) every view is an
orthographic camera with yaw and pitch (`cameraBasis`), the front photo's camera side is read from
the slant of the outline's top edge (`estimateCameraSide`) with a manual override; (3) the mirror
view (symmetric objects) and the object's box (W from the silhouette width and the yaw, H from the
silhouette height minus the pitch term, D from the D field or a side/top photo) join the carve;
(4) paint refuses samples outside a view's outline (2 px margin) and gives unseen faces the object's
mean colour. Lesson recorded: with pitch, mirroring the image is not mirroring the object, so the
yaw sign must match the photo or each view cuts half the top away.

### Rendering pass (2026-09-15, third pass)
Compared against img2threejs' emitted renderer (`create*LookDevLights`, `create*Environment`,
`configure*Renderer`, `THREEJS_MATERIAL_REFERENCE.md`, `material_physics.py`):

| img2threejs | Vitrum before | Vitrum now |
| --- | --- | --- |
| `RoomEnvironment` PMREM, ACES, sRGB | glass softbox room, Neutral | product stage swaps to RoomEnvironment (0.35) + ACES; wall stage keeps the glass studio |
| hemi 0.85 + warm key 2.15 (4096 shadow) + cool fill 0.42 + warm rim 0.85 | white key 2.2 + cool rim | hemi 0.55, warm key 1.7 with 4096 PCF shadow (radius 7), cool fill 0.35, warm rim 0.85 (behind, above) |
| material table per finish | natural / fabric / matte / satin / gloss / acrylic | + velvet (sheen 1), leather (0.62, coat 0.08), wood (0.72), varnished (0.42, coat 0.75); fabric 0.85 / sheen 0.65 |
| sheen × sheenColor is one number; sheen darkens the base by 0.157 × strength | sheen white, no compensation | sheen colour = albedo map (print) or the object's mean colour (hull); base lifted by 1 / (1 − 0.157 · sheen) |
| per-object textures at photo resolution | hull painted per vertex (~4 px per vertex) | photos projected in the shader: per-vertex uv + weight per view, front grain as normal/roughness maps |

`projectHull` also fades faces every camera saw only at a grazing angle (squarest |cos| under
0.25–0.55) to the mean colour of the well-seen faces, and `padSilhouette` treats page-coloured
pixels the outline wrapped (a jagged bottom edge over a floor shadow) as page before padding.

Known limit found on the desk: the photo is perspective, the carve is orthographic, so a slanted
top edge becomes a top that dips toward the back (10° on the desk). Camera solving is out of scope.

### Out of scope
Per-part decomposition (seat/back/rail), a fabric weave generator, camera solving, an LLM
authoring step (img2threejs' actual engine): that needs an API key and would send the photo off
the machine, against Vitrum's promise that no image leaves the browser.

### Reference rig, verbatim (2026-09-15, fourth pass)
The third pass copied img2threejs' *generic* emitted renderer. The reference app itself
(`OrangeChairBed.client.vue` + `createOrangeChairBedLookDevLights('reference')`) is simpler and
looks better: **no environment map**, `MeshStandardMaterial` at roughness 1 × a 0.88 roughness map,
no sheen, no coat, and four lights. The product stage now runs that rig to the number:

| Reference | Vitrum product stage now |
| --- | --- |
| hemi white / `#d8d2cc` 0.9 | same |
| key white 2.2 from (−2.2, 3.4, 2.6), 2048 PCFSoft shadow, bias −0.0002, normalBias 0.02 on a 0.8 m chair | same direction; PCF radius 3 (PCFSoft is deprecated in r185 and falls back to PCF); normalBias 0.02 × half-diagonal |
| fill `#fff4ec` 0.8 from (2.4, 1.6, 2.0); rim white 0.5 from (0, 2.5, −3) | same |
| ACES, sRGB, `ShadowMaterial` 0.18, white background, 40° lens | product profile: `shadow` 0.18, `background` #ffffff, `vignette` 0, `fov` 40 |
| camera (1.15, 0.72, 2.05) at a target 0.45 up | `angle` view = (±1.15, 0.27, 2.05), the sign from the photo's own camera side (`hull.frames[0].d.x`) |
| no `scene.environment` | none for the Color finish on the floor; glass and metal keep the room (they are nothing without reflections) |
| fabric: flat albedo, roughness 0.88, bump 0.6 | `fabric` preset: roughness 0.88, coat 0, sheen 0, flatten 0.7, grain 0.4; product mode opens with it |

Result on the chair photo: the salmon, blown, glossy-rimmed render became the reference's saturated
matte orange on white with one soft floor shadow. What still differs is geometry, not rendering:
a single photo gives a wedge-shaped backrest and a smeared side face (see the carve limits above).

### Surface pass (2026-09-15, fifth): why the chair still looked terrible after the rig matched
Rendering was right; the *surface* and the *silhouette* were not, and none of it was lighting:

| Symptom on the chair photo | Cause | Fix |
| --- | --- | --- |
| Brush-stroke texture everywhere | the photo's JPEG grain as a normal map, stretched where the photo was projected at an angle | `grain` 0 for cloth; new `weave` param: a procedural woven bump in the shader from the object-space position (uniform cell = width/180, the reference's density), faded once a cell is under 2 px |
| Smeared pixels, white gaps under the rail, dark line along the top edge | the photo sampled pixel by pixel; the outline's own edge pixels reach the surface | new `soften` param (GPU blur of the padded albedo, after padding so the page never bleeds); `padSilhouette` erodes 5 trace px instead of 3 (via the exact distance transform, one pass for any radius) |
| Staircase along every crease, in geometry and colour | marching cubes facets and, worse, the **mirror view competing with the real photo**: both see a side face at cos 30° ≈ 0.5, the per-vertex winner flips along the crease on the voxel grid | `smoothSurface` (welded Laplacian on positions, more passes on normals); a mirrored frame only paints where its real camera's cos < 0.25; the grazing fade band moved to 0.12–0.3; the paint's accept mask is the outline *dilated* by the padding's reach, not eroded |
| Traced outline's pixel steps extruded into ridges | polygon straight from the tracer | `smoothOutline`: rings resampled at 1 px and box-filtered over 1.2% of the outline |

Result: a flat matte orange volume with a fine weave on a white floor with one soft shadow, as the
reference. What remains is **shape**: one three-quarter photo plus its mirror gives a rounded block,
not a seat with a backrest; the reference model was hand-authored per part from the photo by an
LLM. Options, none implemented: a side photo (already supported, gives the L), an in-browser
monocular depth model (~25 MB ONNX, keeps the no-upload promise, new subsystem), or an LLM
authoring step (breaks the promise).

Testing note: a backgrounded Chrome tab throttles timers and stops `requestAnimationFrame`, and
the import awaits a frame, so an import in a hidden tab looks stalled for 30 s. Keep the tab in front.
