<script setup lang="ts">
import { logoById } from '~/utils/logos'

/**
 * The client's mark on a porcelain tile, inside a hairline ring: the edge of this device. Plays once
 * when first seen, ~1.4 s: the tile settles (0–420 ms), the ring closes around it (180–1080 ms),
 * the padlock badge pops in (900 ms), its shackle drops shut (1120 ms) and the readout confirms
 * nothing went anywhere (1260 ms). Everything eases out; only the shackle overshoots, because it
 * clicks. Each step's start pose is `motion-safe:` only, so reduced motion shows the final frame.
 */
defineProps<{ running: boolean; seen: boolean }>()
const spotify = logoById('spotify')
</script>

<template>
  <div
    class="group absolute inset-0 flex flex-col items-center justify-center gap-4 pt-7 pb-3"
    :data-play="seen || undefined"
  >
    <div class="relative grid size-[140px] shrink-0 place-items-center">
      <svg
        class="absolute inset-0 size-full overflow-visible"
        viewBox="0 0 140 140"
        aria-hidden="true"
      >
        <circle
          class="fill-white/45 motion-safe:opacity-0 motion-safe:group-data-play:animate-[appear_700ms_180ms_ease-out_forwards]"
          cx="70"
          cy="70"
          r="66"
        />
        <!-- Starts at 12 o'clock and runs clockwise; round caps close the seam where it meets. -->
        <circle
          class="fill-none stroke-ink/[.14] stroke-draw motion-safe:group-data-play:animate-[draw_900ms_180ms_var(--ease-in-out-cubic)_forwards] motion-reduce:[stroke-dashoffset:0]"
          cx="70"
          cy="70"
          r="66"
          stroke-width="1"
          stroke-linecap="round"
          pathLength="1"
          transform="rotate(-90 70 70)"
        />
      </svg>

      <span class="relative grid size-16 place-items-center rounded-[19px] bg-[linear-gradient(180deg,#ffffff,#f2f3f6)] shadow-[inset_0_1px_0_#fff,0_0_0_1px_rgba(38,40,46,.07),0_1px_2px_rgba(38,40,46,.06),0_14px_24px_-14px_rgba(38,40,46,.32)] motion-safe:translate-y-2 motion-safe:scale-96 motion-safe:opacity-0 motion-safe:group-data-play:animate-[to-rest_420ms_var(--ease-out-quint)_forwards]">
        <svg
          class="size-8"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            class="fill-[#1db954]"
            :d="spotify.paths[0]!.d"
          />
        </svg>
        <!-- Padlock badge, ringed in the stage colour so it reads as cut into the tile's corner. -->
        <span class="absolute -right-[9px] -bottom-[9px] grid size-[26px] place-items-center rounded-full bg-ink shadow-[0_0_0_3px_#eff1f4,0_6px_12px_-6px_rgba(38,40,46,.5)] motion-safe:scale-60 motion-safe:opacity-0 motion-safe:group-data-play:animate-[to-rest_360ms_900ms_var(--ease-pop)_forwards]">
          <svg
            class="size-[14px] overflow-visible"
            viewBox="0 0 14 14"
            aria-hidden="true"
          >
            <path
              class="fill-none stroke-white [transform-box:view-box] motion-safe:-translate-y-[2.4px] motion-safe:group-data-play:animate-[to-rest_220ms_1120ms_var(--ease-pop)_forwards]"
              d="M4.4 6.2 V4.6 a2.6 2.6 0 0 1 5.2 0 V6.2"
              stroke-width="1.5"
              stroke-linecap="round"
            />
            <rect
              class="fill-white"
              x="2.8"
              y="6.2"
              width="8.4"
              height="6"
              rx="1.6"
            />
          </svg>
        </span>
      </span>
    </div>

    <p class="flex h-7 items-center gap-2 rounded-full bg-white/85 pr-3 pl-2.5 text-[12px] text-ink shadow-raise motion-safe:translate-y-1 motion-safe:opacity-0 motion-safe:group-data-play:animate-[to-rest_320ms_1260ms_var(--ease-out-quint)_forwards]">
      <LiveDot :on="seen" />
      <span><span class="font-mono tabular-nums">0</span> bytes uploaded</span>
    </p>
  </div>
</template>
