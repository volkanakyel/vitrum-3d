<script setup lang="ts">
import { MotionConfig } from 'motion-v'
</script>

<template>
  <span
    class="grain"
    aria-hidden="true"
  />
  <MotionConfig
    :transition="{ type: 'spring', stiffness: 420, damping: 34 }"
    reduced-motion="user"
  >
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </MotionConfig>
</template>
