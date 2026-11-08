<script setup lang="ts">
import { AnimatePresence } from 'motion-v'
import { useSidebar } from '@/components/ui/sidebar'
import type { SegmentOption } from '~/components/studio/SegmentedControl.vue'
import { DEFAULT_GLASS_PARAMS as D, MATERIAL_PRESETS, type ColorSource, type GlassParams, type MaterialPreset } from '~/utils/presets'

/** The Material tab: the finish, then the knobs that finish has. */
const { glass, ink, editMaterial } = useStudioContext()
const { isMobile } = useSidebar()

const METAL_SWATCHES = ['#e4b84a', '#d9a08a', '#f2f3f5', '#d8d9dc', '#c8734a', '#5f636b', '#15161a', '#f4f4f2', '#2c5cff', '#c0392b']
/** Each finish's own base look, under the picked preset's values (see `base`). */
const METAL_BASE = { metalness: 1, roughness: 0.22, clearcoat: 0 }
const PRINT_BASE = { roughness: 0.7, clearcoat: 0, flatten: 0.55, grain: 0.5, sheen: 0.15, weave: 0, soften: 0 }

const COLOR_SOURCES: SegmentOption<ColorSource>[] = [
  { value: 'picture', label: 'Picture colours', icon: 'image' },
  { value: 'paint', label: 'Paint', icon: 'palette' },
]
const PAINT_SWATCHES = ['#ece5dc', '#c9bca9', '#6b2a4a', '#7b4a2c', '#c46a4a', '#b3202c', '#34373e', '#eceef2', '#2457d6', '#ff8fae']
const isGlass = computed(() => glass.finish === 'glass' || glass.finish === 'liquid')

/**
 * What the sliders call default: the last preset picked in this finish, so choosing Velvet does not
 * light every reset mark at once, and a reset returns to Velvet rather than to a generic base.
 */
const lastPreset = ref<MaterialPreset | null>(null)
watchEffect(() => {
  const id = activePresetId(glass)
  if (id) lastPreset.value = MATERIAL_PRESETS.find(p => p.id === id) ?? null
})
const base = computed<GlassParams>(() => {
  const finishBase = glass.finish === 'metal' ? METAL_BASE : glass.finish === 'print' ? PRINT_BASE : {}
  const picked = lastPreset.value?.group === glass.finish ? lastPreset.value.values : {}
  return { ...D, ...finishBase, ...picked }
})
function restore(...keys: (keyof GlassParams)[]) {
  editMaterial(Object.fromEntries(keys.map(k => [k, base.value[k]])))
}

function resetSurface() {
  if (isGlass.value) restore('ior', 'dispersion', 'clarity', 'roughness', 'blur')
  else if (glass.finish === 'metal') restore('metalness', 'roughness', 'clearcoat')
  else restore('roughness', 'clearcoat', 'flatten', 'grain', 'sheen', 'weave', 'soften', 'paint')
}
</script>

