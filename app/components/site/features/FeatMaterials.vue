<script setup lang="ts">
import { MATERIAL_PRESETS } from '~/utils/presets'

/** Every finish in the studio, with a selection ring hopping between a few favourites. */
const props = defineProps<{ running: boolean; seen: boolean }>()

const GROUP_LABEL = { glass: 'Glass', metal: 'Metal', print: 'Colour print' } as const
const ORDER = ['glass', 'metal', 'print'] as const
const swatches = [...MATERIAL_PRESETS].sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group))
const TOUR = ['sapphire', 'gold', 'emerald', 'chrome', 'velvet', 'rose', 'copper', 'holo', 'wood', 'amber']
  .map(id => swatches.findIndex(s => s.id === id))
  .filter(i => i >= 0)

const { index: step, hold } = useCycle(TOUR.length, 1500, toRef(props, 'running'))
const picked = ref<number | null>(null)
const selected = computed(() => picked.value ?? TOUR[step.value]!)
const current = computed(() => swatches[selected.value]!)
watch(step, () => { picked.value = null })

function pick(i: number) {
  picked.value = i
  hold()
}

const COLS = 8
const selector = computed(() => ({ transform: `translate(calc(${selected.value % COLS} * var(--cell)), calc(${Math.floor(selected.value / COLS)} * var(--cell)))` }))
</script>

<template>
  <div class="absolute inset-0 flex items-center justify-center gap-[26px] p-5 [--cell:30px] max-2xs:gap-4 max-2xs:p-3.5 max-2xs:[--cell:27px]">
    <div class="relative flex w-[104px] shrink-0 flex-col items-center max-2xs:w-20">
      <Transition
        enter-active-class="transition-opacity duration-320 ease-[ease-out] motion-reduce:transition-none"
        leave-active-class="transition-opacity duration-320 ease-[ease-out] motion-reduce:transition-none"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <span
          :key="current.id"
          class="absolute top-0 left-0 size-[104px] rounded-full shadow-[inset_0_-10px_18px_rgba(13,14,18,.18),0_14px_26px_-12px_rgba(13,14,18,.35)] max-2xs:size-20"
          :style="{ background: current.swatch }"
        />
      </Transition>
      <span class="pointer-events-none absolute top-0 left-0 size-[104px] rounded-full bg-[radial-gradient(40%_28%_at_34%_24%,rgba(255,255,255,.95),transparent_70%),radial-gradient(70%_50%_at_50%_110%,rgba(255,255,255,.45),transparent_70%)] max-2xs:size-20" />
      <p class="mt-[118px] flex flex-col items-center gap-0.5 max-2xs:mt-[92px]">
        <span class="index text-ink-3">{{ GROUP_LABEL[current.group] }}</span>
        <strong
          class="text-[13px] font-medium text-ink"
          aria-live="polite"
        >{{ current.label }}</strong>
      </p>
    </div>
    <div
      class="relative grid auto-rows-(--cell) grid-cols-[repeat(8,var(--cell))]"
      role="group"
      :aria-label="`${swatches.length} finishes`"
    >
      <span
        class="pointer-events-none absolute top-0 left-0 size-(--cell) rounded-full shadow-[0_0_0_1.5px_var(--ink)] transition-transform duration-380 ease-in-out-cubic motion-reduce:transition-none"
        :style="selector"
      />
      <button
        v-for="(s, i) in swatches"
        :key="s.id"
        type="button"
        class="sphere m-1 size-[22px] p-0 transition-transform duration-150 ease-[ease] focus-ring motion-reduce:transition-none pointer-fine:hover:scale-[1.12] max-2xs:size-[19px]"
        :style="{ background: s.swatch }"
        :aria-label="s.label"
        :aria-pressed="selected === i"
        :title="s.label"
        @click="pick(i)"
      />
    </div>
  </div>
</template>
