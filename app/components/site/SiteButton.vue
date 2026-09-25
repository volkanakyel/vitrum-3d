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
 */
const pill = cva(
  'inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background-color,box-shadow,scale] duration-150 ease-[ease] focus-ring active:scale-[.97] motion-reduce:transition-none',
  {
    variants: {
      variant: {
        ink: 'bg-ink text-white shadow-raise-dark hover:bg-ink-hover',
        plain: 'bg-surface text-ink shadow-raise hover:bg-[#fafbfc]',
      },
      tile: { true: 'gap-3', false: 'gap-2' },
      size: {
        lg: 'h-[46px] px-5 text-[14px] tracking-[-0.01em] [--ring-offset:3px]',
        md: 'min-h-[42px] pl-4 text-[13px] [--ring-offset:4px]',
        sm: 'h-8 gap-[7px] pr-3 pl-3.5 text-[12px]',
      },
    },
    compoundVariants: [
      { size: 'lg', tile: true, class: 'pr-1.5' },
      { size: 'md', tile: true, class: 'pr-[5px]' },
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
    :to="to"
    :href="href"
    :type="tag === 'button' ? 'button' : undefined"
    :class="cn(pill({ variant, size, tile }), props.class)"
  >
    <slot />
    <span
      v-if="icon && tile"
      class="grid place-items-center rounded-full bg-white/12 shadow-[inset_0_0_0_1px_rgba(255,255,255,.1)]"
      :class="size === 'md' ? 'size-8' : 'size-[34px]'"
    ><Icon
      :name="icon"
      :size="iconSize"
    /></span>
    <Icon
      v-else-if="icon"
      :name="icon"
      :size="iconSize"
    />
  </component>
</template>
