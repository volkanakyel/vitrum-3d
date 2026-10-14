<script setup lang="ts">
import { AnimatePresence } from 'motion-v'
import type { SegmentOption } from '~/components/studio/SegmentedControl.vue'
import { DEFAULT_GLASS_PARAMS as D, type Geometry } from '~/utils/presets'
import { DEFAULT_RELIEF_OPTIONS as R, type HeightSource } from '~/utils/relief'
import { DEFAULT_TRACE_OPTIONS as T, type TraceOptions } from '~/utils/trace'

/** The Shape tab: how the outline becomes a solid, and how big it is. */
const { glass, trace, traceOpts, reliefOpts, heightMm, setHeight, resetGlass } = useStudioContext()

const GEOMETRIES: SegmentOption<Geometry>[] = [
  { value: 'extrude', label: 'Extrude' },
  { value: 'stack', label: 'Stack' },
  { value: 'inflate', label: 'Inflate' },
  { value: 'relief', label: 'Relief' },
]
const GEOMETRY_HINT: Record<Geometry, string> = {
  extrude: 'Silhouette as slab',
  stack: 'Object with raised colours',
  inflate: 'Silhouette as volume',
  relief: 'Picture as height',
}
const GEOMETRY_NOTE: Record<Geometry, string> = {
  extrude: 'The traced outline is extruded into a bevelled solid: crisp edges for logos, icons and type.',
  stack: 'The whole object is the base (an icon keeps its tile) and every colour inside it rises as its own layer, so the picture becomes a real stepped object.',
  inflate: 'The outline is puffed into a rounded solid, front and back; a side or top photo carves the volume to its real profile.',
  relief: 'Every pixel becomes a vertex: photos, paintings and shaded artwork keep their detail and their colours.',
}
/** What D measures, per geometry. */
const DEPTH_HINT: Record<Geometry, string> = {
  extrude: 'H follows the outline',
  stack: 'D = base, layers on top',
  inflate: 'D = full thickness',
  relief: 'D = base slab, relief on top',
}
const HEIGHT_SOURCES: SegmentOption<HeightSource>[] = [
  { value: 'luminance', label: 'Smooth' },
  { value: 'layers', label: 'Layers' },
  { value: 'flat', label: 'Flat' },
]
const TRACE_MODES: SegmentOption<TraceOptions['mode']>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'alpha', label: 'Alpha' },
  { value: 'color', label: 'Color' },
]
const gridSizes = (sizes: number[]): SegmentOption<number>[] => sizes.map(r => ({ value: r, label: String(r) }))
const RELIEF_GRID = gridSizes([256, 512, 1024])
const TRACE_GRID = gridSizes([512, 1024, 2048])

const isRelief = computed(() => glass.geometry === 'relief')
const isInflate = computed(() => glass.geometry === 'inflate')
const isStack = computed(() => glass.geometry === 'stack')
const outlineHint = computed(() => trace.value && `${shapeCountLabel(trace.value)} · ${TRACE_MODE_LABEL[trace.value.resolvedMode]}`)
/** Typed dimensions only land when they are numbers; a cleared field leaves the model alone. */
const isNumber = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

function resetStack() {
  traceOpts.stackLayers = T.stackLayers
  resetGlass('layerMm')
}
function resetVolume() {
  Object.assign(reliefOpts, { ...R, inflate: reliefOpts.inflate, cutout: reliefOpts.cutout })
}
function resetRelief() {
  Object.assign(reliefOpts, { ...R, cutout: reliefOpts.cutout })
  resetGlass('reliefMm')
}
function resetOutline() {
  Object.assign(traceOpts, { ...T, stack: traceOpts.stack })
}
</script>

<template>
  <AnimatePresence :initial="false">
    <SectionGroup
      key="geometry"
      title="Geometry"
      :hint="GEOMETRY_HINT[glass.geometry]"
    >
      <SegmentedControl
        v-model="glass.geometry"
        :options="GEOMETRIES"
        size="md"
      />
      <PanelNote>{{ GEOMETRY_NOTE[glass.geometry] }}</PanelNote>
    </SectionGroup>

    <SectionGroup
      v-if="isStack"
      key="stack"
      title="Layers"
      :hint="trace?.layers ? `${trace.layers.length} raised` : undefined"
      resettable
      @reset="resetStack"
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
          class="flex h-6 items-center gap-1.5 rounded-full bg-card pr-2.5 pl-1.5 text-[12.5px] text-ink-2 shadow-raise tabular-nums"
        >
          <span
            class="size-3 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--hairline-strong)]"
            :style="{ background: l.color }"
          />
          {{ Math.round(l.area * 100) }}%
        </span>
      </div>
    </SectionGroup>

    <SectionGroup
      v-if="isInflate"
      key="inflate"
      title="Volume"
      resettable
      @reset="resetVolume"
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
      <SegmentField
        v-model="reliefOpts.resolution"
        label="Grid detail"
        :options="RELIEF_GRID"
      />
    </SectionGroup>

    <SectionGroup
      v-if="isRelief"
      key="relief"
      title="Relief"
      resettable
      @reset="resetRelief"
    >
      <SegmentField
        v-model="reliefOpts.source"
        label="Height from"
        :options="HEIGHT_SOURCES"
      />
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
          <SwitchField
            v-model="reliefOpts.invert"
            label="Dark rises"
          />
        </Reveal>
      </AnimatePresence>
      <SwitchField
        v-model="reliefOpts.cutout"
        label="Cut to outline"
        :disabled="!trace?.polygons.length"
      />
      <SegmentField
        v-model="reliefOpts.resolution"
        label="Grid detail"
        :options="RELIEF_GRID"
      />
    </SectionGroup>

    <SectionGroup
      v-if="!isRelief || reliefOpts.cutout"
      key="trace"
      title="Outline"
      :hint="outlineHint || undefined"
      resettable
      @reset="resetOutline"
    >
      <SegmentField
        v-model="traceOpts.mode"
        label="Find the shape by"
        :options="TRACE_MODES"
      />
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
      <SwitchField
        v-model="traceOpts.fillHoles"
        label="Fill holes"
      />
      <SegmentField
        v-model="traceOpts.resolution"
        label="Trace detail"
        :options="TRACE_GRID"
      />
    </SectionGroup>

    <SectionGroup
      key="dimensions"
      title="Dimensions"
      :hint="DEPTH_HINT[glass.geometry]"
      resettable
      @reset="resetGlass('widthMm', 'depthMm', 'bevelMm', 'bevelSegments')"
    >
      <div class="grid grid-cols-3 gap-2">
        <DimField
          axis="W"
          :model-value="glass.widthMm"
          :min="1"
          :step="1"
          @update:model-value="(v) => isNumber(v) && (glass.widthMm = v)"
        />
        <DimField
          axis="H"
          :model-value="+heightMm.toFixed(1)"
          :min="1"
          :step="1"
          @update:model-value="(v) => isNumber(v) && setHeight(v)"
        />
        <DimField
          axis="D"
          :model-value="glass.depthMm"
          :min="0.5"
          :step="0.5"
          @update:model-value="(v) => isNumber(v) && (glass.depthMm = v)"
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
        </Reveal>
      </AnimatePresence>
    </SectionGroup>
  </AnimatePresence>
</template>
