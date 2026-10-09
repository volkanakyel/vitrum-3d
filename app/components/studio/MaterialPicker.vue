<script setup lang="ts">
import { AnimatePresence, LayoutGroup, motion } from 'motion-v'
import { MATERIAL_PRESETS, type Finish, type GlassParams, type MaterialPreset } from '~/utils/presets'

const props = defineProps<{ glass: GlassParams }>()

const tab = ref<Finish>(props.glass.finish)
const finishLabel: Record<Finish, string> = { glass: 'Glass', metal: 'Metal', print: 'Color' }
const finishIcon: Record<Finish, 'gem' | 'cuboid' | 'image'> = { glass: 'gem', metal: 'cuboid', print: 'image' }
watch(() => props.glass.finish, f => (tab.value = f))

const presets = computed(() => MATERIAL_PRESETS.filter(p => p.group === tab.value))
const active = computed(() => activePresetId(props.glass))
const apply = (p: MaterialPreset) => applyPreset(props.glass, p)
function switchTab(f: Finish) {
  tab.value = f
  const first = { glass: 'clear', metal: 'chrome', print: 'natural' }[f]
  if (props.glass.finish !== f) apply(MATERIAL_PRESETS.find(p => p.id === first)!)
}

</script>

<template>
  <LayoutGroup>
    <div class="flex flex-col gap-3">
      <div class="relative grid grid-cols-3 rounded-full well p-[3px]">
        <button
          v-for="f in (['glass', 'metal', 'print'] as const)" :key="f"
          class="relative z-10 flex h-7 items-center justify-center gap-1.5 rounded-full text-[12px] font-medium transition-colors"
          :class="tab === f ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="switchTab(f)"
        >
          <motion.span v-if="tab === f" layout-id="finish-pill" class="glass-pill" :transition="{ type: 'spring', stiffness: 500, damping: 40 }" />
          <Icon :name="finishIcon[f]" :size="13" />
          {{ finishLabel[f] }}
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          :key="tab" class="grid grid-cols-4 gap-1.5"
          :initial="{ opacity: 0, y: 6 }" :animate="{ opacity: 1, y: 0 }" :exit="{ opacity: 0, y: -4, transition: { duration: 0.1, ease: 'easeOut' } }"
          :transition="{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }"
        >
          <motion.button
            v-for="(p, i) in presets" :key="p.id"
            class="group relative flex flex-col items-center gap-1.5 rounded-xl px-1 pt-2.5 pb-2"
            :class="active === p.id ? '' : 'hover:bg-well'"
            :initial="{ opacity: 0, scale: 0.9 }" :animate="{ opacity: 1, scale: 1 }"
            :transition="{ type: 'spring', stiffness: 420, damping: 30, delay: i * 0.02 }"
            :while-hover="{ y: -1 }" :while-press="{ scale: 0.94 }" :title="p.label"
            @click="apply(p)"
          >
            <motion.span v-if="active === p.id" layout-id="material-ring" class="absolute inset-0 rounded-xl bg-card shadow-[0_0_0_1px_var(--hairline-strong),0_1px_2px_rgba(17,18,20,0.08),0_4px_10px_-6px_rgba(17,18,20,0.2)]" :transition="{ type: 'spring', stiffness: 520, damping: 38 }" />
            <span class="relative size-8 rounded-full transition-transform group-hover:scale-105" :style="presetSphere(p)" />
            <span class="relative max-w-full truncate text-[11px] leading-none" :class="active === p.id ? 'text-foreground' : 'text-muted-foreground'">{{ p.label }}</span>
          </motion.button>
        </motion.div>
      </AnimatePresence>
    </div>
  </LayoutGroup>
</template>
