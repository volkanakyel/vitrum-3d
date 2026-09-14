<script setup lang="ts">
// The brand mark on an app-icon tile: a small glass slab. Cool white gradient, inner bevel,
// hairline edge and a lift that reads as thickness — the same recipe as the hero tile.
withDefaults(defineProps<{ size?: number }>(), { size: 28 })
</script>

<template>
  <span
    class="app-icon flex shrink-0 items-center justify-center text-foreground"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.3)}px` }"
  >
    <BrandMark
      :size="Math.round(size * 0.54)"
      class="mark"
    />
  </span>
</template>

<style scoped>
.app-icon {
  background: linear-gradient(160deg, #ffffff 0%, #eef2f8 100%);
  box-shadow:
    inset 0 1px 0 #ffffff,
    inset 0 -1px 0 rgba(13, 14, 18, 0.05),
    0 0 0 1px var(--hairline),
    0 2px 6px -2px rgba(13, 14, 18, 0.25);
}
.mark {
  opacity: 0.92;
  filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.95));
}
</style>
