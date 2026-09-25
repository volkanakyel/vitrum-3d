<script setup lang="ts">
import type { MaterialPreset } from '~/utils/presets'
import { HERO_STORY } from '~/utils/samples'
import { cn } from '~/lib/utils'

/**
 * The hero: a scaled-down copy of the studio window around the live showcase. Only the finish
 * swatches, the auto-rotate toggle and the studio link are interactive; the rest mirrors the
 * studio's chrome so the first thing people see is the tool itself.
 */
const props = defineProps<{ preset: string; looks: MaterialPreset[]; paused: boolean; live: boolean; unavailable: boolean }>()
const emit = defineEmits<{ select: [id: string]; toggle: []; ready: []; unavailable: [] }>()

const current = computed(() => props.looks.find(l => l.id === props.preset) ?? props.looks[0]!)
const studioLink = computed(() => ({ path: '/studio', query: { sample: HERO_STORY, finish: props.preset } }))

// The GitHub sample's size in the studio; counts up once the 3D layer is ready.
// The GitHub sample's size in the studio; counts up once the 3D layer is ready.
const spring = { stiffness: 60, damping: 15 }
const wText = useSpringText(() => (props.live ? 100 : 0), v => v.toFixed(1), spring)
const hText = useSpringText(() => (props.live ? 97.4 : 0), v => v.toFixed(1), spring)
const dText = useSpringText(() => (props.live ? 14 : 0), v => v.toFixed(1), spring)
const dims = computed(() => [['W', wText.value], ['H', hText.value], ['D', dText.value]] as const)

/* The panel's children settle in one after another once the window has lifted in. */
const settle = 'animate-settle motion-reduce:animate-none'
const swatch = 'grid aspect-square place-items-center rounded-[12px] bg-surface p-0 shadow-raise transition-[box-shadow,scale] duration-150 ease-[ease] focus-ring active:scale-[.96] disabled:cursor-default disabled:opacity-45 aria-pressed:shadow-[0_0_0_1.5px_var(--ink),0_2px_6px_-2px_rgba(13,14,18,.2)] motion-reduce:transition-none'
</script>

