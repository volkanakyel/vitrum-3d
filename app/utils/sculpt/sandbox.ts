/**
 * Sculpt sandbox — host side.
 *
 * Owns the `<iframe sandbox="allow-scripts">` that runs generated code. The
 * main app never evaluates that code itself; it only sends requests and
 * receives images, counts and a GLB.
 *
 * The frame is treated as hostile, because it runs code we did not write:
 * - every request carries a per-frame nonce the generated code cannot read
 *   from its own document, and a response without it is dropped;
 * - every response is shape-checked and size-capped before it is handed on;
 * - requests are serialised, so one wedged call cannot be answered by the
 *   reply to another;
 * - each `load` gets a brand new frame, so code that navigated or wired up its
 *   own listeners is gone before the next model is built;
 * - any timeout tears the frame down (a synchronous infinite loop cannot be
 *   interrupted any other way) and the next call waits for a fresh `ready`.
 */

import type { View } from './types'
import type { KitOptions } from './kit'
import type { SandboxRequest, SandboxResponse } from './sandboxRuntime'

export type { SandboxRequest, SandboxResponse }

export type SandboxLoaded = Extract<SandboxResponse, { type: 'loaded' }>

const READY_TIMEOUT_MS = 15_000
const LOAD_TIMEOUT_MS = 20_000
const RENDER_TIMEOUT_MS = 30_000
const EXPORT_TIMEOUT_MS = 60_000
/** Consecutive failures to come up before we stop spawning replacement frames. */
const MAX_READY_FAILURES = 3
export const MAX_RENDER_SIZE = 4096
const MAX_PNG_BYTES = 32 * 1024 * 1024
const MAX_GLB_BYTES = 64 * 1024 * 1024
const GLB_MAGIC = [0x67, 0x6C, 0x54, 0x46] // 'glTF'

interface Pending {
  resolve: (response: SandboxResponse) => void
  reject: (error: Error) => void
  timer: number
}

interface Frame {
  el: HTMLIFrameElement
  nonce: string
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

const MALFORMED = 'malformed sandbox response'

const MAX_PART_BOUNDS = 400
const MAX_PART_ID = 120

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n))
}

function isPartBounds(value: unknown): boolean {
  const p = value as { id?: unknown, min?: unknown, max?: unknown } | null
  return Boolean(p)
    && typeof p!.id === 'string'
    && p!.id.length > 0
    && p!.id.length <= MAX_PART_ID
    && isVec3(p!.min)
    && isVec3(p!.max)
}

/** Nothing from the frame is trusted until it has been through here. */
function validate(message: SandboxResponse): boolean {
  switch (message.type) {
    case 'loaded':
      return Array.isArray(message.parts)
        && message.parts.every(part => typeof part === 'string')
        && isFinitePositive(message.triangles)
        && isFinitePositive(message.drawCalls)
        && Boolean(message.bounds)
        && isFinitePositive(message.bounds.w)
        && isFinitePositive(message.bounds.h)
        && isFinitePositive(message.bounds.d)
        && Array.isArray(message.partBounds)
        && message.partBounds.length <= MAX_PART_BOUNDS
        && message.partBounds.every(isPartBounds)
    case 'rendered':
      return Array.isArray(message.views)
        && message.views.every(view =>
          Boolean(view)
          && typeof view.name === 'string'
          && view.png instanceof ArrayBuffer
          && view.png.byteLength <= MAX_PNG_BYTES,
        )
    case 'exported': {
      if (!(message.glb instanceof ArrayBuffer)) return false
      if (message.glb.byteLength > MAX_GLB_BYTES || message.glb.byteLength < 4) return false
      const head = new Uint8Array(message.glb, 0, 4)
      return GLB_MAGIC.every((byte, i) => head[i] === byte)
    }
    default:
      return false
  }
}

export class Sandbox {
  readonly #mount: HTMLElement
  #frame: Frame
  #pending = new Map<number, Pending>()
  #readyWaiters: { resolve: () => void, reject: (error: Error) => void, timer: number }[] = []
  #ready = false
  #readyFailures = 0
  #nextId = 1
  #disposed = false
  /** One request in flight at a time, in call order. */
  #queue: Promise<unknown> = Promise.resolve()
  readonly #onMessage: (event: MessageEvent) => void

  constructor(mount: HTMLElement) {
    this.#mount = mount
    this.#onMessage = (event: MessageEvent) => this.#receive(event)
    window.addEventListener('message', this.#onMessage)
    this.#frame = this.#createFrame()
  }

  #createFrame(): Frame {
    const el = document.createElement('iframe')
    el.setAttribute('sandbox', 'allow-scripts')
    el.src = '/sandbox'
    el.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden'
    this.#mount.appendChild(el)
    // The generated code never sees this: it arrives inside a message the page
    // handler closes over, and the page keeps it in module scope.
    return { el, nonce: crypto.randomUUID() }
  }

