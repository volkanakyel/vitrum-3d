<script setup lang="ts">
import type { TooltipProviderProps } from "reka-ui"
import { TooltipProvider } from "reka-ui"

// After one tooltip closes, the next opened within `skipDelayDuration` skips the delay (and, via
// `data-state="instant-open"` in TooltipContent, the animation), so a toolbar reads at speed.
const props = withDefaults(defineProps<TooltipProviderProps>(), {
  delayDuration: 0,
  skipDelayDuration: 400,
})
</script>

<template>
  <TooltipProvider v-bind="props">
    <slot />
  </TooltipProvider>
</template>
