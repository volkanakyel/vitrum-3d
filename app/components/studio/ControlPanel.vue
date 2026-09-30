<script setup lang="ts">
import { AnimatePresence, motion } from 'motion-v'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SegmentOption } from '~/components/studio/SegmentedControl.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DEFAULT_GLASS_PARAMS, type GlassParams, type Geometry } from '~/utils/presets'
import { DEFAULT_RELIEF_OPTIONS, type HeightSource, type ReliefOptions } from '~/utils/relief'
import {
  DEFAULT_TRACE_OPTIONS,
  toSvgPath,
  type TraceOptions,
  type TraceResult,
} from '~/utils/trace'

const props = defineProps<{
  trace: TraceResult | null
  traceOpts: TraceOptions
  reliefOpts: ReliefOptions
  glass: GlassParams
  heightMm: number
  fileName: string
  busy: boolean
  error: string
}>()
const emit = defineEmits<{ pick: [Event]; sample: []; clear: []; 'set-height': [number] }>()
/** The card shows a source: the traced outline. */
const hasSource = computed(() => !!props.trace)

const D = DEFAULT_GLASS_PARAMS
const T = DEFAULT_TRACE_OPTIONS
const R = DEFAULT_RELIEF_OPTIONS
const isRelief = computed(() => props.glass.geometry === 'relief')
const isInflate = computed(() => props.glass.geometry === 'inflate')
const isStack = computed(() => props.glass.geometry === 'stack')
const geometries: SegmentOption<Geometry>[] = [
  { value: 'extrude', label: 'Extrude' },
  { value: 'stack', label: 'Stack' },
  { value: 'inflate', label: 'Inflate' },
  { value: 'relief', label: 'Relief' },
]
const geometryHint: Record<Geometry, string> = { extrude: 'Silhouette as slab', stack: 'Object with raised colours', inflate: 'Silhouette as volume', relief: 'Picture as height' }
const heightSources: SegmentOption<HeightSource>[] = [
  { value: 'luminance', label: 'Smooth' },
  { value: 'layers', label: 'Layers' },
  { value: 'flat', label: 'Flat' },
]
const reliefResolutions: SegmentOption<number>[] = [256, 512, 1024].map((r) => ({ value: r, label: String(r) }))
const { isMobile, openMobile, setOpenMobile, toggleSidebar } = useSidebar()
/** On the phone sheet, reaching for a tab while it rests means you want to see that tab. */
function selectTab(value: typeof tab.value) {
  tab.value = value
  if (isMobile.value && !openMobile.value) setOpenMobile(true)
}
/**
 * On the sheet the tabs double as a drag grip, so they pick on click, not on press: a drag that
 * starts on a tab must not switch to it. (Touch never sends the press for a drag; a mouse does.)
 */
function holdTabPress(e: MouseEvent) {
  if (!isMobile.value) return
  e.stopPropagation()
  e.preventDefault()
}
const tab = ref<'shape' | 'material' | 'scene'>('shape')

const svgPath = computed(() => (props.trace ? toSvgPath(props.trace) : ''))
const viewBox = computed(() => {
  const t = props.trace
  if (!t) return '0 0 1 1'
  const pad = Math.max(t.bbox.maxX - t.bbox.minX, t.bbox.maxY - t.bbox.minY) * 0.08
  return `${t.bbox.minX - pad} ${t.bbox.minY - pad} ${t.bbox.maxX - t.bbox.minX + pad * 2} ${t.bbox.maxY - t.bbox.minY + pad * 2}`
})
const isGlass = computed(() => props.glass.finish === 'glass')
const isPrint = computed(() => props.glass.finish === 'print')

/** Surface section back to its finish's base look, keeping the colour. */
function resetSurface() {
  const g = props.glass
  if (g.finish === 'glass') pick('ior', 'dispersion', 'clarity', 'roughness', 'blur')
  else if (g.finish === 'metal') Object.assign(g, { metalness: 1, roughness: 0.22, clearcoat: 0 })
  else Object.assign(g, { roughness: 0.7, clearcoat: 0, flatten: 0.55, grain: 0.5, sheen: 0.15, weave: 0, soften: 0 })
}
function pick<K extends keyof GlassParams>(...keys: K[]) {
  const out: Partial<GlassParams> = {}
  for (const k of keys) out[k] = D[k]
  Object.assign(props.glass, out)
}

