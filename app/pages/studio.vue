<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { AnimatePresence, motion, useTransform } from 'motion-v'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

definePageMeta({ layout: 'studio', key: 'studio' })

const studio = useStudio()
const {
  image, fileName, trace, traceOpts, reliefOpts, relief, glass, dims, busy, importing, error,
  dragging, exporting, toast, view, viewer, heightMm, subject, ready,
  setView, clearImage, onDrop, onPick, loadSample, openLinkedSample, doExport, setHeight,
} = studio

useHead({ title: 'Icon studio · Vitrum' })

const hudWText = useSpringText(() => dims.value?.widthMm ?? 0, v => v.toFixed(1))
const hudHText = useSpringText(() => dims.value?.heightMm ?? 0, v => v.toFixed(1))
const hudDText = useSpringText(() => dims.value?.depthMm ?? 0, v => v.toFixed(1))
const hudTText = useSpringText(() => dims.value?.triangles ?? 0, v => Math.round(v).toLocaleString('en-US'))

// Phone: the controls sheet rests over the bottom of the stage. The model recentres and shrinks
// into the room left above the sheet and the dock (tracking it up to half height; past that the
// sheet is for reading, not looking), the view dock rides the sheet's top edge, and the stage dims
// a touch as the sheet climbs to full.
const { height: sheetH, peek: sheetPeek, half: sheetHalf, full: sheetFull, inset: sheetInset, snap: sheetSnap } = useStudioSheet()
const stageEl = ref<HTMLElement | null>(null)
const { height: stageH } = useElementSize(stageEl)
/** The view dock plus its gap above the sheet, and the dimensions readout at the top. */
const DOCK_ROOM = 58
const HUD_ROOM = 36
function focusStage(h: number) {
  if (!h || !stageH.value) return viewer.value?.setFocus(0, 1)
  // Stage px hidden below the model's room at sheet height x (the stage ends 6 px above the screen).
  const cover = (x: number) => Math.min(x, sheetHalf.value) + sheetInset.value - 6 + DOCK_ROOM
  const scale = (stageH.value - cover(h) - HUD_ROOM) / (stageH.value - cover(sheetPeek.value) - HUD_ROOM)
  viewer.value?.setFocus((cover(h) - HUD_ROOM) / 2, Math.min(1, Math.max(0.6, scale)))
}
const stopFocus = sheetH.on('change', focusStage)
onBeforeUnmount(stopFocus)
watch(stageH, () => focusStage(sheetH.get()))
const dockY = useTransform(sheetH, h => (h ? -(h + sheetInset.value + 4) : 0))
const dockFade = useTransform(sheetH, h => (h ? Math.min(1, Math.max(0, 1 - (h - sheetHalf.value - 24) / 72)) : 1))
const stageDim = useTransform(sheetH, h => (h > sheetHalf.value ? Math.min(1, (h - sheetHalf.value) / Math.max(1, sheetFull.value - sheetHalf.value)) * 0.14 : 0))

const route = useRoute()
onMounted(() => {
  const sample = route.query.sample
  if (typeof sample !== 'string' || sample.length === 0) return
  const finish = route.query.finish
  void openLinkedSample(sample, typeof finish === 'string' ? finish : undefined)
})
</script>

