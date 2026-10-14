<script setup lang="ts">
import { AnimatePresence } from 'motion-v'
import { DEFAULT_GLASS_PARAMS as D } from '~/utils/presets'

/** The Scene tab: the set the model stands in, the light and lens, and its turntable. */
const { glass, resetGlass } = useStudioContext()

const BACKGROUND_SWATCHES = ['#eef0f4', '#ffffff', '#e6e9ef', '#e6e9f0', '#dfe6f5', '#f4f4f2', '#f3e9e2', '#1c1c1f', '#0b0b0d', '#2b2f3a']
</script>

<template>
  <SectionGroup
    title="Stage"
    :hint="glass.floor ? 'Object on a floor' : 'Logo on a wall'"
    resettable
    @reset="resetGlass('background', 'shadow', 'vignette', 'floor')"
  >
    <SwitchField
      v-model="glass.floor"
      label="Stand on a floor"
    />
    <PanelNote>
      <template v-if="glass.floor">
        A product set: a film tone curve, a white key casting a soft shadow on the floor, a warm
        fill and a rim from behind, over a sky and ground ambient. The Color finish shows no room
        reflections. The orbit stays above the floor.
      </template>
      <template v-else>
        A glass studio: a dark room with bright softboxes, one hard key and a cool rim, and a soft
        silhouette shadow on the wall behind the model.
      </template>
    </PanelNote>
    <ColorField
      v-model="glass.background"
      label="Background"
      :swatches="BACKGROUND_SWATCHES"
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
    @reset="resetGlass('autoRotate', 'rotateSpeed')"
  >
    <SwitchField
      v-model="glass.autoRotate"
      label="Auto rotate"
    />
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
</template>
