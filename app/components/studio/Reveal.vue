<script setup lang="ts">
import { motion } from 'motion-v'

/**
 * A block of controls that comes and goes with the state above it (the sliders one height
 * source needs, the speed slider behind the auto-rotate switch). Fades in and out and animates
 * its layout so the controls below slide instead of jumping. Must sit inside an
 * `AnimatePresence` for the exit to play.
 */
withDefaults(defineProps<{ gap?: string }>(), { gap: 'gap-5' })
</script>

<template>
  <motion.div
    layout
    class="flex flex-col"
    :class="gap"
    :initial="{ opacity: 0 }"
    :animate="{ opacity: 1 }"
    :exit="{ opacity: 0, transition: { duration: 0.12, ease: 'easeOut' } }"
    :transition="{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }"
  >
    <slot />
  </motion.div>
</template>
