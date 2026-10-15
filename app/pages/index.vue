<script setup lang="ts">
import { useElementBounding, useEventListener } from '@vueuse/core'
import { LANDING_EXAMPLES, LANDING_FAQS, landingLooks } from '~/data/landing'
import { LOGOS } from '~/utils/logos'
import { HERO_FINISH } from '~/utils/samples'
import { MATERIAL_PRESETS } from '~/utils/presets'

const route = useRoute()
const siteUrl = useRuntimeConfig().public.siteUrl
const socialImage = siteUrl ? new URL('/images/vitrum-social.png', siteUrl).href : '/images/vitrum-social.png'
const looks = landingLooks()
// A gallery caption's finish dot: the studio swatch's lighting, without the large sphere's shading.
function exampleSwatch(id: string) {
  const p = MATERIAL_PRESETS.find(m => m.id === id)
  return p ? { background: presetSphere(p).background, boxShadow: 'inset 0 0 0 1px rgba(38,40,46,.16), 0 1px 1px rgba(38,40,46,.08)' } : undefined
}
const preset = ref<string>(HERO_FINISH)
const live = ref(false)
// Where the hero copy ends, so the 3D marks on narrow screens settle in the room beneath it.
const hero = useTemplateRef('hero')
const heroActions = useTemplateRef('heroActions')
const { top: heroTop } = useElementBounding(hero)
const { bottom: actionsBottom } = useElementBounding(heroActions)
const heroClear = computed(() => Math.max(0, actionsBottom.value - heroTop.value))
const paused = ref(false)
const { status: shareStatus, fallbackUrl: shareUrl, share } = useShare()

const title = 'Vitrum — Custom 3D icons from any logo'
useSeoMeta({
  title,
  description: 'Turn an SVG or PNG logo into a 3D icon in glass, metal or colour. Export a PNG, a GLB for three.js or an STL for print. Free, in your browser, no sign-up.',
  ogTitle: title,
  ogDescription: 'Drop in an SVG, pick a finish, export PNG, GLB or STL. No Blender required.',
  ogType: 'website',
  ogImage: socialImage,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: 'Glass and metal 3D icons made with Vitrum.',
  twitterCard: 'summary_large_image',
  twitterTitle: title,
  twitterDescription: 'SVG in, glass and metal 3D icons out. PNG, GLB and STL export, right in your browser.',
  twitterImage: socialImage,
})

function restoreFinish(value: unknown) {
  preset.value = typeof value === 'string' && looks.some(look => look.id === value) ? value : HERO_FINISH
}

// Nuxt restores a prerendered page's query after suspense resolves, later than mounted.
// Read the final URL once that restoration has completed; keep later navigations reactive.
onNuxtReady(() => restoreFinish(new URLSearchParams(window.location.search).get('finish')))
watch(() => route.query.finish, restoreFinish)
// Keep the address shareable: the current finish rides along in `?finish=` without a navigation.
watch(preset, (value) => {
  if (!import.meta.client) return
  const url = new URL(window.location.href)
  if (value === HERO_FINISH) url.searchParams.delete('finish')
  else url.searchParams.set('finish', value)
  history.replaceState(history.state, '', url)
})

// R toggles auto-rotate, same as in the studio.
useEventListener('keydown', (e: KeyboardEvent) => {
  if (isEditableTarget(e.target)) return
  if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'r' || !live.value) return
  paused.value = !paused.value
})

function shareLook() {
  const url = new URL('/', window.location.origin)
  url.searchParams.set('finish', preset.value)
  void share({ title: 'Vitrum', text: 'Custom 3D icons from any logo, made in the browser.', url: url.href })
}

// The cursor's light. Position is written straight to the element once a frame; a long CSS
// transition on transform gives it its lag, so it glides on the compositor, not in Vue.
const glint = useTemplateRef('glint')
const glintOn = ref(false)
let glintFrame = 0
let glintAt = { x: 0, y: 0 }
function moveGlint(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  const host = glint.value?.parentElement
  if (!host) return
  const rect = host.getBoundingClientRect()
  glintAt = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  glintOn.value = true
  if (glintFrame) return
  glintFrame = requestAnimationFrame(() => {
    glintFrame = 0
    glint.value?.style.setProperty('transform', `translate3d(${glintAt.x - 280}px, ${glintAt.y - 280}px, 0)`)
  })
}
onBeforeUnmount(() => cancelAnimationFrame(glintFrame))

