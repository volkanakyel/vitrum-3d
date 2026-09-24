<script setup lang="ts">
import { AnimatePresence, motion } from 'motion-v'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { MATERIAL_PRESETS } from '~/utils/presets'
import { sampleById } from '~/utils/samples'

definePageMeta({ layout: 'studio', key: 'studio' })

const studio = useStudio()
const {
  image, fileName, trace, traceOpts, reliefOpts, relief, glass, dims, busy, importing, error,
  dragging, exporting, toast, view, viewer, heightMm, subject, ready,
  setView, clearImage, onDrop, onPick, loadSample, doExport, setHeight,
} = studio

useHead({ title: 'Icon studio · Vitrum' })

const hudWText = useSpringText(() => dims.value?.widthMm ?? 0, v => v.toFixed(1))
const hudHText = useSpringText(() => dims.value?.heightMm ?? 0, v => v.toFixed(1))
const hudDText = useSpringText(() => dims.value?.depthMm ?? 0, v => v.toFixed(1))
const hudTText = useSpringText(() => dims.value?.triangles ?? 0, v => Math.round(v).toLocaleString('en-US'))

const route = useRoute()
onMounted(async () => {
  const sample = typeof route.query.sample === 'string' ? sampleById(route.query.sample) : undefined
  if (!sample) return
  try {
    await loadSample(sample.id)
    const finish = MATERIAL_PRESETS.find(p => p.id === route.query.finish)
    Object.assign(glass, (finish ?? MATERIAL_PRESETS.find(p => p.id === sample.preset))?.values)
    // These known silhouettes have open counters; automatic tile detection can otherwise
    // turn the camera or conversation outline into a solid badge.
    const roundedIcon = ['camera', 'chat', 'spark', 'heart'].includes(sample.id)
    Object.assign(glass, {
      geometry: sample.id === 'play' ? 'stack' : 'extrude',
      widthMm: 100,
      depthMm: roundedIcon ? 16 : 20,
      bevelMm: sample.id === 'vitrum' ? 0.4 : ['star', 'bolt'].includes(sample.id) ? 1.2 : sample.id === 'spark' ? 2 : 3.8,
    })
  } catch {
    error.value = 'This example could not be opened. Choose a sample or upload your own artwork.'
  }
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

      <SidebarInset class="min-h-0 min-w-0 overflow-hidden bg-card">
        <header
          class="relative z-10 flex h-12 shrink-0 items-center justify-between px-3 after:pointer-events-none after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-hairline"
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
            <span class="flex h-7 min-w-0 items-center gap-2 rounded-full pr-3 pl-2.5 text-[12px] text-foreground/80 max-sm:hidden">
              <span
                class="size-1.5 shrink-0 rounded-full transition-colors duration-300"
                :class="ready ? 'bg-ice shadow-[0_0_0_3px_var(--ice-glow)]' : 'bg-ink-3/40'"
              />
              <span class="truncate">{{ fileName || 'Untitled' }}</span>
              <span
                v-if="trace && (glass.geometry !== 'relief' || reliefOpts.cutout)"
                class="index text-ink-3"
              >
                {{ trace.polygons.length }}&thinsp;{{ trace.polygons.length === 1 ? 'shape' : 'shapes' }}
              </span>
            </span>
            <NuxtLink
              to="/"
              class="ml-1 flex items-center gap-2 text-[13px] font-semibold sm:hidden"
            >
              <AppIcon :size="24" />
              Vitrum
            </NuxtLink>
          </div>

          <span
            class="absolute left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full well px-3.5 text-[12px] font-medium text-foreground max-sm:hidden"
          >
            <Icon
              name="gem"
              :size="13"
            />
            Icon studio
          </span>

          <div class="flex items-center gap-2">
            <div class="flex h-8 items-center rounded-full bg-card p-[3px] shadow-[var(--shadow-raise)]">
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
              <kbd class="h-5 rounded-full bg-white/[0.12] px-1.5 text-[10px] text-white/75 shadow-none max-sm:hidden">⌘E</kbd>
            </Button>
          </div>
        </header>

        <main class="relative min-h-0 min-w-0 flex-1">
          <GlassViewer
            ref="viewer"
            :trace="trace"
            :relief="relief"
            :params="glass"
            :source="image"
            @dimensions="dims = $event"
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

          <!-- View dock -->
          <motion.div
            class="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-full bg-card/92 p-1 shadow-[var(--shadow-float)] backdrop-blur-xl"
            :initial="{ opacity: 0, y: 12, x: '-50%' }"
            :animate="{ opacity: 1, y: 0, x: '-50%' }"
            :transition="{ type: 'spring', stiffness: 300, damping: 28, delay: 0.15 }"
          >
            <div class="flex rounded-full well p-[3px]">
              <button
                v-for="v in ['angle', 'front', 'side', 'top'] as const"
                :key="v"
                class="relative h-7 rounded-full px-3 text-[12px] font-medium capitalize transition-colors disabled:opacity-40 pointer-coarse:h-9 max-sm:px-2.5"
                :class="view === v ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
                :disabled="!ready"
                @click="setView(v)"
              >
                <motion.span
                  v-if="view === v"
                  layout-id="view-pill"
                  class="absolute inset-0 -z-10 rounded-full bg-card shadow-[var(--shadow-raise)]"
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
            <PanelToggle class="md:hidden" />
          </motion.div>

          <!-- Dimensions readout -->
          <AnimatePresence>
            <motion.div
              v-if="dims"
              key="hud"
              class="absolute top-4 left-4 flex h-7 items-center rounded-full bg-card/85 px-1 font-mono text-[11.5px] tabular-nums shadow-[var(--shadow-float)] backdrop-blur"
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
              class="empty-state pointer-events-none absolute inset-0 grid place-items-center p-6"
              :initial="{ opacity: 0, y: 12 }"
              :animate="{ opacity: 1, y: 0 }"
              :exit="{ opacity: 0, scale: 0.985, transition: { duration: 0.2, ease: 'easeOut' } }"
              :transition="{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }"
            >
              <span
                class="stage-grid absolute inset-0"
                aria-hidden="true"
              />
              <span
                class="stage-light absolute top-1/2 left-1/2 size-[640px] -translate-x-1/2 -translate-y-[62%] rounded-full"
                aria-hidden="true"
              />
              <span
                class="stage-halo absolute top-1/2 left-1/2 size-[260px] -translate-x-1/2 -translate-y-[112%] rounded-full"
                aria-hidden="true"
              />
              <div class="glass-card pointer-events-auto relative w-[440px] max-w-[calc(100vw-3rem)] rounded-[28px] px-8 pt-10 pb-8 text-center">
                <span class="hero-tile mx-auto mb-7 flex size-[88px] items-center justify-center rounded-[26px]">
                  <span
                    class="hero-sweep absolute inset-0 rounded-[inherit]"
                    aria-hidden="true"
                  />
                  <BrandMark
                    :size="44"
                    class="hero-mark relative"
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
              <span
                class="index absolute right-5 bottom-5 flex items-center gap-2 text-ink-3 max-sm:hidden"
                aria-hidden="true"
              >
                <span class="size-1 rounded-full bg-ink-3/60" />
                VITRUM · ICON STUDIO
              </span>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence>
            <motion.div
              v-if="dragging"
              key="drop"
              class="pointer-events-none absolute inset-3 flex items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-dashed border-ice/60 bg-ice-soft/75 text-[15px] font-medium text-ice backdrop-blur-sm"
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
              class="absolute top-4 left-1/2 flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[12.5px] font-medium text-primary-foreground shadow-[var(--shadow-raise-dark)]"
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

<style scoped>
.stage-grid {
  background-image: radial-gradient(rgba(13, 14, 18, 0.13) 0.9px, transparent 1px);
  background-size: 22px 22px;
  background-position: center;
  mask-image: radial-gradient(ellipse 58% 54% at 50% 46%, #000 0%, rgba(0, 0, 0, 0.35) 45%, transparent 80%);
  -webkit-mask-image: radial-gradient(ellipse 58% 54% at 50% 46%, #000 0%, rgba(0, 0, 0, 0.35) 45%, transparent 80%);
}
.stage-light {
  background: radial-gradient(closest-side, rgba(47, 111, 237, 0.2), rgba(47, 111, 237, 0.06) 55%, rgba(47, 111, 237, 0) 75%);
  animation: breathe 9s ease-in-out infinite;
}
.stage-halo {
  background: radial-gradient(closest-side, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0) 72%);
  filter: blur(6px);
  animation: breathe-halo 7s ease-in-out infinite reverse;
}
.glass-card {
  background: rgba(255, 255, 255, 0.66);
  backdrop-filter: blur(22px) saturate(1.25);
  -webkit-backdrop-filter: blur(22px) saturate(1.25);
  box-shadow:
    inset 1.5px 1.5px 1px rgba(255, 255, 255, 0.95),
    inset -1px -1px 1px rgba(255, 255, 255, 0.5),
    0 0 0 1px var(--hairline),
    0 2px 24px rgba(3, 7, 18, 0.04),
    0 28px 56px -32px rgba(3, 7, 18, 0.3);
}
.hero-tile {
  position: relative;
  overflow: hidden;
  background: linear-gradient(160deg, #ffffff 0%, #eef2f8 100%);
  box-shadow:
    inset 0 1px 0 #ffffff,
    inset 0 -1px 0 rgba(13, 14, 18, 0.05),
    inset 0 0 0 1px rgba(255, 255, 255, 0.6),
    0 0 0 1px var(--hairline),
    0 20px 36px -22px rgba(3, 7, 18, 0.4);
}
.hero-sweep {
  background: linear-gradient(115deg, transparent 30%, rgba(255, 255, 255, 0) 42%, rgba(255, 255, 255, 0.9) 50%, rgba(255, 255, 255, 0) 58%, transparent 70%);
  transform: translateX(-120%);
  animation: sweep 6.5s var(--ease-out-quint) infinite;
}
.hero-mark {
  color: var(--ink);
  opacity: 0.9;
  filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.95)) drop-shadow(0 -0.5px 0 rgba(13, 14, 18, 0.14));
}
@keyframes breathe {
  0%, 100% { transform: translate(-50%, -62%) scale(1); opacity: 1; }
  50% { transform: translate(-50%, -62%) scale(1.06); opacity: 0.85; }
}
@keyframes breathe-halo {
  0%, 100% { transform: translate(-50%, -112%) scale(1); opacity: 0.9; }
  50% { transform: translate(-50%, -112%) scale(1.08); opacity: 0.7; }
}
@keyframes sweep {
  0% { transform: translateX(-120%); }
  35%, 100% { transform: translateX(120%); }
}
@media (prefers-reduced-motion: reduce) {
  .stage-light, .stage-halo, .hero-sweep { animation: none; }
}
</style>
