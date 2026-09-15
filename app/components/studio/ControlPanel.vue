<script setup lang="ts">
import { AnimatePresence, motion } from 'motion-v'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NumberField, NumberFieldContent, NumberFieldInput } from '@/components/ui/number-field'
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
import { DEFAULT_VIEW_OPTIONS, STUDIO_MODES, type DepthState, type StudioMode, type StudioView, type ViewAxis, type ViewOptions } from '~/composables/useStudio'
import type { SculptApi } from '~/composables/useSculpt'
import type { HullData } from '~/utils/hull'
import { DEFAULT_GLASS_PARAMS, type GlassParams, type Geometry } from '~/utils/glassScene'
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
  views?: Record<ViewAxis, StudioView | null>
  viewOpts?: ViewOptions
  /** Camera side read from the outline: −1 left, 1 right, 0 level. */
  cameraSide?: number
  hull?: HullData | null
  depthState?: DepthState
  depthProgress?: number
  depthDevice?: string
  heightMm: number
  fileName: string
  busy: boolean
  error: string
  mode?: StudioMode
  /** Product mode only: the sculpt run behind the "Rebuild as parts" panel. */
  sculpt?: SculptApi
  /** A finished parts model stands on the stage: the carve's controls do not describe it. */
  sculpted?: boolean
}>()
const emit = defineEmits<{ pick: [Event]; sample: []; clear: []; 'set-height': [number]; mode: [StudioMode]; 'pick-view': [ViewAxis, Event]; 'remove-view': [ViewAxis]; 'flip-view': [ViewAxis] }>()
const viewSlots: { axis: ViewAxis; label: string; hint: string; flipHint: string }[] = [
  { axis: 'side', label: 'Side', hint: 'The object from its side, front facing right', flipHint: 'Mirror: the photo shows the other side' },
  { axis: 'top', label: 'Top', hint: 'The object from above, front at the bottom', flipHint: 'Mirror: the front is at the top of the photo' },
]
const hasViews = computed(() => !!(props.views?.side || props.views?.top))
const VO = DEFAULT_VIEW_OPTIONS
const sideOptions: SegmentOption<ViewOptions['side']>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]
const sideRead = computed(() => (props.cameraSide === -1 ? 'left' : props.cameraSide === 1 ? 'right' : 'straight on'))
const depthHint = computed(() => {
  const s = props.depthState
  if (s === 'loading') return props.depthProgress ? `Downloading the depth model, ${Math.round(props.depthProgress * 100)}%` : 'Reading the photo\'s depth…'
  if (s === 'ready') return `From the depth model (${props.depthDevice === 'webgpu' ? 'WebGPU' : 'CPU'}). Runs on your device; the photo never leaves it.`
  if (s === 'unavailable') return 'Depth model unavailable: carved from outlines only'
  return 'How deep the photo\'s relief cuts. Depth model, 27 MB, downloaded once, runs on your device.'
})
const depthOn = computed(() => props.depthState === 'ready' && (props.viewOpts?.depth ?? 0) > 0)
const modeOptions: SegmentOption<StudioMode>[] = STUDIO_MODES.map(m => ({ value: m.id, label: m.label, icon: m.icon }))

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
const { setOpenMobile } = useSidebar()
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
  object: 'whole object',
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
  { value: 'object', label: 'Object' },
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
  '#f8f9fb',
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
const dimInput =
  'h-8 rounded-lg border-0 bg-card pr-7 pl-6 pointer-coarse:h-10 pointer-coarse:text-[14px] text-right font-mono text-[12px] tabular-nums shadow-[var(--shadow-raise)] transition-[box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/35'
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
      <SidebarHeader class="gap-5 px-4 pt-0 pb-5">
        <!-- Brand -->
        <div class="-mb-1 flex h-12 items-center justify-between">
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

        <!-- Mode, on small screens only: the header's switch is hidden there. -->
        <div
          v-if="mode"
          class="sm:hidden"
        >
          <SegmentedControl
            :model-value="mode"
            :options="modeOptions"
            size="md"
            @update:model-value="(v) => emit('mode', v)"
          />
        </div>

        <!-- Source -->
        <div>
          <label
            class="group relative flex cursor-pointer items-center gap-3 rounded-[18px] p-3 transition-[background-color,box-shadow] duration-200"
            :class="
              trace
                ? 'bg-card shadow-[var(--shadow-raise)]'
                : 'source-well hover:bg-card hover:shadow-[var(--shadow-raise)]'
            "
          >
            <input
              type="file"
              accept="image/*,.svg"
              hidden
              @change="emit('pick', $event)"
            />
            <template v-if="trace">
              <motion.span
                :key="fileName"
                class="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(160deg,#ffffff,#eef2f8)] shadow-[inset_0_1px_0_#fff,0_0_0_1px_var(--hairline)]"
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
                  class="mt-0.5 truncate text-[11.5px] text-muted-foreground tabular-nums"
                  :title="`Traced from ${modeLabel[trace.resolvedMode]}`"
                >
                  {{ trace.polygons.length }} shape{{ trace.polygons.length === 1 ? '' : 's' }} ·
                  {{ trace.vertexCount }} pts
                </div>
              </div>
              <Tooltip>
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
                class="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-card text-muted-foreground shadow-[var(--shadow-raise)] transition-colors group-hover:text-foreground"
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
              class="absolute top-2.5 right-2.5 size-3 animate-spin rounded-full border-2 border-muted border-t-foreground"
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

        <TabsList class="grid h-9 w-full grid-cols-3 rounded-full well p-[3px]">
          <TabsTrigger
            v-for="t in panelTabs"
            :key="t.value"
            :value="t.value"
            :class="tabTrigger"
          >
            <motion.span
              v-if="tab === t.value"
              layout-id="panel-tab-pill"
              class="absolute inset-0 -z-10 rounded-full bg-card shadow-[var(--shadow-raise)]"
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
        <ScrollArea
          type="hover"
          :scroll-hide-delay="400"
          class="panel-scroll min-h-0 flex-1"
        >
          <div class="px-4 pt-5 pb-6">
            <TabsContent
              value="shape"
              class="mt-0 flex flex-col divide-y divide-hairline"
            >
              <!-- The headline action for a product photo: let Claude rebuild it out of parts.
                   Outside the numbered sections — it is not one of the carve's controls. -->
              <section
                v-if="mode === 'product' && sculpt && trace"
                class="flex flex-col gap-5 py-6 first:pt-1"
              >
                <header class="flex h-6 items-center">
                  <span class="text-[12px] font-medium tracking-[-0.005em] text-foreground">Parts model</span>
                </header>
                <SculptPanel :sculpt="sculpt" />
              </section>

              <p
                v-if="sculpted"
                class="py-6 text-[11.5px] leading-relaxed text-ink-3"
              >
                The parts model brings its own shape: the carve's controls are off. Size and Scene
                still apply.
              </p>

              <AnimatePresence :initial="false">
              <SectionGroup
                v-if="!sculpted"
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
                v-if="isStack && !sculpted"
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
                    class="flex h-6 items-center gap-1.5 rounded-full bg-card pr-2.5 pl-1.5 text-[11px] text-ink-2 shadow-[var(--shadow-raise)] tabular-nums"
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
                v-if="isInflate && !sculpted"
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
                v-if="isInflate && !sculpted"
                key="views"
                :index="2"
                title="Views"
                :hint="hull ? `Carved from ${1 + (viewOpts?.symmetric ? 1 : 0) + (views?.side ? 1 : 0) + (views?.top ? 1 : 0)} outlines${depthOn ? ' + depth' : ''}` : 'One photo: a pillow'"
                resettable
                @reset="viewOpts && Object.assign(viewOpts, VO)"
              >
                <p class="text-[11.5px] leading-relaxed text-ink-3">
                  Where the photo was taken from. The outline is carved along that camera, the
                  object's mirror image counts as a second view, and a side or top photo measures
                  the depth instead of guessing it.
                </p>
                <template v-if="viewOpts">
                  <SliderField
                    v-model="viewOpts.yaw"
                    label="Photo angle"
                    hint="How far around the object the camera stood: 0 straight on, 30–45 a typical product shot"
                    :min="0"
                    :max="60"
                    :step="1"
                    :decimals="0"
                    unit="°"
                    :default-value="VO.yaw"
                  />
                  <div class="flex flex-col gap-1.5">
                    <Label class="flex h-5 items-center justify-between text-[12.5px] font-normal text-ink-2">
                      Camera stood
                      <span class="text-[11px] text-ink-3">reads {{ sideRead }}</span>
                    </Label>
                    <SegmentedControl
                      v-model="viewOpts.side"
                      :options="sideOptions"
                    />
                  </div>
                  <SliderField
                    v-model="viewOpts.pitch"
                    label="Camera height"
                    hint="How far above the object the camera stood"
                    :min="0"
                    :max="35"
                    :step="1"
                    :decimals="0"
                    unit="°"
                    :default-value="VO.pitch"
                  />
                  <div class="flex h-6 items-center justify-between pointer-coarse:h-9">
                    <Label
                      for="view-symmetric"
                      class="text-[12.5px] font-normal text-ink-2"
                    >
                      Symmetric object
                    </Label>
                    <Switch
                      id="view-symmetric"
                      :model-value="viewOpts.symmetric"
                      @update:model-value="(v) => (viewOpts!.symmetric = v)"
                    />
                  </div>
                  <SliderField
                    v-model="viewOpts.depth"
                    label="Depth"
                    :hint="depthHint"
                    :min="0"
                    :max="1"
                    :step="0.05"
                    :decimals="2"
                    :default-value="VO.depth"
                  />
                </template>
                <div
                  v-for="slot in viewSlots"
                  :key="slot.axis"
                  class="group/view flex h-12 items-center gap-3 rounded-[14px] px-2"
                  :class="views?.[slot.axis] ? 'bg-card shadow-[var(--shadow-raise)]' : 'well'"
                >
                  <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="file"
                      accept="image/*,.svg"
                      hidden
                      @change="emit('pick-view', slot.axis, $event)"
                    />
                    <span
                      class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-card text-muted-foreground shadow-[inset_0_0_0_1px_var(--hairline)]"
                    >
                      <img
                        v-if="views?.[slot.axis]"
                        :src="views[slot.axis]!.preview"
                        class="size-full object-cover"
                        :alt="`${slot.label} view`"
                      />
                      <Icon
                        v-else
                        name="imagePlus"
                        :size="14"
                      />
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-[12.5px] font-medium">
                        {{ views?.[slot.axis] ? views[slot.axis]!.name : `Add ${slot.label.toLowerCase()} photo` }}
                      </span>
                      <span class="block truncate text-[11px] text-ink-3">{{ slot.hint }}</span>
                    </span>
                  </label>
                  <template v-if="views?.[slot.axis]">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          :class="views[slot.axis]!.flip ? 'bg-well-strong text-foreground' : 'text-muted-foreground'"
                          :aria-pressed="views[slot.axis]!.flip"
                          aria-label="Mirror view"
                          @click="emit('flip-view', slot.axis)"
                        >
                          <Icon
                            name="rotate"
                            :size="13"
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{{ slot.flipHint }}</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      class="text-muted-foreground"
                      aria-label="Remove view"
                      @click="emit('remove-view', slot.axis)"
                    >
                      <Icon
                        name="x"
                        :size="13"
                      />
                    </Button>
                  </template>
                </div>
              </SectionGroup>

              <SectionGroup
                v-if="isRelief && !sculpted"
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
                v-if="!sculpted && (!isRelief || reliefOpts.cutout)"
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
                :index="isRelief ? (reliefOpts.cutout ? 3 : 2) : isInflate ? 4 : isStack ? 3 : 2"
                title="Dimensions"
                :hint="isRelief ? 'D = base slab, relief on top' : isInflate ? (hasViews ? 'D measured from the views' : hull ? 'D = the object\'s depth' : 'D = full thickness') : isStack ? 'D = base, layers on top' : 'H follows the outline'"
                resettable
                @reset="pick('widthMm', 'depthMm', 'bevelMm', 'bevelSegments')"
              >
                <div class="grid grid-cols-3 gap-2">
                  <NumberField
                    :model-value="glass.widthMm"
                    :min="1"
                    :step="1"
                    :format-options="{ maximumFractionDigits: 1 }"
                    class="gap-1"
                    @update:model-value="(v) => setNumber('widthMm', v)"
                  >
                    <NumberFieldContent>
                      <span class="dim-prefix">W</span>
                      <NumberFieldInput :class="dimInput" />
                      <span class="dim-suffix">mm</span>
                    </NumberFieldContent>
                  </NumberField>
                  <NumberField
                    :model-value="+heightMm.toFixed(1)"
                    :min="1"
                    :step="1"
                    :format-options="{ maximumFractionDigits: 1 }"
                    class="gap-1"
                    @update:model-value="setHeight"
                  >
                    <NumberFieldContent>
                      <span class="dim-prefix">H</span>
                      <NumberFieldInput :class="dimInput" />
                      <span class="dim-suffix">mm</span>
                    </NumberFieldContent>
                  </NumberField>
                  <NumberField
                    :model-value="glass.depthMm"
                    :min="0.5"
                    :step="0.5"
                    :format-options="{ maximumFractionDigits: 1 }"
                    class="gap-1"
                    @update:model-value="(v) => setNumber('depthMm', v)"
                  >
                    <NumberFieldContent>
                      <span class="dim-prefix">D</span>
                      <NumberFieldInput :class="dimInput" />
                      <span class="dim-suffix">mm</span>
                    </NumberFieldContent>
                  </NumberField>
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
              <p
                v-if="sculpted"
                class="py-6 text-[11.5px] leading-relaxed text-ink-3"
              >
                Materials come with the parts model.
              </p>
              <SectionGroup
                v-if="!sculpted"
                :index="0"
                title="Finish"
              >
                <MaterialPicker :glass="glass" />
              </SectionGroup>
              <SectionGroup
                v-if="!sculpted"
                :index="1"
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
                v-if="isGlass && !sculpted"
                key="edges"
                :index="2"
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
                <div class="flex h-6 items-center justify-between pointer-coarse:h-9">
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

    <SidebarSeparator class="mx-4 bg-hairline data-[orientation=horizontal]:w-auto" />

    <SidebarFooter class="flex-row items-center justify-between px-4 py-3">
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
        {{ mode === 'product' ? 'Sample armchair' : 'Sample mark' }}
      </Button>
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="flex items-center gap-1.5 text-[11px] text-ink-3 pointer-coarse:hidden">
            Hide panel
            <kbd class="text-[10px]">⌘B</kbd>
          </span>
        </TooltipTrigger>
        <TooltipContent>Vitrum · everything is built from your image, nothing is downloaded</TooltipContent>
      </Tooltip>
    </SidebarFooter>
  </Sidebar>
