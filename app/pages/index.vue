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

/**
 * Three canvases, each inside its own section so nothing rendered can ever sit over text
 * further down the page:
 *   hero    — the mark alone, centred, turning on its own; headline below it
 *   story   — pinned for three beats; the mark turns on the right as the copy changes on the left
 *   gallery — six icons and two products, free scrolling
 */
const BEATS = 3
const heroEl = ref<HTMLElement | null>(null)
const heroCanvas = ref<HTMLCanvasElement | null>(null)
const storyEl = ref<HTMLElement | null>(null)
const storyCanvas = ref<HTMLCanvasElement | null>(null)
const galleryEl = ref<HTMLElement | null>(null)
const galleryCanvas = ref<HTMLCanvasElement | null>(null)
let hero: Showcase | null = null
let story: Showcase | null = null
let gallery: Showcase | null = null
const ready = ref(false)
const beat = ref(0)
/** False once the story has scrolled out; the beat rail hides so it never rides over the next section. */
const pinned = ref(false)
const preset = ref('crystal')
const placed = reactive(new Set<string>())
const thumbs = reactive<Record<string, string>>({})
const anchors = reactive<Record<string, { x: number; y: number }>>({})
const icons = ['heart', 'bolt', 'star', 'play', 'leaf', 'ring'].map(id => SAMPLES.find(s => s.id === id)!)
const products = ['armchair', 'mug'].map(id => SAMPLES.find(s => s.id === id)!)
const materialPresets = MATERIAL_PRESETS.filter(p => ['crystal', 'frosted', 'smoke', 'sapphire', 'amber', 'holo', 'gold', 'chrome', 'copper', 'black', 'ceramic', 'satin'].includes(p.id))
const presetLabel = computed(() => materialPresets.find(p => p.id === preset.value)?.label ?? '')
let userPicked = false

function setPreset(id: string, byUser = true) {
  if (byUser) userPicked = true
  preset.value = id
  story?.setPreset(id)
}

