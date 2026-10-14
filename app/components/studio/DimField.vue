<script setup lang="ts">
import { NumberField, NumberFieldContent, NumberFieldInput } from '@/components/ui/number-field'

/** One millimetre field of the Dimensions group: a raised input with its axis letter and unit inside. */
defineProps<{ axis: 'W' | 'H' | 'D'; min: number; step: number }>()
const model = defineModel<number>({ required: true })
const AXIS_NAME = { W: 'Width', H: 'Height', D: 'Depth' } as const
</script>

<template>
  <NumberField
    v-model="model"
    :min="min"
    :step="step"
    :format-options="{ maximumFractionDigits: 1 }"
    class="gap-1"
  >
    <NumberFieldContent>
      <span
        class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[12px] font-medium text-muted-foreground"
        aria-hidden="true"
      >{{ axis }}</span>
      <NumberFieldInput
        :aria-label="`${AXIS_NAME[axis]} in millimetres`"
        class="h-8 rounded-lg border-0 bg-card pr-[31px] pl-6 text-right text-[13px] font-medium tabular-nums shadow-raise transition-[box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/35 pointer-coarse:h-10 pointer-coarse:text-[14px]" />
      <span
        class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[12px] text-muted-foreground"
        aria-hidden="true"
      >mm</span>
    </NumberFieldContent>
  </NumberField>
</template>
