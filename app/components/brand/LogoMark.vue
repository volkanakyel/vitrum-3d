<script setup lang="ts">
import { logoById, logoViewBox } from '~/utils/logos'

/** A brand mark from `logos.ts`, in its brand colours or in `currentColor` when `mono`. */
const props = withDefaults(defineProps<{ id: string; size?: number; mono?: boolean }>(), { size: 20, mono: false })
const logo = computed(() => logoById(props.id))
</script>

<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="logoViewBox(logo)"
    aria-hidden="true"
  >
    <path
      v-for="(p, i) in logo.paths"
      :key="i"
      :d="p.d"
      :fill="mono ? 'currentColor' : (p.fill ?? logo.colour)"
      :fill-rule="logo.evenodd ? 'evenodd' : undefined"
    />
  </svg>
</template>
