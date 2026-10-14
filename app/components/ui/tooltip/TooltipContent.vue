<script setup lang="ts">
import type { TooltipContentEmits, TooltipContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TooltipContent, TooltipPortal, useForwardPropsEmits } from "reka-ui"
import { cn } from "@/lib/utils"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<TooltipContentProps & { class?: HTMLAttributes["class"] }>(), {
  sideOffset: 4,
})

const emits = defineEmits<TooltipContentEmits>()

const delegatedProps = reactiveOmit(props, "class")
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      data-slot="tooltip-content"
      v-bind="{ ...forwarded, ...$attrs }"
      :class="cn(
        'bench glass relative z-50 w-fit rounded-lg px-2.5 py-1.5 text-[12px] text-balance text-foreground [--glass-blur:16px]',
        // Grows out of its trigger in 125ms; a neighbour opened straight after (reka's `instant-open`)
        // appears with no animation at all. The exit is a 100ms fade: reka waits for its
        // `animationend` before unmounting. Reduced motion keeps the fade, drops the scale.
        'origin-(--reka-tooltip-content-transform-origin) transition-[opacity,scale] duration-125 ease-out starting:opacity-0 motion-safe:starting:scale-97',
        'data-[state=instant-open]:transition-none data-[state=closed]:animate-[fade-out_100ms_var(--ease-out)_forwards] motion-safe:data-[state=closed]:scale-97',
        props.class,
      )"
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>
