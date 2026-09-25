<script setup lang="ts">
/** Out-in swap for a short label that changes in place: a quick fade, with a 4px lift when `lift`. */
defineProps<{ lift?: boolean }>()
const active = 'transition-[opacity,translate] duration-160 ease-[ease-out] motion-reduce:transition-none'
</script>

<template>
  <Transition
    mode="out-in"
    :enter-active-class="active"
    :leave-active-class="active"
    :enter-from-class="lift ? 'opacity-0 translate-y-1' : 'opacity-0'"
    :leave-to-class="lift ? 'opacity-0 -translate-y-1' : 'opacity-0'"
  >
    <slot />
  </Transition>
</template>
