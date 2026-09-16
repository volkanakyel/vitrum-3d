/**
 * Sculpt quality harness — `pnpm eval`.
 *
 * Playwright drives the real studio (not a mock): for every photo in
 * `eval/photos` it opens `/studio/product`, imports the photo through the file
 * input, waits for the carve to settle, then calls the dev-only hook
 * `window.__vitrum.sculpt.start(hint, dims, { quality })` and polls the job
 * until it settles. Everything the run produced — spec, generated code,
 * comparison sheets, the review, the GLB and a viewer render — lands in
 * `eval/out/<name>/`, and one row per run is appended to `eval/out/summary.md`.
 * The prompts and the kit are tuned against that table.
 *
 * The harness starts its own Nuxt dev server on a free port and kills it at the
 * end — including on Ctrl-C, an uncaught error or a crash, since a detached
 * process group never sees the terminal's own SIGINT. `--base` reuses a server
 * you started yourself, and that one is never killed.
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
const HOOK_TIMEOUT_MS = 60_000
/** A cancel the runner ignores must not turn into an endless loop of cancels. */
const MAX_CANCELS = 3
/** Page reloads survived per run before giving up. */
const MAX_RECOVERIES = 2
/** Failed runs resumed per photo before the failure is recorded. */
const MAX_RETRIES = 1

// ---------------------------------------------------------------- arguments

interface Options {
  only: string[]
  polish: boolean
  quality: Quality
  headed: boolean
  base: string | null
  timeoutMs: number
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { only: [], polish: true, quality: 'standard', headed: false, base: null, timeoutMs: DEFAULT_RUN_TIMEOUT_MS }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${arg} needs a value`)
      return v
    }
    switch (arg) {
      case '--only': opts.only.push(...next().split(',').map(s => s.trim()).filter(Boolean)); break
      case '--no-polish': opts.polish = false; break
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
  --no-polish            Plan and build only: no review, no fix (two calls).
  --quality <q>          Sandbox render quality: draft | standard | hero (default standard).
  --headed               Show the browser.
  --base <url>           Use a dev server already running here instead of starting one.
                         It must have been started with VITRUM_SANDBOX_E2E=1, and it is
                         never killed by the harness.
  --timeout <minutes>    Per-photo budget (default 15).

Environment:
  EVAL_VERBOSE=1         Echo the dev server's stdout (stderr is always shown).`)
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

// --------------------------------------------------------- server lifecycle

/**
 * The dev server this process spawned — and only that one. A server passed in
 * with `--base` belongs to whoever started it and is never touched.
 */
let spawnedServer: ChildProcess | null = null

async function startServer(port: number): Promise<void> {
  const base = `http://localhost:${port}`
  console.log(`[eval] starting a dev server on ${base}`)
  const child = spawn('pnpm', ['dev', '--port', String(port)], {
    cwd: ROOT,
    // Its own process group, so killing it takes the Nuxt child down too.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITRUM_SANDBOX_E2E: '1', NUXT_IGNORE_LOCK: '1' },
  })
  spawnedServer = child
  child.stdout?.on('data', (d: Buffer) => process.env.EVAL_VERBOSE && process.stdout.write(`[dev] ${d}`))
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[dev] ${d}`))
  let failure: Error | null = null
  let exited: number | null = null
  // `pnpm` missing, or no permission to run it: `spawn` reports it here, not by throwing.
  child.on('error', (e: Error) => (failure = e))
  child.on('exit', (code) => {
    exited = code ?? 0
    spawnedServer = null
  })

  const deadline = Date.now() + SERVER_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (failure) throw new Error(`the dev server could not be started: ${(failure as Error).message}`)
    if (exited !== null) throw new Error(`the dev server exited with code ${exited} before it was ready`)
    try {
      const res = await fetch(`${base}/studio/product`)
      if (res.ok) {
        console.log('[eval] dev server ready')
        return
      }
    }
    catch {
      // Not listening yet.
    }
    await sleep(1000)
  }
  throw new Error(`the dev server was not ready within ${SERVER_TIMEOUT_MS / 1000}s`)
}

/** Take down the server this process spawned; a no-op for `--base`. */
function stopServer() {
  const child = spawnedServer
  spawnedServer = null
  if (!child?.pid) return
  try {
    // Negative pid: the whole group, so the Nuxt child goes too.
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

/**
 * Ctrl-C reaches this process but not the server's own process group, so
 * without this the dev server outlives the harness and holds its port and the
 * Nuxt dev lock.
 */
function installShutdownHandlers() {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`\n[eval] ${signal} — stopping the dev server`)
      stopServer()
      process.exit(130)
    })
  }
  process.on('uncaughtException', (e: Error) => {
    console.error(`[eval] uncaught: ${e.stack ?? e.message}`)
    stopServer()
    process.exit(1)
  })
  process.on('unhandledRejection', (reason: unknown) => {
    console.error(`[eval] unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
    stopServer()
    process.exit(1)
  })
}

