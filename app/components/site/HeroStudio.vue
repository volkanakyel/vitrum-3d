<script setup lang="ts">
import { useElementVisibility } from '@vueuse/core'

/**
 * The hero: the live showcase, full-bleed behind the copy. Its paper is the page colour, so the
 * objects sit on the table itself and frame the headline. It morphs into the studio's stage on
 * navigation. Auto-rotate is on the R key, as in the studio.
 */
defineProps<{ preset: string; paused: boolean; clear?: number }>()
const emit = defineEmits<{ ready: []; unavailable: [] }>()

// Morph only while on screen: from further down the page it would fly in from outside the viewport.
const stage = useTemplateRef('stage')
const stageVisible = useElementVisibility(stage)
</script>

<template>
  <div
    ref="stage"
    class="absolute inset-0"
    :class="{ '[view-transition-name:stage]': stageVisible }"
  >
    <LandingScene
      :preset="preset"
      :paused="paused"
      :clear="clear"
      @ready="emit('ready')"
      @unavailable="emit('unavailable')"
    />
  </div>
</template>
