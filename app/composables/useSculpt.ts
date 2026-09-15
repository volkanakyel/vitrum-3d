/**
 * Vue glue for a sculpt run: one reactive job, the sandbox that renders the
 * generated code, and the parts model that lands in the viewer when the job is
 * done.
 *
 * Everything hard lives elsewhere — `JobRunner` walks the passes, `Sandbox`
 * runs the code, `store.ts` persists — so this file only owns the browser
 * pieces those cannot: the hidden mount the iframe lives in, the source photo
 * downscaled for the API, and the GLB → `THREE.Group` hand-off to the studio.
 */

import type * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { JobRunner, createJob, type JobStatus, type SculptJob } from '~/utils/sculpt/job'
import { Sandbox } from '~/utils/sculpt/sandbox'
import { buildSheet } from '~/utils/sculpt/sheet'
import { listJobs, loadJob, saveJob, type JobSummary } from '~/utils/sculpt/store'
import { fetchTransport } from '~/utils/sculpt/transport'
import type { Dims } from '~/utils/sculpt/types'

/** What `useSculpt` needs from the viewer; `ViewerHandle` satisfies it. */
export interface SculptViewer {
  setExternalModel: (group: THREE.Group | null) => void
}

export interface SculptDeps {
  image: Ref<HTMLImageElement | null>
  /** W/H/D from the size section when the user has set them, else `null`. */
  dims: () => Dims | null
  viewer: Ref<SculptViewer | null>
  notify: (message: string) => void
}

/** Statuses that mean the runner is working; `waiting-input` is the user's turn, not the runner's. */
const RUNNING_STATUSES: JobStatus[] = ['intake', 'spec', 'building', 'rendering', 'reviewing', 'exporting']

/** Long side of the photo sent to the API (Anthropic's image budget). */
const MAX_IMAGE_PX = 1568
const IMAGE_QUALITY = 0.9

/** The source photo as a JPEG data URL no larger than the API takes. */
function toApiImage(img: HTMLImageElement): string {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const k = Math.min(1, MAX_IMAGE_PX / Math.max(iw, ih))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(iw * k))
  canvas.height = Math.max(1, Math.round(ih * k))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  // JPEG has no alpha: a transparent cut-out would come out black otherwise.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
}

export function useSculpt(deps: SculptDeps) {
  const job = shallowRef<SculptJob | null>(null)
  const jobs = ref<JobSummary[]>([])
  const available = computed(() => !!useRuntimeConfig().public.sculptEnabled)
  /** A run is in flight: the panel shows stages and a Cancel, `start` is refused. */
  const running = computed(() => !!job.value && RUNNING_STATUSES.includes(job.value.status))

  let runner: JobRunner | null = null
  let sandbox: Sandbox | null = null
  let mount: HTMLElement | null = null

  /**
   * The iframe lives in a hidden element on `document.body`, never inside a
   * `v-if`'d region: unmounting it mid-job would kill the frame the run is
   * rendering in.
   */
  function ensureSandbox(): Sandbox {
    if (sandbox) return sandbox
    mount = document.createElement('div')
    mount.dataset.sculptSandbox = ''
    mount.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none'
    document.body.appendChild(mount)
    sandbox = new Sandbox(mount)
    return sandbox
  }

  async function refreshJobs() {
    try {
      jobs.value = (await listJobs()).sort((a, b) => b.createdAt - a.createdAt)
    }
    catch {
      // A blocked or broken IndexedDB only costs the history list.
    }
  }

  function runnerFor(target: SculptJob): JobRunner {
    const box = ensureSandbox()
    return new JobRunner(target, {
      transport: fetchTransport(),
      // The sandbox takes a quality and a seed the runner does not model:
      // every studio run is the standard quality at seed 1, so two runs of the
      // same code look the same.
      renderer: {
        load: code => box.load(code, 'standard', 1),
        render: views => box.render(views),
        exportGLB: () => box.exportGLB(),
      },
      sheet: (reference, renders) => buildSheet(reference, renders),
      save: saveJob,
      onChange: (j) => { job.value = { ...j } },
    })
  }

  /** Put the finished GLB on the stage in place of the carve. */
  async function showModel(glb: ArrayBuffer) {
    const loader = new GLTFLoader()
    const gltf = await loader.parseAsync(glb, '')
    deps.viewer.value?.setExternalModel(gltf.scene)
  }

  async function finish(result: SculptJob) {
    job.value = { ...result }
    await refreshJobs()
    if (result.status === 'done' && result.glb) {
      try {
        await showModel(result.glb)
        deps.notify('Parts model ready')
      }
      catch (e) {
        deps.notify(`Could not open the parts model: ${(e as Error).message}`)
      }
    }
    else if (result.status === 'failed') {
      deps.notify(result.error ?? 'Sculpt failed')
    }
  }

  async function start(hint: string, dims: Dims | null = deps.dims()) {
    if (!available.value || running.value) return
    const img = deps.image.value
    if (!img) {
      deps.notify('Import a photo first')
      return
    }
    const fresh = createJob(toApiImage(img), hint.trim(), dims)
    job.value = fresh
    runner = runnerFor(fresh)
    await finish(await runner.run())
  }

  function cancel() {
    runner?.cancel()
  }

  function answer(text: string) {
    const current = job.value
    if (!current || current.status !== 'waiting-input') return
    // A job reopened from the store has no runner of its own; one over the
    // stored state resumes the pass it stopped in.
    const active = runner ?? (runner = runnerFor(current))
    active.answer(text)
    void active.lastRun.then(finish)
  }

  /** A failed job resumes from its last completed pass; nothing already paid for is redone. */
  async function retry() {
    const current = job.value
    if (!current || !available.value || running.value) return
    const resumed: SculptJob = { ...current, error: null }
    job.value = resumed
    runner = runnerFor(resumed)
    await finish(await runner.run())
  }

  /** Open a stored job: its model goes back on the stage, without a single API call. */
  async function reopen(id: string) {
    const stored = await loadJob(id)
    if (!stored) {
      deps.notify('That run is no longer stored')
      return
    }
    runner = null
    job.value = stored
    if (stored.glb) {
      try {
        await showModel(stored.glb)
      }
      catch (e) {
        deps.notify(`Could not open the parts model: ${(e as Error).message}`)
      }
    }
  }

  /** Back to the carve: the run stays in the history, the stage does not. */
  function clear() {
    deps.viewer.value?.setExternalModel(null)
    job.value = null
    runner = null
  }

  const api = { job, jobs, available, running, start, cancel, answer, retry, reopen, clear, refreshJobs }

  onMounted(() => { void refreshJobs() })
  onScopeDispose(() => {
    runner?.cancel()
    sandbox?.dispose()
    sandbox = null
    mount?.remove()
    mount = null
  })

  // The Task 7 eval harness drives a real run from Playwright through this.
  if (import.meta.dev && import.meta.client) {
    window.__vitrum = { sculpt: api }
  }

  return api
}

export type SculptApi = ReturnType<typeof useSculpt>

declare global {
  interface Window {
    /** Dev-only handle for the sculpt eval harness. */
    __vitrum?: { sculpt: SculptApi }
  }
}
