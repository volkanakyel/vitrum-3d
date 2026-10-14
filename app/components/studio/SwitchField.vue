<script setup lang="ts">
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/** A labelled on/off row in a panel section. */
defineProps<{ label: string; disabled?: boolean }>()
const model = defineModel<boolean>({ required: true })
const id = useId()
</script>

<template>
  <div class="flex h-6 items-center justify-between pointer-coarse:h-9">
    <Label
      :for="id"
      class="text-[13.5px] font-normal text-ink-2"
    >
      {{ label }}
    </Label>
    <Switch
      :id="id"
      v-model="model"
      :disabled="disabled"
    />
  </div>
</template>
