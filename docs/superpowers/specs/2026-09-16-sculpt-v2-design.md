# Sculpt v2: one-shot parts model, separate studios

Date: 2026-09-16. Supersedes the run loop in `2026-09-15-sculpt-design.md`; the kit, the sandbox,
the sheet, the store, the guard and the code validator stay.

## Why

The v1 loop (intake → spec → five build passes, each reviewed up to twice, eight fixes job-wide)
measured at 26 minutes, $1.49 and 150k tokens on the desk photo, then stopped after pass two with
**nothing on the stage**: the GLB is only exported when the whole run finishes. The proof of
concept (`../orange-chair-bed`) that set the quality bar was written in one authoring shot: one
435-line file, one visual check.

## The loop

At most **four model calls**, and the model reaches the stage after the second.

| # | Route | Model | Sees | Returns | Cap |
| --- | --- | --- | --- | --- | --- |
| 1 | `plan` | author | photo, hint, dims | `SculptSpec` (intake folded in) | 12k out |
| 2 | `build` | author | photo, spec | complete factory (`createModel`) | 24k out |
| 3 | `review` | reviewer | sheet (holds the photo), spec, part table | fidelity, defects | 4k out |
| 4 | `build` (fix) | author | photo, spec, code, defects, part table | complete factory | 24k out |

Between 2 and 3 the sandbox loads the code, renders, exports the GLB and **the model lands on the
stage as a draft**. Step 3 runs only when *Polish* is on (default). Step 4 runs only when the
review found defects and scored below 0.85. After 4 the model is re-exported and replaces the
draft. There is no third fix, no spec revision, no question to the user, no pass ladder.

A runtime error on load spends the fix call (step 4) with the error as the one defect; a second
failure ends the run `failed` with the draft (if any) still on stage.

Budget per run: ~$0.4–0.9, 1–4 minutes. Hard cap by construction, not by counters.

## Prompts

- `plan.md`: the intake's eight-layer reading discipline plus the spec grammar, one call. Output
  is the existing `SculptSpec` (unchanged schema, unchanged validator).
- `build.md`: the v1 contract (sandbox rules, kit, exemplar) rewritten for a **finished** model in
  one file: every part, seated contacts, real materials, seams/buttons/piping. The photo is
  attached: the author sees what it builds.
- `review.md`: one goal, the finished model against the photo. Scores and measured defects; the
  `action` field is gone (the runner decides from `fidelity` and `defects`).

## Client

- `SculptJob`: `spec`, `code`, `sheets[]`, `review`, `fixed` (bool), `glb`, `draft` (bool while
  the review is pending), `usage`, `costUsd`, `status`.
- `JobStatus`: `idle | planning | building | rendering | reviewing | fixing | exporting | done |
  failed | cancelled`.
- `JobRunner.run()` resumes coarsely: has spec → skip plan; has code → skip build; has review →
  skip review. `answer()`/`waiting-input` removed.
- The runner calls `deps.onModel(glb)` as soon as the first export succeeds, and again after the
  fix, so `useSculpt` puts the draft on the stage immediately. Auto-rotate turns on when a parts
  model lands (turntable), as in the POC.
- IndexedDB store name bumps to `vitrum-sculpt-v2`; v1 jobs are not migrated.

## UI

- The studio's two modes become two visibly different workspaces. Header pill reads
  **Icon studio / Product studio**. Product mode's panel opens on a *Parts model* card above the
  carve sections: build button, hint, polish toggle, a four-step progress rail with elapsed time
  and cost, the latest comparison sheet, and history. The carve sections sit under a
  *Silhouette carve* heading and describe themselves as the offline fallback.
- Icon mode never shows the card.
- Icon render: darker, higher-contrast glass stage defaults so a traced mark reads as glass rather
  than a faint ghost (tuned by screenshot).

## Tests

`sculpt-job`, `sculpt-routes`, `sculpt-schema`, `sculpt-store` rewritten for the new shapes.
`scripts/sculpt-eval.ts` and `sculpt-smoke.mjs` follow the new routes. One live run on the
Akielle tube photo is the acceptance check.
