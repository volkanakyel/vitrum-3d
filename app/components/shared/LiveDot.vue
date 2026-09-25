<script setup lang="ts">
/** Status light: grey while idle, ice with a soft halo once the thing it labels is live. */
defineProps<{ on?: boolean }>()
</script>

<template>
  <span
    class="size-1.5 shrink-0 rounded-full transition-[background-color,box-shadow] duration-300 ease-[ease] motion-reduce:transition-none"
    :class="on ? 'bg-ice shadow-[0_0_0_3px_var(--ice-glow)]' : 'bg-ink/20'"
  />
</template>
