<script setup lang="ts">
import { NumberField, NumberFieldContent, NumberFieldInput } from '@/components/ui/number-field'

/** One millimetre field of the Dimensions group: a raised input with its axis letter and unit inside. */
defineProps<{ axis: 'W' | 'H' | 'D'; min: number; step: number }>()
const model = defineModel<number>({ required: true })
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
      <span class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[10.5px] font-semibold text-muted-foreground">{{ axis }}</span>
      <NumberFieldInput class="h-8 rounded-lg border-0 bg-card pr-7 pl-6 text-right font-mono text-[12px] tabular-nums shadow-raise transition-[box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/35 pointer-coarse:h-10 pointer-coarse:text-[14px]" />
      <span class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">mm</span>
    </NumberFieldContent>
  </NumberField>
</template>
