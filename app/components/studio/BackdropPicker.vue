<script setup lang="ts">
import { motion } from 'motion-v'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BACKDROP_PRESETS, activeBackdropId, backdropCss, type BackdropPreset, type GlassParams } from '~/utils/presets'

/**
 * The backdrop sets as tiles that preview their own fill, pale to dark. A calm ring (a card-coloured
 * gap, then a thin half-strength azure line) slides to the pick; a tuned backdrop shows no ring. Used in the Scene tab and the stage's quick menu.
 */
const props = withDefaults(defineProps<{ glass: GlassParams; columns?: number }>(), { columns: 5 })
const reduced = useReducedMotion()
const ringId = `backdrop-ring-${useId()}`
const active = computed(() => activeBackdropId(props.glass))
// A set carries its own vignette: a glow wants less falloff than a flat wall.
const apply = (b: BackdropPreset) => Object.assign(props.glass, b.values)
</script>

<template>
  <div
    class="grid gap-1.5"
    :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
    role="radiogroup"
    aria-label="Backdrop"
  >
    <Tooltip
      v-for="b in BACKDROP_PRESETS"
      :key="b.id"
    >
      <TooltipTrigger as-child>
        <button
          type="button"
          role="radio"
          :aria-checked="active === b.id"
          :aria-label="b.label"
          class="relative aspect-[5/4] rounded-[9px] outline-none press focus-visible:ring-[3px] focus-visible:ring-ring/35"
          @click="apply(b)"
        >
          <span
            class="absolute inset-0 rounded-[9px] shadow-[inset_0_0_0_1px_rgba(38,40,46,.1),inset_0_1px_0_rgba(255,255,255,.35)] transition-[scale] duration-150 ease-out hover:scale-[1.04]"
            :style="{ background: backdropCss(b.values) }"
          />
          <motion.span
            v-if="active === b.id"
            :layout-id="ringId"
            class="pointer-events-none absolute inset-0 rounded-[9px] shadow-[0_0_0_2px_var(--card),0_0_0_3.5px_color-mix(in_srgb,var(--lamp)_55%,transparent)]"
            :transition="reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38 }"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ b.label }}</TooltipContent>
    </Tooltip>
  </div>
</template>
