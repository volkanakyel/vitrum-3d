<script setup lang="ts">
import { AnimatePresence } from 'motion-v'
import type { SegmentOption } from '~/components/studio/SegmentedControl.vue'
import { DEFAULT_GLASS_PARAMS as D, type BackdropFill, type RotateMode } from '~/utils/presets'

/** The Scene tab: the wall behind the model, the set it stands in, the light and lens, and its turntable. */
const { glass, resetGlass } = useStudioContext()

const BACKGROUND_SWATCHES = ['#f4f5f8', '#ffffff', '#c9ced8', '#dfe6f5', '#cfe1ff', '#f4f4f2', '#f3e9e2', '#1c1c1f', '#0b0b0d', '#1d3a74']
const FILLS: SegmentOption<BackdropFill>[] = [
  { value: 'solid', label: 'Solid', icon: 'square' },
  { value: 'linear', label: 'Linear', icon: 'blend' },
  { value: 'radial', label: 'Radial', icon: 'circle' },
]
const ROTATE_MODES: SegmentOption<RotateMode>[] = [
  { value: 'sway', label: 'Sway' },
  { value: 'orbit', label: 'Full turn' },
]
// The set behind each stage mode, for the switch's info mark rather than a paragraph in the panel.
const STAGE_HINT = {
  floor: 'A product set: a film tone curve, a white key casting a soft shadow on the floor, a warm fill and a rim from behind. The Color finish shows no room reflections, and the orbit stays above the floor.',
  wall: 'A glass studio: a dark room with bright softboxes, one hard key and a cool rim, and a soft silhouette shadow on the wall behind the model.',
}
const gradient = computed(() => glass.backdropFill !== 'solid')
</script>

<template>
  <SectionGroup
    title="Background"
    resettable
    @reset="resetGlass('background', 'backdropFill', 'background2', 'backdropAngle', 'vignette')"
  >
    <BackdropPicker :glass="glass" />
    <SegmentedControl
      v-model="glass.backdropFill"
      :options="FILLS"
      size="md"
    />
    <div class="flex flex-col gap-3">
      <ColorField
        v-model="glass.background"
        :label="gradient ? (glass.backdropFill === 'radial' ? 'Centre' : 'From') : 'Color'"
        :swatches="BACKGROUND_SWATCHES"
      />
      <AnimatePresence :initial="false">
        <Reveal
          v-if="gradient"
          key="to"
        >
          <ColorField
            v-model="glass.background2"
            :label="glass.backdropFill === 'radial' ? 'Edge' : 'To'"
            :swatches="BACKGROUND_SWATCHES"
          />
        </Reveal>
      </AnimatePresence>
    </div>
    <AnimatePresence :initial="false">
      <Reveal
        v-if="glass.backdropFill === 'linear'"
        key="angle"
      >
        <SliderField
          v-model="glass.backdropAngle"
          label="Angle"
          hint="Which way the blend runs: 180° is top to bottom, 90° left to right"
          :min="0"
          :max="360"
          :step="1"
          :decimals="0"
          unit="°"
          :default-value="D.backdropAngle"
        />
      </Reveal>
    </AnimatePresence>
    <SliderField
      v-model="glass.vignette"
      label="Vignette"
      hint="Darkens the corners so the eye settles on the model"
      :min="0"
      :max="1"
      :step="0.01"
      :default-value="D.vignette"
    />
  </SectionGroup>
  <SectionGroup
    title="Stage"
    :hint="glass.floor ? 'Object on a floor' : 'Logo on a wall'"
    resettable
    @reset="resetGlass('shadow', 'floor')"
  >
    <SwitchField
      v-model="glass.floor"
      label="Stand on a floor"
      :hint="glass.floor ? STAGE_HINT.floor : STAGE_HINT.wall"
    />
    <SliderField
      v-model="glass.shadow"
      label="Shadow"
      :min="0"
      :max="1"
      :step="0.01"
      :default-value="D.shadow"
    />
  </SectionGroup>
  <SectionGroup
    title="Light & camera"
    resettable
    @reset="resetGlass('lightAngle', 'envIntensity', 'exposure', 'fov')"
  >
    <SliderField
      v-model="glass.lightAngle"
      label="Light angle"
      hint="Walks the studio's lights around the object: the reflections and highlights move with them"
      :min="-180"
      :max="180"
      :step="1"
      :decimals="0"
      unit="°"
      :default-value="D.lightAngle"
    />
    <SliderField
      v-model="glass.envIntensity"
      label="Studio light"
      hint="Brightness of the softboxes the surface reflects"
      :min="0.4"
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
    title="Motion"
    resettable
    @reset="resetGlass('autoRotate', 'rotateMode', 'rotateSpeed')"
  >
    <SwitchField
      v-model="glass.autoRotate"
      label="Auto rotate"
      hint="Sway rocks the model gently either side of its front, so it is never seen edge-on. Full turn spins it all the way round."
    />
    <AnimatePresence :initial="false">
      <Reveal
        v-if="glass.autoRotate"
        key="speed"
      >
        <SegmentedControl
          v-model="glass.rotateMode"
          :options="ROTATE_MODES"
        />
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
</template>
