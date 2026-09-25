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
      'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-[var(--well-strong)] data-[state=unchecked]:shadow-[inset_0_1px_1px_rgba(13,14,18,0.08)] data-[state=checked]:shadow-raise-dark focus-visible:ring-ring/35 inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full border border-transparent transition-all outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
  >
    <SwitchThumb
      data-slot="switch-thumb"
      :class="cn('bg-card shadow-[0_1px_2px_rgba(13,14,18,0.25),0_0_0_0.5px_rgba(13,14,18,0.08)] pointer-events-none block size-[14px] rounded-full ring-0 transition-transform duration-200 ease-[var(--ease-out-quint)] data-[state=checked]:translate-x-[13px] data-[state=unchecked]:translate-x-[1px]')"
    >
      <slot name="thumb" v-bind="slotProps" />
    </SwitchThumb>
  </SwitchRoot>
</template>
