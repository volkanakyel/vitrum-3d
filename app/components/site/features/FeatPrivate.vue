<script setup lang="ts">
import { logoById } from '~/utils/logos'

/**
 * The client's mark on a porcelain tile, inside a hairline ring: the edge of this device. Plays once
 * when first seen: the tile settles, the ring closes around it, the padlock's shackle drops shut,
 * and the readout confirms nothing went anywhere.
 */
defineProps<{ running: boolean; seen: boolean }>()
const spotify = logoById('spotify')
</script>

<template>
  <div
    class="private-demo absolute inset-0 flex flex-col items-center justify-center gap-4 pt-7 pb-3"
    :data-play="seen || undefined"
  >
    <div class="relative grid size-[140px] shrink-0 place-items-center">
      <svg
        class="absolute inset-0 size-full overflow-visible"
        viewBox="0 0 140 140"
        aria-hidden="true"
      >
        <circle
          class="private-halo fill-white/45"
          cx="70"
          cy="70"
          r="66"
        />
        <!-- Starts at 12 o'clock and runs clockwise. -->
        <circle
          class="private-ring fill-none stroke-ink/[.14]"
          cx="70"
          cy="70"
          r="66"
          stroke-width="1"
          stroke-linecap="round"
          pathLength="1"
          transform="rotate(-90 70 70)"
        />
      </svg>

      <span class="private-tile relative grid size-16 place-items-center rounded-[19px] bg-[linear-gradient(180deg,#ffffff,#f2f3f6)] shadow-[inset_0_1px_0_#fff,0_0_0_1px_rgba(13,14,18,.07),0_1px_2px_rgba(13,14,18,.06),0_14px_24px_-14px_rgba(13,14,18,.32)]">
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
        <span class="private-badge absolute -right-[9px] -bottom-[9px] grid size-[26px] place-items-center rounded-full bg-ink shadow-[0_0_0_3px_#eff1f4,0_6px_12px_-6px_rgba(13,14,18,.5)]">
          <svg
            class="size-[14px] overflow-visible"
            viewBox="0 0 14 14"
            aria-hidden="true"
          >
            <path
              class="private-shackle fill-none stroke-white"
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

    <p class="private-readout flex h-7 items-center gap-2 rounded-full bg-white/85 pr-3 pl-2.5 text-[12px] text-ink shadow-raise">
      <LiveDot :on="seen" />
      <span><span class="font-mono tabular-nums">0</span> bytes uploaded</span>
    </p>
  </div>
</template>

<style scoped>
.private-ring {
  stroke-dasharray: 1;
  stroke-dashoffset: 0;
}
.private-shackle {
  transform-box: view-box;
}

/* One sequence, ~1.4 s: tile 0–420 ms, ring 180–1080 ms, badge 900 ms, shackle drops at 1120 ms,
   readout 1260 ms. Everything eases out; only the shackle overshoots, because it clicks. */
@media (prefers-reduced-motion: no-preference) {
  .private-halo { opacity: 0; }
  .private-ring { stroke-dashoffset: 1; }
  .private-tile { opacity: 0; transform: translateY(8px) scale(0.96); }
  .private-badge { opacity: 0; transform: scale(0.6); }
  .private-shackle { transform: translateY(-2.4px); }
  .private-readout { opacity: 0; transform: translateY(4px); }

  [data-play] .private-halo { animation: private-fade 700ms 180ms ease-out forwards; }
  [data-play] .private-ring { animation: private-draw 900ms 180ms cubic-bezier(0.65, 0, 0.35, 1) forwards; }
  [data-play] .private-tile { animation: private-settle 420ms var(--ease-out-quint) forwards; }
  [data-play] .private-badge { animation: private-settle 360ms 900ms var(--ease-pop) forwards; }
  [data-play] .private-shackle { animation: private-shut 220ms 1120ms var(--ease-pop) forwards; }
  [data-play] .private-readout { animation: private-settle 320ms 1260ms var(--ease-out-quint) forwards; }
}

@keyframes private-draw { to { stroke-dashoffset: 0; } }
@keyframes private-fade { to { opacity: 1; } }
@keyframes private-settle { to { opacity: 1; transform: none; } }
@keyframes private-shut { to { transform: none; } }
</style>
