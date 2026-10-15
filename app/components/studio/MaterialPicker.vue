<script setup lang="ts">
import { AnimatePresence, LayoutGroup, motion } from 'motion-v'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { SegmentOption } from './SegmentedControl.vue'
import { MATERIAL_PRESETS, type Finish, type GlassParams, type MaterialPreset } from '~/utils/presets'

const props = defineProps<{ glass: GlassParams }>()
const { ink } = useStudioContext()

const tab = ref<Finish>(props.glass.finish)
const finishLabel: Record<Finish, string> = { glass: 'Glass', metal: 'Metal', print: 'Color' }
const finishIcon: Record<Finish, 'gem' | 'cuboid' | 'image'> = { glass: 'gem', metal: 'cuboid', print: 'image' }
watch(() => props.glass.finish, f => (tab.value = f))

const presets = computed(() => MATERIAL_PRESETS.filter(p => p.group === tab.value))
const active = computed(() => activePresetId(props.glass))
const apply = (p: MaterialPreset) => applyPreset(props.glass, p)
const finishes: SegmentOption<Finish>[] = (['glass', 'metal', 'print'] as const).map(f => ({ value: f, label: finishLabel[f], icon: finishIcon[f] }))
function pickPreset(id: unknown) {
  const p = presets.value.find(m => m.id === id)
  if (p) apply(p)
}
function switchTab(f: Finish) {
  tab.value = f
  const first = { glass: 'clear', metal: 'chrome', print: 'natural' }[f]
  if (props.glass.finish !== f) apply(MATERIAL_PRESETS.find(p => p.id === first)!)
}
</script>

<template>
  <LayoutGroup>
    <div class="flex flex-col gap-3">
      <SegmentedControl
        :model-value="tab"
        :options="finishes"
        size="md"
        @update:model-value="switchTab"
      />

      <!-- Switching Glass / Metal / Color crossfades the grid in place; mounting the tab shows it as is. -->
      <AnimatePresence
        mode="wait"
        :initial="false"
      >
        <motion.div
          :key="tab"
          :initial="{ opacity: 0 }" :animate="{ opacity: 1 }" :exit="{ opacity: 0, transition: { duration: 0.08, ease: 'easeOut' } }"
          :transition="{ duration: 0.16, ease: 'easeOut' }"
        >
          <!-- One shadcn toggle group: arrow keys move between finishes, the choice is announced. -->
          <ToggleGroup
            type="single"
            :model-value="active ?? undefined"
            :aria-label="`${finishLabel[tab]} finishes`"
            :spacing="1"
            class="-mx-1.5 grid w-[calc(100%+0.75rem)] grid-cols-4 gap-1"
            @update:model-value="pickPreset"
          >
            <ToggleGroupItem
              v-for="p in presets" :key="p.id"
              :value="p.id"
              :aria-label="p.label"
              class="group relative flex h-auto min-w-0 flex-col items-center gap-2 rounded-xl px-0 pt-3 pb-2.5 outline-none hover:bg-well focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0 data-[state=on]:bg-transparent"
              as-child
            >
              <motion.button>
                <motion.span v-if="active === p.id" layout-id="material-ring" class="absolute inset-0 rounded-xl bg-card shadow-raise" :transition="{ type: 'spring', duration: 0.3, bounce: 0 }" />
                <!-- Press squashes the sphere, not the button: scaling the button would skew the ring's layout measurement. -->
                <span class="relative size-8 rounded-full shadow-[0_1px_2px_rgba(38,40,46,.18),0_4px_8px_-4px_rgba(38,40,46,.3)] transition-[scale] duration-200 ease-out group-hover:scale-105 group-active:scale-95 group-active:duration-100" :style="presetSphere(p, glass.colorSource === 'picture' ? ink : null)" />
                <span class="relative max-w-full truncate text-[12.5px] leading-none tracking-[-0.01em]" :class="active === p.id ? 'font-medium text-foreground' : 'text-ink-2'">{{ p.label }}</span>
              </motion.button>
            </ToggleGroupItem>
          </ToggleGroup>
        </motion.div>
      </AnimatePresence>
    </div>
  </LayoutGroup>
</template>
