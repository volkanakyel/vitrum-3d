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
    <!-- Feathered on every side: the ellipse reaches transparent exactly at the box edge (radii
         50%), on a smoothstep curve, so the backdrop's vignette dissolves with no visible rim. -->
    <div
      ref="stage"
      class="relative h-[clamp(360px,36vw,520px)] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_58%,rgba(0,0,0,.93)_65%,rgba(0,0,0,.74)_72%,rgba(0,0,0,.5)_79%,rgba(0,0,0,.26)_86%,rgba(0,0,0,.07)_93%,transparent_100%)] max-split:aspect-square max-split:h-auto"
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
