<script setup lang="ts" generic="T extends string | number">
import { Label } from '@/components/ui/label'
import type { SegmentOption } from '~/components/studio/SegmentedControl.vue'

/** A labelled segmented choice in a panel section. */
defineProps<{ label: string; options: SegmentOption<T>[] }>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <Label class="h-5 text-[13.5px] font-normal text-ink-2">{{ label }}</Label>
    <SegmentedControl
      v-model="model"
      :options="options"
    />
  </div>
</template>