// ------------------------------------------------------- shapes read in-page

/** The slice of `SculptJob` the poll pulls back; the GLB and the sheets stay in the page. */
interface JobStatusSnapshot {
  id: string
  status: string
  fixed: boolean
  draft: boolean
  hasGlb: boolean
  usage: { input: number, output: number }
  costUsd: number
  error: string | null
  quality: string | null
  sheets: number
}

interface ReviewLayers {
  silhouetteProportion: number
  componentStructure: number
  formDetail: number
  materialSurface: number
  lightingCamera: number
}
interface ReviewLike { fidelity: number, layers: ReviewLayers, summary: string }
interface JobDump extends JobStatusSnapshot { spec: unknown, code: string, notes: string[], sheetUrls: string[], review: ReviewLike | null }

/** Shape of the dev hook, for the in-page callbacks; erased at runtime. */
interface EvalWindow {
  __vitrum?: {
    sculpt: {
      job: { value: Record<string, unknown> | null }
      /** False when the server has no `NUXT_ANTHROPIC_KEY`: the studio hides the panel. */
      available: { value: boolean }
      start: (hint: string, dims: unknown, opts?: { quality?: Quality, polish?: boolean }) => Promise<void>
      cancel: () => void
      clear: () => void
      reopen: (id: string) => Promise<void>
      retry: () => Promise<void>
    }
    studio?: {
      setAutoBuild: (on: boolean) => void
      state: () => { hasTrace: boolean, hasHull: boolean, busy: boolean, importing: boolean, error: string, size: { widthMm: number, heightMm: number, depthMm: number } }
      screenshot: () => Promise<string | null>
    }
  }
}

/** What the page has shouted about since it was opened; quoted when a wait times out. */
interface Diagnostics { pageErrors: string[] }

// ------------------------------------------------------------------ one run

interface RunReport {
  name: string
  /** `done`, `failed`, `cancelled` or `harness-error`. */
  status: string
  quality: string | null
  error: string | null
  fidelity: number | null
  layers: ReviewLayers | null
  fixed: boolean
  tokens: { input: number, output: number }
  costUsd: number
  seconds: number
}

