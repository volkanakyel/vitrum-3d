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
 * `ink` is the primary pill: warm white on the bench, ink inside a lightbox. A press squashes to
 * .96 fast; the release springs back on a soft overshoot, so the button feels like it has give.
 */
const pill = cva(
  'group/pill inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background-color,box-shadow,scale] duration-[160ms,160ms,380ms] ease-[ease,ease,var(--ease-spring)] focus-ring active:scale-[.96] active:duration-100 active:ease-out motion-reduce:transition-none',
  {
    variants: {
      variant: {
        ink: 'bg-ink text-shell shadow-raise-dark hover:bg-ink-hover',
        plain: 'glass relative text-ink hover:[--glass-tint:rgba(255,255,255,.82)]',
      },
      tile: { true: 'gap-3', false: 'gap-2' },
      size: {
        lg: 'h-11 px-5 text-[13.5px] tracking-[-0.01em] [--ring-offset:3px]',
        md: 'min-h-[40px] pl-4 text-[13px] [--ring-offset:4px]',
        sm: 'h-8 gap-[7px] pr-3 pl-3.5 text-[12px]',
      },
    },
    compoundVariants: [
      { size: 'lg', tile: true, class: 'pr-1.5' },
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
    <!-- The arrow nudges toward where the button goes on hover. -->
    <span
      v-if="icon && tile"
      class="grid size-8 place-items-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--shell)_9%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--shell)_8%,transparent)]"
    ><Icon
      :name="icon"
      :size="iconSize"
      class="transition-transform duration-300 ease-spring motion-reduce:transition-none pointer-fine:group-hover/pill:translate-x-px pointer-fine:group-hover/pill:-translate-y-px"
    /></span>
    <Icon
      v-else-if="icon"
      :name="icon"
      :size="iconSize"
      class="transition-transform duration-300 ease-spring motion-reduce:transition-none pointer-fine:group-hover/pill:translate-x-px pointer-fine:group-hover/pill:-translate-y-px"
    />
  </component>
</template>
