<script setup lang="ts" generic="T extends string | number">
import { LayoutGroup, motion } from 'motion-v'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { IconName } from '~/components/Icon.vue'

export interface SegmentOption<V> {
  value: V
  label: string
  icon?: IconName
}

const props = withDefaults(
  defineProps<{
    modelValue: T
    options: SegmentOption<T>[]
    mono?: boolean
    size?: 'sm' | 'md'
  }>(),
  { mono: false, size: 'sm' },
)
const emit = defineEmits<{ 'update:modelValue': [T] }>()

// Unique layout id so several controls on screen never trade pills.
const pillId = `seg-pill-${useId()}`

function onUpdate(v: unknown) {
  // Reka emits undefined when the active item is clicked again; keep the selection.
  if (v === undefined || v === null || v === '') return
  const match = props.options.find((o) => String(o.value) === String(v))
  if (match) emit('update:modelValue', match.value)
}
</script>

<template>
  <LayoutGroup>
    <ToggleGroup
      type="single"
      :model-value="String(modelValue)"
      :spacing="1"
      class="grid w-full gap-0.5 rounded-full well p-[3px]"
      :style="{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }"
      @update:model-value="onUpdate"
    >
      <ToggleGroupItem
        v-for="o in options"
        :key="String(o.value)"
        :value="String(o.value)"
        class="relative w-auto min-w-0 rounded-full px-1 font-medium text-muted-foreground transition-colors duration-150 hover:bg-transparent hover:text-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground"
        :class="[size === 'sm' ? 'h-6 text-[12px] pointer-coarse:h-8' : 'h-7 text-[12.5px] pointer-coarse:h-9', mono && 'font-mono']"
      >
        <motion.span
          v-if="String(o.value) === String(modelValue)"
          :layout-id="pillId"
          class="absolute inset-0 -z-10 rounded-full bg-card shadow-[var(--shadow-raise)]"
          :transition="{ type: 'spring', stiffness: 500, damping: 40 }"
        />
        <motion.span
          class="relative flex items-center gap-1.5"
          :while-press="{ scale: 0.96 }"
          :transition="{ type: 'spring', stiffness: 600, damping: 30 }"
        >
          <Icon
            v-if="o.icon"
            :name="o.icon"
            :size="13"
          />
          {{ o.label }}
        </motion.span>
      </ToggleGroupItem>
    </ToggleGroup>
  </LayoutGroup>
</template>
