<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { cn } from '~/lib/utils'

/**
 * The studio's controls: a sidebar on desktop, the bottom sheet on the phone. It lays out the
 * source, the tab row and the tab pages; each page owns its sections and reads the studio from
 * `provideStudio` on the page.
 */
const { keyed, subject, loadSample } = useStudioContext()
const { isMobile, toggleSidebar } = useSidebar()

const TABS = [
  { value: 'shape', label: 'Shape', icon: 'shapes' },
  { value: 'material', label: 'Material', icon: 'palette' },
  { value: 'scene', label: 'Scene', icon: 'sun' },
] as const
type Tab = (typeof TABS)[number]['value']
const tab = ref<Tab>('shape')
/** The active tab sits at an outer end: the slab's corner squares off under it. */
const edge = computed(() => (tab.value === TABS[0].value ? 'start' : tab.value === TABS.at(-1)!.value ? 'end' : undefined))

/**
 * Sections rise in when they appear inside a tab (Layers, when Stack is picked), but not when a
 * whole tab mounts: a new tab's page is one sheet that fades in, nothing moves. Off while a tab
 * swaps, back on two frames later. Read once by each SectionGroup at mount.
 */
const sectionAppear = ref(false)
provide('sectionAppear', sectionAppear)
const afterPaint = () => requestAnimationFrame(() => requestAnimationFrame(() => (sectionAppear.value = true)))
onMounted(afterPaint)

// The new tab's settings fade in where they stand while the tab shape glides; the old ones leave
// at once. Opacity only, so nothing jostles; none at all when a key switched the tab. Decided per
// switch, not live, so a later click never re-adds the class and replays the fade.
const fadePage = ref(true)
const tabPage = computed(() => cn('mt-0 flex flex-col divide-y divide-hairline', fadePage.value && 'animate-[fade-in_180ms_var(--ease-out)_both]'))

const panelBody = useTemplateRef<HTMLElement>('panelBody')
watch(tab, () => {
  fadePage.value = !keyed.value
  sectionAppear.value = false
  afterPaint()
  // Every tab opens at its top, not at wherever the last one was scrolled to.
  const viewport = panelBody.value?.closest<HTMLElement>('[data-slot=scroll-area-viewport]')
  if (viewport) viewport.scrollTop = 0
}, { flush: 'sync' })
</script>

<template>
  <Sidebar
    variant="inset"
    collapsible="offcanvas"
  >
    <Tabs
      v-model="tab"
      class="flex min-h-0 flex-1 flex-col gap-0"
    >
      <SidebarHeader class="gap-5 px-4 pt-0 pb-5 max-md:gap-3 max-md:pb-3.5 md:pb-0">
        <div class="-mb-1 flex h-12 items-center max-md:hidden">
          <NuxtLink
            to="/"
            class="flex items-center gap-2.5 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
            aria-label="Vitrum home"
          >
            <AppIcon :size="28" />
            <span class="flex items-baseline gap-2">
              <span class="text-[14px] font-semibold tracking-[-0.02em] text-foreground">Vitrum</span>
              <span class="text-[12.5px] text-ink-3 tabular-nums">v0.2</span>
            </span>
          </NuxtLink>
        </div>

        <SourceCard />
        <SheetRest v-if="isMobile" />

        <PanelTabs
          v-model="tab"
          :tabs="TABS"
          :edge="edge"
        />
      </SidebarHeader>

      <SidebarSeparator class="mx-4 bg-hairline data-[orientation=horizontal]:w-auto md:hidden" />

      <!-- The settings slab: the active tab above is cut from the same sheet, so the panel reads as
           that tab's page. Its top corner squares off under an end tab so the two meet flush. -->
      <SidebarContent
        :data-edge="edge"
        :class="cn(
          'gap-0 md:mx-2 md:rounded-pane md:bg-card md:transition-[border-radius] md:duration-180 md:ease-out md:data-[edge=end]:rounded-tr-none md:data-[edge=start]:rounded-tl-none motion-reduce:transition-none',
          // Glass sheet: hairline rim, a 1px white catch along the top, a short contact shadow and a
          // long, faint fall-off, so the slab lifts off the sidebar without a visible border.
          'md:shadow-[0_0_0_1px_var(--hairline),inset_0_1px_0_rgba(255,255,255,.9),0_1px_2px_rgba(38,40,46,.04),0_4px_12px_-6px_rgba(38,40,46,.08),0_24px_48px_-28px_rgba(38,40,46,.22)]',
          keyed && 'md:transition-none',
        )"
      >
        <!-- Content fades under the slab's top and bottom edges; no scrollbar: the fade says there
             is more, and wheel, trackpad, touch and keyboard all still scroll. -->
        <ScrollArea
          type="hover"
          :scroll-hide-delay="400"
          class="min-h-0 flex-1 **:data-[slot=scroll-area-scrollbar]:hidden **:data-[slot=scroll-area-viewport]:overscroll-contain **:data-[slot=scroll-area-viewport]:[mask-image:linear-gradient(to_bottom,transparent,#000_24px,#000_calc(100%-24px),transparent)]"
        >
          <!-- Nothing to shape until something is on the stage: the settings rest, dimmed and out
               of reach, so every page reads the same before an import. -->
          <div
            ref="panelBody"
            class="px-4 pt-5 pb-6 transition-opacity duration-180 ease-out md:px-5 motion-reduce:transition-none"
            :class="{ 'opacity-45 select-none': !subject }"
            :inert="!subject"
            :aria-disabled="!subject || undefined"
          >
            <TabsContent
              value="shape"
              :class="tabPage"
            >
              <ShapeTab />
            </TabsContent>
            <TabsContent
              value="material"
              :class="tabPage"
            >
              <MaterialTab />
            </TabsContent>
            <TabsContent
              value="scene"
              :class="tabPage"
            >
              <SceneTab />
            </TabsContent>
          </div>
        </ScrollArea>
      </SidebarContent>
    </Tabs>

    <SidebarFooter class="flex-row items-center justify-between px-4 py-3 max-md:hidden">
      <Button
        variant="ghost"
        size="sm"
        class="-ml-2 h-7 px-2 text-[13px] text-muted-foreground hover:text-foreground"
        @click="loadSample()"
      >
        <Icon
          name="sparkle"
          :size="13"
        />
        Sample mark
      </Button>
      <button
        type="button"
        class="-mr-1 flex h-7 items-center gap-1.5 rounded-full pr-1 pl-2 text-[13px] text-ink-3 press hover:bg-well hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none pointer-coarse:hidden"
        @click="toggleSidebar"
      >
        Hide panel
        <kbd class="text-[12px]">⌘B</kbd>
      </button>
    </SidebarFooter>
  </Sidebar>
</template>
