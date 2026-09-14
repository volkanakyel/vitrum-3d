<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { MATERIAL_PRESETS } from '~/utils/presets'
import { SAMPLES, sampleDataUrl } from '~/utils/samples'
import type { Showcase } from '~/utils/showcase'

useSeoMeta({
  title: 'Vitrum',
  ogTitle: 'Vitrum',
  description: 'Turn any icon, logo or product photo into a true-to-size 3D object in glass, metal or full colour. Runs in the browser, exports GLB and STL.',
  ogDescription: 'Turn any icon, logo or product photo into a true-to-size 3D object in glass, metal or full colour.',
})

const canvas = ref<HTMLCanvasElement | null>(null)
const stage = ref<HTMLElement | null>(null)
let showcase: Showcase | null = null
const ready = ref(false)
const placed = reactive(new Set<string>())
const preset = ref('crystal')
const iconIds = ['heart', 'bolt', 'star', 'play', 'leaf', 'ring']
const icons = iconIds.map(id => SAMPLES.find(s => s.id === id)!)
const products = ['armchair', 'mug'].map(id => SAMPLES.find(s => s.id === id)!)
const thumbs = reactive<Record<string, string>>({})
/** Caption anchors, in canvas px, refreshed every frame from the projected objects. */
const anchors = reactive<Record<string, { x: number; y: number }>>({})
const materialPresets = MATERIAL_PRESETS.filter(p => ['crystal', 'frosted', 'smoke', 'sapphire', 'amber', 'holo', 'gold', 'chrome', 'copper', 'black', 'ceramic', 'satin'].includes(p.id))

function setPreset(id: string) {
  preset.value = id
  showcase?.setPreset(id)
}

let raf = 0
let reduced = false
let cleanup: (() => void) | null = null
onBeforeUnmount(() => cleanup?.())
onMounted(async () => {
  for (const s of SAMPLES) thumbs[s.id] = sampleDataUrl(s, 128)
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const { Showcase } = await import('~/utils/showcase')
  const el = canvas.value
  if (!el) return
  const narrow = window.innerWidth < 768
  showcase = new Showcase(el, { narrow })
  showcase.onPlaced = id => placed.add(id)
  showcase.onReady = () => (ready.value = true)
  void showcase.load()

  const onScroll = () => {
    const h = window.innerHeight || 1
    showcase?.setProgress(window.scrollY / h)
  }
  const onPointer = (e: PointerEvent) => {
    if (reduced) return
    showcase?.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1))
  }
  const onResize = () => {
    showcase?.resize()
    onScroll()
  }
  const onVisibility = () => showcase?.setVisible(document.visibilityState === 'visible')
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('pointermove', onPointer, { passive: true })
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)
  onScroll()

  const trackedIds = [...iconIds, ...products.map(p => p.id)]
  const tick = () => {
    raf = requestAnimationFrame(tick)
    if (!showcase) return
    for (const id of trackedIds) {
      const p = showcase.project(id)
      if (p && p.z < 1) anchors[id] = { x: p.x, y: p.y }
    }
  }
  tick()

  cleanup = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('pointermove', onPointer)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('visibilitychange', onVisibility)
    showcase?.dispose()
    showcase = null
  }
})
</script>

