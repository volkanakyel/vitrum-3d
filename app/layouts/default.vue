<script setup lang="ts">
// Landing layout: a scrolling page. The studio layout locks the viewport instead.
</script>

<template>
  <div class="page min-h-svh">
    <SiteNav />
    <slot />
    <SiteFooter />
  </div>
</template>
