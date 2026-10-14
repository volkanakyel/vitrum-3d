<script setup lang="ts">
// Landing layout: a scrolling page. The studio layout locks the viewport instead.
</script>

<template>
  <div class="min-h-svh">
    <span
      class="grain pointer-events-none fixed inset-0 z-[60] opacity-[0.035] mix-blend-multiply"
      aria-hidden="true"
    />
    <SiteNav />
    <slot />
    <SiteFooter />
  </div>
</template>
