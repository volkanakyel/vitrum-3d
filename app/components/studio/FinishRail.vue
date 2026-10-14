<script setup lang="ts">
import { motion } from 'motion-v'
import { MATERIAL_PRESETS, type GlassParams, type MaterialPreset } from '~/utils/presets'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Desktop counterpart of the phone's QuickFinishes: a short glass rail on the stage's right edge
 * with the neutral finishes, so flipping looks never means leaving the model. Glass above the
 * hairline, metal below; the ring slides to the pick. The full list stays in the Material tab.
 */
const RAIL = ['clear', 'frosted', 'smoke', 'obsidian', 'chrome', 'silver', 'titanium', 'black', 'ceramic'] as const

const props = defineProps<{ glass: GlassParams }>()
const reduced = useReducedMotion()
const looks = RAIL.map(id => MATERIAL_PRESETS.find(p => p.id === id)!).filter(Boolean)
const active = computed(() => activePresetId(props.glass))
const apply = (p: MaterialPreset) => applyPreset(props.glass, p)
</script>

<template>
  <div
    v-glass
    class="glass relative flex flex-col items-center gap-0.5 rounded-full p-1 [--glass-blur:18px]"
    role="group"
    aria-label="Quick finishes"
  >
    <template
      v-for="(p, i) in looks"
      :key="p.id"
    >
      <span
        v-if="i && p.group !== looks[i - 1]!.group"
        class="my-1 h-px w-5 shrink-0 bg-hairline-strong"
        aria-hidden="true"
      />
      <Tooltip>
        <TooltipTrigger as-child>
          <motion.button
            type="button"
            class="relative grid size-9 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
            :aria-label="p.label"
            :aria-pressed="active === p.id"
            :while-press="reduced ? undefined : { scale: 0.88 }"
            :transition="{ type: 'spring', stiffness: 520, damping: 26 }"
            @click="apply(p)"
          >
            <motion.span
              v-if="active === p.id"
              layout-id="rail-ring"
              class="absolute inset-[2px] rounded-full shadow-[0_0_0_1.5px_var(--ink),0_0_0_4px_rgba(255,255,255,.7)]"
              :transition="reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38 }"
            />
            <span
              class="sphere relative size-[24px] rounded-full"
              :style="presetSphere(p)"
            />
          </motion.button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {{ p.label }}
        </TooltipContent>
      </Tooltip>
    </template>
  </div>
</template>
