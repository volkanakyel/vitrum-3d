<script setup lang="ts">
/**
 * The phone sheet at rest: the source on the left, every finish on the right. The source tile is
 * also a drag grip, so it takes no browser touch gestures; a tap still opens the file picker.
 */
const { trace, fileName, busy, glass, onPick } = useStudioContext()
</script>

<template>
  <div class="-mr-4 flex items-center">
    <label
      data-sheet-grip
      class="relative grid size-11 shrink-0 cursor-pointer touch-none place-items-center overflow-hidden rounded-[14px] press [--press:.92]"
      :class="trace ? 'lightbox tile shadow-[inset_0_1px_0_#fff,0_0_0_1px_var(--hairline)]' : 'bg-card text-muted-foreground shadow-raise'"
      :aria-label="trace ? `Replace ${fileName}` : 'Choose an image'"
    >
      <input
        type="file"
        :accept="IMAGE_ACCEPT"
        hidden
        @change="onPick"
      />
      <TraceThumb
        v-if="trace"
        :trace="trace"
        class="size-7 text-foreground transition-opacity"
        :class="{ 'opacity-30': busy }"
      />
      <Icon
        v-else
        name="imagePlus"
        :size="18"
      />
      <span
        v-if="busy"
        class="absolute size-4 animate-spin rounded-full border-[1.5px] border-hairline-strong border-t-foreground motion-reduce:animate-none"
        role="status"
        aria-label="Tracing"
      />
    </label>
    <span
      class="mr-1 ml-2.5 h-7 w-px shrink-0 bg-hairline-strong"
      aria-hidden="true"
    />
    <QuickFinishes
      :glass="glass"
      class="min-w-0 flex-1"
    />
  </div>
</template>
