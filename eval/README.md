# Sculpt eval harness

`pnpm eval` runs the real Sculpt pipeline over a folder of product photos and writes one row per
photo into a table. The prompts (`server/utils/sculpt/prompts/*.md`) and the kit
(`app/utils/sculpt/kit/`) are tuned against that table, not against a single hand-picked photo.

The harness starts its own Nuxt dev server on a free port and kills it when it is done, so it will
not disturb a dev server you already have open. It drives the studio through Playwright exactly as
a person would: import the photo, wait for the carve, press the sculpt button (via the dev-only
`window.__vitrum` hook), wait for the run.

## 1. Add photos

Drop the photos into **`eval/photos/`** — `.jpg`, `.jpeg`, `.png` or `.webp`. Nothing here is
committed (`.gitignore` keeps only `.gitkeep`), so the photos stay yours.

One object per photo, whole object in frame, plain background, the sort of three-quarter shot a
catalogue uses. The file name without its extension is the **run name**: it names the output folder,
the `--only` flag and the summary row. Prefer `strandmon-wing-chair.jpg` over `IMG_4312.jpeg`.

IKEA product photos are the reference set — they come with exact measurements, which is what makes
the fidelity numbers mean anything.

## 2. Describe them in `eval/dims.json`

`eval/dims.json` maps a photo to the hint and the real-world size the run is given. The key is the
file name, with or without the extension:

```json
{
  "strandmon-wing-chair": {
    "hint": "IKEA STRANDMON wing chair, buttoned back, turned wooden legs",
    "widthMm": 820,
    "heightMm": 1010,
    "depthMm": 960
  }
}
```

- `hint` — one line of text, exactly what a user would type into the sculpt panel: the product name
  and anything the photo hides. Optional; an empty hint tests the planner on its own.
- `widthMm` / `heightMm` / `depthMm` — the real size in millimetres. Take these from the IKEA
  product page, section **"Measurements"** (Width / Height / Depth), and convert cm → mm (a
  `Width: 82 cm` becomes `"widthMm": 820`). All three must be present or the run is told nothing and
  the planner estimates the size itself — which is a legitimate thing to test, just a different one.

Entries for photos that are not in `eval/photos/` are ignored, so the file can carry the whole
reference set.

## 3. Run

```bash
pnpm eval                              # every photo in eval/photos
pnpm eval --only strandmon-wing-chair  # one photo (comma-separate for several)
pnpm eval --no-polish                  # plan and build only, no review or fix — cheap prompt iteration
pnpm eval --quality draft              # sandbox render quality: draft | standard | hero
pnpm eval --headed                     # watch it happen
pnpm eval --base http://localhost:3000 # reuse a dev server you started yourself
pnpm eval --timeout 25                 # per-photo budget in minutes (default 45)
EVAL_VERBOSE=1 pnpm eval                # echo the dev server's stdout too (stderr is always shown)
```

`--base` only works with a dev server started with `VITRUM_SANDBOX_E2E=1` (the opaque-origin sandbox
frame needs the CORS relaxation that flag turns on):
`VITRUM_SANDBOX_E2E=1 pnpm dev --port 3000`.

A run that is still going after `--timeout` minutes is cancelled and recorded as `cancelled`. The
process exits non-zero if any run did not reach `done`.

Before the first photo the harness loads the studio once and checks that sculpt is switched on; if
the server has no `NUXT_ANTHROPIC_KEY` it stops immediately with "sculpt is disabled" rather than
burning a timeout per photo. Ctrl-C stops the dev server it started (a server given with `--base` is
never touched).

## 4. What it writes

`eval/out/<name>/` (untracked):

| file | what |
| --- | --- |
| `spec.json` | The plan: object class, camera, dimensions, parts and materials. |
| `code.js` | The generated `createModel`, as it was last run (the fix when there was one). |
| `sheet-<n>.jpg` | The photo-vs-render comparison sheets: the draft, then the fix. |
| `review.json` | The review: fidelity, per-layer scores, defects, summary. |
| `notes-<pass>.json` | The builder's notes carried into the next pass. |
| `final.glb` | The exported parts model. |
| `final.png` | The viewer render with that model on the stage. |
| `run.json` | Status, quality, fidelity per pass, layer scores, fixes, tokens, cost, seconds. |

and one appended row in `eval/out/summary.md`.

## 5. Reading the table

```
| name | quality | final fidelity | silhouette/structure/form/material/lighting | fixes | tokens | $ | s |
```

- **quality** — the render quality the run used, then the outcome: `good` (the review scored
  ≥ 0.85), `approximate` (below that, or no review), or the failure/cancel reason.
- **fidelity** — the review's overall score of the draft, 0–1. The target is ≥ 0.8 on 8 of 10 photos.
- **the five layers** — the last review's per-layer scores in the fixed order
  silhouette/proportion, component structure, form detail, material/surface, lighting/camera. This
  is the column to read when tuning: a column that is low across many rows is a prompt or kit
  problem, not a photo problem. Low silhouette → the plan's dimensions; low structure → floating or
  misattached parts (`restOn`); low form → cushions and fillets; low material → the build prompt's
  material rules; low lighting → the camera the planner guessed.
- **fixed** — whether the one fix round was spent (the review scored under 0.85 with defects).
- **tokens / $ / s** — input/output tokens, informational USD cost (the per-million prices in
  `nuxt.config.ts` are placeholders), wall-clock seconds. Targets: median ≤ $2, median ≤ 5 min.

Keep the old `summary.md` rows when iterating — before/after on the same photo is the only honest
measure of a prompt change.

## Requirements

- `NUXT_ANTHROPIC_KEY` must be set in `.env` **and the key must be scoped to a workspace**. An
  unscoped key fails at the first call with
  `This API key is not scoped to a workspace...`, and every run is recorded as `failed` with that
  message. If the key belongs to a workspace, set `NUXT_ANTHROPIC_WORKSPACE_ID` too.
- Each run is real money — `--only` and `--no-polish` while iterating on prompts, the full folder only
  for a baseline.
- The dev server must be a dev build: the harness drives `window.__vitrum`, which only exists when
  `import.meta.dev` is true.
