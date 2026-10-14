<script setup lang="ts">
import { AnimatePresence } from 'motion-v'
import { useSidebar } from '@/components/ui/sidebar'
import { DEFAULT_GLASS_PARAMS as D } from '~/utils/presets'

/** The Material tab: the finish, then the knobs that finish has. */
const { glass, reliefOpts, resetGlass } = useStudioContext()
const { isMobile } = useSidebar()

const METAL_SWATCHES = ['#e4b84a', '#d9a08a', '#f2f3f5', '#d8d9dc', '#c8734a', '#5f636b', '#15161a', '#f4f4f2', '#2c5cff', '#c0392b']
/** Each finish's own base look, which its Surface reset returns to (the colour stays). */
const METAL_BASE = { metalness: 1, roughness: 0.22, clearcoat: 0 }
const PRINT_BASE = { roughness: 0.7, clearcoat: 0, flatten: 0.55, grain: 0.5, sheen: 0.15, weave: 0, soften: 0 }

const isGlass = computed(() => glass.finish === 'glass')

function resetSurface() {
  if (glass.finish === 'glass') resetGlass('ior', 'dispersion', 'clarity', 'roughness', 'blur')
  else Object.assign(glass, glass.finish === 'metal' ? METAL_BASE : PRINT_BASE)
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
          <SliderField
            v-model="glass.roughness"
            label="Roughness"
            :min="0"
            :max="1"
            :step="0.01"
            :default-value="PRINT_BASE.roughness"
          />
          <SliderField
            v-model="glass.sheen"
            label="Sheen"
            hint="Soft glow at grazing angles, the way cloth and velvet catch the light"
            :min="0"
            :max="1"
            :step="0.01"
            :default-value="PRINT_BASE.sheen"
          />
          <PanelNote>
            <template v-if="glass.geometry === 'relief' && !reliefOpts.cutout">
              The picture is sampled at its native resolution and laid over the relief, every
              colour kept.
            </template>
            <template v-else>
              The picture is sampled at its native resolution and padded past the outline, so
              walls and bevels take the edge colour.
            </template>
          </PanelNote>
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
        </template>
        <template v-else>
          <ColorField
            v-model="glass.tint"
            label="Color"
            :swatches="METAL_SWATCHES"
          />
          <SliderField
            v-model="glass.metalness"
            label="Metalness"
            :min="0"
            :max="1"
            :step="0.01"
            :default-value="METAL_BASE.metalness"
          />
          <SliderField
            v-model="glass.roughness"
            label="Roughness"
            :min="0"
            :max="1"
            :step="0.01"
            :default-value="METAL_BASE.roughness"
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
      @reset="resetGlass('tir', 'edgeChroma', 'clearcoat', 'tint', 'attenuationMm')"
    >
      <SliderField
        v-model="glass.edgeChroma"
        label="Rainbow rim"
        hint="Thin-film colours on the rims that turn with the view; 1 is holographic"
        :min="0"
        :max="1"
        :step="0.01"
        :default-value="D.edgeChroma"
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
</template>