<template>
  <SidebarProvider
    class="h-svh min-h-0"
    style="--sidebar-width: 320px"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <TooltipProvider :delay-duration="300">
      <ControlPanel
        :trace="trace"
        :trace-opts="traceOpts"
        :relief-opts="reliefOpts"
        :glass="glass"
        :height-mm="heightMm"
        :file-name="fileName"
        :busy="busy"
        :error="error"
        @pick="onPick"
        @sample="loadSample()"
        @clear="clearImage"
        @set-height="setHeight"
      />

      <!-- The stage window: a slab with a dark header over a lightbox, the same anatomy as the landing hero. -->
      <SidebarInset class="min-h-0 min-w-0 overflow-hidden bg-slab [view-transition-name:stage]">
        <header
          class="relative z-10 flex h-[52px] shrink-0 items-center justify-between px-3"
        >
          <div class="flex min-w-0 items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger as-child>
                <SidebarTrigger class="size-8 rounded-full text-muted-foreground hover:bg-well hover:text-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                Toggle panel
                <Kbd class="ml-1">⌘B</Kbd>
              </TooltipContent>
            </Tooltip>
            <span class="mx-1 h-4 w-px bg-hairline max-sm:hidden" />
            <span class="flex h-7 min-w-0 items-center gap-2 rounded-full pr-3 pl-2.5 font-mono text-[11.5px] text-ink-2 max-sm:hidden">
              <LiveDot :on="ready" />
              <span class="truncate">{{ fileName || 'Untitled' }}</span>
            </span>
            <NuxtLink
              to="/"
              class="ml-1 flex items-center gap-2 text-[13px] font-semibold sm:hidden"
            >
              <AppIcon :size="24" />
              Vitrum
            </NuxtLink>
          </div>

          <div class="flex items-center gap-2">
            <div class="flex h-8 items-center rounded-full bg-card p-[3px] shadow-raise">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="!ready || !!exporting"
                    class="h-[26px] rounded-full px-2.5 text-[12px] max-sm:size-[26px] max-sm:px-0"
                    aria-label="Export PNG"
                    @click="doExport('png')"
                  >
                    <Icon
                      name="camera"
                      :size="13"
                    />
                    <span class="max-sm:sr-only">PNG</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Render the current view at 2×</TooltipContent>
              </Tooltip>
              <span class="h-3.5 w-px bg-hairline" />
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="sm"
                    :disabled="!ready || !!exporting"
                    class="h-[26px] rounded-full px-2.5 text-[12px] max-sm:size-[26px] max-sm:px-0"
                    aria-label="Export STL"
                    @click="doExport('stl')"
                  >
                    <Icon
                      name="layers"
                      :size="13"
                    />
                    <span class="max-sm:sr-only">STL</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Binary STL in millimetres</TooltipContent>
              </Tooltip>
            </div>
            <Button
              size="sm"
              :disabled="!ready || !!exporting"
              class="h-8 gap-2 pr-1.5 pl-3.5 text-[12.5px]"
              @click="doExport('glb')"
            >
              <Icon
                name="download"
                :size="14"
              />
              <span class="max-sm:hidden">Export GLB</span>
              <span class="sm:hidden">GLB</span>
              <kbd class="h-5 rounded-full bg-primary-foreground/[0.08] px-1.5 text-[10px] text-primary-foreground/60 shadow-none max-sm:hidden">⌘E</kbd>
            </Button>
          </div>
        </header>

        <main
          ref="stageEl"
          class="lightbox relative mx-2 mb-2 min-h-0 min-w-0 flex-1 overflow-hidden rounded-pane bg-background shadow-[inset_0_0_0_1px_rgba(13,14,18,.06)] max-md:mx-1.5 max-md:mb-1.5 max-md:rounded-[14px]">
          <GlassViewer
            ref="viewer"
            :trace="trace"
            :relief="relief"
            :params="glass"
            :source="image"
            @dimensions="dims = $event"
          />
          <motion.div
            class="pointer-events-none absolute inset-0 bg-[#0d0e12] md:hidden"
            :style="{ opacity: stageDim }"
            aria-hidden="true"
          />

          <AnimatePresence>
            <StageLoader
              v-if="importing"
              key="loader"
              :phase="importing.phase"
              :preview="importing.preview"
              :name="importing.name"
            />
          </AnimatePresence>

          <!-- View dock. On the phone it rides the sheet's top edge and bows out as the sheet
               climbs past half. -->
          <motion.div
            class="pointer-events-none absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 flex justify-center max-md:bottom-0"
            :style="{ y: dockY, opacity: dockFade }"
          >
            <motion.div
              v-glass
              class="bench glass relative flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-full p-1 [--glass-blur:18px]"
              :class="sheetSnap === 'full' ? 'pointer-events-none' : 'pointer-events-auto'"
              :initial="{ opacity: 0, y: 12 }"
              :animate="{ opacity: 1, y: 0 }"
              :transition="{ type: 'spring', stiffness: 300, damping: 28, delay: 0.15 }"
            >
              <div class="flex rounded-full well p-[3px]">
                <button
                  v-for="v in ['angle', 'front', 'side', 'top'] as const"
                  :key="v"
                  class="relative h-7 rounded-full px-3 text-[12px] font-medium capitalize transition-colors disabled:opacity-40 pointer-coarse:h-9 max-sm:px-2.5"
                  :class="view === v ? 'text-shell' : 'text-muted-foreground hover:text-foreground'"
                  :disabled="!ready"
                  @click="setView(v)"
                >
                  <motion.span
                    v-if="view === v"
                    layout-id="view-pill"
                    class="lightbox glass absolute inset-0 -z-10 rounded-full [--glass-tint-top:#fff] [--glass-tint:#eef0f4] [--glass-drop:0_1px_2px_rgba(0,0,0,.35)]"
                    :transition="{ type: 'spring', stiffness: 500, damping: 40 }"
                  />
                  <span class="relative">{{ v }}</span>
                </button>
              </div>
              <span class="mx-1 h-5 w-px bg-hairline" />
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-8 pointer-coarse:size-9"
                    :disabled="!ready"
                    @click="viewer?.frame()"
                  >
                    <Icon
                      name="maximize"
                      :size="15"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Fit to view
                  <kbd class="ml-1">F</kbd>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-8 pointer-coarse:size-9"
                    :class="{ 'bg-well-strong text-foreground': glass.autoRotate }"
                    @click="glass.autoRotate = !glass.autoRotate"
                  >
                    <Icon
                      name="orbit"
                      :size="15"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Auto rotate
                  <kbd class="ml-1">R</kbd>
                </TooltipContent>
              </Tooltip>
  </motion.div>
          </motion.div>

          <!-- Dimensions readout -->
          <AnimatePresence>
            <motion.div
              v-if="dims"
              key="hud"
              class="bench glass absolute top-4 left-4 flex h-7 items-center rounded-full px-1 font-mono text-[11.5px] tabular-nums"
              :initial="{ opacity: 0, y: -6 }"
              :animate="{ opacity: 1, y: 0 }"
              :exit="{ opacity: 0, y: -6 }"
            >
              <template
                v-for="(c, i) in [['W', hudWText], ['H', hudHText], ['D', hudDText]] as const"
                :key="c[0]"
              >
                <span
                  v-if="i"
                  class="mx-0.5 h-3 w-px bg-hairline"
                />
                <span class="flex items-center gap-1.5 px-2">
                  <b class="index font-semibold text-ink-3">{{ c[0] }}</b>
                  <span class="text-foreground">{{ c[1] }}</span>
                  <span class="text-[10px] text-ink-3">mm</span>
                </span>
              </template>
              <span class="mx-0.5 h-3 w-px bg-hairline" />
              <span class="px-2 text-ink-3">{{ hudTText }} tris</span>
            </motion.div>
          </AnimatePresence>

          <!-- Empty state: the light table, waiting for an icon. -->
          <AnimatePresence>
            <motion.div
              v-if="!subject && !importing"
              key="empty"
              class="empty-state pointer-events-none absolute inset-0 grid place-items-center overflow-hidden p-6"
              :style="sheetPeek ? { paddingBottom: `${sheetPeek + sheetInset + 12}px` } : undefined"
              :initial="{ opacity: 0, y: 12 }"
              :animate="{ opacity: 1, y: 0 }"
              :exit="{ opacity: 0, scale: 0.985, transition: { duration: 0.2, ease: 'easeOut' } }"
              :transition="{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }"
            >
              <span
                class="absolute inset-0 bg-[radial-gradient(rgba(13,14,18,0.13)_0.9px,transparent_1px)] bg-size-[22px_22px] bg-center [mask-image:radial-gradient(ellipse_58%_54%_at_50%_46%,#000_0%,rgba(0,0,0,0.35)_45%,transparent_80%)]"
                aria-hidden="true"
              />
              <span
                class="absolute top-1/2 left-1/2 size-[640px] -translate-x-1/2 -translate-y-[62%] animate-breathe rounded-full bg-[radial-gradient(closest-side,rgba(47,111,237,0.2),rgba(47,111,237,0.06)_55%,rgba(47,111,237,0)_75%)] motion-reduce:animate-none"
                aria-hidden="true"
              />
              <span
                class="absolute top-1/2 left-1/2 size-[260px] -translate-x-1/2 -translate-y-[112%] animate-breathe-halo rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.9),rgba(255,255,255,0)_72%)] blur-[6px] motion-reduce:animate-none"
                aria-hidden="true"
              />
              <div
                v-glass
                class="glass pointer-events-auto relative w-[440px] max-w-[calc(100vw-3rem)] rounded-window px-8 pt-10 pb-8 text-center [--glass-blur:22px] [--glass-drop:0_2px_24px_rgba(3,7,18,.04),0_28px_56px_-32px_rgba(3,7,18,.3)] [--glass-tint:rgba(255,255,255,.52)]"
              >
                <span class="tile relative mx-auto mb-7 flex size-[88px] items-center justify-center overflow-hidden rounded-[26px] shadow-[inset_0_1px_0_#ffffff,inset_0_-1px_0_rgba(13,14,18,0.05),inset_0_0_0_1px_rgba(255,255,255,0.6),0_0_0_1px_var(--hairline),0_20px_36px_-22px_rgba(3,7,18,0.4)]">
                  <span
                    class="absolute inset-0 animate-sweep rounded-[inherit] bg-[linear-gradient(115deg,transparent_30%,rgba(255,255,255,0)_42%,rgba(255,255,255,0.9)_50%,rgba(255,255,255,0)_58%,transparent_70%)] [transform:translateX(-120%)] motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <BrandMark
                    :size="44"
                    class="relative text-ink opacity-90 [filter:drop-shadow(0_1px_0_rgba(255,255,255,0.95))_drop-shadow(0_-0.5px_0_rgba(13,14,18,0.14))]"
                  />
                </span>
                <h1 class="font-display mb-2.5 text-[26px] leading-[1.08] text-foreground">
                  Turn an icon into solid glass
                </h1>
                <p class="mx-auto mb-7 max-w-[34ch] text-[13px] leading-relaxed text-ink-2">
                  <span class="pointer-coarse:hidden">Drop or paste a logo, icon or wordmark.</span>
                  <span class="hidden pointer-coarse:inline">Pick a logo, icon or wordmark.</span>
                  The outline is traced and extruded, ready in glass, metal or full colour.
                </p>
                <div class="flex justify-center gap-2">
                  <Button
                    as="label"
                    class="h-9 cursor-pointer px-4 text-[12.5px]"
                  >
                    <Icon
                      name="upload"
                      :size="14"
                    />
                    Choose image
                    <input
                      type="file"
                      accept="image/*,.svg"
                      hidden
                      @change="onPick"
                    />
                  </Button>
                  <Button
                    variant="outline"
                    class="h-9 px-4 text-[12.5px]"
                    @click="loadSample()"
                  >
                    <Icon
                      name="sparkle"
                      :size="14"
                    />
                    Try the mark
                  </Button>
                </div>
                <div class="mt-7 flex items-center justify-center gap-3 text-[11px] text-ink-3 pointer-coarse:hidden">
                  <span class="flex items-center gap-1.5"><kbd>⌘V</kbd> paste</span>
                  <span class="size-0.5 rounded-full bg-ink-3/50" />
                  <span class="flex items-center gap-1.5"><kbd>F</kbd> fit</span>
                  <span class="size-0.5 rounded-full bg-ink-3/50" />
                  <span class="flex items-center gap-1.5"><kbd>R</kbd> rotate</span>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence>
            <motion.div
              v-if="dragging"
              key="drop"
              class="pointer-events-none absolute inset-3 flex items-center justify-center gap-2 rounded-pane border-[1.5px] border-dashed border-ice/60 bg-ice-soft/75 text-[15px] font-medium text-ice backdrop-blur-sm"
              :initial="{ opacity: 0 }"
              :animate="{ opacity: 1 }"
              :exit="{ opacity: 0 }"
            >
              <Icon
                name="upload"
                :size="18"
              />
              Drop to trace
            </motion.div>
          </AnimatePresence>
          <AnimatePresence>
            <motion.div
              v-if="toast"
              key="toast"
              class="bench glass absolute top-4 left-1/2 flex h-9 items-center gap-2 rounded-full px-4 text-[12.5px] font-medium text-foreground"
              :initial="{ opacity: 0, y: -8, x: '-50%' }"
              :animate="{ opacity: 1, y: 0, x: '-50%' }"
              :exit="{ opacity: 0, y: -8, x: '-50%' }"
            >
              <Icon
                name="check"
                :size="14"
              />
              {{ toast }}
            </motion.div>
          </AnimatePresence>
        </main>
      </SidebarInset>
    </TooltipProvider>
  </SidebarProvider>
</template>