<template>
  <div class="landing">
    <!-- The showroom: one canvas fixed behind every section. -->
    <div
      ref="stage"
      class="stage pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    >
      <canvas
        ref="canvas"
        class="absolute inset-0 block size-full"
      />
      <!-- Captions ride under their objects in the icons and products stations. -->
      <span
        v-for="s in icons"
        :key="s.id"
        class="caption absolute flex -translate-x-1/2 flex-col items-center gap-2 transition-opacity duration-500"
        :class="placed.has(s.id) && anchors[s.id] ? 'opacity-100' : 'opacity-0'"
        :style="anchors[s.id] ? { left: `${anchors[s.id]!.x}px`, top: `calc(${anchors[s.id]!.y}px + clamp(64px, 9vw, 120px))` } : undefined"
      >
        <img
          :src="thumbs[s.id]"
          alt=""
          class="size-9 rounded-[10px] bg-card object-contain p-1 shadow-[var(--shadow-raise)]"
          draggable="false"
        >
        <span class="text-[11.5px] text-ink-2">{{ s.label }}</span>
      </span>
      <span
        v-for="s in products"
        :key="s.id"
        class="caption absolute flex -translate-x-1/2 flex-col items-center gap-2 transition-opacity duration-500"
        :class="placed.has(s.id) && anchors[s.id] ? 'opacity-100' : 'opacity-0'"
        :style="anchors[s.id] ? { left: `${anchors[s.id]!.x}px`, top: `calc(${anchors[s.id]!.y}px + clamp(96px, 16vw, 190px))` } : undefined"
      >
        <img
          :src="thumbs[s.id]"
          alt=""
          class="size-12 rounded-[12px] bg-card object-contain p-1 shadow-[var(--shadow-raise)]"
          draggable="false"
        >
        <span class="text-[11.5px] text-ink-2">{{ s.label }}, from this picture</span>
      </span>
    </div>

    <!-- Station 0: hero -->
    <section class="station relative z-10 flex min-h-svh items-end px-6 pt-24 pb-[12svh] md:items-center md:pb-0">
      <div class="mx-auto w-full max-w-[1200px]">
        <div class="max-w-[560px]">
          <h1 class="max-w-[9.5ch] font-serif text-[clamp(44px,6.4vw,88px)] leading-[0.98] tracking-[-0.025em] text-foreground">
            Any image, made <em>solid.</em>
          </h1>
          <p class="mt-6 max-w-[38ch] text-[15px] leading-[1.55] text-ink-2 md:text-[17px]">
            Drop a logo, an icon or a product photo. Vitrum traces it and builds a real object in glass, metal or its own colours, sized in millimetres, ready to orbit and export.
          </p>
          <div class="mt-8 flex flex-wrap gap-2">
            <Button
              as-child
              size="lg"
              class="h-11 px-5 text-[13.5px]"
            >
              <NuxtLink to="/studio/icon">
                <Icon
                  name="gem"
                  :size="15"
                />
                Start with an icon
              </NuxtLink>
            </Button>
            <Button
              as-child
              variant="outline"
              size="lg"
              class="h-11 px-5 text-[13.5px]"
            >
              <NuxtLink to="/studio/product">
                <Icon
                  name="cuboid"
                  :size="15"
                />
                Start with a product
              </NuxtLink>
            </Button>
          </div>
          <p class="mt-5 flex items-center gap-2 text-[12px] text-ink-3">
            <span
              class="size-1.5 rounded-full transition-colors duration-500"
              :class="ready ? 'bg-ice shadow-[0_0_0_3px_var(--ice-glow)]' : 'bg-ink-3/40'"
            />
            {{ ready ? 'Every object on this page was built in your browser just now.' : 'Building the objects on this page in your browser…' }}
          </p>
        </div>
      </div>
    </section>

    <!-- Station 1: icons -->
    <section class="station relative z-10 flex min-h-svh items-start px-6 pt-[16svh] md:items-start">
      <div class="mx-auto w-full max-w-[1200px]">
        <div class="max-w-[26ch]">
          <h2 class="font-serif text-[clamp(32px,4.4vw,56px)] leading-[1.02] tracking-[-0.02em] text-foreground">
            Icons become objects you could hold.
          </h2>
          <p class="mt-4 max-w-[40ch] text-[14px] leading-[1.55] text-ink-2 md:text-[15px]">
            The outline is traced to the pixel, sharp tips rounded, edges bevelled. Six flat marks, six finishes, no modelling.
          </p>
        </div>
      </div>
    </section>

    <!-- Station 2: products -->
    <section class="station relative z-10 flex min-h-svh items-start px-6 pt-[16svh]">
      <div class="mx-auto w-full max-w-[1200px]">
        <div class="max-w-[26ch] md:ml-auto md:text-right">
          <h2 class="font-serif text-[clamp(32px,4.4vw,56px)] leading-[1.02] tracking-[-0.02em] text-foreground">
            A product picture keeps its colours and gains a body.
          </h2>
          <p class="mt-4 max-w-[40ch] text-[14px] leading-[1.55] text-ink-2 md:ml-auto md:text-[15px]">
            The silhouette is inflated into a rounded volume, front and back, and the picture's shading presses into the surface. The armchair here started as a flat drawing.
          </p>
        </div>
      </div>
    </section>

    <!-- Station 3: materials -->
    <section class="station relative z-10 flex min-h-svh items-end px-6 pb-[10svh]">
      <div class="mx-auto w-full max-w-[1200px]">
        <div class="max-w-[26ch]">
          <h2 class="font-serif text-[clamp(32px,4.4vw,56px)] leading-[1.02] tracking-[-0.02em] text-foreground">
            Pick the material. Watch it change.
          </h2>
          <p class="mt-4 max-w-[40ch] text-[14px] leading-[1.55] text-ink-2 md:text-[15px]">
            Refraction, dispersion, tint depth and rim colour for glass. Roughness, lacquer and colour for metal and ceramic.
          </p>
        </div>
        <div
          class="pointer-events-auto mt-6 flex max-w-full flex-wrap gap-1.5"
          role="radiogroup"
          aria-label="Material"
        >
          <button
            v-for="p in materialPresets"
            :key="p.id"
            type="button"
            role="radio"
            :aria-checked="preset === p.id"
            class="flex h-8 items-center gap-2 rounded-full bg-card/85 pr-3 pl-1.5 text-[12px] font-medium text-ink-2 backdrop-blur transition-[box-shadow,color] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none"
            :class="preset === p.id ? 'text-foreground shadow-[var(--shadow-raise-dark)] ring-1 ring-ink/80' : 'shadow-[var(--shadow-raise)]'"
            @click="setPreset(p.id)"
            @pointerenter="setPreset(p.id)"
          >
            <span
              class="size-5 rounded-full shadow-[inset_0_0_0_1px_rgba(13,14,18,0.12)]"
              :style="{ background: p.swatch }"
            />
            {{ p.label }}
          </button>
        </div>
      </div>
    </section>

    <!-- How it works + call to action: static, after the camera has parked. -->
    <section class="relative z-10 px-6 pt-[10svh] pb-[8svh]">
      <div class="mx-auto w-full max-w-[1200px]">
        <div class="grid gap-10 md:grid-cols-[1fr_1fr] md:gap-16">
          <div>
            <h2 class="font-serif text-[clamp(30px,3.8vw,48px)] leading-[1.04] tracking-[-0.02em] text-foreground">
              Three steps, all of them in your browser.
            </h2>
          </div>
          <ol class="flex flex-col divide-y divide-hairline">
            <li class="flex gap-5 py-5 first:pt-0">
              <span class="index mt-1 text-ink-3">01</span>
              <div>
                <p class="text-[15px] font-medium text-foreground">Trace</p>
                <p class="mt-1 max-w-[46ch] text-[13.5px] leading-[1.55] text-ink-2">The image is read at up to 2048 px. Dark pixels, light pixels, alpha or colour distance become an outline with holes, in a worker so nothing stalls.</p>
              </div>
            </li>
            <li class="flex gap-5 py-5">
              <span class="index mt-1 text-ink-3">02</span>
              <div>
                <p class="text-[15px] font-medium text-foreground">Build</p>
                <p class="mt-1 max-w-[46ch] text-[13.5px] leading-[1.55] text-ink-2">Extrude for flat art, stack for icons on tiles, inflate for objects, relief for photographs. Every model is built in millimetres.</p>
              </div>
            </li>
            <li class="flex gap-5 py-5 last:pb-0">
              <span class="index mt-1 text-ink-3">03</span>
              <div>
                <p class="text-[15px] font-medium text-foreground">Export</p>
                <p class="mt-1 max-w-[46ch] text-[13.5px] leading-[1.55] text-ink-2">GLB with glass and colour intact for the web, binary STL for printing, or a 2× render of the current view.</p>
              </div>
            </li>
          </ol>
        </div>

        <div class="cta mt-[12svh] flex flex-col items-start gap-6 rounded-[28px] px-8 py-10 md:flex-row md:items-center md:justify-between md:px-12">
          <div>
            <p class="font-serif text-[clamp(28px,3.4vw,40px)] leading-[1.05] tracking-[-0.02em] text-foreground">Open the studio with your own image.</p>
            <p class="mt-2 text-[13.5px] text-ink-2">PNG, JPG, WebP or SVG. Nothing is uploaded anywhere.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              as-child
              size="lg"
              class="h-11 px-5 text-[13.5px]"
            >
              <NuxtLink to="/studio/icon">Icon studio</NuxtLink>
            </Button>
            <Button
              as-child
              variant="outline"
              size="lg"
              class="h-11 px-5 text-[13.5px]"
            >
              <NuxtLink to="/studio/product">Product studio</NuxtLink>
            </Button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing {
  background: linear-gradient(180deg, #f6f7f9 0%, var(--shell) 22%, var(--shell) 100%);
}
.station h1 em {
  font-style: italic;
}
.cta {
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
</style>
