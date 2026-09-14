<script setup lang="ts">
import {
  Aperture, Box, Camera, Check, ChevronDown, Circle, Cuboid, Diamond, Download, Expand, Eye, Focus, Frame,
  Gem, Hexagon, Image, ImagePlus, Info, Layers, Lightbulb, Maximize2, Move3d, Orbit, Palette, Pipette,
  RotateCcw, RotateCw, Ruler, Scan, Settings2, Shapes, SlidersHorizontal, Sparkles, Sun, Upload, X, Droplets, Blend, Mountain, Square,
} from '@lucide/vue'

// Single entry point for icons so the rest of the app never imports lucide directly.
const map = {
  logo: Hexagon, upload: Upload, image: Image, imagePlus: ImagePlus, scan: Scan, ruler: Ruler, gem: Gem, sun: Sun,
  download: Download, camera: Camera, box: Box, cuboid: Cuboid, rotate: RotateCw, reset: RotateCcw, maximize: Maximize2,
  expand: Expand, chevron: ChevronDown, check: Check, x: X, sparkle: Sparkles, sliders: SlidersHorizontal, layers: Layers,
  info: Info, shapes: Shapes, palette: Palette, focus: Focus, move3d: Move3d, orbit: Orbit, lightbulb: Lightbulb,
  aperture: Aperture, eye: Eye, frame: Frame, diamond: Diamond, pipette: Pipette, settings: Settings2, circle: Circle,
  droplets: Droplets, blend: Blend, mountain: Mountain, square: Square,
} as const

export type IconName = keyof typeof map
const props = withDefaults(defineProps<{ name: IconName | string; size?: number; strokeWidth?: number }>(), { size: 16, strokeWidth: 1.75 })
const comp = computed(() => map[props.name as IconName] ?? Circle)
</script>

<template>
  <component :is="comp" :size="size" :stroke-width="strokeWidth" aria-hidden="true" />
</template>
