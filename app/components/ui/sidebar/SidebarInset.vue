<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <main
    data-slot="sidebar-inset"
    :class="cn(
      'bg-background relative flex w-full flex-1 flex-col transition-[margin] duration-[320ms] ease-out motion-reduce:transition-none',
      'md:peer-data-[variant=inset]:m-2.5 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-window md:peer-data-[variant=inset]:shadow-pane md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2.5',
      props.class,
    )"
  >
    <slot />
  </main>
</template>
