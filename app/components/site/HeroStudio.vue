<script setup lang="ts">
import { useElementVisibility } from '@vueuse/core'

/**
 * The hero: the live showcase with nothing around it. The scene's edges dissolve into the page
 * through a soft mask, so the objects sit on the table itself. It morphs into the studio's stage
 * on navigation. Auto-rotate is on the R key, as in the studio.
 */
defineProps<{ preset: string; paused: boolean }>()
const emit = defineEmits<{ ready: []; unavailable: [] }>()

// Morph only while on screen: from further down the page it would fly in from outside the viewport.
const stage = ref<HTMLElement | null>(null)
const stageVisible = useElementVisibility(stage)
</script>

<template>
  <div class="relative mx-auto max-w-[1040px] animate-lift motion-reduce:animate-none">
    <!-- Feathered on every side: the render's backdrop fades out before it can read as a box. -->
    <div
      ref="stage"
      class="relative h-[clamp(360px,36vw,520px)] [mask-image:radial-gradient(ellipse_54%_56%_at_50%_52%,#000_60%,transparent_100%)] max-split:aspect-square max-split:h-auto"
      :class="{ '[view-transition-name:stage]': stageVisible }"
    >
      <LandingScene
        :preset="preset"
        :paused="paused"
        @ready="emit('ready')"
        @unavailable="emit('unavailable')"
      />
    </div>
  </div>
</template>
