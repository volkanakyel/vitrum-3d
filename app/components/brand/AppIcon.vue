<script setup lang="ts">
// The brand mark on an app-icon tile: a small glass slab. Cool white gradient, inner bevel,
// hairline edge and a lift that reads as thickness — the same recipe as the hero tile.
withDefaults(defineProps<{ size?: number }>(), { size: 28 })
</script>

<template>
  <span
    class="lightbox flex shrink-0 items-center justify-center bg-[linear-gradient(160deg,#fff_0%,#eef2f8_100%)] text-foreground shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_rgba(38,40,46,0.05),0_0_0_1px_var(--hairline),0_2px_6px_-2px_rgba(38,40,46,0.25)]"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.3)}px` }"
  >
    <BrandMark
      :size="Math.round(size * 0.54)"
      class="opacity-[0.92] drop-shadow-[0_1px_0_rgba(255,255,255,0.95)]"
    />
  </span>
</template>
