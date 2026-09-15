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
import { toApiImage } from '~/utils/sculpt/apiImage'
import { JobRunner, createJob, type JobStatus, type SculptJob } from '~/utils/sculpt/job'
import { Sandbox } from '~/utils/sculpt/sandbox'
import { buildSheet } from '~/utils/sculpt/sheet'
import { listJobs, loadJob, saveJob, type JobSummary } from '~/utils/sculpt/store'
import { fetchTransport } from '~/utils/sculpt/transport'
import type { KitOptions } from '~/utils/sculpt/kit'
import type { Dims } from '~/utils/sculpt/types'

/** Render quality the sandbox builds at; the studio uses `standard`. */
export type SculptQuality = KitOptions['quality']

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

export function useSculpt(deps: SculptDeps) {
  const job = shallowRef<SculptJob | null>(null)
  const jobs = ref<JobSummary[]>([])
  const enabled = !!useRuntimeConfig().public.sculptEnabled
  const available = computed(() => enabled)
  /** A run is in flight: the panel shows stages and a Cancel, `start` is refused. */
  /** True from the moment a run is started until its `run()` settles. */
  const inFlight = ref(false)
  const running = computed(() => inFlight.value || (!!job.value && RUNNING_STATUSES.includes(job.value.status)))

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

  function runnerFor(target: SculptJob, quality: SculptQuality = 'standard'): JobRunner {
    const box = ensureSandbox()
    return new JobRunner(target, {
      transport: fetchTransport(),
      // The sandbox takes a quality and a seed the runner does not model: the
      // studio always renders at the standard quality (the eval harness can ask
      // for another), always at seed 1, so two runs of the same code match.
      renderer: {
        load: code => box.load(code, quality, 1),
        render: views => box.render(views),
        exportGLB: () => box.exportGLB(),
      },
      sheet: (reference, renders) => buildSheet(reference, renders),
      save: saveJob,
      // A runner that was cancelled still reports its last state; once the
      // studio has moved off that job (cleared, or another run reopened) those
      // updates are not ours to show.
      onChange: (j) => { if (j.id === job.value?.id) job.value = { ...j } },
    })
  }

  /** Put the finished GLB on the stage in place of the carve. */
  async function showModel(glb: ArrayBuffer) {
    const loader = new GLTFLoader()
    const gltf = await loader.parseAsync(glb, '')
    deps.viewer.value?.setExternalModel(gltf.scene)
  }

  /**
   * Land a settled run. A result whose job is no longer the current one — the
   * user cleared it, imported another photo or reopened an older run while it
   * was in flight — must not touch the stage or the panel.
   */
  async function finish(result: SculptJob) {
    if (result.id !== job.value?.id) {
      await refreshJobs()
      return
    }
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

  async function start(hint: string, dims: Dims | null = deps.dims(), opts: { quality?: SculptQuality } = {}) {
    if (!available.value || running.value) return
    const img = deps.image.value
    if (!img) {
      deps.notify('Import a photo first')
      return
    }
    inFlight.value = true
    let fresh: SculptJob | null = null
    try {
      fresh = createJob(toApiImage(img), hint.trim(), dims)
      job.value = fresh
      runner = runnerFor(fresh, opts.quality)
      await finish(await runner.run())
    }
    catch (e) {
      // A canvas the browser would not give us, a sandbox that never came up:
      // the run never started, so there is nothing to resume.
      if (fresh && job.value?.id === fresh.id) job.value = null
      deps.notify(`Could not start the run: ${(e as Error).message}`)
    }
    finally {
      inFlight.value = false
    }
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
    inFlight.value = true
    try {
      const resumed: SculptJob = { ...current, error: null }
      job.value = resumed
      runner = runnerFor(resumed)
      await finish(await runner.run())
    }
    catch (e) {
      deps.notify(`Could not resume the run: ${(e as Error).message}`)
    }
    finally {
      inFlight.value = false
    }
  }

  /** Open a stored job: its model goes back on the stage, without a single API call. */
  async function reopen(id: string) {
    // Opening an older run under a live one would leave the runner writing into
    // a job the studio has moved off.
    if (running.value) return
    let stored: SculptJob | null = null
    try {
      stored = await loadJob(id)
    }
    catch (e) {
      deps.notify(`Could not open that run: ${(e as Error).message}`)
      return
    }
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
    // A live run would keep paying for passes and keep writing into `job`.
    runner?.cancel()
    runner = null
    deps.viewer.value?.setExternalModel(null)
    job.value = null
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
