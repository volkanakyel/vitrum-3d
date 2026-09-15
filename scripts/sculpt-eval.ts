/**
 * Sculpt quality harness — `pnpm eval`.
 *
 * Playwright drives the real studio (not a mock): for every photo in
 * `eval/photos` it opens `/studio/product`, imports the photo through the file
 * input, waits for the carve to settle, then calls the dev-only hook
 * `window.__vitrum.sculpt.start(hint, dims, { quality })` and polls the job
 * until it settles. Everything the run produced — spec, intake, generated code,
 * comparison sheets, reviews, the GLB and a viewer render — lands in
 * `eval/out/<name>/`, and one row per run is appended to `eval/out/summary.md`.
 * The prompts and the kit are tuned against that table.
 *
 * The harness starts its own Nuxt dev server on a free port and kills it at the
 * end, so it never disturbs a dev server you already have running; `--base`
 * reuses one instead.
 *
 * See `eval/README.md` for photos, `dims.json` and how to read the table.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PHOTOS_DIR = join(ROOT, 'eval/photos')
const OUT_DIR = join(ROOT, 'eval/out')
const DIMS_PATH = join(ROOT, 'eval/dims.json')
const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

/** Pass order, mirrored from `app/utils/sculpt/types.ts` (this script runs outside the Nuxt tsconfig). */
const PASSES = ['blockout', 'structural', 'form', 'material', 'surface'] as const
type PassId = (typeof PASSES)[number]
type Quality = 'draft' | 'standard' | 'hero'

/** Chromium in a headless shell has no GPU; WebGL comes from ANGLE on SwiftShader. Kept in step with `playwright.config.ts`. */
const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  // A sandboxed iframe sharing the host's renderer process freezes the host
  // along with itself when generated code spins.
  '--site-per-process',
  '--enable-features=IsolateSandboxedIframes:grouping/per-document',
]

const POLL_MS = 2_000
const DEFAULT_RUN_TIMEOUT_MS = 15 * 60_000
const SERVER_TIMEOUT_MS = 180_000
/** The carve's hull is nice to have in `final.png` but not worth failing a run over. */
const HULL_WAIT_MS = 120_000
const IMPORT_TIMEOUT_MS = 180_000

// ---------------------------------------------------------------- arguments

interface Options {
  only: string[]
  passes: PassId[] | null
  quality: Quality
  headed: boolean
  base: string | null
  timeoutMs: number
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { only: [], passes: null, quality: 'standard', headed: false, base: null, timeoutMs: DEFAULT_RUN_TIMEOUT_MS }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${arg} needs a value`)
      return v
    }
    switch (arg) {
      case '--only': opts.only.push(...next().split(',').map(s => s.trim()).filter(Boolean)); break
      case '--passes': {
        const names = next().split(',').map(s => s.trim()).filter(Boolean)
        for (const n of names) {
          if (!(PASSES as readonly string[]).includes(n)) throw new Error(`unknown pass "${n}" (expected ${PASSES.join(', ')})`)
        }
        opts.passes = names as PassId[]
        break
      }
      case '--quality': {
        const q = next()
        if (q !== 'draft' && q !== 'standard' && q !== 'hero') throw new Error(`unknown quality "${q}" (expected draft, standard or hero)`)
        opts.quality = q
        break
      }
      case '--headed': opts.headed = true; break
      case '--base': opts.base = next().replace(/\/$/, ''); break
      case '--timeout': opts.timeoutMs = Number(next()) * 60_000; break
      case '--help': case '-h': usage(); process.exit(0); break
      default: throw new Error(`unknown flag "${arg}" — try --help`)
    }
  }
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) throw new Error('--timeout must be a number of minutes')
  return opts
}

function usage() {
  console.log(`pnpm eval [flags]

