<script setup lang="ts">
import { motion } from 'motion-v'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

withDefaults(
  defineProps<{ title: string; hint?: string; resettable?: boolean; index?: number }>(),
  { index: 0 },
)
const emit = defineEmits<{ reset: [] }>()
// Rise in only when appearing inside an open tab; a tab mounting its page shows sections as they are.
const appear = inject<Ref<boolean>>('sectionAppear', ref(true)).value
</script>

<template>
  <!-- Enters with a short rise; leaves with a quick fade. `layout="position"` lets neighbours
       slide into a gap instead of jumping, without ever scaling a section: a full layout animation
       would stretch the controls while a description changes height. -->
  <motion.section
    layout="position"
    class="group/section flex flex-col gap-6 py-7 first:pt-1 last:pb-3"
    :initial="appear ? { opacity: 0, y: 8 } : false"
    :animate="{ opacity: 1, y: 0 }"
    :exit="{ opacity: 0, transition: { duration: 0.12, ease: 'easeOut' } }"
    :transition="{ type: 'spring', duration: 0.35, bounce: 0 }"
  >
    <header class="-mb-1 flex h-6 items-center justify-between">
      <h3 class="text-[14px] font-medium tracking-[-0.01em] text-foreground">
        {{ title }}
      </h3>
      <div class="flex items-center gap-1.5">
        <Tooltip v-if="resettable">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              :class="[
                'text-muted-foreground opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100',
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
          class="text-[13px] text-ink-3 tabular-nums"
        >
          {{ hint }}
        </span>
      </div>
    </header>
    <slot />
  </motion.section>
</template>
