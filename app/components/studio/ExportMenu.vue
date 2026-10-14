<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ExportKind } from '~/composables/useStudio'
import type { IconName } from '~/components/Icon.vue'

/**
 * One Export button, one short menu: each format says what it's for and saves in one click.
 * The header carries the size that will be written, so the STL's millimetres are never a guess.
 * ⌘E still skips the menu and saves the GLB.
 */
const props = defineProps<{
  disabled: boolean
  exporting: '' | ExportKind
  dims: { widthMm: number; heightMm: number; depthMm: number; triangles: number } | null
}>()
const emit = defineEmits<{ export: [kind: ExportKind] }>()
const open = ref(false)

const FORMATS: { kind: ExportKind; icon: IconName; title: string; use: string; key?: string }[] = [
  { kind: 'glb', icon: 'cuboid', title: 'GLB model', use: 'three.js, React Three Fiber, Spline', key: '⌘E' },
  { kind: 'png', icon: 'camera', title: 'PNG image', use: 'This view at 2×, transparent' },
  { kind: 'stl', icon: 'layers', title: 'STL mesh', use: 'Slicers and 3D printing, in mm' },
]

const MM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const size = computed(() => {
  const d = props.dims
  if (!d) return ''
  return `${MM.format(d.widthMm)} × ${MM.format(d.heightMm)} × ${MM.format(d.depthMm)} mm`
})

function pick(kind: ExportKind) {
  emit('export', kind)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        size="sm"
        :disabled="disabled"
        class="h-8 gap-2 pr-2.5 pl-3.5 text-[12.5px] max-sm:pr-2 max-sm:pl-2.5"
        aria-label="Export"
      >
        <Icon
          :name="exporting ? 'spinner' : 'download'"
          :size="14"
          :class="{ 'animate-spin motion-reduce:animate-none': exporting }"
        />
        <span class="max-sm:sr-only">Export</span>
        <Icon
          name="chevron"
          :size="13"
          class="opacity-60 transition-transform duration-200 ease-out motion-reduce:transition-none"
          :class="{ 'rotate-180': open }"
        />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      :side-offset="8"
      class="w-[300px] p-1.5"
    >
      <div class="flex items-baseline justify-between px-2.5 pt-1.5 pb-2">
        <p class="text-[13px] font-semibold text-ink">
          Export
        </p>
        <p
          v-if="size"
          class="text-[12px] text-ink-3 tabular-nums"
        >
          {{ size }}
        </p>
      </div>
      <ul class="flex flex-col gap-0.5">
        <li
          v-for="f in FORMATS"
          :key="f.kind"
        >
          <button
            type="button"
            class="group press flex w-full items-center gap-3 rounded-xl p-2 text-left outline-none [--press:.98] hover:bg-well focus-visible:bg-well focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:opacity-50"
            :disabled="!!exporting"
            @click="pick(f.kind)"
          >
            <span class="grid size-9 shrink-0 place-items-center rounded-tile bg-surface text-ink-2 shadow-raise">
              <Icon
                :name="exporting === f.kind ? 'spinner' : f.icon"
                :size="16"
                :class="{ 'animate-spin motion-reduce:animate-none': exporting === f.kind }"
              />
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="text-[13px] font-medium text-ink">{{ f.title }}</span>
              <span class="truncate text-[12px] text-ink-3">{{ f.use }}</span>
            </span>
            <kbd
              v-if="f.key"
              class="shrink-0 pointer-coarse:hidden"
            >{{ f.key }}</kbd>
            <Icon
              v-else
              name="download"
              :size="14"
              class="shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 ease-[ease] group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          </button>
        </li>
      </ul>
      <p class="mt-1.5 flex items-center gap-1.5 border-t border-hairline px-2.5 pt-2.5 pb-1.5 text-[12px] text-ink-3">
        <Icon
          name="lock"
          :size="12"
        />
        Saved to your device, never uploaded.
      </p>
    </PopoverContent>
  </Popover>
</template>