/* Classes shared by the hero and closing call-to-action rows. */
const actions = 'flex flex-wrap items-center gap-3 max-2xs:w-full'
const action = 'max-2xs:flex-[1_1_100%]'
/* A hero headline line: the ink fades toward the bottom of the two-line block. The padding,
   cancelled by the margin, gives the clip room for ascenders and descenders past the tight line box. */
const heroLine = 'block animate-rise bg-[linear-gradient(180deg,var(--ink)_35%,color-mix(in_srgb,var(--ink)_62%,transparent))] bg-[length:100%_200%] bg-clip-text py-[0.12em] -my-[0.12em] text-transparent'
/* Gallery prints: the export tiles' soft pane; on hover its shadow deepens a touch. */
const printPane = 'bg-[linear-gradient(180deg,color-mix(in_oklab,var(--shell)_55%,white)_0%,var(--shell)_70%)] shadow-[inset_0_0_0_1px_rgba(38,40,46,.05),inset_0_1px_0_rgba(255,255,255,.9),0_1px_2px_rgba(38,40,46,.03),0_16px_36px_-24px_rgba(38,40,46,.16)] transition-shadow duration-500 ease-out group-hover:shadow-[inset_0_0_0_1px_rgba(38,40,46,.06),inset_0_1px_0_rgba(255,255,255,.9),0_1px_2px_rgba(38,40,46,.04),0_22px_44px_-24px_rgba(38,40,46,.24)]'
/* The print's "Remix" chip rises on hover or keyboard focus; under reduced motion it only fades. */
const remixChip = 'origin-bottom-right translate-y-1 scale-[.96] opacity-0 blur-[3px] transition-[opacity,filter,translate,scale] duration-[220ms,220ms,320ms,320ms] ease-out group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-hover:blur-[0px] group-focus-visible:translate-y-0 group-focus-visible:scale-100 group-focus-visible:opacity-100 group-focus-visible:blur-[0px] motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:blur-[0px] motion-reduce:transition-opacity'
</script>