<template>
  <!-- One orchestrated entrance: the window lifts in, then the panel fills. -->
  <div class="grid animate-lift grid-cols-[250px_1fr] gap-2 rounded-[26px] bg-shell p-2 text-left shadow-[0_0_0_1px_var(--hairline),0_1px_0_#fff_inset,0_40px_80px_-40px_rgba(13,14,18,.28),0_12px_30px_-18px_rgba(13,14,18,.12)] motion-reduce:animate-none max-desk:grid-cols-[216px_1fr] max-split:grid-cols-1 max-split:rounded-[22px] max-split:p-1.5">
    <aside class="flex min-w-0 flex-col gap-4 pt-2.5 pr-2 pb-1.5 pl-2.5 max-split:hidden">
      <div
        class="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.02em] animation-delay-520"
        :class="settle"
      >
        <AppIcon :size="26" />
        <span>Vitrum</span>
        <span class="index font-normal text-ink-3">v0.2</span>
      </div>

      <div
        class="flex items-center gap-3 rounded-[16px] bg-surface p-2.5 shadow-raise animation-delay-580"
        :class="settle"
        aria-hidden="true"
      >
        <span class="grid size-[38px] place-items-center rounded-[11px] bg-[#f3f4f7] inset-shadow-hairline"><LogoMark
          id="github"
          :size="20"
        /></span>
        <span>
          <strong class="block text-[12.5px] font-medium">github.svg</strong>
          <small class="mt-px block text-[11px] text-ink-3">1 shape · 190 pts</small>
        </span>
      </div>

      <div
        class="well grid grid-cols-3 rounded-full p-[3px] animation-delay-640 *:flex *:h-7 *:items-center *:justify-center *:gap-[5px] *:rounded-full *:text-[11.5px] *:text-ink-2"
        :class="settle"
        aria-hidden="true"
      >
        <span><Icon
          name="shapes"
          :size="13"
        /> Shape</span>
        <span class="bg-surface text-ink! shadow-raise"><Icon
          name="palette"
          :size="13"
        /> Material</span>
        <span><Icon
          name="sun"
          :size="13"
        /> Scene</span>
      </div>

      <div
        class="flex flex-col gap-2.5 border-t border-hairline pt-3.5 animation-delay-700"
        :class="settle"
      >
        <p class="flex items-center gap-[7px] text-[12.5px] font-medium">
          <span class="index font-normal text-ink-3">01</span> Finish <span class="ml-auto font-normal text-ink-3">{{ current.label }}</span>
        </p>
        <div
          class="grid grid-cols-4 gap-1.5"
          role="group"
          aria-label="Preview a finish"
        >
          <button
            v-for="look in looks"
            :key="look.id"
            type="button"
            :class="cn(swatch, 'min-h-10')"
            :aria-label="look.label"
            :aria-pressed="preset === look.id"
            :title="look.label"
            :disabled="unavailable"
            @click="emit('select', look.id)"
          >
            <span
              class="sphere aspect-square w-3/5"
              :style="{ background: look.swatch }"
            />
          </button>
        </div>
      </div>

      <div
        class="flex flex-col gap-2.5 border-t border-hairline pt-3.5 animation-delay-760"
        :class="settle"
        aria-hidden="true"
      >
        <template
          v-for="row in [{ n: '02', label: 'Depth', value: '14.0 mm', fill: 'w-[46%]' }, { n: '03', label: 'Bevel', value: '1.0 mm', fill: 'w-[22%]' }]"
          :key="row.n"
        >
          <p class="flex items-center gap-[7px] text-[12.5px] font-medium">
            <span class="index font-normal text-ink-3">{{ row.n }}</span> {{ row.label }} <span class="index ml-auto font-normal text-ink-3">{{ row.value }}</span>
          </p>
          <span class="relative mt-1 mb-1.5 block h-0.5 rounded-[2px] bg-ink/10"><span
            class="absolute inset-y-0 left-0 rounded-[2px] bg-ink after:absolute after:-top-1.5 after:-right-[7px] after:size-3.5 after:rounded-full after:bg-white after:shadow-raise"
            :class="row.fill"
          /></span>
        </template>
      </div>

      <p
        class="mt-auto flex items-center justify-between text-[11.5px] text-ink-2 animation-delay-820 *:flex *:items-center *:gap-1.5"
        :class="settle"
        aria-hidden="true"
      >
        <span><Icon
          name="sparkle"
          :size="14"
        /> Sample mark</span>
        <span class="text-ink-3">Hide panel <kbd>⌘B</kbd></span>
      </p>
    </aside>

    <div class="flex min-w-0 flex-col overflow-hidden rounded-[18px] bg-surface shadow-pane">
      <header class="relative flex h-12 items-center justify-between gap-3 border-b border-hairline pr-2 pl-4 max-xs:pl-3">
        <span
          class="flex min-w-0 items-center gap-2 text-[12px] whitespace-nowrap text-ink-2"
          aria-hidden="true"
        >
          <LiveDot :on="live" />
          github.svg
          <span class="index text-ink-3 max-xs:hidden">1 shape</span>
        </span>
        <span
          class="absolute left-1/2 flex h-[30px] -translate-x-1/2 items-center gap-1.5 rounded-full bg-well px-[13px] text-[12px] font-medium max-split:hidden"
          aria-hidden="true"
        ><Icon
          name="gem"
          :size="13"
        /> Icon studio</span>
        <span class="flex items-center gap-2">
          <span
            class="flex h-8 items-center rounded-full px-1 text-[11.5px] text-ink-2 shadow-raise [&>i]:h-[13px] [&>i]:w-px [&>i]:bg-hairline [&>span]:px-[9px] max-desk:hidden"
            aria-hidden="true"
          ><span>PNG</span><i /><span>STL</span><i /><span>GLB</span></span>
          <SiteButton
            :to="studioLink"
            size="sm"
            icon="arrow-up-right"
            class="transition-[background-color]"
          >
            Open in studio
          </SiteButton>
        </span>
      </header>

      <div class="relative h-[clamp(440px,42vw,600px)] bg-[#e9ebf0] max-split:aspect-square max-split:h-auto">
        <LandingScene
          :preset="preset"
          :paused="paused"
          @ready="emit('ready')"
          @unavailable="emit('unavailable')"
        />
        <DimReadout
          :values="dims"
          class="absolute top-3.5 left-3.5 bg-white/90 max-xs:top-2.5 max-xs:left-2.5 max-xs:text-[10.5px] max-xs:*:px-[5px]"
          aria-hidden="true"
        />
        <div class="absolute bottom-4 left-1/2 flex -translate-x-1/2 rounded-full bg-white/90 p-1 shadow-float">
          <button
            v-if="live"
            type="button"
            class="inline-flex h-8 items-center gap-2 rounded-full pr-2 pl-3 text-[12px] whitespace-nowrap text-ink transition-colors duration-150 ease-[ease] focus-ring hover:bg-well motion-reduce:transition-none"
            :aria-pressed="!paused"
            @click="emit('toggle')"
          >
            <Icon
              :name="paused ? 'play' : 'pause'"
              :size="13"
            />
            Auto-rotate
            <kbd class="hover-none:hidden">R</kbd>
          </button>
          <span
            v-else
            class="inline-flex h-8 items-center rounded-full px-3 text-[12px] whitespace-nowrap text-ink-2"
          >{{ unavailable ? 'Rendered in Vitrum' : 'Loading 3D' }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- On phones the panel is hidden, so the finishes move under the window. -->
  <div class="hidden max-split:mt-3.5 max-split:flex max-split:items-center max-split:justify-between max-split:gap-3.5 max-split:px-1 max-split:text-left max-xs:flex-col max-xs:items-stretch max-xs:gap-2.5">
    <p class="text-[11px] text-ink-3 max-xs:flex max-xs:items-baseline max-xs:justify-between">
      <span>Finish</span><strong
        class="block text-[13px] font-medium text-ink max-xs:inline"
        aria-live="polite"
      >{{ current.label }}</strong>
    </p>
    <div
      class="flex gap-1 max-xs:grid max-xs:grid-cols-8"
      role="group"
      aria-label="Preview a finish"
    >
      <button
        v-for="look in looks"
        :key="look.id"
        type="button"
        :class="cn(swatch, 'min-h-[34px] w-[34px] rounded-full max-xs:min-h-0 max-xs:w-auto')"
        :aria-label="look.label"
        :aria-pressed="preset === look.id"
        :disabled="unavailable"
        @click="emit('select', look.id)"
      >
        <span
          class="sphere aspect-square w-6 max-xs:w-2/3"
          :style="{ background: look.swatch }"
        />
      </button>
    </div>
  </div>
</template>
