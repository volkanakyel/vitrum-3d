<script setup lang="ts">
import { motion } from 'motion-v'
import { MATERIAL_PRESETS, type GlassParams, type MaterialPreset } from '~/utils/presets'

/**
 * Every finish in one thumb-width row, for the phone sheet at rest: the fastest way to play is to
 * flick through looks with the model filling the screen. Glass, metal and colour are split by a
 * hairline; the ring slides to the pick and the row scrolls the pick to its middle.
 */
const props = defineProps<{ glass: GlassParams }>()
const strip = ref<HTMLElement | null>(null)
const reduced = useReducedMotion()

const active = computed(() => activePresetId(props.glass))
const apply = (p: MaterialPreset) => applyPreset(props.glass, p)

function centre(id: string | null, smooth: boolean) {
  const el = id ? strip.value?.querySelector<HTMLElement>(`[data-id="${id}"]`) : null
  const row = strip.value
  if (!el || !row) return
  row.scrollTo({ left: el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2, behavior: smooth && !reduced.value ? 'smooth' : 'auto' })
}
watch(active, id => nextTick(() => centre(id, true)))
onMounted(() => centre(active.value, false))
</script>

<template>
  <div
    ref="strip"
    class="relative flex touch-pan-x items-center overflow-x-auto overscroll-x-contain py-1 pr-4 pl-1 [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,#000_10px,#000_calc(100%-28px),transparent)] [&::-webkit-scrollbar]:hidden"
    role="group"
    aria-label="Finishes"
  >
    <template
      v-for="(p, i) in MATERIAL_PRESETS"
      :key="p.id"
    >
      <span
        v-if="i && p.group !== MATERIAL_PRESETS[i - 1]!.group"
        class="mx-1.5 h-5 w-px shrink-0 bg-hairline-strong"
        aria-hidden="true"
      />
      <motion.button
        type="button"
        :data-id="p.id"
        class="relative grid size-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
        :aria-label="p.label"
        :aria-pressed="active === p.id"
        :while-press="{ scale: 0.88 }"
        :transition="{ type: 'spring', stiffness: 520, damping: 26 }"
        @click="apply(p)"
      >
        <motion.span
          v-if="active === p.id"
          layout-id="quick-ring"
          class="absolute inset-[3px] rounded-full shadow-[0_0_0_1.5px_var(--ink),0_0_0_4px_rgba(255,255,255,.7)]"
          :transition="{ type: 'spring', stiffness: 520, damping: 38 }"
        />
        <span
          class="relative size-[30px] rounded-full"
          :style="presetSphere(p)"
        />
      </motion.button>
    </template>
  </div>
</template>
