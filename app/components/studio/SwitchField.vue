<script setup lang="ts">
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A labelled on/off row in a panel section: a field like the sliders, so the label shares their
 * left edge. The whole row toggles; a hint hides behind an info mark instead of a paragraph.
 */
defineProps<{ label: string; disabled?: boolean; hint?: string }>()
const model = defineModel<boolean>({ required: true })
const id = useId()
</script>

<template>
  <div
    class="field group relative flex h-8 items-center justify-between rounded-[10px] pr-2 pl-3 transition-[background-color] duration-150 ease-[ease] has-[button:not(:disabled)]:hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] has-[button:disabled]:opacity-55 pointer-coarse:h-10"
  >
    <span class="flex min-w-0 items-center gap-1.5">
      <!-- The label stretches over the row so a click anywhere on it flips the switch. -->
      <Label
        :for="id"
        class="text-[13px] font-normal text-ink-2 transition-colors duration-150 ease-[ease] group-hover:text-foreground after:absolute after:inset-0 after:rounded-[10px]"
      >
        {{ label }}
      </Label>
      <Tooltip v-if="hint">
        <TooltipTrigger as-child>
          <span
            class="relative flex cursor-help text-muted-foreground opacity-0 transition-[opacity,color] duration-150 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 pointer-coarse:opacity-100"
            tabindex="0"
          >
            <Icon
              name="info"
              :size="11"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          class="max-w-[240px] text-pretty"
        >
          {{ hint }}
        </TooltipContent>
      </Tooltip>
    </span>
    <Switch
      :id="id"
      v-model="model"
      :disabled="disabled"
      class="relative"
    />
  </div>
</template>
