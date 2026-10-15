<script setup lang="ts">
import { motion } from 'motion-v'
import type { MaterialPreset } from '~/utils/presets'

/**
 * The hero's finish switch: a glass bar docked on the stage's lower edge. Each finish is a lit
 * sphere; the picked one widens to carry its name, so the bar reads as one control that morphs
 * rather than a row of chips. Picking re-materials the centre logo live.
 */
const props = defineProps<{ looks: MaterialPreset[] }>()
const model = defineModel<string>({ required: true })
const reduced = useReducedMotion()

const spring = computed(() => (reduced.value ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 40 }))

// Arrow keys move along the bar, as in a radio group.
function onKey(event: KeyboardEvent, index: number) {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const next = props.looks[(index + step + props.looks.length) % props.looks.length]!
  model.value = next.id
  ;(event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus()
}
</script>

<template>
  <div
    v-glass
    class="glass relative inline-flex items-center gap-0.5 rounded-full p-1 [--glass-blur:20px] [--glass-tint:rgba(255,255,255,.62)]"
    role="radiogroup"
    aria-label="Preview a finish"
  >
    <motion.button
      v-for="(look, i) in looks"
      :key="look.id"
      type="button"
      role="radio"
      :data-id="look.id"
      :aria-checked="model === look.id"
      :aria-label="look.label"
      :tabindex="model === look.id ? 0 : -1"
      layout
      :transition="spring"
      class="relative flex h-10 items-center rounded-full pl-[7px] text-[15px] font-medium tracking-[-0.01em] whitespace-nowrap text-ink focus-ring [--ring-offset:1px] max-phone:h-9 max-phone:pl-[5px] max-phone:text-[14px]"
      :class="model === look.id ? 'pr-3.5 max-phone:pr-3' : 'pr-[7px] max-phone:pr-[5px]'"
      :while-press="reduced ? undefined : { scale: 0.94 }"
      @click="model = look.id"
      @keydown="onKey($event, i)"
    >
      <motion.span
        v-if="model === look.id"
        layout-id="hero-finish-thumb"
        class="absolute inset-0 -z-10 rounded-full bg-surface shadow-raise"
        :transition="spring"
      />
      <motion.span
        layout="position"
        :transition="spring"
        class="sphere block size-[26px] shrink-0 max-phone:size-[22px]"
        :style="presetSphere(look)"
      />
      <motion.span
        v-if="model === look.id"
        :key="look.id"
        class="pl-2 max-phone:pl-1.5"
        :initial="reduced ? false : { opacity: 0, filter: 'blur(4px)' }"
        :animate="{ opacity: 1, filter: 'blur(0px)' }"
        :transition="{ duration: 0.22, ease: 'easeOut', delay: reduced ? 0 : 0.06 }"
      >{{ look.label }}</motion.span>
    </motion.button>
  </div>
</template>