<template>
  <!--
    Spacing: one section rhythm (--section), one card inset (8px, so inner radii are the outer
    radius minus 8), one heading-to-content gap. Each section has its own form so the page doesn't
    repeat itself: a stage, one drawing, a gallery, one panel, a plain list.
  -->
  <main
    id="main-content"
    class="relative overflow-clip bg-shell text-ink [--section:clamp(128px,13vw,200px)]"
  >
    <!-- Light through glass: two pools of azure drift slowly behind the hero, and a third trails
         the cursor, as if the icons below were refracting the lamp onto the table. -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[1200px]"
      aria-hidden="true"
    >
      <span class="aura-a absolute top-[60px] left-[calc(50%-760px)] size-[720px] will-change-transform rounded-full bg-[radial-gradient(closest-side,rgba(91,158,244,.2),rgba(91,158,244,.07)_55%,rgba(91,158,244,0))]" />
      <span class="aura-b absolute top-[300px] left-[calc(50%+60px)] size-[680px] will-change-transform rounded-full bg-[radial-gradient(closest-side,rgba(42,114,224,.13),rgba(42,114,224,.04)_55%,rgba(42,114,224,0))]" />
      <span
        ref="glint"
        class="absolute top-0 left-0 size-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(91,158,244,.16),rgba(91,158,244,.05)_50%,rgba(91,158,244,0))] [transform:translate3d(50vw,360px,0)] transition-[transform,opacity] duration-[1100ms,600ms] ease-[var(--ease-out),ease] will-change-transform motion-reduce:hidden hover-none:hidden"
        :class="glintOn ? 'opacity-100' : 'opacity-0'"
      />
    </div>
    <!-- The lamp over the table: one soft overhead light the hero sits under. -->
    <span
      class="pointer-events-none absolute top-[-320px] left-1/2 z-[1] h-[1040px] w-[min(1400px,140vw)] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--graphite-0),color-mix(in_srgb,var(--graphite-0)_40%,transparent)_45%,transparent_75%)]"
      aria-hidden="true"
    />

    <!-- One screen tall on every device. The 3D set is full-bleed behind the copy and arranges
         itself around it: on wide screens the marks hold the headline between them, on narrow
         ones they gather underneath. -->
    <section
      ref="hero"
      class="relative h-svh min-h-[660px] max-tab:min-h-[720px]"
      aria-labelledby="hero-title"
      @pointermove="moveGlint"
      @pointerleave="glintOn = false"
    >
      <HeroStudio
        class="z-0"
        :preset="preset"
        :paused="paused"
        :clear="heroClear"
        @ready="live = true"
        @unavailable="live = false"
      />

      <div class="frame pointer-events-none relative z-[2] flex h-full flex-col items-center justify-center pb-[13svh] text-center max-tab:justify-start max-tab:pt-[124px] max-tab:pb-0">
        <p class="mb-7 flex animate-rise items-center gap-2.5 text-[15px] text-ink-2 max-tab:mb-6">
          <LiveDot
            on
            pulse
          />
          Free, and nothing leaves your browser
        </p>
        <!-- Each line clips its own half of one two-line gradient. Clipping on the h1 instead would
             leave the lines invisible in Safari: their rise animation lifts them onto their own
             layers, which the parent's text clip never reaches. -->
        <h1
          id="hero-title"
          class="heading-hero flex flex-col pb-[0.08em] max-2xs:text-[38px]"
        >
          <span :class="[heroLine, 'animation-delay-60 bg-top']">Custom 3D icons</span>
          <span :class="[heroLine, 'animation-delay-120 bg-bottom']">from any logo.</span>
        </h1>
        <p class="mt-6 max-w-[46ch] animate-rise text-lead text-balance animation-delay-180 max-2xs:text-[17px]">
          Drop in an SVG or PNG and get it back in glass, metal or colour. Export a PNG for your designs, a GLB for three.js or an STL for print.
        </p>
        <div
          ref="heroActions"
          class="pointer-events-auto mt-9 animate-rise justify-center animation-delay-240"
          :class="actions"
        >
          <SiteButton
            to="/studio"
            icon="arrow-up-right"
            tile
            :class="action"
          >
            Make a 3D icon
          </SiteButton>
          <SiteButton
            href="#features"
            variant="plain"
            :class="action"
          >
            See how it works
          </SiteButton>
        </div>
      </div>

      <!-- Docked on the screen's lower edge once the scene is live: before that there is nothing to re-finish. -->
      <div class="absolute inset-x-0 bottom-[max(28px,env(safe-area-inset-bottom))] z-[2] flex h-12 justify-center max-phone:bottom-[max(20px,env(safe-area-inset-bottom))]">
        <Transition
          enter-active-class="transition-[opacity,translate] duration-[420ms] ease-out"
          enter-from-class="translate-y-2 opacity-0 motion-reduce:translate-y-0"
        >
          <HeroFinishBar
            v-if="live"
            v-model="preset"
            :looks="looks"
          />
        </Transition>
      </div>
    </section>

    <nav
      class="frame relative z-[2] mt-14 flex items-center justify-center gap-5 max-tab:mt-10 max-tab:flex-col max-tab:gap-4"
      aria-label="Open a brand logo in the studio"
    >
      <p class="text-[15px] whitespace-nowrap text-ink-3">
        Try it on a logo you know
      </p>
      <ul class="flex flex-wrap justify-center gap-1">
        <li
          v-for="logo in LOGOS"
          :key="logo.id"
        >
          <NuxtLink
            :to="{ path: '/studio', query: { sample: logo.id } }"
            :aria-label="`Open the ${logo.name} logo in the studio`"
            :title="logo.name"
            class="grid size-10 place-items-center rounded-full text-ink-3 press focus-ring [--press:.92] [--ring-offset:2px] hover:bg-well-strong hover:text-ink max-phone:size-9"
          >
            <LogoMark
              :id="logo.id"
              :size="17"
              mono
            />
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <section
      id="features"
      class="frame scroll-mt-24 pt-(--section)"
      aria-labelledby="features-title"
    >
      <SectionHeading
        id="features-title"
        title="From flat SVG to finished 3D asset"
        text="Everything you need to ship custom 3D icons for a site, an app or a deck, without opening a 3D tool."
      />

      <!-- Below the fold: server-rendered as usual, hydrated (and its JS fetched) once scrolled to. -->
      <LazyIsoPipeline hydrate-on-visible />
    </section>

    <section
      id="examples"
      class="frame scroll-mt-24 pt-(--section)"
      aria-labelledby="examples-title"
    >
      <SectionHeading
        id="examples-title"
        title="Made from logos you know"
        text="Each render came straight out of the studio at its default settings. Open one to remix it, or drop in your own mark."
      />
      <!-- A quiet row of prints: six even frames, each mark small with room around it, captioned
           with its name and a swatch of its finish. It wraps to three, then two, on narrower screens. -->
      <ul class="grid grid-cols-6 gap-x-4 gap-y-8 max-desk:grid-cols-3 max-desk:gap-x-5 max-desk:gap-y-10 max-fold:grid-cols-2 max-fold:gap-x-4">
        <li
          v-for="example in LANDING_EXAMPLES"
          :key="example.id"
        >
          <NuxtLink
            :to="{ path: '/studio', query: { sample: example.id, finish: example.preset } }"
            class="group flex flex-col gap-3.5 rounded-[20px] press focus-ring [--press:.98] [--ring-offset:6px] max-tab:gap-3"
            :aria-label="`Open the ${example.name} example in ${example.finish.toLowerCase()} in the studio`"
          >
            <span
              class="relative block aspect-square overflow-hidden rounded-[20px]"
              :class="printPane"
            >
              <img
                :src="`/images/${example.image}.webp`"
                :alt="`${example.name} logo rendered in 3D, ${example.finish.toLowerCase()}`"
                width="1024"
                height="1024"
                loading="lazy"
                decoding="async"
                class="absolute inset-0 block size-full scale-[.76] object-cover [mask-image:radial-gradient(closest-side,#000_74%,transparent)] transition-[scale] duration-[1100ms] ease-out group-hover:scale-[.79] motion-reduce:transition-none"
              >
              <!-- Rises on hover or keyboard focus: what the click does. -->
              <span
                class="absolute right-2.5 bottom-2.5 flex h-7 items-center gap-1.5 rounded-full bg-surface/90 pr-[3px] pl-2.5 text-[12.5px] font-medium tracking-[-0.005em] text-ink shadow-[0_0_0_1px_rgba(38,40,46,.05),0_6px_16px_-6px_rgba(38,40,46,.22)] backdrop-blur-md"
                :class="remixChip"
                aria-hidden="true"
              >
                Remix
                <span class="grid size-[22px] shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Icon
                    name="arrow-up-right"
                    :size="12"
                  />
                </span>
              </span>
            </span>
            <span class="flex min-w-0 flex-col gap-1 px-1">
              <strong class="truncate text-[15px] font-medium tracking-[-0.012em] text-ink">{{ example.name }}</strong>
              <small class="flex min-w-0 items-center gap-1.5 text-[13.5px] text-ink-3">
                <span
                  class="size-[11px] shrink-0 rounded-full"
                  :style="exampleSwatch(example.preset)"
                />
                <span class="truncate">{{ example.finish }}</span>
              </small>
            </span>
          </NuxtLink>
        </li>
      </ul>
      <p class="mt-10 max-w-[70ch] text-[14px] leading-[1.55] text-ink-3">
        Logos belong to their owners and appear only to show what Vitrum can do. Vitrum isn’t affiliated with these brands.
      </p>
    </section>

    <section
      id="export"
      class="frame scroll-mt-24 pt-(--section)"
      aria-labelledby="export-title"
    >
      <SectionHeading
        id="export-title"
        title="One icon, three files"
        text="Each export is made for where it goes next: a flat image for your designs, a model for the web, a mesh for the printer."
      />
      <LazyExportFormats hydrate-on-visible />
    </section>

    <!-- The closing panel: copy beside one render, on a white pane. -->
    <section
      class="frame pt-(--section)"
      aria-labelledby="closing-title"
    >
      <div class="grid min-h-[480px] grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] overflow-hidden rounded-window bg-slab p-2 shadow-pane max-tab:grid-cols-1">
        <div class="flex flex-col items-start justify-center p-16 max-desk:px-10 max-desk:py-12 max-tab:px-6 max-tab:pt-10 max-tab:pb-8">
          <h2
            id="closing-title"
            class="heading-section max-w-[13ch]"
          >
            Your next icon set is a minute away.
          </h2>
          <p class="mt-6 max-w-[40ch] text-lead">
            Drop in your SVG, pick a finish, export.
          </p>
          <div
            class="mt-10 justify-start"
            :class="actions"
          >
            <SiteButton
              to="/studio"
              icon="arrow-up-right"
              tile
              :class="action"
            >
              Make a 3D icon
            </SiteButton>
            <SiteButton
              variant="plain"
              :class="action"
              @click="shareLook"
            >
              <Icon
                name="share"
                :size="15"
              /> Share Vitrum
            </SiteButton>
          </div>
          <p
            v-if="shareStatus"
            class="mt-3 text-[15px] text-ink-2"
            role="status"
          >
            {{ shareStatus }}
          </p>
          <label
            v-if="shareUrl"
            class="mt-3 block w-full text-[15px]"
          >Share this link<input
            :value="shareUrl"
            readonly
            class="mt-1.5 block w-full rounded-[12px] bg-surface p-2.5 shadow-raise focus-ring [--ring-offset:3px]"
            @focus="($event.target as HTMLInputElement).select()"
          ></label>
        </div>
        <!-- An icon set, literally: four marks from one session, one finish each. -->
        <ul
          class="grid min-h-[320px] grid-cols-2 gap-2 max-tab:-order-1 max-tab:min-h-0"
          aria-hidden="true"
        >
          <li
            v-for="img in ['camera-frosted', 'spark-silver', 'heart-ceramic', 'chat-milk']"
            :key="img"
            class="relative aspect-square overflow-hidden rounded-[12px] bg-shell"
          >
            <img
              :src="`/images/set/${img}.webp`"
              width="1024"
              height="1024"
              alt=""
              loading="lazy"
              decoding="async"
              class="absolute inset-0 size-full object-cover"
            >
            <span class="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(38,40,46,.05),inset_0_1px_0_rgba(255,255,255,.85)]" />
          </li>
        </ul>
      </div>
    </section>

    <!-- A plain list on the table, divided by hairlines. -->
    <section
      id="questions"
      class="frame grid scroll-mt-24 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-20 pt-(--section) pb-[calc(var(--section)*.75)] max-desk:gap-12 max-tab:grid-cols-1 max-tab:gap-10"
      aria-labelledby="faq-title"
    >
      <div>
        <h2
          id="faq-title"
          class="heading-section"
        >
          Questions
        </h2>
        <p class="mt-6 max-w-[32ch] text-lead max-tab:hidden">
          The short answers. The studio explains the rest as you go.
        </p>
      </div>
      <div class="border-t border-hairline-strong">
        <details
          v-for="faq in LANDING_FAQS"
          :key="faq.question"
          class="faq group border-b border-hairline-strong"
        >
          <summary class="flex min-h-[80px] cursor-pointer list-none items-center justify-between gap-6 py-5 text-[18px] font-medium tracking-[-0.018em] text-ink focus-ring [--ring-offset:-2px] focus-visible:rounded-[6px] [&::-webkit-details-marker]:hidden">
            {{ faq.question }}
            <span class="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 shadow-[inset_0_0_0_1px_var(--hairline-strong)] transition-[rotate,background-color,color,box-shadow] duration-[380ms,200ms,200ms,200ms] ease-[var(--ease-spring),ease,ease,ease] group-open:rotate-45 group-open:bg-ink group-open:text-shell group-open:shadow-none group-hover:text-ink motion-reduce:transition-none">
              <Icon
                name="plus"
                :size="15"
              />
            </span>
          </summary>
          <p class="max-w-[60ch] pr-14 pb-8 text-[17px] leading-[1.65] text-ink-2 max-tab:pr-0">
            {{ faq.answer }}
          </p>
        </details>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* Slow, out-of-phase drifts: two lights that never line up the same way twice in a minute. */
.aura-a { animation: aura-a 19s ease-in-out infinite alternate; }
.aura-b { animation: aura-b 23s ease-in-out -6s infinite alternate; }
@keyframes aura-a {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to { transform: translate3d(90px, 60px, 0) scale(1.12); }
}
@keyframes aura-b {
  from { transform: translate3d(0, 0, 0) scale(1.08); }
  to { transform: translate3d(-110px, -40px, 0) scale(0.94); }
}
@media (prefers-reduced-motion: reduce) {
  .aura-a, .aura-b { animation: none; }
}
</style>
