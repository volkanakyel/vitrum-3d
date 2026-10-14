<script setup lang="ts">
/** The three export formats, each "saving" in turn. */
const props = defineProps<{ running: boolean; seen: boolean }>()

const FILES = [
  { ext: 'PNG', use: 'Slides, posts' },
  { ext: 'GLB', use: 'Web, 3D apps' },
  { ext: 'STL', use: '3D printing' },
]
const { index: round } = useCycle(1_000_000, 4800, toRef(props, 'running'))
</script>

<template>
  <div class="absolute inset-0 grid place-items-center p-4">
    <div
      :key="round"
      class="group flex gap-3"
      :data-play="seen || undefined"
    >
      <div
        v-for="(f, i) in FILES"
        :key="f.ext"
        class="flex w-[76px] flex-col items-center gap-0.5 motion-safe:group-data-play:animate-[file-rise_520ms_var(--delay)_var(--ease-out-quint)_both]"
        :style="{ '--delay': `${i * 420}ms` }"
      >
        <svg
          class="mb-2 w-16 overflow-visible drop-shadow-[0_10px_14px_rgba(38,40,46,.08)]"
          viewBox="0 0 64 80"
          aria-hidden="true"
        >
          <path
            class="fill-white stroke-ink/10"
            d="M8 1.5 H42 L62.5 22 V72 Q62.5 78.5 56 78.5 H8 Q1.5 78.5 1.5 72 V8 Q1.5 1.5 8 1.5 Z"
          />
          <path
            class="fill-[#eef0f4] stroke-ink/10"
            d="M42 1.5 V16 Q42 22 48 22 H62.5"
          />
          <path
            class="stroke-ink/8 stroke-4 [stroke-linecap:round]"
            d="M14 62 H50"
          />
          <path
            class="stroke-ink stroke-4 stroke-draw [stroke-linecap:round] motion-safe:group-data-play:animate-[draw_700ms_calc(var(--delay)_+_250ms)_var(--ease-in-out-cubic)_forwards] motion-reduce:[stroke-dashoffset:0]"
            d="M14 62 H50"
            pathLength="1"
          />
          <path
            class="fill-none stroke-lamp stroke-3 stroke-draw [stroke-linecap:round] [stroke-linejoin:round] motion-safe:group-data-play:animate-[draw_320ms_calc(var(--delay)_+_980ms)_var(--ease-out-quint)_forwards] motion-reduce:[stroke-dashoffset:0]"
            d="M25 44 L30 49 L40 38"
            pathLength="1"
          />
        </svg>
        <strong class="text-[13px] font-semibold text-ink">{{ f.ext }}</strong>
        <span class="text-[12px] whitespace-nowrap text-ink-3">{{ f.use }}</span>
      </div>
    </div>
  </div>
</template>
