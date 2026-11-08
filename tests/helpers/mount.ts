import { createRenderer, defineComponent } from 'vue'

/** Run a composable with real Vue mount/unmount hooks, without a browser renderer. */
export function mountComposable<T>(setup: () => T) {
  const renderer = createRenderer<object, object>({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  })
  let value!: T
  const app = renderer.createApp(defineComponent({ setup() { value = setup(); return () => null } }))
  app.mount({})
  return { value, unmount: () => app.unmount() }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