/** A run that ended the way it was asked to — the exit code must not call these failures. */
function succeeded(report: RunReport): boolean {
  return report.status === 'done'
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

/** Which half of the dev hook is missing, and what the page complained about. */
async function hookDiagnosis(page: Page, diag: Diagnostics): Promise<string> {
  let present = { vitrum: false, sculpt: false, studio: false }
  try {
    present = await page.evaluate(() => {
      const w = (window as unknown as EvalWindow).__vitrum
      return { vitrum: !!w, sculpt: !!w?.sculpt, studio: !!w?.studio }
    })
  }
  catch (e) {
    return `the page could not even be queried (${(e as Error).message})`
  }
  const missing = [!present.vitrum && 'window.__vitrum', present.vitrum && !present.sculpt && '__vitrum.sculpt', present.vitrum && !present.studio && '__vitrum.studio']
    .filter(Boolean)
    .join(', ') || 'nothing (the hook appeared late)'
  const errors = diag.pageErrors.length ? ` Page errors: ${diag.pageErrors.slice(-5).join(' | ')}` : ' The page reported no errors.'
  return `missing: ${missing}.${errors}`
}

/** Open the studio, wait for the dev hook, and check the pipeline is even switched on. */
async function preflight(page: Page, base: string, diag: Diagnostics) {
  await page.goto(`${base}/studio/product`, { waitUntil: 'domcontentloaded' })
  await waitForHook(page, diag)
  // `available` starts false and flips when `/api/sculpt/status` answers, so
  // the hook appearing is not yet the answer; give the round trip a moment.
  try {
    await page.waitForFunction(
      () => !!(window as unknown as EvalWindow).__vitrum?.sculpt.available.value,
      null,
      { timeout: 10_000 },
    )
  }
  catch {
    throw new Error('sculpt is disabled — set NUXT_ANTHROPIC_KEY (the server reported no key)')
  }
}

async function waitForHook(page: Page, diag: Diagnostics) {
  try {
    await page.waitForFunction(() => {
      const w = (window as unknown as EvalWindow).__vitrum
      return !!w?.sculpt && !!w.studio
    }, null, { timeout: HOOK_TIMEOUT_MS })
  }
  catch {
    throw new Error(`window.__vitrum never appeared within ${HOOK_TIMEOUT_MS / 1000}s — is this a dev build? ${await hookDiagnosis(page, diag)}`)
  }
}

/** Open the studio on this photo and wait until the import has settled. */
async function importPhoto(page: Page, base: string, file: string, diag: Diagnostics) {
  diag.pageErrors.length = 0
  await page.goto(`${base}/studio/product`, { waitUntil: 'domcontentloaded' })
  await waitForHook(page, diag)

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
}

interface PollResult {
  snapshot: JobStatusSnapshot
  seconds: number
}

/** Watch the job until it settles, cancelling it when there is nothing left worth paying for. */
async function pollJob(page: Page, opts: Options, started: number): Promise<PollResult> {
  const terminal = new Set(['done', 'failed', 'cancelled'])
  const deadline = started + opts.timeoutMs
  let snapshot: JobStatusSnapshot | null = null
  let cancels = 0
  let lastLine = ''
  let jobId: string | null = null
  let recoveries = 0
  let retries = 0

  // A dev-server full reload (Nuxt regenerating its virtual modules, Vite
  // re-optimising a dependency) wipes the page and the runner with it. The
  // job itself survives in IndexedDB, so the harness reopens it and resumes
  // from the last step that was paid for.
  const recover = async () => {
    if (!jobId || recoveries >= MAX_RECOVERIES) return false
    recoveries++
    console.log(`[eval]   the page lost the job — reopening and resuming (attempt ${recoveries})`)
    await page.waitForFunction(() => !!(window as unknown as EvalWindow).__vitrum?.sculpt, null, { timeout: HOOK_TIMEOUT_MS })
    await page.evaluate(async (id) => {
      const sculpt = (window as unknown as EvalWindow).__vitrum!.sculpt
      await sculpt.reopen(id)
      void sculpt.retry()
    }, jobId)
    return true
  }

  const cancel = async (why: string) => {
    if (cancels >= MAX_CANCELS) return false
    cancels++
    console.log(`[eval]   ${why} — cancelling${cancels > 1 ? ` (attempt ${cancels})` : ''}`)
    await page.evaluate(() => (window as unknown as EvalWindow).__vitrum?.sculpt.cancel())
    return true
  }

  for (;;) {
    await sleep(POLL_MS)
    snapshot = await page.evaluate(() => {
      const j = (window as unknown as EvalWindow).__vitrum?.sculpt.job.value
      if (!j) return null
      return {
        id: j.id as string,
        status: j.status as string,
        fixed: !!j.fixed,
        draft: !!j.draft,
        hasGlb: !!j.glb,
        usage: (j.usage ?? { input: 0, output: 0 }) as { input: number, output: number },
        costUsd: (j.costUsd ?? 0) as number,
        error: (j.error ?? null) as string | null,
        quality: (j.quality ?? null) as string | null,
        sheets: ((j.sheets ?? []) as unknown[]).length,
      }
    })

    if (!snapshot) {
      if (jobId) {
        if (await recover()) continue
        throw new Error('the page lost the job and it could not be resumed')
      }
      if (Date.now() > started + 30_000) throw new Error('the run never produced a job')
      continue
    }
    jobId = snapshot.id

    const line = `${Math.round((Date.now() - started) / 1000)}s · ${snapshot.status}${snapshot.hasGlb ? ' · on stage' : ''}${snapshot.fixed ? ' · fixed' : ''} · $${snapshot.costUsd.toFixed(2)}`
    if (line !== lastLine) {
      console.log(`[eval]   ${line}`)
      lastLine = line
    }

    if (snapshot.status === 'failed' && retries < MAX_RETRIES && Date.now() < deadline) {
      // A failed run resumes from its last completed step; nothing already
      // paid for is redone, so one more attempt is cheap insurance against a
      // dropped upstream stream.
      retries++
      console.log(`[eval]   failed: ${snapshot.error ?? '(no error)'} — resuming (attempt ${retries})`)
      await page.evaluate(() => { void (window as unknown as EvalWindow).__vitrum?.sculpt.retry() })
      continue
    }
    if (terminal.has(snapshot.status)) break

    const outOfTime = Date.now() > deadline
    if (outOfTime) {
      if (!await cancel('out of time')) break
      continue
    }
  }

  if (!snapshot) throw new Error('the run never produced a job')
  return { snapshot, seconds: Math.round((Date.now() - started) / 1000) }
}

/** Pull everything the run made out of the page and onto disk. */
async function writeOutputs(page: Page, name: string, poll: PollResult): Promise<RunReport> {
  // Everything the run made, minus the GLB (raw bytes do not cross `evaluate`).
  const dump = await page.evaluate((): JobDump | null => {
    const j = (window as unknown as EvalWindow).__vitrum?.sculpt.job.value
    if (!j) return null
    return {
      id: j.id as string,
      status: j.status as string,
      fixed: !!j.fixed,
      draft: !!j.draft,
      hasGlb: !!j.glb,
      usage: (j.usage ?? { input: 0, output: 0 }) as { input: number, output: number },
      costUsd: (j.costUsd ?? 0) as number,
      error: (j.error ?? null) as string | null,
      quality: (j.quality ?? null) as string | null,
      sheets: ((j.sheets ?? []) as unknown[]).length,
      spec: j.spec ?? null,
      code: (j.code ?? '') as string,
      notes: (j.notes ?? []) as string[],
      sheetUrls: (j.sheets ?? []) as string[],
      review: (j.review ?? null) as ReviewLike | null,
    }
  })
  if (!dump) throw new Error('the job vanished before it could be read')

  const dir = join(OUT_DIR, name)
  mkdirSync(dir, { recursive: true })
  if (dump.spec) writeFileSync(join(dir, 'spec.json'), JSON.stringify(dump.spec, null, 2))
  if (dump.code) writeFileSync(join(dir, 'code.js'), dump.code)
  if (dump.notes.length) writeFileSync(join(dir, 'notes.json'), JSON.stringify(dump.notes, null, 2))
  dump.sheetUrls.forEach((sheet, n) => {
    try {
      const { buffer, ext } = dataUrlToBuffer(sheet)
      writeFileSync(join(dir, `sheet-${n + 1}.${ext}`), buffer)
    }
    catch (e) {
      console.log(`[eval]   could not save sheet ${n + 1}: ${(e as Error).message}`)
    }
  })
  if (dump.review) writeFileSync(join(dir, 'review.json'), JSON.stringify(dump.review, null, 2))

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
    fidelity: dump.review?.fidelity ?? null,
    layers: dump.review?.layers ?? null,
    fixed: dump.fixed,
    tokens: dump.usage,
    costUsd: dump.costUsd,
    seconds: poll.seconds,
  }
  writeFileSync(join(dir, 'run.json'), JSON.stringify(report, null, 2))
  return report
}

