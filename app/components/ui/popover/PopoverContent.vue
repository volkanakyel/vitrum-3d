<script setup lang="ts">
import type { PopoverContentEmits, PopoverContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  PopoverContent,
  PopoverPortal,
  useForwardPropsEmits,
} from "reka-ui"
import { cn } from "@/lib/utils"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<PopoverContentProps & { class?: HTMLAttributes["class"] }>(),
  {
    align: "center",
    sideOffset: 4,
  },
)
const emits = defineEmits<PopoverContentEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <PopoverPortal>
    <PopoverContent
      data-slot="popover-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'glass relative z-50 w-72 max-w-(--reka-popover-content-available-width) rounded-2xl border-0 p-4 text-popover-foreground outline-hidden [--glass-blur:24px] [--glass-tint:rgba(255,255,255,.8)]',
          // Scales out of its trigger in 180ms and leaves faster (130ms); reka waits for the exit's
          // `animationend` before unmounting. Reduced motion keeps only the fade.
          'origin-(--reka-popover-content-transform-origin) transition-[opacity,scale] duration-180 ease-out starting:opacity-0 motion-safe:starting:scale-95',
          'data-[state=closed]:animate-[fade-out_130ms_var(--ease-out)_forwards] data-[state=closed]:duration-130 motion-safe:data-[state=closed]:scale-95',
          props.class,
        )
      "
    >
      <slot />
    </PopoverContent>
  </PopoverPortal>
</template>