  --only <name[,name]>   Only these photos (file name without the extension).
  --passes <a,b>         Stop once the run moves past the last named pass
                         (${PASSES.join(', ')}) — for cheap prompt iteration.
  --quality <q>          Sandbox render quality: draft | standard | hero (default standard).
  --headed               Show the browser.
  --base <url>           Use a dev server already running here instead of starting one.
                         It must have been started with VITRUM_SANDBOX_E2E=1.
  --timeout <minutes>    Per-photo budget (default 15).`)
}

// ------------------------------------------------------------------ helpers

interface PhotoDims { hint?: string, widthMm?: number, heightMm?: number, depthMm?: number }

function readDims(): Record<string, PhotoDims> {
  if (!existsSync(DIMS_PATH)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(DIMS_PATH, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, PhotoDims>
  }
  catch (e) {
    throw new Error(`eval/dims.json is not valid JSON: ${(e as Error).message}`)
  }
}

/** `chair.jpg` and `chair` both address the entry for `chair`. */
function dimsFor(all: Record<string, PhotoDims>, file: string): PhotoDims {
  return all[file] ?? all[basename(file, extname(file))] ?? {}
}

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const server = createServer()
    server.on('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? ok(port) : fail(new Error('could not find a free port'))))
    })
  })
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function startServer(port: number): Promise<ChildProcess> {
  const base = `http://localhost:${port}`
  console.log(`[eval] starting a dev server on ${base}`)
  const child = spawn('pnpm', ['dev', '--port', String(port)], {
    cwd: ROOT,
    // Its own process group, so killing it takes the Nuxt child down too.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITRUM_SANDBOX_E2E: '1', NUXT_IGNORE_LOCK: '1' },
  })
  child.stdout?.on('data', (d: Buffer) => process.env.EVAL_VERBOSE && process.stdout.write(`[dev] ${d}`))
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[dev] ${d}`))
  let exited: number | null = null
  child.on('exit', code => (exited = code ?? 0))

  const deadline = Date.now() + SERVER_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`the dev server exited with code ${exited} before it was ready`)
    try {
      const res = await fetch(`${base}/studio/product`)
      if (res.ok) {
        console.log('[eval] dev server ready')
        return child
      }
    }
    catch {
      // Not listening yet.
    }
    await sleep(1000)
  }
  throw new Error(`the dev server was not ready within ${SERVER_TIMEOUT_MS / 1000}s`)
}

function stopServer(child: ChildProcess | null) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  }
  catch {
    try {
      child.kill('SIGTERM')
    }
    catch {
      // Already gone.
    }
  }
}

// ------------------------------------------------------- shapes read in-page

/** The slice of `SculptJob` the poll pulls back; the GLB and the sheets stay in the page. */
interface JobStatusSnapshot {
  id: string
  status: string
  currentPass: PassId | null
  fixesTotal: number
  usage: { input: number, output: number }
  costUsd: number
  error: string | null
  question: string | null
  quality: string | null
  passes: { id: PassId, fixes: number, reviews: number, sheets: number }[]
}

interface ReviewLayers {
  silhouetteProportion: number
  componentStructure: number
  formDetail: number
  materialSurface: number
  lightingCamera: number
}
interface ReviewLike { fidelity: number, layers: ReviewLayers, action: string, summary: string }
interface PassDump { id: PassId, code: string, notes: string[], sheets: string[], reviews: ReviewLike[], fixes: number }
interface JobDump extends JobStatusSnapshot { intake: unknown, spec: unknown, dump: PassDump[] }

/** Shape of the dev hook, for the in-page callbacks; erased at runtime. */
interface EvalWindow {
  __vitrum?: {
    sculpt: {
      job: { value: Record<string, unknown> | null }
      start: (hint: string, dims: unknown, opts?: { quality?: Quality }) => Promise<void>
      cancel: () => void
      clear: () => void
    }
    studio?: {
      state: () => { hasTrace: boolean, hasHull: boolean, busy: boolean, importing: boolean, error: string, size: { widthMm: number, heightMm: number, depthMm: number } }
      screenshot: () => Promise<string | null>
    }
  }
}

// ------------------------------------------------------------------ one run

interface RunReport {
  name: string
  status: string
  quality: string | null
  error: string | null
  fidelityByPass: Record<string, number>
  layers: ReviewLayers | null
  fixes: number
  tokens: { input: number, output: number }
  costUsd: number
  seconds: number
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer, ext: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) throw new Error('not a data URL')
  const mime = match[1] ?? 'application/octet-stream'
  const body = match[3] ?? ''
  const buffer = match[2] ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8')
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
  return { buffer, ext }
}

async function runPhoto(page: Page, base: string, file: string, opts: Options, dims: Record<string, PhotoDims>): Promise<RunReport> {
  const name = basename(file, extname(file))
  const entry = dimsFor(dims, basename(file))
  const hint = entry.hint ?? ''
  const size = entry.widthMm && entry.heightMm && entry.depthMm
    ? { widthMm: entry.widthMm, heightMm: entry.heightMm, depthMm: entry.depthMm }
    : null
  console.log(`\n[eval] ${name} — hint ${hint ? JSON.stringify(hint) : '(none)'}, dims ${size ? `${size.widthMm}×${size.heightMm}×${size.depthMm} mm` : '(estimated)'}`)

  await page.goto(`${base}/studio/product`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as EvalWindow).__vitrum?.studio, null, { timeout: 60_000 })

  await page.setInputFiles('input[type="file"]', join(PHOTOS_DIR, file))
  // The import traces, then carves; both must settle before a run starts.
  await page.waitForFunction(() => {
    const s = (window as unknown as EvalWindow).__vitrum?.studio?.state()
    return !!s && s.hasTrace && !s.busy && !s.importing
  }, null, { timeout: IMPORT_TIMEOUT_MS })
  try {
    await page.waitForFunction(() => !!(window as unknown as EvalWindow).__vitrum?.studio?.state().hasHull, null, { timeout: HULL_WAIT_MS })
  }
  catch {
    // The depth model may be unavailable offline; the carve is only the backdrop for `final.png`.
    console.log('[eval]   (no hull — carrying on)')
  }

  const started = Date.now()
  // Fire and forget: `start` only settles when the whole run does, and the
  // poll below is what reports on it.
  await page.evaluate(([h, d, q]) => {
    const api = (window as unknown as EvalWindow).__vitrum?.sculpt
    if (!api) throw new Error('window.__vitrum.sculpt is missing — is this a dev build?')
    void api.start(h as string, d, { quality: q as Quality })
  }, [hint, size, opts.quality] as const)

  const lastPassIndex = opts.passes ? Math.max(...opts.passes.map(p => PASSES.indexOf(p))) : PASSES.length - 1
  const terminal = new Set(['done', 'failed', 'cancelled'])
  let snapshot: JobStatusSnapshot | null = null
  let cancelled = false
  let lastLine = ''

  const deadline = started + opts.timeoutMs
  for (;;) {
    await sleep(POLL_MS)
    snapshot = await page.evaluate(() => {
      const j = (window as unknown as EvalWindow).__vitrum?.sculpt.job.value
      if (!j) return null
      const passes = (j.passes ?? []) as { id: string, fixes: number, reviews: unknown[], sheets: unknown[] }[]
      return {
        id: j.id as string,
        status: j.status as string,
        currentPass: (j.currentPass ?? null) as PassId | null,
        fixesTotal: (j.fixesTotal ?? 0) as number,
        usage: (j.usage ?? { input: 0, output: 0 }) as { input: number, output: number },
        costUsd: (j.costUsd ?? 0) as number,
        error: (j.error ?? null) as string | null,
        question: (j.question ?? null) as string | null,
        quality: (j.quality ?? null) as string | null,
        passes: passes.map(p => ({ id: p.id as PassId, fixes: p.fixes, reviews: p.reviews.length, sheets: p.sheets.length })),
      }
    })

    if (!snapshot) {
      if (Date.now() > started + 30_000) throw new Error('the run never produced a job')
      continue
    }

    const line = `${snapshot.status}${snapshot.currentPass ? ` · ${snapshot.currentPass}` : ''} · ${snapshot.fixesTotal} fixes · $${snapshot.costUsd.toFixed(2)}`
    if (line !== lastLine) {
      console.log(`[eval]   ${line}`)
      lastLine = line
    }

    if (terminal.has(snapshot.status)) break

    if (snapshot.status === 'waiting-input') {
      // Nobody is at the keyboard: an unanswered question ends the run.
      console.log(`[eval]   question: ${snapshot.question ?? '(none)'} — cancelling`)
      await page.evaluate(() => (window as unknown as EvalWindow).__vitrum?.sculpt.cancel())
      cancelled = true
      continue
    }

    if (!cancelled && snapshot.currentPass && PASSES.indexOf(snapshot.currentPass) > lastPassIndex) {
      console.log(`[eval]   past --passes, cancelling`)
      await page.evaluate(() => (window as unknown as EvalWindow).__vitrum?.sculpt.cancel())
      cancelled = true
      continue
    }

    if (Date.now() > deadline) {
      if (!cancelled) {
        console.log('[eval]   out of time, cancelling')
        await page.evaluate(() => (window as unknown as EvalWindow).__vitrum?.sculpt.cancel())
        cancelled = true
        continue
      }
      break
    }
  }

  const seconds = Math.round((Date.now() - started) / 1000)
  if (!snapshot) throw new Error('the run never produced a job')

  // Everything the run made, minus the GLB (raw bytes do not cross `evaluate`).
  const dump = await page.evaluate((): JobDump | null => {
    const j = (window as unknown as EvalWindow).__vitrum?.sculpt.job.value
    if (!j) return null
    const passes = (j.passes ?? []) as PassDump[]
    return {
      id: j.id as string,
      status: j.status as string,
      currentPass: (j.currentPass ?? null) as PassId | null,
      fixesTotal: (j.fixesTotal ?? 0) as number,
      usage: (j.usage ?? { input: 0, output: 0 }) as { input: number, output: number },
      costUsd: (j.costUsd ?? 0) as number,
      error: (j.error ?? null) as string | null,
      question: (j.question ?? null) as string | null,
      quality: (j.quality ?? null) as string | null,
      passes: passes.map(p => ({ id: p.id, fixes: p.fixes, reviews: p.reviews.length, sheets: p.sheets.length })),
      intake: j.intake ?? null,
      spec: j.spec ?? null,
      dump: passes.map(p => ({ id: p.id, code: p.code, notes: p.notes, sheets: p.sheets, reviews: p.reviews, fixes: p.fixes })),
    }
  })
  if (!dump) throw new Error('the job vanished before it could be read')

  const dir = join(OUT_DIR, name)
  mkdirSync(dir, { recursive: true })
  if (dump.intake) writeFileSync(join(dir, 'intake.json'), JSON.stringify(dump.intake, null, 2))
  if (dump.spec) writeFileSync(join(dir, 'spec.json'), JSON.stringify(dump.spec, null, 2))

  const fidelityByPass: Record<string, number> = {}
  let lastLayers: ReviewLayers | null = null
  for (const pass of dump.dump) {
    if (pass.code) writeFileSync(join(dir, `code-${pass.id}.js`), pass.code)
    if (pass.notes.length) writeFileSync(join(dir, `notes-${pass.id}.json`), JSON.stringify(pass.notes, null, 2))
    pass.sheets.forEach((sheet, n) => {
      try {
        const { buffer, ext } = dataUrlToBuffer(sheet)
        writeFileSync(join(dir, `sheet-${pass.id}-${n + 1}.${ext}`), buffer)
      }
      catch (e) {
        console.log(`[eval]   could not save sheet ${pass.id}-${n + 1}: ${(e as Error).message}`)
      }
    })
    pass.reviews.forEach((review, n) => {
      writeFileSync(join(dir, `review-${pass.id}-${n + 1}.json`), JSON.stringify(review, null, 2))
    })
    const last = pass.reviews.at(-1)
    if (last) {
      fidelityByPass[pass.id] = last.fidelity
      lastLayers = last.layers
    }
  }

  // `job.glb` is an ArrayBuffer; base64 is the only way out of the page.
  const glbBase64 = await page.evaluate(() => {
    const j = (window as unknown as EvalWindow).__vitrum?.sculpt.job.value
    const glb = j?.glb as ArrayBuffer | null | undefined
    if (!glb) return null
    const bytes = new Uint8Array(glb)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
  })
  if (glbBase64) writeFileSync(join(dir, 'final.glb'), Buffer.from(glbBase64, 'base64'))

  try {
    const png = await page.evaluate(() => (window as unknown as EvalWindow).__vitrum?.studio?.screenshot() ?? null)
    if (png) writeFileSync(join(dir, 'final.png'), dataUrlToBuffer(png).buffer)
  }
  catch (e) {
    console.log(`[eval]   could not save final.png: ${(e as Error).message}`)
  }

  const report: RunReport = {
    name,
    status: dump.status,
    quality: dump.quality,
    error: dump.error,
    fidelityByPass,
    layers: lastLayers,
    fixes: dump.fixesTotal,
    tokens: dump.usage,
    costUsd: dump.costUsd,
    seconds,
  }
  writeFileSync(join(dir, 'run.json'), JSON.stringify(report, null, 2))
  appendSummary(report, opts.quality)
  console.log(`[eval]   ${report.status} in ${seconds}s → eval/out/${name}/`)
  return report
}

// ------------------------------------------------------------------ summary

const SUMMARY_HEADER = `# Sculpt eval runs

| name | quality | final fidelity | silhouette/structure/form/material/lighting | fixes | tokens | $ | s |
| --- | --- | --- | --- | --- | --- | --- | --- |
`

function appendSummary(report: RunReport, renderQuality: Quality) {
  const path = join(OUT_DIR, 'summary.md')
  mkdirSync(OUT_DIR, { recursive: true })
  if (!existsSync(path)) writeFileSync(path, SUMMARY_HEADER)
  const n = (v: number | undefined) => (typeof v === 'number' ? v.toFixed(2) : '—')
  const fidelities = Object.values(report.fidelityByPass)
  const finalFidelity = report.status === 'done' || fidelities.length ? n(fidelities.at(-1)) : '—'
  const l = report.layers
  const layers = l
    ? [l.silhouetteProportion, l.componentStructure, l.formDetail, l.materialSurface, l.lightingCamera].map(v => n(v)).join('/')
    : '—'
  const quality = report.status === 'done' ? (report.quality ?? '—') : `${report.status}${report.error ? `: ${report.error.replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 160)}` : ''}`
  const row = `| ${report.name} | ${renderQuality} · ${quality} | ${finalFidelity} | ${layers} | ${report.fixes} | ${report.tokens.input}/${report.tokens.output} | ${report.costUsd.toFixed(2)} | ${report.seconds} |\n`
  appendFileSync(path, row)
}

// --------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  if (!existsSync(PHOTOS_DIR)) throw new Error(`no ${PHOTOS_DIR} — see eval/README.md`)
  let photos = readdirSync(PHOTOS_DIR).filter(f => PHOTO_EXTENSIONS.has(extname(f).toLowerCase())).sort()
  if (opts.only.length) photos = photos.filter(f => opts.only.includes(basename(f, extname(f))) || opts.only.includes(f))
  if (!photos.length) throw new Error(opts.only.length ? `no photo in eval/photos matched --only ${opts.only.join(',')}` : 'eval/photos is empty — see eval/README.md')

  const dims = readDims()
  mkdirSync(OUT_DIR, { recursive: true })

  let server: ChildProcess | null = null
  let browser: Browser | null = null
  const reports: RunReport[] = []
  try {
    let base = opts.base
    if (!base) {
      const port = await freePort()
      server = await startServer(port)
      base = `http://localhost:${port}`
    }
    browser = await chromium.launch({ headless: !opts.headed, args: CHROMIUM_ARGS })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    page.on('pageerror', e => console.log(`[page] ${e.message}`))
    page.on('console', m => m.type() === 'error' && console.log(`[page] ${m.text()}`))

    for (const photo of photos) {
      try {
        reports.push(await runPhoto(page, base, photo, opts, dims))
      }
      catch (e) {
        console.error(`[eval] ${photo} could not be run: ${(e as Error).message}`)
        reports.push({ name: basename(photo, extname(photo)), status: 'harness-error', quality: null, error: (e as Error).message, fidelityByPass: {}, layers: null, fixes: 0, tokens: { input: 0, output: 0 }, costUsd: 0, seconds: 0 })
        appendSummary(reports[reports.length - 1]!, opts.quality)
      }
    }
  }
  finally {
    await browser?.close()
    stopServer(server)
  }

  console.log(`\n[eval] ${reports.filter(r => r.status === 'done').length}/${reports.length} runs finished — eval/out/summary.md`)
  if (reports.some(r => r.status !== 'done')) process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error(`[eval] ${(e as Error).message}`)
  process.exit(1)
})
