<script setup lang="ts">
/**
 * The isolated renderer. Loaded only inside `<iframe sandbox="allow-scripts">`,
 * so it runs on an opaque origin: no cookies, no storage, no handle on the app.
 * It renders nothing visible — the canvas lives in memory and leaves as PNG.
 */
import { SandboxRuntime } from '~/utils/sculpt/sandboxRuntime'

definePageMeta({ layout: false })

// The policy that matters — including `frame-ancestors 'self'`, which a meta
// tag cannot express — is served as a response header by the `/sandbox` route
// rule in nuxt.config.ts. It is in force while the document loads; a meta tag
// on an ssr:false page would not be.
useHead({
  title: 'sandbox',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
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