</template>

<style scoped>
@reference "~/assets/main.css";

/* Content fades under the header and footer edges; scrollbar is a hairline that only appears
   while scrolling and lives in the gutter, never over the controls. */
.panel-scroll :deep([data-slot='scroll-area-viewport']) {
  mask-image: linear-gradient(
    to bottom,
    transparent,
    #000 14px,
    #000 calc(100% - 14px),
    transparent
  );
}
.panel-scroll :deep([data-slot='scroll-area-scrollbar']) {
  @apply w-2 border-0 p-0 py-3 pr-[3px];
}
.panel-scroll :deep([data-slot='scroll-area-thumb']) {
  @apply rounded-full bg-foreground/20;
}

/* Empty source slot: a recessed well with a dashed hairline drawn inside it. */
.source-well {
  background: var(--well);
  background-image: repeating-linear-gradient(
      90deg,
      var(--hairline-strong) 0 6px,
      transparent 6px 12px
    ),
    repeating-linear-gradient(90deg, var(--hairline-strong) 0 6px, transparent 6px 12px),
    repeating-linear-gradient(180deg, var(--hairline-strong) 0 6px, transparent 6px 12px),
    repeating-linear-gradient(180deg, var(--hairline-strong) 0 6px, transparent 6px 12px);
  background-size:
    100% 1px,
    100% 1px,
    1px 100%,
    1px 100%;
  background-position:
    0 0,
    0 100%,
    0 0,
    100% 0;
  background-repeat: no-repeat;
}
.source-well:hover {
  background-image: none;
}

.dim-prefix {
  @apply pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[10.5px] font-semibold text-muted-foreground;
}
.dim-suffix {
  @apply pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground;
}
</style>