<template>
  <!-- The phone sheet's finish row covers this. -->
  <SectionGroup
    v-if="!isMobile"
    title="Finish"
  >
    <MaterialPicker :glass="glass" />
  </SectionGroup>
  <SectionGroup
    :title="isGlass ? 'Optics' : 'Surface'"
    resettable
    @reset="resetSurface"
  >
    <AnimatePresence
      mode="wait"
      :initial="false"
    >
      <Reveal :key="glass.finish">
        <template v-if="glass.finish === 'print'">
          <SegmentedControl
            :model-value="glass.colorSource"
            @update:model-value="editMaterial({ colorSource: $event })"
            :options="COLOR_SOURCES"
          />
          <ColorField
            v-if="glass.colorSource === 'paint'"
            :model-value="glass.paint"
            @update:model-value="editMaterial({ paint: $event })"
            label="Paint"
            :swatches="PAINT_SWATCHES"
          />
          <SliderField
            :model-value="glass.roughness"
            @update:model-value="editMaterial({ roughness: $event })"
            label="Roughness"
            :min="0"
            :max="1"
            :step="0.01"
            :default-value="base.roughness"
          />
          <SliderField
            :model-value="glass.sheen"
            @update:model-value="editMaterial({ sheen: $event })"
            label="Sheen"
            hint="Soft glow at grazing angles, the way cloth and velvet catch the light"
            :min="0"
            :max="1"
            :step="0.01"
            :default-value="base.sheen"
          />
          <PanelNote v-if="glass.colorSource === 'picture'">
            {{ ink.length === 1 ? 'A one-colour mark: try Paint to see each surface in its own colour.' : 'The picture keeps its own colours; walls and bevels take the edge colour.' }}
          </PanelNote>
        </template>
        <template v-else-if="isGlass">
          <SliderField
            :model-value="glass.ior"
            @update:model-value="editMaterial({ ior: $event })"
            label="Refraction"
            hint="How much the glass bends what is behind it: 1.5 window glass, 1.9 crystal, 2.4 diamond"
            :min="1"
            :max="2.33"
            :step="0.01"
            :default-value="base.ior"
          />
          <SliderField
            v-if="glass.finish === 'liquid'"
            :model-value="glass.dispersion"
            @update:model-value="editMaterial({ dispersion: $event })"
            label="Dispersion"
            hint="How far each edge splits into a spectrum, red on one side and blue on the other"
            :min="0"
            :max="1"
            :step="0.01"
            :default-value="base.dispersion"
          />
          <SliderField
            :model-value="glass.clarity"
            @update:model-value="editMaterial({ clarity: $event })"
            label="Clarity"
            hint="How much light passes through; lower reads as milky glass"
            :min="0.3"
            :max="1"
            :step="0.01"
            :default-value="base.clarity"
          />
          <SliderField
            :model-value="glass.roughness"
            @update:model-value="editMaterial({ roughness: $event })"
            label="Frost"
            hint="Matte, sandblasted surface"
            :min="0"
            :max="0.6"
            :step="0.01"
            :default-value="base.roughness"
          />
        </template>
        <template v-else>
          <ColorField
            :model-value="glass.tint"
            @update:model-value="editMaterial({ tint: $event })"
            label="Color"
            :swatches="METAL_SWATCHES"
          />
          <SliderField
            :model-value="glass.metalness"
            @update:model-value="editMaterial({ metalness: $event })"
            label="Metalness"
            :min="0"
            :max="1"
            :step="0.01"
            :default-value="base.metalness"
          />
          <SliderField
            :model-value="glass.roughness"
            @update:model-value="editMaterial({ roughness: $event })"
            label="Roughness"
            :min="0"
            :max="1"
            :step="0.01"
            :default-value="base.roughness"
          />
        </template>
      </Reveal>
    </AnimatePresence>
  </SectionGroup>
  <AnimatePresence :initial="false">
    <SectionGroup
      v-if="isGlass"
      key="edges"
      title="Rim & tint"
      resettable
      @reset="restore('tir', 'edgeChroma', 'clearcoat', 'tint', 'attenuationMm')"
    >
      <SliderField
        :model-value="glass.edgeChroma"
            @update:model-value="editMaterial({ edgeChroma: $event })"
        label="Rainbow rim"
        hint="Thin-film colours on the rims that turn with the view; 1 is holographic"
        :min="0"
        :max="1"
        :step="0.01"
        :default-value="base.edgeChroma"
      />
      <ColorField
        :model-value="glass.tint"
            @update:model-value="editMaterial({ tint: $event })"
        label="Tint"
      />
      <SliderField
        :model-value="glass.attenuationMm"
            @update:model-value="editMaterial({ attenuationMm: $event })"
        label="Tint depth"
        hint="How far light travels before it takes the full tint; small is deep colour"
        :min="2"
        :max="600"
        :step="1"
        unit="mm"
        :decimals="0"
        :default-value="base.attenuationMm"
      />
    </SectionGroup>
  </AnimatePresence>
</template>
