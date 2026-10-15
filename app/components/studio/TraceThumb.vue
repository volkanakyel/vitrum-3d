<script setup lang="ts">
import { toSvgPath, type TraceResult } from '~/utils/trace'

/** The traced outline as a filled silhouette, framed with a little air around it. */
const props = defineProps<{ trace: TraceResult }>()

/** Breathing room around the outline, as a share of its longer side. */
const PAD = 0.08
const path = computed(() => toSvgPath(props.trace))
const viewBox = computed(() => {
  const { minX, minY, maxX, maxY } = props.trace.bbox
  const w = maxX - minX
  const h = maxY - minY
  const pad = Math.max(w, h) * PAD
  return `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`
})
</script>

<template>
  <svg
    :viewBox="viewBox"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    <path
      :d="path"
      fill="currentColor"
      fill-rule="evenodd"
    />
  </svg>
</template>
