<script setup lang="ts">
/**
 * Status light: grey while idle, azure with a soft halo once the thing it labels is live.
 * With `pulse`, a ring breathes out of it now and then (the hero's "it's running" cue).
 */
defineProps<{ on?: boolean; pulse?: boolean }>()
</script>

<template>
  <span class="relative grid size-1.5 shrink-0 place-items-center">
    <span
      v-if="on && pulse"
      class="live-pulse absolute inset-0 rounded-full bg-lamp"
      aria-hidden="true"
    />
    <span
      class="relative size-full rounded-full transition-[background-color,box-shadow] duration-300 ease-[ease] motion-reduce:transition-none"
      :class="on ? 'bg-lamp shadow-[0_0_0_3px_var(--lamp-glow)]' : 'bg-ink/20'"
    />
  </span>
</template>

<style scoped>
.live-pulse {
  animation: live-pulse 2.8s cubic-bezier(0.23, 1, 0.32, 1) 1.2s infinite;
  opacity: 0;
}
@keyframes live-pulse {
  0% { transform: scale(1); opacity: 0.5; }
  60%, 100% { transform: scale(4.5); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .live-pulse { animation: none; }
}
</style>
