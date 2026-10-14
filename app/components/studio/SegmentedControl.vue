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
    size?: 'sm' | 'md'
  }>(),
  { size: 'sm' },
)
const emit = defineEmits<{ 'update:modelValue': [T] }>()

// Unique layout id so several controls on screen never trade pills.
const pillId = `seg-pill-${useId()}`
const activeIndex = computed(() => props.options.findIndex(o => String(o.value) === String(props.modelValue)))
/** A divider sits on an option's left edge, except next to the thumb (it would cut into it). */
const divided = (i: number) => i > 0 && i !== activeIndex.value && i - 1 !== activeIndex.value

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
      class="segment-track isolate grid w-full gap-0 rounded-full p-[3px]"
      :style="{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }"
      @update:model-value="onUpdate"
    >
      <ToggleGroupItem
        v-for="(o, i) in options"
        :key="String(o.value)"
        :value="String(o.value)"
        class="relative w-auto min-w-0 rounded-full px-1 font-medium text-muted-foreground transition-colors duration-150 before:absolute before:top-1/2 before:left-0 before:h-3.5 before:w-px before:-translate-y-1/2 before:bg-[rgba(38,40,46,.1)] before:opacity-0 data-[divided]:before:opacity-100 before:transition-opacity before:duration-200 hover:bg-transparent hover:text-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground"
        :data-divided="divided(i) || undefined"
        :class="[size === 'sm' ? 'h-6 text-[12.5px] pointer-coarse:h-8' : 'h-7 text-[13px] pointer-coarse:h-9']"
      >
        <motion.span
          v-if="String(o.value) === String(modelValue)"
          :layout-id="pillId"
          class="segment-thumb"
          :transition="{ type: 'spring', duration: 0.3, bounce: 0 }"
        />
        <!-- Labels stay put; only the thumb travels. -->
        <span class="relative flex items-center gap-1.5">
          <Icon
            v-if="o.icon"
            :name="o.icon"
            :size="13"
          />
          {{ o.label }}
        </span>
      </ToggleGroupItem>
    </ToggleGroup>
  </LayoutGroup>
</template>
