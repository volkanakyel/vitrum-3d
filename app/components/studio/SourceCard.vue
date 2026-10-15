<script setup lang="ts">
import { AnimatePresence, motion } from 'motion-v'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The panel's source slot: the traced image with its stats, or the place to pick one (desktop; the
 * phone sheet has its own tile), and the import error under it (everywhere).
 */
const { trace, fileName, busy, error, onPick, clearImage } = useStudioContext()

const shapeCount = computed(() => shapeCountLabel(trace.value))
</script>

<template>
  <div>
    <label
      class="group relative flex cursor-pointer items-center gap-3 rounded-[20px] p-3 press [--press:.985] max-md:hidden"
      :class="trace ? 'bg-card shadow-raise' : 'dashed-well hover:bg-none hover:shadow-raise'"
    >
      <input
        type="file"
        :accept="IMAGE_ACCEPT"
        hidden
        @change="onPick"
      />
      <template v-if="trace">
        <motion.span
          :key="fileName"
          class="lightbox flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-tile tile shadow-[inset_0_1px_0_#fff,0_0_0_1px_var(--hairline)]"
          :initial="{ scale: 0.9, opacity: 0 }"
          :animate="{ scale: 1, opacity: 1 }"
          :transition="{ type: 'spring', duration: 0.3, bounce: 0 }"
        >
          <TraceThumb
            :trace="trace"
            class="size-8 text-foreground"
          />
        </motion.span>
        <div class="min-w-0 flex-1">
          <div
            class="truncate text-[13px] font-medium"
            :title="fileName"
          >
            {{ fileName }}
          </div>
          <div
            class="mt-0.5 truncate text-[13px] text-muted-foreground tabular-nums"
            :title="`Traced from ${TRACE_MODE_LABEL[trace.resolvedMode]}`"
          >
            {{ shapeCount }} · {{ trace.vertexCount.toLocaleString('en-US') }} pts
          </div>
        </div>
        <Tooltip v-if="!busy">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              class="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              aria-label="Remove image"
              @click.prevent="clearImage"
            >
              <Icon
                name="x"
                :size="14"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove image</TooltipContent>
        </Tooltip>
      </template>
      <template v-else>
        <span class="flex size-11 shrink-0 items-center justify-center rounded-tile bg-card text-muted-foreground shadow-raise transition-colors group-hover:text-foreground">
          <Icon
            name="imagePlus"
            :size="18"
          />
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-medium">
            Choose an image
          </div>
          <div class="mt-0.5 text-[13px] text-ink-2">
            PNG, JPG, WebP, SVG · drop or paste
          </div>
        </div>
      </template>
      <span
        v-if="busy"
        class="absolute top-1/2 right-3.5 size-3.5 -translate-y-1/2 animate-spin rounded-full border-[1.5px] border-hairline-strong border-t-foreground motion-reduce:animate-none"
        role="status"
        aria-label="Tracing"
      />
    </label>
    <AnimatePresence>
      <motion.p
        v-if="error"
        key="err"
        class="mt-2 flex items-center gap-1.5 px-1 text-[13px] text-destructive"
        :initial="{ opacity: 0, y: -4 }"
        :animate="{ opacity: 1, y: 0 }"
        :exit="{ opacity: 0 }"
        :transition="{ duration: 0.2, ease: EASE_OUT }"
      >
        <Icon
          name="info"
          :size="13"
          class="shrink-0"
        />
        {{ error }}
      </motion.p>
    </AnimatePresence>
  </div>
</template>