async function runPhoto(page: Page, base: string, file: string, opts: Options, dims: Record<string, PhotoDims>, diag: Diagnostics): Promise<RunReport> {
  const name = basename(file, extname(file))
  const entry = dimsFor(dims, basename(file))
  const hint = entry.hint ?? ''
  const size = entry.widthMm && entry.heightMm && entry.depthMm
    ? { widthMm: entry.widthMm, heightMm: entry.heightMm, depthMm: entry.depthMm }
    : null
  console.log(`\n[eval] ${name} — hint ${hint ? JSON.stringify(hint) : '(none)'}, dims ${size ? `${size.widthMm}×${size.heightMm}×${size.depthMm} mm` : '(estimated)'}`)

  // The studio would start a run on import with no hint and no dims; the harness starts its own.
  await page.evaluate(() => (window as unknown as EvalWindow).__vitrum?.studio?.setAutoBuild(false))
  await importPhoto(page, base, file, diag)

  const started = Date.now()
  // Fire and forget: `start` only settles when the whole run does, and the
  // poll is what reports on it.
  await page.evaluate(([h, d, q, polish]) => {
    const api = (window as unknown as EvalWindow).__vitrum?.sculpt
    if (!api) throw new Error('window.__vitrum.sculpt is missing — is this a dev build?')
    void api.start(h as string, d, { quality: q as Quality, polish: polish as boolean })
  }, [hint, size, opts.quality, opts.polish] as const)

  const poll = await pollJob(page, opts, started)
  const report = await writeOutputs(page, name, poll)
  appendSummary(report, opts.quality)
  console.log(`[eval]   ${report.status} in ${report.seconds}s → eval/out/${name}/`)
  return report
}

