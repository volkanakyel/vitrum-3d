<script setup lang="ts">
/** A landing section's heading: title on the left, a short note on the right, sharing a baseline. */
defineProps<{ id: string; title: string; text: string }>()
</script>

<template>
  <div class="mb-14 grid grid-cols-[minmax(0,1fr)_minmax(0,420px)] items-baseline-last gap-x-20 gap-y-5 max-desk:gap-x-12 max-tab:mb-10 max-tab:grid-cols-1">
    <h2
      :id="id"
      class="heading-section max-w-[16ch]"
    >
      {{ title }}
    </h2>
    <p class="text-lead pb-[0.2em]">
      {{ text }}
    </p>
  </div>
</template>
