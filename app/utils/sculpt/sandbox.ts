/**
 * Sculpt sandbox — host side.
 *
 * Owns the `<iframe sandbox="allow-scripts">` that runs generated code. The
 * main app never evaluates that code itself; it only sends requests and
 * receives images, counts and a GLB. Every call is matched by id and bounded
 * by a timeout — a hung sandbox (a synchronous infinite loop, say) is dealt
 * with by throwing the iframe away and building a new one.
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

interface Pending {
  id: number
  resolve: (response: SandboxResponse) => void
  reject: (error: Error) => void
  timer: number
}

export class Sandbox {
  readonly #mount: HTMLElement
  #frame: HTMLIFrameElement
  #pending = new Map<number, Pending>()
  #readyWaiters: { resolve: () => void, reject: (error: Error) => void, timer: number }[] = []
  #ready = false
  #nextId = 1
  #disposed = false
  readonly #onMessage: (event: MessageEvent) => void

  constructor(mount: HTMLElement) {
    this.#mount = mount
    this.#onMessage = (event: MessageEvent) => this.#receive(event)
    window.addEventListener('message', this.#onMessage)
    this.#frame = this.#createFrame()
  }

  #createFrame(): HTMLIFrameElement {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.src = '/sandbox'
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden'
    this.#mount.appendChild(frame)
    return frame
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
    this.#frame.remove()
    if (!this.#disposed) this.#frame = this.#createFrame()
  }

  #receive(event: MessageEvent): void {
    if (this.#disposed) return
    // Only our own frame is allowed to talk to us.
    if (event.source !== this.#frame.contentWindow) return
    const message = event.data as SandboxResponse
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return

    if (message.type === 'ready') {
      this.#ready = true
      for (const waiter of this.#readyWaiters) {
        window.clearTimeout(waiter.timer)
        waiter.resolve()
      }
      this.#readyWaiters = []
      return
    }

    const pending = this.#pending.get(message.id)
    if (!pending) return
    window.clearTimeout(pending.timer)
    this.#pending.delete(message.id)
    if (message.type === 'error') pending.reject(new Error(message.message))
    else pending.resolve(message)
  }

  ready(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error('sandbox disposed'))
    if (this.#ready) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#readyWaiters = this.#readyWaiters.filter(w => w.timer !== timer)
        reject(new Error(`sandbox ready timeout after ${READY_TIMEOUT_MS} ms`))
        this.#recreate(`sandbox ready timeout after ${READY_TIMEOUT_MS} ms`)
      }, READY_TIMEOUT_MS)
      this.#readyWaiters.push({ resolve, reject, timer })
    })
  }

  async #send<T extends SandboxResponse['type']>(
    build: (id: number) => SandboxRequest,
    timeoutMs: number,
    label: string,
  ): Promise<Extract<SandboxResponse, { type: T }>> {
    if (this.#disposed) throw new Error('sandbox disposed')
    await this.ready()
    const id = this.#nextId++
    const request = build(id)
    const frame = this.#frame
    return new Promise<Extract<SandboxResponse, { type: T }>>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`sandbox ${label} timeout after ${timeoutMs} ms`))
        // The page may be wedged in a synchronous loop: only a new frame frees it.
        this.#recreate(`sandbox ${label} timeout after ${timeoutMs} ms`)
      }, timeoutMs)
      this.#pending.set(id, {
        id,
        resolve: response => resolve(response as Extract<SandboxResponse, { type: T }>),
        reject,
        timer,
      })
      frame.contentWindow?.postMessage(request, '*')
    })
  }

  load(code: string, quality: KitOptions['quality'], seed: number): Promise<SandboxLoaded> {
    return this.#send<'loaded'>(
      id => ({ type: 'load', id, code, quality, seed }),
      LOAD_TIMEOUT_MS,
      'load',
    )
  }

  async render(views: View[], size = 1024): Promise<{ name: string, blob: Blob }[]> {
    const response = await this.#send<'rendered'>(
      id => ({ type: 'render', id, views: views.map(v => ({ ...v })), size }),
      RENDER_TIMEOUT_MS,
      'render',
    )
    return response.views.map(v => ({ name: v.name, blob: new Blob([v.png], { type: 'image/png' }) }))
  }

  async exportGLB(): Promise<ArrayBuffer> {
    const response = await this.#send<'exported'>(
      id => ({ type: 'export', id }),
      EXPORT_TIMEOUT_MS,
      'export',
    )
    return response.glb
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
    this.#frame.remove()
  }
}