  /** Tear the frame down mid-flight and start a fresh one. */
  #recreate(reason: string): void {
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.#pending.clear()
    for (const waiter of this.#readyWaiters) {
      window.clearTimeout(waiter.timer)
      waiter.reject(new Error(reason))
    }
    this.#readyWaiters = []
    this.#ready = false
    this.#frame.el.remove()
    if (!this.#disposed) this.#frame = this.#createFrame()
  }

  #receive(event: MessageEvent): void {
    if (this.#disposed) return
    // Only our own frame is allowed to talk to us.
    if (event.source !== this.#frame.el.contentWindow) return
    const message = event.data as SandboxResponse
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return

    if (message.type === 'ready') {
      this.#ready = true
      this.#readyFailures = 0
      for (const waiter of this.#readyWaiters) {
        window.clearTimeout(waiter.timer)
        waiter.resolve()
      }
      this.#readyWaiters = []
      return
    }

    // Generated code shares the document and can post messages of its own; it
    // cannot know this frame's nonce, so an answer without it is not ours.
    if (message.nonce !== this.#frame.nonce) return

    const pending = this.#pending.get(message.id)
    if (!pending) return
    window.clearTimeout(pending.timer)
    this.#pending.delete(message.id)
    if (message.type === 'error') pending.reject(new Error(message.message))
    else if (!validate(message)) pending.reject(new Error(MALFORMED))
    else pending.resolve(message)
  }

  ready(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error('sandbox disposed'))
    if (this.#ready) return Promise.resolve()
    if (this.#readyFailures >= MAX_READY_FAILURES) {
      return Promise.reject(new Error(`sandbox failed to start ${MAX_READY_FAILURES} times; giving up`))
    }
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#readyWaiters = this.#readyWaiters.filter(w => w.timer !== timer)
        this.#readyFailures += 1
        const message = `sandbox ready timeout after ${READY_TIMEOUT_MS} ms`
        reject(new Error(message))
        if (this.#readyFailures < MAX_READY_FAILURES) this.#recreate(message)
      }, READY_TIMEOUT_MS)
      this.#readyWaiters.push({ resolve, reject, timer })
    })
  }

  /** Serialise calls: at most one request is in flight per frame. */
  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task)
    this.#queue = run.then(() => undefined, () => undefined)
    return run
  }

  #request<T extends SandboxResponse['type']>(
    build: (id: number, nonce: string) => SandboxRequest,
    timeoutMs: number,
    label: string,
  ): Promise<Extract<SandboxResponse, { type: T }>> {
    const id = this.#nextId++
    const frame = this.#frame
    const request = build(id, frame.nonce)
    return new Promise<Extract<SandboxResponse, { type: T }>>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#pending.delete(id)
        const message = `sandbox ${label} timeout after ${timeoutMs} ms`
        reject(new Error(message))
        // The page may be wedged in a synchronous loop: only a new frame frees it.
        this.#recreate(message)
      }, timeoutMs)
      this.#pending.set(id, {
        resolve: response => resolve(response as Extract<SandboxResponse, { type: T }>),
        reject,
        timer,
      })
      frame.el.contentWindow?.postMessage(request, '*')
    })
  }

  load(code: string, quality: KitOptions['quality'], seed: number): Promise<SandboxLoaded> {
    return this.#enqueue(async () => {
      if (this.#disposed) throw new Error('sandbox disposed')
      // A fresh document per model: the previous one ran code that may have
      // navigated the frame or installed listeners of its own.
      this.#recreate('sandbox restarted for a new load')
      await this.ready()
      return this.#request<'loaded'>(
        (id, nonce) => ({ type: 'load', id, nonce, code, quality, seed }),
        LOAD_TIMEOUT_MS,
        'load',
      )
    })
  }

  render(views: View[], size = 1024): Promise<{ name: string, blob: Blob }[]> {
    const clamped = Math.min(MAX_RENDER_SIZE, Math.max(16, Math.round(size)))
    return this.#enqueue(async () => {
      if (this.#disposed) throw new Error('sandbox disposed')
      await this.ready()
      const response = await this.#request<'rendered'>(
        (id, nonce) => ({ type: 'render', id, nonce, views: views.map(v => ({ ...v })), size: clamped }),
        RENDER_TIMEOUT_MS,
        'render',
      )
      return response.views.map(v => ({ name: v.name, blob: new Blob([v.png], { type: 'image/png' }) }))
    })
  }

  exportGLB(): Promise<ArrayBuffer> {
    return this.#enqueue(async () => {
      if (this.#disposed) throw new Error('sandbox disposed')
      await this.ready()
      const response = await this.#request<'exported'>(
        (id, nonce) => ({ type: 'export', id, nonce }),
        EXPORT_TIMEOUT_MS,
        'export',
      )
      return response.glb
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    window.removeEventListener('message', this.#onMessage)
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timer)
      pending.reject(new Error('sandbox disposed'))
    }
    this.#pending.clear()
    for (const waiter of this.#readyWaiters) {
      window.clearTimeout(waiter.timer)
      waiter.reject(new Error('sandbox disposed'))
    }
    this.#readyWaiters = []
    this.#frame.el.remove()
  }
}
