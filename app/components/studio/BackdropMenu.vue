<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SegmentOption } from '~/components/studio/SegmentedControl.vue'
import { backdropCss, type BackdropFill, type GlassParams } from '~/utils/presets'

/**
 * The backdrop from the view dock: the sets and the fill, without leaving the model. Its button
 * is a swatch of the current wall, so the dock says what is set before it is opened. The fine
 * controls (colours, angle, vignette) stay in the Scene tab.
 */
const props = defineProps<{ glass: GlassParams; disabled?: boolean }>()
const open = ref(false)
const FILLS: SegmentOption<BackdropFill>[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
]
const swatch = computed(() => backdropCss(props.glass))
</script>

<template>
  <Popover v-model:open="open">
    <!-- The popover trigger wraps the tooltip, not the other way round: inside a tooltip trigger
         the popover never finds its anchor and opens off screen. -->
    <PopoverTrigger as-child>
      <span class="inline-flex">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="size-8 pointer-coarse:size-9"
              :class="{ 'bg-well-strong': open }"
              aria-label="Background"
              :disabled="disabled"
            >
              <span
                class="size-4 rounded-[5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.28),0_1px_2px_rgba(0,0,0,.3)]"
                :style="{ background: swatch }"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Background</TooltipContent>
        </Tooltip>
      </span>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      :side-offset="10"
      class="flex w-72 flex-col gap-3 rounded-2xl p-3"
      @open-auto-focus.prevent
    >
      <div class="flex h-5 items-center justify-between px-0.5">
        <span class="text-[13px] font-medium text-foreground">Background</span>
        <span class="text-[12px] text-ink-3">More in Scene</span>
      </div>
      <BackdropPicker :glass="glass" />
      <SegmentedControl
        v-model="glass.backdropFill"
        :options="FILLS"
      />
    </PopoverContent>
  </Popover>
</template>