// ------------------------------------------------------------------ summary

const SUMMARY_HEADER = `# Sculpt eval runs

| name | quality | fidelity | silhouette/structure/form/material/lighting | fixed | tokens | $ | s |
| --- | --- | --- | --- | --- | --- | --- | --- |
`

function appendSummary(report: RunReport, renderQuality: Quality) {
  const path = join(OUT_DIR, 'summary.md')
  mkdirSync(OUT_DIR, { recursive: true })
  if (!existsSync(path)) writeFileSync(path, SUMMARY_HEADER)
  const n = (v: number | undefined) => (typeof v === 'number' ? v.toFixed(2) : '—')
  const finalFidelity = n(report.fidelity ?? undefined)
  const l = report.layers
  const layers = l
    ? [l.silhouetteProportion, l.componentStructure, l.formDetail, l.materialSurface, l.lightingCamera].map(v => n(v)).join('/')
    : '—'
  const quality = report.status === 'done'
    ? (report.quality ?? '—')
    : `${report.status}${report.error ? `: ${report.error.replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 160)}` : ''}`
  const row = `| ${report.name} | ${renderQuality} · ${quality} | ${finalFidelity} | ${layers} | ${report.fixed ? 'yes' : 'no'} | ${report.tokens.input}/${report.tokens.output} | ${report.costUsd.toFixed(2)} | ${report.seconds} |\n`
  appendFileSync(path, row)
}

// --------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  installShutdownHandlers()

  if (!existsSync(PHOTOS_DIR)) throw new Error(`no ${PHOTOS_DIR} — see eval/README.md`)
  let photos = readdirSync(PHOTOS_DIR).filter(f => PHOTO_EXTENSIONS.has(extname(f).toLowerCase())).sort()
  if (opts.only.length) photos = photos.filter(f => opts.only.includes(basename(f, extname(f))) || opts.only.includes(f))
  if (!photos.length) throw new Error(opts.only.length ? `no photo in eval/photos matched --only ${opts.only.join(',')}` : 'eval/photos is empty — see eval/README.md')

  const dims = readDims()
  mkdirSync(OUT_DIR, { recursive: true })

  let browser: Browser | null = null
  const reports: RunReport[] = []
  try {
    let base = opts.base
    if (!base) {
      const port = await freePort()
      await startServer(port)
      base = `http://localhost:${port}`
    }
    browser = await chromium.launch({ headless: !opts.headed, args: CHROMIUM_ARGS })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const diag: Diagnostics = { pageErrors: [] }
    const note = (text: string) => {
      console.log(`[page] ${text}`)
      diag.pageErrors.push(text)
      if (diag.pageErrors.length > 50) diag.pageErrors.shift()
    }
    page.on('pageerror', e => note(e.message))
    page.on('console', m => m.type() === 'error' && note(m.text()))

    // One cheap load before any photo: a disabled pipeline should not cost a
    // 45-minute timeout per photo to discover.
    await preflight(page, base, diag)

    for (const photo of photos) {
      try {
        reports.push(await runPhoto(page, base, photo, opts, dims, diag))
      }
      catch (e) {
        console.error(`[eval] ${photo} could not be run: ${(e as Error).message}`)
        const failed: RunReport = { name: basename(photo, extname(photo)), status: 'harness-error', quality: null, error: (e as Error).message, fidelity: null, layers: null, fixed: false, tokens: { input: 0, output: 0 }, costUsd: 0, seconds: 0 }
        reports.push(failed)
        appendSummary(failed, opts.quality)
      }
    }
  }
  finally {
    await browser?.close()
    stopServer()
  }

  console.log(`\n[eval] ${reports.filter(succeeded).length}/${reports.length} runs finished — eval/out/summary.md`)
  if (!reports.every(succeeded)) process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error(`[eval] ${(e as Error).message}`)
  stopServer()
  process.exit(1)
})
