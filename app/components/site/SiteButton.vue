<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { cva, type VariantProps } from 'class-variance-authority'
import type { IconName } from '~/components/Icon.vue'
import { cn } from '~/lib/utils'
import { NuxtLink } from '#components'

/**
 * The landing page's pill button, shared by the nav, the hero, the hero window and the closing
 * card. With `tile`, the icon sits in a round inset tile at the trailing edge (the studio CTA).
 *
 * `ink` is the primary pill: white on the bench, charcoal (graphite-800) on the table. A press squashes to
 * .96 fast (`press`); the release springs back on a soft overshoot, so the button feels like it has give.
 *
 * Hover changes no colour and moves nothing: only the shadow deepens, as if the pill stood further
 * off the page. See `.pill` below.
 */
const pill = cva(
  'pill group/pill inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap press focus-ring [--press:.96]',
  {
    variants: {
      variant: {
        ink: 'pill-ink bg-primary text-primary-foreground',
        plain: 'pill-plain glass relative text-ink',
      },
      tile: { true: 'gap-3', false: 'gap-2' },
      size: {
        lg: 'h-12 px-6 text-[15px] tracking-[-0.01em] [--ring-offset:3px]',
        md: 'min-h-[42px] pl-4 text-[15px] [--ring-offset:4px]',
        sm: 'h-9 gap-[7px] pr-3 pl-3.5 text-[13px]',
      },
    },
    compoundVariants: [
      { size: 'lg', tile: true, class: 'pr-2' },
      { size: 'md', tile: true, class: 'pr-[4px]' },
    ],
    defaultVariants: { variant: 'ink', size: 'lg', tile: false },
  },
)

type PillVariants = VariantProps<typeof pill>

const props = defineProps<{
  to?: RouteLocationRaw
  href?: string
  variant?: PillVariants['variant']
  size?: PillVariants['size']
  /** Trailing icon; drawn in a round tile when `tile` is set. */
  icon?: IconName
  tile?: boolean
  class?: HTMLAttributes['class']
}>()

const tag = computed(() => (props.to ? NuxtLink : props.href ? 'a' : 'button'))

const iconSize = computed(() => (props.size === 'sm' ? 14 : 15))
/* The arrow nudges toward where the button goes on hover. */
const nudge = 'shrink-0 transition-[translate] duration-300 ease-spring group-hover/pill:translate-x-px group-hover/pill:-translate-y-px motion-reduce:transition-none'
</script>

<template>
  <component
    :is="tag"
    v-glass
    :to="to"
    :href="href"
    :type="tag === 'button' ? 'button' : undefined"
    :class="cn(pill({ variant, size, tile }), props.class)"
  >
    <slot />
    <span
      v-if="icon && tile"
      class="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--primary-foreground)_10%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary-foreground)_9%,transparent)]"
    ><Icon
      :name="icon"
      :size="iconSize"
      :class="nudge"
    /></span>
    <Icon
      v-else-if="icon"
      :name="icon"
      :size="iconSize"
      :class="nudge"
    />
  </component>
</template>

<style scoped>
/* Depth on hover: the shadow drops further and softens; the pill itself stays put. One registered
   number (`--lift`, 0…1) drives the shadow so it eases instead of snapping between two shadows.
   This replaces `press`'s transition list (its colour/opacity transitions have nothing to do here);
   `press` still supplies the squash, and drops it under reduced motion. The shadow keeps easing
   there: it is depth, not movement. */
.pill {
  transition: --lift 320ms var(--ease-out), scale 380ms var(--ease-spring);
}
@media (hover: hover) and (pointer: fine) {
  .pill:hover { --lift: 1; }
}
.pill:focus-visible { --lift: 1; }
.pill-ink {
  box-shadow:
    var(--shadow-raise-dark),
    0 calc(var(--lift) * 10px) calc(var(--lift) * 22px) -10px rgb(38 40 46 / calc(var(--lift) * 0.45));
}
.pill-plain {
  --glass-drop:
    0 1px 2px rgb(38 40 46 / 0.06),
    0 calc(10px + var(--lift) * 6px) calc(28px + var(--lift) * 10px) -14px rgb(38 40 46 / calc(0.24 + var(--lift) * 0.12));
}
</style>
