<script setup lang="ts">
/** A landing section's heading: title on the left, a short note on the right, sharing a baseline. */
defineProps<{ id: string; title: string; text: string }>()
</script>

<template>
  <div class="mb-9 grid grid-cols-[minmax(0,1fr)_minmax(0,400px)] items-baseline-last gap-x-12 gap-y-4 max-tab:mb-6 max-tab:grid-cols-1">
    <h2
      :id="id"
      class="heading-section"
    >
      {{ title }}
    </h2>
    <p class="text-[15px] leading-[1.55] text-pretty text-ink-2">
      {{ text }}
    </p>
  </div>
</template>