const modeLabel: Record<string, string> = {
  dark: 'dark pixels',
  light: 'light pixels',
  alpha: 'alpha',
  color: 'colour distance',
}
const panelTabs = [
  { value: 'shape', label: 'Shape', icon: 'shapes' },
  { value: 'material', label: 'Material', icon: 'palette' },
  { value: 'scene', label: 'Scene', icon: 'sun' },
] as const
const modes: SegmentOption<TraceOptions['mode']>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'alpha', label: 'Alpha' },
  { value: 'color', label: 'Color' },
]
const resolutions: SegmentOption<number>[] = [512, 1024, 2048].map((r) => ({
  value: r,
  label: String(r),
}))
function setNumber(key: 'widthMm' | 'depthMm', v: number | undefined) {
  if (typeof v === 'number' && Number.isFinite(v)) props.glass[key] = v
}
function setHeight(v: number | undefined) {
  if (typeof v === 'number' && Number.isFinite(v)) emit('set-height', v)
}

const metalSwatches = [
  '#e4b84a',
  '#d9a08a',
  '#f2f3f5',
  '#d8d9dc',
  '#c8734a',
  '#5f636b',
  '#15161a',
  '#f4f4f2',
  '#2c5cff',
  '#c0392b',
]
const bgSwatches = [
  '#e6e9ef',
  '#ffffff',
  '#eceef2',
  '#e6e9f0',
  '#dfe6f5',
  '#f4f4f2',
  '#f3e9e2',
  '#1c1c1f',
  '#0b0b0d',
  '#2b2f3a',
]

