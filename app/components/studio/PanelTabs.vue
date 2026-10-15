<script setup lang="ts" generic="T extends string">
import { motion } from 'motion-v'
import { useSidebar } from '@/components/ui/sidebar'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { IconName } from '~/components/Icon.vue'

/**
 * The panel's tab row. The triggers stay flat; one shared motion shape carries the active state.
 * On desktop that shape is a folder tab joined to the settings slab below; on the phone sheet it
 * is a pill in a well, and the row doubles as the sheet's drag grip.
 */
defineProps<{
  tabs: readonly { value: T; label: string; icon: IconName }[]
  /** Which outer end the active tab sits at, so its outer fillet can be dropped. */
  edge?: 'start' | 'end'
}>()
const tab = defineModel<T>({ required: true })

const { isMobile, openMobile, setOpenMobile } = useSidebar()
const { keyed } = useStudioContext()

/** Arrow keys switch tabs too, and a key's result lands at once. */
const glide = computed(() => (keyed.value ? { duration: 0 } : { type: 'spring' as const, duration: 0.32, bounce: 0 }))

/** On the phone sheet, reaching for a tab while it rests means you want to see that tab. */
function select(value: T) {
  tab.value = value
  if (isMobile.value && !openMobile.value) setOpenMobile(true)
}
/**
 * On the sheet the tabs double as a drag grip, so they pick on click, not on press: a drag that
 * starts on a tab must not switch to it. (Touch never sends the press for a drag; a mouse does.)
 */
function holdPress(e: MouseEvent) {
  if (!isMobile.value) return
  e.stopPropagation()
  e.preventDefault()
}
</script>

<template>
  <TabsList
    data-sheet-grip
    data-sheet-peek
    class="relative z-10 grid h-9 w-full grid-cols-3 max-md:isolate max-md:touch-none max-md:rounded-full max-md:segment-track max-md:p-[3px] md:-mx-2 md:-mb-px md:h-10 md:w-[calc(100%+1rem)] md:rounded-none md:bg-transparent md:p-0"
    @mousedown.capture="holdPress"
  >
    <TabsTrigger
      v-for="t in tabs"
      :key="t.value"
      :value="t.value"
      class="group/tab relative gap-1.5 rounded-full border-0 text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none md:h-full md:rounded-none md:focus-visible:rounded-t-xl md:focus-visible:outline-none md:focus-visible:ring-2 md:focus-visible:ring-inset md:focus-visible:ring-ring/35"
      @click="select(t.value)"
    >
      <motion.span
        v-if="tab === t.value && isMobile"
        layout-id="panel-tab-pill"
        class="segment-thumb"
        :transition="glide"
      />
      <motion.span
        v-else-if="tab === t.value"
        layout-id="panel-tab-folder"
        class="folder-tab"
        :data-edge="edge"
        :transition="glide"
      />
      <!-- The label never moves: only the tab shape glides to it. -->
      <span class="relative flex items-center gap-1.5">
        <Icon
          :name="t.icon"
          :size="13"
          class="shrink-0 transition-colors duration-150 group-data-[state=active]/tab:text-lamp-ink"
        />
        {{ t.label }}
      </span>
    </TabsTrigger>
  </TabsList>
</template>

<style scoped>
/*
  Folder tab (desktop). A card-coloured shape that runs 1px into the slab below and covers the
  slab's top hairline there, so the two read as one sheet. Its bottom corners flare out with
  concave fillets (radial gradients that draw the same hairline on their curve). Under the first
  or last tab the fillet on the outer side is dropped and the slab's corner squares.
*/
.folder-tab {
  --r: 12px;
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: var(--r) var(--r) 0 0;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--hairline), inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 -4px 12px -6px rgba(38, 40, 46, 0.1);
  /* No shadow or hairline along the bottom: that edge is the slab. */
  clip-path: inset(-20px -20px 0 -20px);
}
.folder-tab::before,
.folder-tab::after {
  content: '';
  position: absolute;
  bottom: 0;
  width: var(--r);
  height: var(--r);
}
.folder-tab::before {
  left: calc(var(--r) * -1);
  background: radial-gradient(circle at 0 0, transparent calc(var(--r) - 0.5px), var(--hairline) calc(var(--r) - 0.5px), var(--hairline) calc(var(--r) + 0.5px), var(--card) calc(var(--r) + 0.5px));
}
.folder-tab::after {
  right: calc(var(--r) * -1);
  background: radial-gradient(circle at 100% 0, transparent calc(var(--r) - 0.5px), var(--hairline) calc(var(--r) - 0.5px), var(--hairline) calc(var(--r) + 0.5px), var(--card) calc(var(--r) + 0.5px));
}
.folder-tab[data-edge='start']::before,
.folder-tab[data-edge='end']::after {
  display: none;
}
</style>