function scrollToStory() {
  storyEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

let raf = 0
let cleanup: (() => void) | null = null
onBeforeUnmount(() => cleanup?.())
onMounted(async () => {
  for (const s of SAMPLES) thumbs[s.id] = sampleDataUrl(s, 128)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const narrow = window.innerWidth < 768
  const { Showcase } = await import('~/utils/showcase')
  if (!heroCanvas.value || !storyCanvas.value || !galleryCanvas.value) return
  hero = new Showcase(heroCanvas.value, { layout: 'hero', narrow })
  hero.onReady = () => (ready.value = true)
  story = new Showcase(storyCanvas.value, { layout: 'story', narrow })
  story.setVisible(false)
  gallery = new Showcase(galleryCanvas.value, { layout: 'gallery', narrow })
  gallery.onPlaced = id => placed.add(id)
  gallery.setVisible(false)
  void hero.load().then(() => story?.load()).then(() => gallery?.load())

  const onScroll = () => {
    const el = storyEl.value
    if (!el) return
    const h = window.innerHeight || 1
    const p = Math.max(0, Math.min(BEATS - 1, (window.scrollY - el.offsetTop) / h))
    story?.setProgress(p)
    pinned.value = window.scrollY >= el.offsetTop - h * 0.5 && window.scrollY < el.offsetTop + el.offsetHeight - h - 8
    const b = Math.min(BEATS - 1, Math.floor(p + 0.5))
    if (b !== beat.value) {
      beat.value = b
      // Arriving at the material beat shows a change without asking for a click.
      if (b === 1 && !userPicked) setPreset('gold', false)
    }
  }
  const onPointer = (e: PointerEvent) => {
    if (reduced) return
    const x = (e.clientX / window.innerWidth) * 2 - 1
    const y = -((e.clientY / window.innerHeight) * 2 - 1)
    hero?.setPointer(x, y)
    story?.setPointer(x, y)
    gallery?.setPointer(x, y)
  }
  const onResize = () => {
    hero?.resize()
    story?.resize()
    gallery?.resize()
    onScroll()
  }
  const io = new IntersectionObserver((entries) => {
    const on = document.visibilityState === 'visible'
    for (const en of entries) {
      if (en.target === heroEl.value) hero?.setVisible(en.isIntersecting && on)
      if (en.target === storyEl.value) story?.setVisible(en.isIntersecting && on)
      if (en.target === galleryEl.value) gallery?.setVisible(en.isIntersecting && on)
    }
  }, { rootMargin: '10% 0px' })
  io.observe(heroEl.value!)
  io.observe(storyEl.value!)
  io.observe(galleryEl.value!)
  const onVisibility = () => {
    const on = document.visibilityState === 'visible'
    hero?.setVisible(on)
    story?.setVisible(on)
    gallery?.setVisible(on)
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('pointermove', onPointer, { passive: true })
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)
  onScroll()

  const tracked = [...icons, ...products].map(s => s.id)
  const tick = () => {
    raf = requestAnimationFrame(tick)
    if (!gallery) return
    for (const id of tracked) {
      const p = gallery.project(id)
      if (p && p.z < 1) anchors[id] = { x: p.x, y: p.y }
    }
  }
  tick()

  cleanup = () => {
    cancelAnimationFrame(raf)
    io.disconnect()
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('pointermove', onPointer)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('visibilitychange', onVisibility)
    hero?.dispose()
    story?.dispose()
    gallery?.dispose()
    hero = story = gallery = null
  }
})
</script>

<template>
  <div class="landing">
    <!-- Hero: the object alone, then the headline. One screen, nothing else. -->
    <section
      ref="heroEl"
      class="relative h-svh min-h-[640px] overflow-hidden"
      aria-label="Vitrum"
    >
      <canvas
        ref="heroCanvas"
        class="absolute inset-0 block size-full"
        aria-hidden="true"
      />
      <div class="relative flex h-full flex-col items-center justify-end px-6 pb-[max(2rem,6svh)] text-center">
        <h1 class="font-display max-w-[12ch] text-[clamp(40px,6vw,84px)] leading-[0.96] text-foreground">
          Any image, made solid.
        </h1>
        <p class="mt-5 max-w-[44ch] text-[15px] leading-[1.55] text-ink-2 md:text-[17px]">
          Drop a logo, an icon or a product photo. Vitrum traces it and builds a real object in glass, metal or its own colours, sized in millimetres, ready to orbit and export.
        </p>
        <div class="mt-7 flex flex-wrap justify-center gap-2">
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
          {{ ready ? 'This object was built in your browser just now.' : 'Building this object in your browser…' }}
        </p>
      </div>
      <button
        type="button"
        class="absolute right-6 bottom-[max(1.25rem,env(safe-area-inset-bottom))] hidden items-center gap-2 rounded-full px-2 py-1 text-[12px] text-ink-3 transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none md:flex"
        @click="scrollToStory"
      >
        How it works
        <Icon
          name="chevron"
          :size="14"
        />
      </button>
    </section>

    <!-- Story: pinned for three beats. The mark turns on the right; copy changes on the left. -->
    <section
      ref="storyEl"
      class="story relative"
      :style="{ height: `${BEATS * 100}svh` }"
      aria-label="How Vitrum works"
    >
      <div class="sticky top-0 h-svh overflow-hidden">
        <canvas
          ref="storyCanvas"
          class="absolute inset-0 block size-full"
          aria-hidden="true"
        />
        <div class="relative mx-auto flex h-full w-full max-w-[1200px] items-end px-6 pb-[10svh] md:items-center md:pb-0">
          <div class="relative h-[50svh] w-full max-w-[560px] md:h-[420px]">
            <!-- Beat 0: trace + build -->
            <div
              class="beat"
              :class="{ 'is-active': beat === 0 }"
              :aria-hidden="beat !== 0"
            >
              <p class="index text-ink-3">01 / 03</p>
              <h2 class="font-display mt-3 max-w-[12ch] text-[clamp(34px,4.6vw,60px)] leading-[1] text-foreground">
                Traced to the pixel, built in millimetres.
              </h2>
              <p class="mt-5 max-w-[40ch] text-[14px] leading-[1.55] text-ink-2 md:text-[15px]">
                The outline is found at up to 2048 px, holes kept, sharp tips rounded, and extruded with a bevel that follows the stroke width. What you see is the real mesh you will export.
              </p>
              <dl class="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] text-ink-2 tabular-nums">
                <div class="flex items-baseline gap-2"><dt class="index text-ink-3">W</dt><dd>120.0 mm</dd></div>
                <div class="flex items-baseline gap-2"><dt class="index text-ink-3">D</dt><dd>14.4 mm</dd></div>
                <div class="flex items-baseline gap-2"><dt class="index text-ink-3">Shapes</dt><dd>2</dd></div>
                <div class="flex items-baseline gap-2"><dt class="index text-ink-3">Edge</dt><dd>3.0 mm radius</dd></div>
              </dl>
            </div>

            <!-- Beat 1: material -->
            <div
              class="beat"
              :class="{ 'is-active': beat === 1 }"
              :aria-hidden="beat !== 1"
            >
              <p class="index text-ink-3">02 / 03</p>
              <h2 class="font-display mt-3 max-w-[12ch] text-[clamp(34px,4.6vw,60px)] leading-[1] text-foreground">
                Pick the material. Watch it turn.
              </h2>
              <p class="mt-5 max-w-[40ch] text-[14px] leading-[1.55] text-ink-2 md:text-[15px]">
                Refraction, dispersion, tint depth and rim colour for glass. Roughness, lacquer and colour for metal and ceramic. Now showing {{ presetLabel }}.
              </p>
              <div
                class="mt-6 flex max-w-[520px] flex-wrap gap-1.5"
                role="radiogroup"
                aria-label="Material"
              >
                <button
                  v-for="p in materialPresets"
                  :key="p.id"
                  type="button"
                  role="radio"
                  :aria-checked="preset === p.id"
                  :tabindex="beat === 1 ? 0 : -1"
                  class="flex h-8 items-center gap-2 rounded-full bg-card/85 pr-3 pl-1.5 text-[12px] font-medium text-ink-2 backdrop-blur transition-[box-shadow,color] duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none"
                  :class="preset === p.id ? 'text-foreground shadow-[var(--shadow-raise-dark)] ring-1 ring-ink/80' : 'shadow-[var(--shadow-raise)]'"
                  @click="setPreset(p.id)"
                >
                  <span
                    class="size-5 rounded-full shadow-[inset_0_0_0_1px_rgba(13,14,18,0.12)]"
                    :style="{ background: p.swatch }"
                  />
                  {{ p.label }}
                </button>
              </div>
            </div>

            <!-- Beat 2: export -->
            <div
              class="beat"
              :class="{ 'is-active': beat === 2 }"
              :aria-hidden="beat !== 2"
            >
              <p class="index text-ink-3">03 / 03</p>
              <h2 class="font-display mt-3 max-w-[12ch] text-[clamp(34px,4.6vw,60px)] leading-[1] text-foreground">
                Export it, true to size.
              </h2>
              <p class="mt-5 max-w-[40ch] text-[14px] leading-[1.55] text-ink-2 md:text-[15px]">
                GLB carries the glass, metal or colour for the web and AR. Binary STL in millimetres goes straight to a printer. PNG renders the current view at twice the screen.
              </p>
              <ul class="mt-6 flex flex-wrap gap-1.5">
                <li
                  v-for="f in ['GLB', 'STL', 'PNG']"
                  :key="f"
                  class="flex h-8 items-center gap-2 rounded-full bg-card px-3 font-mono text-[12px] text-foreground shadow-[var(--shadow-raise)]"
                >
                  <Icon
                    :name="f === 'PNG' ? 'camera' : f === 'STL' ? 'layers' : 'download'"
                    :size="13"
                  />
                  {{ f }}
                </li>
              </ul>
              <div class="mt-8">
                <Button
                  as-child
                  size="lg"
                  class="h-11 px-5 text-[13.5px]"
                >
                  <NuxtLink
                    to="/studio/icon"
                    :tabindex="beat === 2 ? 0 : -1"
                  >
                    Open the studio
                  </NuxtLink>
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- Beat rail: where you are in the story. -->
        <ol
          class="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 items-center gap-2 transition-opacity duration-200 md:left-6 md:translate-x-0"
          :class="pinned ? 'opacity-100' : 'opacity-0'"
          aria-hidden="true"
        >
          <li
            v-for="i in BEATS"
            :key="i"
            class="h-1 rounded-full transition-[width,background-color] duration-300 ease-out"
            :class="beat === i - 1 ? 'w-6 bg-ink' : 'w-2 bg-ink-3/40'"
          />
        </ol>
      </div>
    </section>

    <!-- Gallery: built objects, free scrolling. -->
    <section
      ref="galleryEl"
      class="relative z-10 px-6 pt-[14svh] pb-[6svh]"
    >
      <div class="mx-auto w-full max-w-[1200px]">
        <div class="grid gap-6 md:grid-cols-2 md:gap-16">
          <h2 class="font-display max-w-[14ch] text-[clamp(32px,4.2vw,54px)] leading-[1] text-foreground">
            Icons become objects. Products keep their colours.
          </h2>
          <p class="max-w-[44ch] self-end text-[14px] leading-[1.55] text-ink-2 md:text-[15px]">
            Six flat marks, six finishes, no modelling. Below them, two illustrated products inflated into rounded volumes: the silhouette becomes a body, the picture's shading presses into the surface, and every colour stays.
          </p>
        </div>
        <!-- The pane keeps a fixed 3:2 frame on wide screens so both rows and their captions fit. -->
        <div class="relative mt-10 aspect-[3/2] max-h-[820px] min-h-[560px] w-full overflow-hidden rounded-[28px] shadow-[var(--shadow-pane)] max-md:aspect-[4/5]">
          <canvas
            ref="galleryCanvas"
            class="absolute inset-0 block size-full"
            aria-hidden="true"
          />
          <span
            v-for="s in [...icons, ...products]"
            :key="s.id"
            class="pointer-events-none absolute flex -translate-x-1/2 flex-col items-center gap-2 transition-opacity duration-500"
            :class="placed.has(s.id) && anchors[s.id] ? 'opacity-100' : 'opacity-0'"
            :style="anchors[s.id] ? { left: `${anchors[s.id]!.x}px`, top: `calc(${anchors[s.id]!.y}px + ${s.kind === 'product' ? 'clamp(76px, 9vw, 112px)' : 'clamp(52px, 5.5vw, 72px)'})` } : undefined"
          >
            <img
              :src="thumbs[s.id]"
              alt=""
              class="rounded-[10px] bg-card object-contain p-1 shadow-[var(--shadow-raise)]"
              :class="s.kind === 'product' ? 'size-11' : 'size-9'"
              draggable="false"
            >
            <span class="text-[11.5px] text-ink-2">{{ s.label }}</span>
          </span>
        </div>
      </div>
    </section>

    <!-- Steps + call to action -->
    <section class="relative z-10 px-6 pt-[10svh] pb-[8svh]">
      <div class="mx-auto w-full max-w-[1200px]">
        <div class="grid gap-10 md:grid-cols-[1fr_1fr] md:gap-16">
          <h2 class="font-display max-w-[14ch] text-[clamp(30px,3.8vw,48px)] leading-[1.02] text-foreground">
            Three steps, all of them in your browser.
          </h2>
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
            <p class="font-display text-[clamp(26px,3.2vw,38px)] leading-[1.05] text-foreground">Open the studio with your own image.</p>
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
  background: var(--shell);
}
/* Beats stack in one slot; the active one is shown, the rest are inert. Entering rises a little
   and fades in (ease-out); leaving fades faster. Transform and opacity only. */
.beat {
  position: absolute;
  inset: 0;
  opacity: 0;
  transform: translateY(14px);
  pointer-events: none;
  transition:
    opacity 220ms cubic-bezier(0.215, 0.61, 0.355, 1),
    transform 220ms cubic-bezier(0.215, 0.61, 0.355, 1);
}
.beat.is-active {
  opacity: 1;
  transform: none;
  pointer-events: auto;
  transition-duration: 320ms;
  transition-delay: 120ms;
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
@media (prefers-reduced-motion: reduce) {
  .beat, .beat.is-active { transition: none; }
}
</style>
