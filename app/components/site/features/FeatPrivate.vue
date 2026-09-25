<script setup lang="ts">
import { logoById } from '~/utils/logos'

/** A browser window draws itself around the artwork and locks. Plays once, when first seen. */
defineProps<{ running: boolean; seen: boolean }>()
const spotify = logoById('spotify')
</script>

<template>
  <div class="absolute inset-0 grid place-items-center p-6">
    <svg
      class="group w-[78%] max-w-[250px] overflow-visible"
      :data-play="seen || undefined"
      viewBox="0 0 220 150"
      aria-hidden="true"
    >
      <rect
        class="fill-white/70 stroke-ink/16 stroke-1 stroke-draw [fill-opacity:0] motion-safe:group-data-play:animate-[draw_1100ms_var(--ease-in-out-cubic)_forwards,fill-in_400ms_900ms_ease-out_forwards] motion-reduce:[fill-opacity:1] motion-reduce:[stroke-dashoffset:0]"
        x="1"
        y="1"
        width="218"
        height="148"
        rx="16"
        pathLength="1"
      />
      <path
        class="stroke-ink/10 stroke-draw motion-safe:group-data-play:animate-[draw_500ms_700ms_var(--ease-in-out-cubic)_forwards] motion-reduce:[stroke-dashoffset:0]"
        d="M1 30 H219"
        pathLength="1"
      />
      <g class="fill-ink/12 opacity-0 motion-safe:group-data-play:animate-[appear_300ms_1000ms_ease-out_forwards] motion-reduce:opacity-100">
        <circle
          cx="18"
          cy="16"
          r="3.5"
        />
        <circle
          cx="30"
          cy="16"
          r="3.5"
        />
        <circle
          cx="42"
          cy="16"
          r="3.5"
        />
      </g>
      <svg
        class="opacity-0 motion-safe:group-data-play:animate-[appear_500ms_1000ms_ease-out_forwards] motion-reduce:opacity-100"
        x="84"
        y="54"
        width="52"
        height="52"
        viewBox="0 0 24 24"
      >
        <path
          class="fill-[#1db954]"
          :d="spotify.paths[0]!.d"
        />
      </svg>
      <g class="origin-center opacity-0 [transform-box:fill-box] motion-safe:group-data-play:animate-[lock-in_480ms_1450ms_var(--ease-out-quint)_forwards] motion-reduce:opacity-100">
        <rect
          class="fill-ink"
          x="158"
          y="100"
          width="30"
          height="30"
          rx="9"
        />
        <path
          class="fill-none stroke-white stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]"
          d="M167 113 V109 a6 6 0 0 1 12 0 V113 M166 113 H180 V122 H166 Z"
        />
      </g>
    </svg>
  </div>
</template>
