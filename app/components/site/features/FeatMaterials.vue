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
  <!-- Sized to the card: a 208 px grid (8 × 26) beside an 88 px sphere, 22 px apart, so the pair
       is 318 px wide and keeps at least 24 px of stage either side down to the phone card. -->
  <div class="absolute inset-0 flex items-center justify-center gap-[22px] px-6 py-5 [--cell:26px] @max-[360px]:gap-4 @max-[360px]:px-4 @max-[360px]:[--cell:24px]">
    <div class="flex w-[88px] shrink-0 flex-col items-center gap-3 @max-[360px]:w-[72px]">
      <!-- New finish fades in over the old one, which holds until it is covered: the sphere never
           dips through the stage mid-swap. -->
      <div class="relative size-[88px] @max-[360px]:size-[72px]">
        <Transition
          enter-active-class="z-10 transition-opacity duration-260 ease-out motion-reduce:transition-none"
          leave-active-class="transition-opacity duration-0 delay-260 motion-reduce:delay-0"
          enter-from-class="opacity-0"
          leave-to-class="opacity-0"
        >
          <span
            :key="current.id"
            class="absolute inset-0 rounded-full shadow-[inset_0_-10px_18px_rgba(38,40,46,.18),0_14px_24px_-12px_rgba(38,40,46,.38)]"
            :style="{ background: current.swatch }"
          />
        </Transition>
        <span class="pointer-events-none absolute inset-0 z-20 rounded-full bg-[radial-gradient(40%_28%_at_34%_24%,rgba(255,255,255,.95),transparent_70%),radial-gradient(70%_50%_at_50%_110%,rgba(255,255,255,.45),transparent_70%)] shadow-[inset_0_0_0_1px_rgba(38,40,46,.06)]" />
      </div>
      <p class="grid h-[34px] place-items-center text-center">
        <SwapTransition lift>
          <span
            :key="current.id"
            class="flex flex-col items-center gap-0.5"
          >
            <span class="index text-ink-3">{{ GROUP_LABEL[current.group] }}</span>
            <strong
              class="text-[12.5px] leading-none font-medium whitespace-nowrap text-ink"
              aria-live="polite"
            >{{ current.label }}</strong>
          </span>
        </SwapTransition>
      </p>
    </div>
    <div
      class="relative grid shrink-0 auto-rows-(--cell) grid-cols-[repeat(8,var(--cell))]"
      role="group"
      :aria-label="`${swatches.length} finishes`"
    >
      <span
        class="pointer-events-none absolute top-0 left-0 size-(--cell) rounded-full shadow-[0_0_0_1.5px_var(--ink)] transition-transform duration-[420ms] ease-[cubic-bezier(.65,0,.35,1)] motion-reduce:transition-none"
        :style="selector"
      />
      <button
        v-for="(s, i) in swatches"
        :key="s.id"
        type="button"
        class="sphere m-[3px] size-[20px] p-0 transition-transform duration-150 ease-[ease] focus-ring motion-reduce:transition-none pointer-fine:hover:scale-[1.12] @max-[360px]:size-[18px]"
        :style="{ background: s.swatch }"
        :aria-label="s.label"
        :aria-pressed="selected === i"
        :title="s.label"
        @click="pick(i)"
      />
    </div>
  </div>
</template>
