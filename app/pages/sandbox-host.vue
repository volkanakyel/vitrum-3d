<script setup lang="ts">
/**
 * Dev-only harness for the sandbox: exposes the host object on `window` so the
 * Playwright smoke test can drive it. Never shipped behaviour — in a build it
 * renders a notice and nothing else.
 */
import { Sandbox } from '~/utils/sculpt/sandbox'

definePageMeta({ layout: false })

const isDev = import.meta.dev
const mount = ref<HTMLElement | null>(null)
let sandbox: Sandbox | null = null

onMounted(async () => {
  // <ClientOnly> renders its children after hydration, so the ref is only
  // filled on the next tick.
  await nextTick()
  if (!isDev || !mount.value) return
  sandbox = new Sandbox(mount.value)
  ;(window as unknown as { __sandbox: Sandbox }).__sandbox = sandbox
})

onBeforeUnmount(() => {
  sandbox?.dispose()
  sandbox = null
})
</script>

<template>
  <ClientOnly>
    <p v-if="!isDev">
      This page is dev only.
    </p>
    <div v-else ref="mount" style="position:relative" data-sandbox-host="1">
      sandbox host
    </div>
  </ClientOnly>
</template>