// Tab triggers stay flat; the shared motion pill below carries the active state.
const tabTrigger =
  'relative gap-1.5 rounded-full border-0 text-[12px] text-muted-foreground transition-colors duration-150 hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none'
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
      <SidebarHeader class="gap-5 px-4 pt-0 pb-5 max-md:gap-3 max-md:pb-3.5">
        <!-- Brand -->
        <div class="-mb-1 flex h-12 items-center justify-between max-md:hidden">
          <NuxtLink
            to="/"
            class="flex items-center gap-2.5 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
            aria-label="Vitrum home"
          >
            <AppIcon :size="28" />
            <span class="flex items-baseline gap-2">
              <span class="text-[14px] font-semibold tracking-[-0.02em] text-foreground">Vitrum</span>
              <span class="index text-ink-3">v0.2</span>
            </span>
          </NuxtLink>
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              class="-mr-2 text-muted-foreground md:hidden"
              aria-label="Close panel"
              @click="setOpenMobile(false)"
            >
              <Icon
                name="x"
                :size="16"
              />
            </Button>
          </div>
        </div>

        <!-- Source -->
        <div>
          <label
            class="group relative flex cursor-pointer items-center gap-3 rounded-[20px] p-3 max-md:hidden transition-[background-color,box-shadow,scale] duration-[200ms,200ms,320ms] ease-[ease,ease,var(--ease-spring)] active:scale-[.985] active:duration-100"
            :class="
              hasSource
                ? 'bg-card shadow-raise'
                : 'dashed-well hover:bg-none hover:shadow-raise'
            "
          >
            <input
              type="file"
              accept="image/*,.svg"
              hidden
              @change="emit('pick', $event)"
            />
            <template v-if="hasSource">
              <motion.span
                :key="fileName"
                class="lightbox flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-tile bg-[linear-gradient(160deg,#ffffff,#eef2f8)] shadow-[inset_0_1px_0_#fff,0_0_0_1px_var(--hairline)]"
                :initial="{ scale: 0.7, opacity: 0, rotate: -6 }"
                :animate="{ scale: 1, opacity: 1, rotate: 0 }"
                :transition="{ type: 'spring', stiffness: 380, damping: 24 }"
              >
                <svg
                  class="size-8 text-foreground"
                  :viewBox="viewBox"
                  preserveAspectRatio="xMidYMid meet"
                >
                  <path
                    :d="svgPath"
                    fill="currentColor"
                    fill-rule="evenodd"
                  />
                </svg>
              </motion.span>
              <div class="min-w-0 flex-1">
                <div
                  class="truncate text-[13px] font-medium"
                  :title="fileName"
                >
                  {{ fileName }}
                </div>
                <div
                  v-if="trace"
                  class="mt-0.5 truncate text-[11.5px] text-muted-foreground tabular-nums"
                  :title="`Traced from ${modeLabel[trace.resolvedMode]}`"
                >
                  {{ trace.polygons.length }} shape{{ trace.polygons.length === 1 ? '' : 's' }} ·
                  {{ trace.vertexCount }} pts
                </div>
              </div>
              <Tooltip v-if="!busy">
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    class="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label="Remove image"
                    @click.prevent="emit('clear')"
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
              <span
                class="flex size-11 shrink-0 items-center justify-center rounded-tile bg-card text-muted-foreground shadow-raise transition-colors group-hover:text-foreground"
              >
                <Icon
                  name="imagePlus"
                  :size="18"
                />
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-[13px] font-medium">Choose an image</div>
                <div class="mt-0.5 text-[11.5px] text-ink-2">
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
              class="mt-2 flex items-center gap-1.5 px-1 text-[12px] text-destructive"
              :initial="{ opacity: 0, y: -4 }"
              :animate="{ opacity: 1, y: 0 }"
              :exit="{ opacity: 0 }"
            >
              <Icon
                name="info"
                :size="13"
              />
              {{ error }}
            </motion.p>
          </AnimatePresence>
        </div>

        <!-- Phone sheet at rest: the source on the left, every finish on the right. -->
        <div
          v-if="isMobile"
          class="-mr-4 flex items-center"
        >
          <label
            data-sheet-grip
            class="relative grid size-11 shrink-0 cursor-pointer touch-none place-items-center overflow-hidden rounded-[14px] transition-[scale] duration-[380ms] ease-spring active:scale-[.92] active:duration-100 motion-reduce:transition-none"
            :class="hasSource ? 'lightbox bg-[linear-gradient(160deg,#ffffff,#eef2f8)] shadow-[inset_0_1px_0_#fff,0_0_0_1px_var(--hairline)]' : 'bg-card text-muted-foreground shadow-raise'"
            :aria-label="hasSource ? `Replace ${fileName}` : 'Choose an image'"
          >
            <input
              type="file"
              accept="image/*,.svg"
              hidden
              @change="emit('pick', $event)"
            />
            <svg
              v-if="hasSource"
              class="size-7 text-foreground transition-opacity"
              :class="{ 'opacity-30': busy }"
              :viewBox="viewBox"
              preserveAspectRatio="xMidYMid meet"
            >
              <path
                :d="svgPath"
                fill="currentColor"
                fill-rule="evenodd"
              />
            </svg>
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

        <TabsList
          data-sheet-grip
          data-sheet-peek
          class="grid h-9 w-full grid-cols-3 rounded-full well p-[3px] max-md:touch-none"
          @mousedown.capture="holdTabPress"
        >
          <TabsTrigger
            v-for="t in panelTabs"
            :key="t.value"
            :value="t.value"
            :class="tabTrigger"
            @click="selectTab(t.value)"
          >
            <motion.span
              v-if="tab === t.value"
              layout-id="panel-tab-pill"
              class="glass-pill"
              :transition="{ type: 'spring', stiffness: 500, damping: 40 }"
            />
            <motion.span
              class="relative flex items-center gap-1.5"
              :while-press="{ scale: 0.96 }"
            >
              <Icon
                :name="t.icon"
                :size="13"
              />
              {{ t.label }}
            </motion.span>
          </TabsTrigger>
        </TabsList>
      </SidebarHeader>

      <SidebarSeparator class="mx-4 bg-hairline data-[orientation=horizontal]:w-auto" />

      <SidebarContent class="gap-0">
        <!-- Content fades under the header and footer edges; the scrollbar is a hairline that only
             appears while scrolling and lives in the gutter, never over the controls. -->
        <ScrollArea
          type="hover"
          :scroll-hide-delay="400"
          class="min-h-0 flex-1 **:data-[slot=scroll-area-scrollbar]:w-2 **:data-[slot=scroll-area-scrollbar]:border-0 **:data-[slot=scroll-area-scrollbar]:p-0 **:data-[slot=scroll-area-scrollbar]:py-3 **:data-[slot=scroll-area-scrollbar]:pr-[3px] **:data-[slot=scroll-area-thumb]:rounded-full **:data-[slot=scroll-area-thumb]:bg-foreground/20 **:data-[slot=scroll-area-viewport]:[mask-image:linear-gradient(to_bottom,transparent,#000_24px,#000_calc(100%-24px),transparent)]"
        >
          <div class="px-4 pt-5 pb-6">
            <TabsContent
              value="shape"
              class="mt-0 flex flex-col divide-y divide-hairline"
            >
              <AnimatePresence :initial="false">
              <SectionGroup
                key="geometry"
                :index="0"
                title="Geometry"
                :hint="geometryHint[glass.geometry]"
              >
                <SegmentedControl
                  v-model="glass.geometry"
                  :options="geometries"
                  size="md"
                />
                <p class="text-[11.5px] leading-relaxed text-ink-3">
                  <template v-if="isRelief">
                    Every pixel becomes a vertex: photos, paintings and shaded artwork keep their
                    detail and their colours.
                  </template>
                  <template v-else-if="isStack">
                    The whole object is the base (an icon keeps its tile) and every colour inside
                    it rises as its own layer, so the picture becomes a real stepped object.
                  </template>
                  <template v-else-if="isInflate">
                    The outline is puffed into a rounded solid, front and back; a side or top photo
                    carves the volume to its real profile.
                  </template>
                  <template v-else>
                    The traced outline is extruded into a bevelled solid: crisp edges for logos,
                    icons and type.
                  </template>
                </p>
              </SectionGroup>

              <SectionGroup
                v-if="isStack"
                key="stack"
                :index="1"
                title="Layers"
                :hint="trace?.layers ? `${trace.layers.length} raised` : undefined"
                resettable
                @reset="traceOpts.stackLayers = T.stackLayers; glass.layerMm = D.layerMm"
              >
                <SliderField
                  v-model="traceOpts.stackLayers"
                  label="Colours"
                  hint="How many colours the picture is split into; the biggest is the base, the rest rise"
                  :min="2"
                  :max="6"
                  :step="1"
                  :decimals="0"
                  :default-value="T.stackLayers"
                />
                <SliderField
                  v-model="glass.layerMm"
                  label="Layer height"
                  hint="How far each colour rises above the base"
                  :min="0.2"
                  :max="10"
                  :step="0.1"
                  unit="mm"
                  :decimals="1"
                  :default-value="D.layerMm"
                />
                <div
                  v-if="trace?.layers?.length"
                  class="flex flex-wrap gap-1.5"
                >
                  <span
                    v-for="(l, i) in trace.layers"
                    :key="i"
                    class="flex h-6 items-center gap-1.5 rounded-full bg-card pr-2.5 pl-1.5 text-[11px] text-ink-2 shadow-raise tabular-nums"
                  >
                    <span
                      class="size-3 rounded-full shadow-[inset_0_0_0_1px_var(--hairline-strong)]"
                      :style="{ background: l.color }"
                    />
                    {{ Math.round(l.area * 100) }}%
                  </span>
                </div>
              </SectionGroup>

              <SectionGroup
                v-if="isInflate"
                key="inflate"
                :index="1"
                title="Volume"
                resettable
                @reset="Object.assign(reliefOpts, { ...R, inflate: reliefOpts.inflate, cutout: reliefOpts.cutout })"
              >
                <SliderField
                  v-model="reliefOpts.roundness"
                  label="Roundness"
                  hint="1 rounds over the whole width like a dome; low values keep a flat top like a pillow"
                  :min="0.1"
                  :max="1"
                  :step="0.01"
                  :default-value="R.roundness"
                />
                <SliderField
                  v-model="reliefOpts.detail"
                  label="Surface detail"
                  hint="How much the picture's shading dents the surface"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  :default-value="R.detail"
                />
                <SliderField
                  v-model="reliefOpts.smooth"
                  label="Smoothing"
                  :min="0"
                  :max="8"
                  :step="0.1"
                  unit="px"
                  :decimals="1"
                  :default-value="R.smooth"
                />
                <div class="flex flex-col gap-1.5">
                  <Label class="h-5 text-[12.5px] font-normal text-ink-2">Grid detail</Label>
                  <SegmentedControl
                    v-model="reliefOpts.resolution"
                    :options="reliefResolutions"
                    mono
                  />
                </div>
              </SectionGroup>

              <SectionGroup
                v-if="isRelief"
                key="relief"
                :index="1"
                title="Relief"
                resettable
                @reset="Object.assign(reliefOpts, { ...R, cutout: reliefOpts.cutout }); glass.reliefMm = D.reliefMm"
              >
                <div class="flex flex-col gap-1.5">
                  <Label class="h-5 text-[12.5px] font-normal text-ink-2">Height from</Label>
                  <SegmentedControl
                    v-model="reliefOpts.source"
                    :options="heightSources"
                  />
                </div>
                <SliderField
                  v-model="glass.reliefMm"
                  label="Relief height"
                  hint="How far the brightest pixel rises above the base slab (D)"
                  :min="0"
                  :max="30"
                  :step="0.1"
                  unit="mm"
                  :decimals="1"
                  :default-value="D.reliefMm"
                />
                <AnimatePresence :initial="false">
                  <Reveal
                    v-if="reliefOpts.source !== 'flat'"
                    key="shaped"
                  >
                    <SliderField
                      v-model="reliefOpts.smooth"
                      label="Smoothing"
                      :min="0"
                      :max="8"
                      :step="0.1"
                      unit="px"
                      :decimals="1"
                      :default-value="R.smooth"
                    />
                    <SliderField
                      v-model="reliefOpts.contrast"
                      label="Contrast"
                      hint="Below 1 lifts the mid-tones, above 1 pushes them down"
                      :min="0.3"
                      :max="3"
                      :step="0.01"
                      :default-value="R.contrast"
                    />
                  </Reveal>
                  <Reveal
                    v-if="reliefOpts.source === 'layers'"
                    key="layers"
                  >
                    <SliderField
                      v-model="reliefOpts.layers"
                      label="Layers"
                      :min="2"
                      :max="16"
                      :step="1"
                      :decimals="0"
                      :default-value="R.layers"
                    />
                  </Reveal>
                  <Reveal
                    v-if="reliefOpts.source !== 'flat'"
                    key="invert"
                  >
                    <div class="flex h-6 items-center justify-between pointer-coarse:h-9">
                      <Label
                        for="relief-invert"
                        class="text-[12.5px] font-normal text-ink-2"
                      >
                        Dark rises
                      </Label>
                      <Switch
                        id="relief-invert"
                        :model-value="reliefOpts.invert"
                        @update:model-value="(v) => (reliefOpts.invert = v)"
                      />
                    </div>
                  </Reveal>
                </AnimatePresence>
                <div class="flex h-6 items-center justify-between pointer-coarse:h-9">
                  <Label
                    for="relief-cutout"
                    class="text-[12.5px] font-normal text-ink-2"
                  >
                    Cut to outline
                  </Label>
                  <Switch
                    id="relief-cutout"
                    :model-value="reliefOpts.cutout"
                    :disabled="!trace || !trace.polygons.length"
                    @update:model-value="(v) => (reliefOpts.cutout = v)"
                  />
                </div>
                <div class="flex flex-col gap-1.5">
                  <Label class="h-5 text-[12.5px] font-normal text-ink-2">Grid detail</Label>
                  <SegmentedControl
                    v-model="reliefOpts.resolution"
                    :options="reliefResolutions"
                    mono
                  />
                </div>
              </SectionGroup>

              <SectionGroup
                v-if="!isRelief || reliefOpts.cutout"
                key="trace"
                :index="isInflate ? 3 : isRelief || isStack ? 2 : 1"
                title="Outline"
                :hint="trace ? `${trace.polygons.length} shape${trace.polygons.length === 1 ? '' : 's'} · ${modeLabel[trace.resolvedMode]}` : undefined"
                resettable
                @reset="Object.assign(traceOpts, { ...T, stack: traceOpts.stack })"
              >
                <div class="flex flex-col gap-1.5">
                  <Label class="h-5 text-[12.5px] font-normal text-ink-2">Find the shape by</Label>
                  <SegmentedControl
                    v-model="traceOpts.mode"
                    :options="modes"
                  />
                </div>
                <SliderField
                  v-model="traceOpts.threshold"
                  label="Cutoff"
                  hint="Where the outline is cut: lower takes more of the picture in, higher less"
                  :min="0.1"
                  :max="0.9"
                  :step="0.01"
                  :default-value="T.threshold"
                />
                <SliderField
                  v-model="traceOpts.simplify"
                  label="Smoothing"
                  hint="Straightens the outline; 0 keeps every traced point"
                  :min="0"
                  :max="4"
                  :step="0.1"
                  unit="px"
                  :decimals="1"
                  :default-value="T.simplify"
                />
                <SliderField
                  v-model="traceOpts.minRegion"
                  label="Ignore specks"
                  hint="Drops pieces smaller than this share of the artwork"
                  :min="0"
                  :max="0.05"
                  :step="0.001"
                  :decimals="3"
                  :default-value="T.minRegion"
                />
                <div class="flex h-6 items-center justify-between pointer-coarse:h-9">
                  <Label
                    for="fill-holes"
                    class="text-[12.5px] font-normal text-ink-2"
                  >
                    Fill holes
                  </Label>
                  <Switch
                                        id="fill-holes"
                    :model-value="traceOpts.fillHoles"
                    @update:model-value="(v) => (traceOpts.fillHoles = v)"
                  />
                </div>
                <div class="flex flex-col gap-1.5">
                  <Label class="h-5 text-[12.5px] font-normal text-ink-2">Trace detail</Label>
                  <SegmentedControl
                    v-model="traceOpts.resolution"
                    :options="resolutions"
                    mono
                  />
                </div>
              </SectionGroup>

              <SectionGroup
                key="dimensions"
                :index="isRelief ? (reliefOpts.cutout ? 3 : 2) : isInflate ? 3 : isStack ? 3 : 2"
                title="Dimensions"
                :hint="isRelief ? 'D = base slab, relief on top' : isInflate ? 'D = full thickness' : isStack ? 'D = base, layers on top' : 'H follows the outline'"
                resettable
                @reset="pick('widthMm', 'depthMm', 'bevelMm', 'bevelSegments')"
              >
                <div class="grid grid-cols-3 gap-2">
                  <DimField
                    axis="W"
                    :model-value="glass.widthMm"
                    :min="1"
                    :step="1"
                    @update:model-value="(v) => setNumber('widthMm', v)"
                  />
                  <DimField
                    axis="H"
                    :model-value="+heightMm.toFixed(1)"
                    :min="1"
                    :step="1"
                    @update:model-value="setHeight"
                  />
                  <DimField
                    axis="D"
                    :model-value="glass.depthMm"
                    :min="0.5"
                    :step="0.5"
                    @update:model-value="(v) => setNumber('depthMm', v)"
                  />
                </div>
                <AnimatePresence :initial="false">
                  <Reveal
                    v-if="!isRelief && !isInflate"
                    key="bevel"
                  >
                    <SliderField
                      v-model="glass.bevelMm"
                      label="Edge radius"
                      hint="Rounds the front and back edges; capped at half the depth"
                      :min="0"
                      :max="Math.max(0.5, glass.depthMm / 2)"
                      :step="0.1"
                      unit="mm"
                      :decimals="1"
                      :default-value="D.bevelMm"
                    />
                    <SliderField
                      v-model="glass.bevelSegments"
                      label="Edge smoothness"
                      hint="Segments in each rounded edge; more is smoother and heavier"
                      :min="1"
                      :max="14"
                      :step="1"
                      :decimals="0"
                      :default-value="D.bevelSegments"
                    />
                  </Reveal>
                </AnimatePresence>
              </SectionGroup>
              </AnimatePresence>
            </TabsContent>

            <TabsContent
              value="material"
              class="mt-0 flex flex-col divide-y divide-hairline"
            >
              <!-- The phone sheet's finish row covers this. -->
              <SectionGroup
                v-if="!isMobile"
                :index="0"
                title="Finish"
              >
                <MaterialPicker :glass="glass" />
              </SectionGroup>
              <SectionGroup
                :index="isMobile ? 0 : 1"
                :title="isGlass ? 'Optics' : 'Surface'"
                resettable
                @reset="resetSurface"
              >
                <AnimatePresence
                  mode="wait"
                  :initial="false"
                >
                <Reveal
                  :key="glass.finish"
                >
                <template v-if="isPrint">
                  <SliderField
                    v-model="glass.flatten"
                    label="Flatten lighting"
                    hint="Divides the picture's own shading out of the colour, so the studio lights the volume instead of re-lighting a painted shadow"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :default-value="0.55"
                  />
                  <SliderField
                    v-model="glass.grain"
                    label="Grain"
                    hint="The picture's fine texture (weave, brush, pores) as a normal and roughness map, so it catches the light at any grid detail"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :default-value="0.5"
                  />
                  <SliderField
                    v-model="glass.soften"
                    label="Soften"
                    hint="Blurs the picture on the surface so photo noise and stretched pixels melt into a flat colour"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :default-value="0"
                  />
                  <SliderField
                    v-model="glass.weave"
                    label="Weave"
                    hint="A fine woven bump at a fixed real-world size, uniform over the whole surface"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :default-value="0"
                  />
                  <SliderField
                    v-model="glass.roughness"
                    label="Roughness"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :default-value="0.7"
                  />
                  <SliderField
                    v-model="glass.sheen"
                    label="Sheen"
                    hint="Soft glow at grazing angles, the way cloth and velvet catch the light"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :default-value="0.15"
                  />
                  <SliderField
                    v-model="glass.clearcoat"
                    label="Lacquer"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :default-value="0"
                  />
                  <p class="text-[11.5px] leading-relaxed text-ink-3">
                    <template v-if="isRelief && !reliefOpts.cutout">
                      The picture is sampled at its native resolution and laid over the relief,
                      every colour kept.
                    </template>
                    <template v-else>
                      The picture is sampled at its native resolution and padded past the outline,
                      so walls and bevels take the edge colour.
                    </template>
                  </p>
                </template>
                <template v-else-if="isGlass">
                  <SliderField
                    v-model="glass.ior"
                    label="Refraction"
                    hint="How much the glass bends what is behind it: 1.5 window glass, 1.9 crystal, 2.4 diamond"
                    :min="1"
                    :max="2.33"
                    :step="0.01"
                    :default-value="D.ior"
                  />
                  <SliderField
                    v-model="glass.dispersion"
                    label="Dispersion"
                    hint="Splits the refraction into colours at the edges, like a prism"
                    :min="0"
                    :max="0.3"
                    :step="0.005"
                    :decimals="3"
                    :default-value="D.dispersion"
                  />
                  <SliderField
                    v-model="glass.clarity"
                    label="Clarity"
                    hint="How much light passes through; lower reads as milky glass"
                    :min="0.3"
                    :max="1"
                    :step="0.01"
                    :default-value="D.clarity"
                  />
                  <SliderField
                    v-model="glass.roughness"
                    label="Frost"
                    hint="Matte, sandblasted surface"
                    :min="0"
                    :max="0.6"
                    :step="0.01"
                    :default-value="D.roughness"
                  />
                  <SliderField
                    v-model="glass.blur"
                    label="Blur"
                    hint="Softens what shows through the glass"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :default-value="D.blur"
                  />
                </template>
                <template v-else>
                  <ColorField
                    v-model="glass.tint"
                    label="Color"
                    :swatches="metalSwatches"
                  />
                  <SliderField
                    v-model="glass.metalness"
                    label="Metalness"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :default-value="1"
                  />
                  <SliderField
                    v-model="glass.roughness"
                    label="Roughness"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :default-value="0.22"
                  />
                  <SliderField
                    v-model="glass.clearcoat"
                    label="Lacquer"
                    :min="0"
                    :max="1"
                    :step="0.01"
                    :default-value="0"
                  />
                </template>
                </Reveal>
                </AnimatePresence>
              </SectionGroup>
              <AnimatePresence :initial="false">
              <SectionGroup
                v-if="isGlass"
                key="edges"
                :index="isMobile ? 1 : 2"
                title="Edges & tint"
                resettable
                @reset="pick('tir', 'edgeChroma', 'clearcoat', 'tint', 'attenuationMm')"
              >
                <SliderField
                  v-model="glass.tir"
                  label="Edge darkening"
                  hint="Rims mirror the room instead of showing through, as thick glass does"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  :default-value="D.tir"
                />
                <SliderField
                  v-model="glass.edgeChroma"
                  label="Rainbow rim"
                  hint="Thin-film colours on the rims that turn with the view; 1 is holographic"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  :default-value="D.edgeChroma"
                />
                <SliderField
                  v-model="glass.clearcoat"
                  label="Polish"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  :default-value="D.clearcoat"
                />
                <ColorField
                  v-model="glass.tint"
                  label="Tint"
                />
                <SliderField
                  v-model="glass.attenuationMm"
                  label="Tint depth"
                  hint="How far light travels before it takes the full tint; small is deep colour"
                  :min="2"
                  :max="600"
                  :step="1"
                  unit="mm"
                  :decimals="0"
                  :default-value="D.attenuationMm"
                />
              </SectionGroup>
              </AnimatePresence>
            </TabsContent>

            <TabsContent
              value="scene"
              class="mt-0 flex flex-col divide-y divide-hairline"
            >
              <SectionGroup
                :index="0"
                title="Stage"
                :hint="glass.floor ? 'Object on a floor' : 'Logo on a wall'"
                resettable
                @reset="pick('background', 'shadow', 'vignette', 'floor')"
              >
                <div
                  class="flex h-6 items-center justify-between pointer-coarse:h-9"
                >
                  <Label
                    for="stage-floor"
                    class="text-[12.5px] font-normal text-ink-2"
                  >
                    Stand on a floor
                  </Label>
                  <Switch
                    id="stage-floor"
                    :model-value="glass.floor"
                    @update:model-value="(v) => (glass.floor = v)"
                  />
                </div>
                <p class="text-[11.5px] leading-relaxed text-ink-3">
                  <template v-if="glass.floor">
                    A product set: a film tone curve, a white key casting a soft shadow on the
                    floor, a warm fill and a rim from behind, over a sky and ground ambient. The
                    Color finish shows no room reflections. The orbit stays above the floor.
                  </template>
                  <template v-else>
                    A glass studio: a dark room with bright softboxes, one hard key and a cool
                    rim, and a soft silhouette shadow on the wall behind the model.
                  </template>
                </p>
                <ColorField
                  v-model="glass.background"
                  label="Background"
                  :swatches="bgSwatches"
                />
                <SliderField
                  v-model="glass.shadow"
                  label="Shadow"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  :default-value="D.shadow"
                />
                <SliderField
                  v-model="glass.vignette"
                  label="Vignette"
                  :min="0"
                  :max="0.6"
                  :step="0.01"
                  :default-value="D.vignette"
                />
              </SectionGroup>
              <SectionGroup
                :index="1"
                title="Light & camera"
                resettable
                @reset="pick('envIntensity', 'exposure', 'fov')"
              >
                <SliderField
                  v-model="glass.envIntensity"
                  label="Studio light"
                  hint="Brightness of the softboxes the surface reflects"
                  :min="0"
                  :max="3"
                  :step="0.05"
                  :default-value="D.envIntensity"
                />
                <SliderField
                  v-model="glass.exposure"
                  label="Exposure"
                  :min="0.4"
                  :max="2"
                  :step="0.01"
                  :default-value="D.exposure"
                />
                <SliderField
                  v-model="glass.fov"
                  label="Lens"
                  :min="15"
                  :max="60"
                  :step="1"
                  :decimals="0"
                  unit="°"
                  :default-value="D.fov"
                />
              </SectionGroup>
              <SectionGroup
                :index="2"
                title="Motion"
                resettable
                @reset="pick('autoRotate', 'rotateSpeed')"
              >
                <div class="flex h-6 items-center justify-between pointer-coarse:h-9">
                  <Label
                    for="auto-rotate"
                    class="text-[12.5px] font-normal text-ink-2"
                  >
                    Auto rotate
                  </Label>
                  <Switch
                                        id="auto-rotate"
                    :model-value="glass.autoRotate"
                    @update:model-value="(v) => (glass.autoRotate = v)"
                  />
                </div>
                <AnimatePresence :initial="false">
                  <Reveal
                    v-if="glass.autoRotate"
                    key="speed"
                  >
                    <SliderField
                      v-model="glass.rotateSpeed"
                      label="Speed"
                      :min="0.2"
                      :max="4"
                      :step="0.1"
                      :decimals="1"
                      :default-value="D.rotateSpeed"
                    />
                  </Reveal>
                </AnimatePresence>
              </SectionGroup>
            </TabsContent>
          </div>
        </ScrollArea>
      </SidebarContent>
    </Tabs>

    <SidebarSeparator class="mx-4 bg-hairline data-[orientation=horizontal]:w-auto max-md:hidden" />

    <SidebarFooter class="flex-row items-center justify-between px-4 py-3 max-md:hidden">
      <Button
        variant="ghost"
        size="sm"
        class="-ml-2 h-7 px-2 text-[12px] text-muted-foreground hover:text-foreground"
        @click="emit('sample')"
      >
        <Icon
          name="sparkle"
          :size="13"
        />
        Sample mark
      </Button>
      <button
        type="button"
        class="-mr-1 flex h-7 items-center gap-1.5 rounded-full pr-1 pl-2 text-[11px] text-ink-3 transition-colors duration-150 hover:bg-well hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none pointer-coarse:hidden"
        @click="toggleSidebar"
      >
        Hide panel
        <kbd class="text-[10px]">⌘B</kbd>
      </button>
    </SidebarFooter>
  </Sidebar>
</template>
