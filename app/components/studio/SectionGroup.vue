<script setup lang="ts">
import { motion } from 'motion-v'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = withDefaults(
  defineProps<{ title: string; hint?: string; resettable?: boolean; index?: number }>(),
  { index: 0 },
)
const emit = defineEmits<{ reset: [] }>()
// Two-digit mono index: a plate number, the quiet detail that makes the panel feel engineered.
const number = computed(() => String(props.index + 1).padStart(2, '0'))
</script>

<template>
  <!-- Enters with a short rise; leaves with a quick fade. `layout` lets neighbours slide into
       the gap a leaving section opens instead of jumping. -->
  <motion.section
    layout
    class="group/section flex flex-col gap-5 py-6 first:pt-1 last:pb-2"
    :initial="{ opacity: 0, y: 10 }"
    :animate="{ opacity: 1, y: 0 }"
    :exit="{ opacity: 0, transition: { duration: 0.12, ease: 'easeOut' } }"
    :transition="{ type: 'spring', stiffness: 380, damping: 32, delay: index * 0.05 }"
  >
    <header class="flex h-6 items-center justify-between">
      <span class="flex items-baseline gap-2">
        <span class="index text-ink-3">{{ number }}</span>
        <span class="text-[12px] font-medium tracking-[-0.005em] text-foreground">
          {{ title }}
        </span>
      </span>
      <div class="flex items-center gap-1.5">
        <Tooltip v-if="resettable">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              :class="[
                'text-muted-foreground/70 opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100',
                hint ? '' : '-mr-1.5',
              ]"
              aria-label="Reset section"
              @click="emit('reset')"
            >
              <Icon
                name="reset"
                :size="12"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset to defaults</TooltipContent>
        </Tooltip>
        <span
          v-if="hint"
          class="text-[11px] text-ink-3 tabular-nums"
        >
          {{ hint }}
        </span>
      </div>
    </header>
    <slot />
  </motion.section>
</template>
