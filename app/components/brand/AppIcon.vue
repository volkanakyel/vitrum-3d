<script setup lang="ts">
// The brand mark on an app-icon tile: the mark fills most of it, on a near-white tile with a
// faint hairline and a soft lift, so the tile frames the mark without competing with it.
withDefaults(defineProps<{ size?: number }>(), { size: 28 })
</script>

<template>
  <span
    class="lightbox flex shrink-0 items-center justify-center bg-[linear-gradient(160deg,#fff_0%,#f5f7fa_100%)] text-foreground shadow-[inset_0_1px_0_#fff,0_0_0_1px_color-mix(in_srgb,var(--hairline)_55%,transparent),0_1px_3px_-1px_rgba(38,40,46,0.16)]"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.3)}px` }"
  >
    <BrandMark
      :size="Math.round(size * 0.8)"
      class="opacity-[0.92] drop-shadow-[0_1px_0_rgba(255,255,255,0.95)]"
    />
  </span>
</template>
