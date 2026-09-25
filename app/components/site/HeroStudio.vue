<script setup lang="ts">
import type { MaterialPreset } from '~/utils/presets'
import { HERO_STORY } from '~/utils/samples'
import { cn } from '~/lib/utils'

/**
 * The hero: a pared-down studio window around the live showcase. It keeps only what the preview
 * is about (the object, its finishes, auto-rotate and the way into the studio) and leaves the
 * rest of the studio's chrome to the studio itself.
 */
const props = defineProps<{ preset: string; looks: MaterialPreset[]; paused: boolean; live: boolean; unavailable: boolean }>()
const emit = defineEmits<{ select: [id: string]; toggle: []; ready: []; unavailable: [] }>()

const current = computed(() => props.looks.find(l => l.id === props.preset) ?? props.looks[0]!)
const studioLink = computed(() => ({ path: '/studio', query: { sample: HERO_STORY, finish: props.preset } }))

const swatch = 'grid aspect-square place-items-center rounded-tile bg-surface p-0 shadow-raise transition-[box-shadow,scale] duration-150 ease-[ease] focus-ring active:scale-[.96] disabled:cursor-default disabled:opacity-45 aria-pressed:shadow-[0_0_0_1.5px_var(--ink),0_2px_6px_-2px_rgba(13,14,18,.2)] motion-reduce:transition-none'
</script>

<template>
  <!-- The window lifts in as one piece; everything the visitor can touch floats over the scene. -->
  <div class="animate-lift rounded-window bg-shell p-2 text-left shadow-[0_0_0_1px_var(--hairline),0_1px_0_#fff_inset,0_40px_80px_-40px_rgba(13,14,18,.28),0_12px_30px_-18px_rgba(13,14,18,.12)] motion-reduce:animate-none max-split:rounded-card max-split:p-1.5">
    <div class="flex min-w-0 flex-col overflow-hidden rounded-pane bg-surface shadow-pane">
      <header class="relative flex h-12 items-center justify-between gap-3 border-b border-hairline pr-2 pl-4 max-xs:pl-3">
        <span
          class="flex min-w-0 items-center gap-2 text-[12px] whitespace-nowrap text-ink-2"
          aria-hidden="true"
        >
          <LiveDot :on="live" />
          github.svg
        </span>
        <SiteButton
          :to="studioLink"
          size="sm"
          icon="arrow-up-right"
          class="transition-[background-color]"
        >
          Open in studio
        </SiteButton>
      </header>

      <div class="relative h-[clamp(440px,42vw,600px)] bg-[#e4e4e2] max-split:aspect-square max-split:h-auto">
        <LandingScene
          :preset="preset"
          :paused="paused"
          @ready="emit('ready')"
          @unavailable="emit('unavailable')"
        />
        <!-- One floating toolbar: finishes, then auto-rotate. Phones get the finishes below instead. -->
        <div class="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center rounded-full bg-white/90 p-1 shadow-float">
          <div
            class="flex gap-0.5 max-split:hidden"
            role="group"
            aria-label="Preview a finish"
          >
            <button
              v-for="look in looks"
              :key="look.id"
              type="button"
              :class="cn(swatch, 'size-8 rounded-full bg-transparent shadow-none hover:bg-well')"
              :aria-label="look.label"
              :aria-pressed="preset === look.id"
              :title="look.label"
              :disabled="unavailable"
              @click="emit('select', look.id)"
            >
              <span
                class="sphere size-5"
                :style="{ background: look.swatch }"
              />
            </button>
          </div>
          <i
            v-if="live"
            class="mx-1.5 h-4 w-px bg-hairline max-split:hidden"
          />
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

  <!-- On phones the toolbar only has room for auto-rotate, so the finishes move under the window. -->
  <div
    class="mt-3.5 hidden items-center justify-between gap-3.5 px-1 text-left max-split:flex max-xs:flex-col max-xs:items-stretch max-xs:gap-2.5"
  >
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
