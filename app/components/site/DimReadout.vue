<script setup lang="ts">
/**
 * The studio's W × H × D pill, in millimetres. Background and placement come from the caller;
 * item padding is set on the children (`*:`) so callers can tighten it responsively.
 */
defineProps<{ values: readonly (readonly [label: string, value: string])[] }>()
</script>

<template>
  <div class="index flex h-[30px] items-center rounded-full px-2 text-[11.5px] text-ink shadow-raise *:flex *:items-baseline *:gap-[5px] *:px-[7px] [&>*+*]:border-l [&>*+*]:border-hairline">
    <span
      v-for="[label, value] in values"
      :key="label"
    ><b class="font-medium text-ink-3">{{ label }}</b>{{ value }}<i class="text-ink-3 not-italic">mm</i></span>
  </div>
</template>
