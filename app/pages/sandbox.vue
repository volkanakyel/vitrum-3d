<script setup lang="ts">
/**
 * The isolated renderer. Loaded only inside `<iframe sandbox="allow-scripts">`,
 * so it runs on an opaque origin: no cookies, no storage, no handle on the app.
 * It renders nothing visible — the canvas lives in memory and leaves as PNG.
 */
import { SandboxRuntime } from '~/utils/sculpt/sandboxRuntime'

definePageMeta({ layout: false })

const csp = [
  'default-src \'none\'',
  // 'unsafe-eval' is the point of this page: generated code runs in new Function().
  'script-src \'self\' \'unsafe-eval\' \'unsafe-inline\'',
  'style-src \'unsafe-inline\'',
  'img-src data: blob:',
  import.meta.dev ? 'connect-src \'self\' ws: wss:' : 'connect-src \'self\'',
].join('; ')

useHead({
  title: 'sandbox',
  meta: [{ 'http-equiv': 'Content-Security-Policy', 'content': csp }],
})

let runtime: SandboxRuntime | null = null

onMounted(() => {
  runtime = new SandboxRuntime()
  runtime.announce()
})

onBeforeUnmount(() => {
  runtime?.dispose()
  runtime = null
})
</script>

<template>
  <ClientOnly>
    <div style="display:none" data-sandbox="ready" />
  </ClientOnly>
</template>
