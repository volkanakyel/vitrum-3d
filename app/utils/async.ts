/** Cancellation settles callers even when the underlying browser operation cannot be stopped. */
export const abortError = () => new DOMException('Operation cancelled', 'AbortError')

export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? abortError())
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? abortError())
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? abortError()) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Two frames allow the loader to paint; the timeout also works in a hidden document. */
export function nextPaint(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? abortError())
    let frame = 0
    const cleanup = () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
    const done = () => { cleanup(); resolve() }
    const abort = () => { cleanup(); reject(signal.reason ?? abortError()) }
    const timer = setTimeout(done, 80)
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(done) })
    signal.addEventListener('abort', abort, { once: true })
  })
}
