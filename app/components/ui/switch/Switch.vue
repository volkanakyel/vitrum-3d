<script setup lang="ts">
import type { SwitchRootEmits, SwitchRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  SwitchRoot,
  SwitchThumb,
  useForwardPropsEmits,
} from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<SwitchRootProps & { class?: HTMLAttributes["class"] }>()

const emits = defineEmits<SwitchRootEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SwitchRoot
    v-slot="slotProps"
    data-slot="switch"
    v-bind="forwarded"
    :class="cn(
      'peer data-[state=checked]:bg-lamp data-[state=unchecked]:bg-[var(--well-strong)] data-[state=unchecked]:shadow-[var(--well-inset)] data-[state=checked]:shadow-[inset_0_1px_1px_rgba(0,0,0,0.15)] focus-visible:ring-ring/35 press inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full border border-transparent outline-none [--press:.94] focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
  >
    <SwitchThumb
      data-slot="switch-thumb"
      :class="cn('bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35),0_0_0_0.5px_rgba(0,0,0,0.12)] pointer-events-none block size-[14px] rounded-full ring-0 transition-[translate] duration-250 ease-spring motion-reduce:transition-none data-[state=checked]:translate-x-[13px] data-[state=unchecked]:translate-x-[1px]')"
    >
      <slot name="thumb" v-bind="slotProps" />
    </SwitchThumb>
  </SwitchRoot>
</template>
