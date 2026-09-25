<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { LANDING_EXAMPLES, LANDING_FAQS, landingLooks } from '~/data/landing'
import { LOGOS } from '~/utils/logos'
import { MATERIAL_PRESETS } from '~/utils/presets'

const route = useRoute()
const siteUrl = useRuntimeConfig().public.siteUrl
const socialImage = siteUrl ? new URL('/images/vitrum-social.png', siteUrl).href : '/images/vitrum-social.png'
const looks = landingLooks()
const preset = ref('sapphire')
const live = ref(false)
const unavailable = ref(false)
const paused = ref(false)
const { status: shareStatus, fallbackUrl: shareUrl, share, reset: resetShare } = useShare()

useSeoMeta({
  title: 'Vitrum — Custom 3D icons from any logo',
  description: 'Turn an SVG or PNG logo into a 3D icon in glass, metal or colour. Export a PNG, a GLB for three.js or an STL for print. Free, in your browser, no sign-up.',
  ogTitle: 'Vitrum — Custom 3D icons from any logo',
  ogDescription: 'Drop in an SVG, pick a finish, export PNG, GLB or STL. No Blender required.',
  ogType: 'website',
  ogImage: socialImage,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: 'Glass and metal 3D icons made with Vitrum.',
  twitterCard: 'summary_large_image',
  twitterTitle: 'Vitrum — Custom 3D icons from any logo',
  twitterDescription: 'SVG in, glass and metal 3D icons out. PNG, GLB and STL export, right in your browser.',
  twitterImage: socialImage,
})

function selectLook(id: string) {
  preset.value = id
  resetShare()
}

function restoreFinish(value: unknown) {
  preset.value = typeof value === 'string' && looks.some(look => look.id === value) ? value : 'sapphire'
}

// Nuxt restores a prerendered page's query after suspense resolves, later than mounted.
// Read the final URL once that restoration has completed; keep later navigations reactive.
onNuxtReady(() => restoreFinish(new URLSearchParams(window.location.search).get('finish')))
watch(() => route.query.finish, restoreFinish)

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

/* Classes shared by the hero and closing call-to-action rows. */
const actions = 'flex flex-wrap items-center gap-2.5 max-2xs:w-full'
const action = 'max-2xs:flex-[1_1_100%]'
</script>

<template>
  <!--
    Spacing: one section rhythm (--section), one card inset (6px, so inner radii are the outer
    radius minus 6), and one text inset shared by feature cards and example cards so their copy
    lines up across the page.
  -->
  <main
    id="main-content"
    class="overflow-clip bg-shell text-ink [--gap:14px] [--section:clamp(80px,11vw,144px)] max-tab:[--gap:12px]"
  >
    <section
      class="frame pt-[132px] text-center max-tab:pt-28"
      aria-labelledby="hero-title"
    >
      <!-- The hero copy and window share one entrance, copy first. -->
      <div class="flex flex-col items-center">
        <h1
          id="hero-title"
          class="heading-hero max-2xs:text-[38px]"
        >
          <span class="block animate-rise motion-reduce:animate-none">Custom 3D icons</span>
          <span class="block animate-rise animation-delay-70 motion-reduce:animate-none">from any logo.</span>
        </h1>
        <p class="mt-6 max-w-[58ch] animate-rise text-[17px] leading-[1.55] tracking-[-0.012em] text-balance text-ink-2 animation-delay-140 motion-reduce:animate-none max-tab:text-[16px] max-2xs:text-[15px]">
          Drop in an SVG or PNG and get it back in glass, metal or colour. Export a PNG for your designs, a GLB for three.js or an STL for print. No Blender required.
        </p>
        <div
          class="mt-[30px] animate-rise justify-center animation-delay-200 motion-reduce:animate-none"
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
        <p class="mt-4 animate-rise text-[12.5px] text-ink-3 animation-delay-260 motion-reduce:animate-none">
          Free, no sign-up. Your files never leave the browser.
        </p>
      </div>

      <div class="mt-14 max-tab:mt-10">
        <HeroStudio
          :preset="preset"
          :looks="looks"
          :paused="paused"
          :live="live"
          :unavailable="unavailable"
          @select="selectLook"
          @toggle="paused = !paused"
          @ready="live = true"
          @unavailable="unavailable = true; live = false"
        />
      </div>

      <!-- Text sits on the frame edge; the last glyph does too (its 44px hit area overhangs by 11px). -->
      <nav
        class="mt-6 flex items-center justify-between gap-6 max-tab:flex-col max-tab:gap-2"
        aria-label="Open a brand logo in the studio"
      >
        <p class="text-[13px] whitespace-nowrap text-ink-2">
          Try it on a logo you know
        </p>
        <ul class="-mr-[11px] flex flex-wrap justify-end gap-1 max-tab:mr-0 max-tab:justify-center">
          <li
            v-for="logo in LOGOS"
            :key="logo.id"
          >
            <NuxtLink
              :to="{ path: '/studio', query: { sample: logo.id } }"
              :aria-label="`Open the ${logo.name} logo in the studio`"
              :title="logo.name"
              class="grid size-11 place-items-center rounded-[12px] text-ink-3 transition-colors duration-150 ease-[ease] focus-ring [--ring-offset:3px] hover:bg-surface hover:text-ink hover:shadow-raise motion-reduce:transition-none max-phone:size-10"
            >
              <LogoMark
                :id="logo.id"
                :size="22"
                mono
              />
            </NuxtLink>
          </li>
        </ul>
      </nav>
    </section>

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

      <div class="grid grid-flow-dense grid-cols-3 gap-(--gap) max-desk:grid-cols-2 max-fold:grid-cols-1">
        <FeatureCard
          v-slot="{ running, seen }"
          title="Reads any SVG or PNG"
          text="Logos, icons, wordmarks. Vitrum finds every shape, keeps the holes and ignores stray pixels, so you never redraw a path."
          tone="ice"
        >
          <FeatTrace
            :running="running"
            :seen="seen"
          />
        </FeatureCard>
        <FeatureCard
          v-slot="{ running, seen }"
          title="Four ways to add depth"
          text="Extrude a crisp slab, stack brand colours in layers, inflate a soft volume, or turn artwork into relief. Pick a mode to see its cross-section."
          tone="slate"
          wide
        >
          <FeatGeometry
            :running="running"
            :seen="seen"
          />
        </FeatureCard>
        <FeatureCard
          v-slot="{ running, seen }"
          title="Keyboard-first, like your editor"
          text="Frame, switch views, spin and export without reaching for the mouse."
          hint="Try F, 1 to 4 or R on this page."
          tone="mint"
          wide
        >
          <FeatShortcuts
            :running="running"
            :seen="seen"
          />
        </FeatureCard>
        <FeatureCard
          v-slot="{ running, seen }"
          :title="`${MATERIAL_PRESETS.length} finishes, fully tunable`"
          text="Glass that refracts, metal that reflects, matte prints in full colour. Start from a preset, then dial in IOR, roughness and tint."
          tone="rose"
        >
          <FeatMaterials
            :running="running"
            :seen="seen"
          />
        </FeatureCard>
        <FeatureCard
          v-slot="{ running, seen }"
          title="Sized in real millimetres"
          text="Set the height and the width follows the mark. The STL prints at exactly the size you set."
          tone="ice"
        >
          <FeatSize
            :running="running"
            :seen="seen"
          />
        </FeatureCard>
        <FeatureCard
          v-slot="{ running, seen }"
          title="Ready for your stack"
          text="A 2× PNG for Figma and slides, a GLB for three.js and React Three Fiber, an STL for the printer."
          tone="amber"
        >
          <FeatExport
            :running="running"
            :seen="seen"
          />
        </FeatureCard>
        <!-- Tablet: two-column bento, so this card takes a full row and the grid has no hole. -->
        <FeatureCard
          v-slot="{ running, seen }"
          title="Client logos stay private"
          text="Tracing, modelling and rendering run on your machine. Nothing is uploaded, and there’s no account to create."
          tone="mint"
          class="max-desk:col-span-2 max-fold:col-auto"
        >
          <FeatPrivate
            :running="running"
            :seen="seen"
          />
        </FeatureCard>
      </div>
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
      <div class="grid grid-cols-3 gap-(--gap) max-lap:grid-cols-2">
        <NuxtLink
          v-for="example in LANDING_EXAMPLES"
          :key="example.id"
          :to="{ path: '/studio', query: { sample: example.id, finish: example.preset } }"
          class="group flex flex-col rounded-[24px] bg-surface p-1.5 text-ink shadow-pane focus-ring [--ring-offset:3px]"
          :aria-label="`Open the ${example.name} example in ${example.finish.toLowerCase()} in the studio`"
        >
          <span class="block aspect-square overflow-hidden rounded-[18px] bg-[#e7e9ef] inset-shadow-hairline">
            <img
              :src="`/images/${example.image}.webp`"
              :alt="`${example.name} logo rendered in 3D, ${example.finish.toLowerCase()}`"
              width="720"
              height="720"
              loading="lazy"
              decoding="async"
              class="block size-full object-cover transition-transform duration-[600ms] ease-out-quint motion-reduce:transition-none pointer-fine:group-hover:scale-[1.04]"
            >
          </span>
          <span class="flex items-center justify-between gap-3 px-3 pt-3.5 pb-3 max-phone:flex-col max-phone:items-start max-phone:gap-0.5 max-phone:px-2.5 max-phone:pt-3 max-phone:pb-2">
            <span class="flex min-w-0 items-center gap-2">
              <LogoMark
                :id="example.id"
                :size="16"
                mono
                class="shrink-0 text-ink-2"
              />
              <strong class="text-[15px] font-medium tracking-[-0.02em] max-phone:text-[14px]">{{ example.name }}</strong>
            </span>
            <small class="text-right text-[13px] text-ink-3 max-phone:text-left max-phone:text-[12px]">{{ example.finish }}</small>
          </span>
        </NuxtLink>
      </div>
      <p class="mt-5 max-w-[70ch] text-[12px] leading-normal text-ink-3">
        Logos belong to their owners and appear only to show what Vitrum can do. Vitrum isn’t affiliated with these brands.
      </p>
    </section>

    <section
      class="frame pt-(--section)"
      aria-labelledby="closing-title"
    >
      <div class="grid min-h-[400px] grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] overflow-hidden rounded-[28px] bg-surface p-2 shadow-pane max-tab:grid-cols-1">
        <div class="flex flex-col items-start justify-center p-12 max-desk:px-8 max-desk:py-10 max-tab:px-[18px] max-tab:pt-7 max-tab:pb-[22px]">
          <h2
            id="closing-title"
            class="heading-section max-w-[14ch]"
          >
            Your next icon set is a minute away.
          </h2>
          <p class="mt-4 max-w-[40ch] text-[15px] leading-[1.55] text-ink-2">
            Drop in your SVG, pick a finish, export. Free, no account, nothing to install.
          </p>
          <div
            class="mt-7 justify-start"
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
            class="mt-3 text-[12.5px] text-[#2c6b56]"
            role="status"
          >
            {{ shareStatus }}
          </p>
          <label
            v-if="shareUrl"
            class="mt-3 block w-full text-[12.5px]"
          >Share this link<input
            :value="shareUrl"
            readonly
            class="mt-1.5 block w-full rounded-[10px] border border-hairline-strong bg-white p-2.5 focus-ring [--ring-offset:3px]"
            @focus="($event.target as HTMLInputElement).select()"
          ></label>
        </div>
        <div
          class="relative min-h-[280px] overflow-hidden rounded-[20px] bg-[#e7e9ef] max-tab:-order-1 max-tab:aspect-[16/10] max-tab:min-h-0"
          aria-hidden="true"
        >
          <img
            src="/images/logo-framer.webp"
            width="720"
            height="720"
            alt=""
            loading="lazy"
            decoding="async"
            class="absolute inset-0 size-full object-cover"
          >
        </div>
      </div>
    </section>

    <section
      id="questions"
      class="frame grid scroll-mt-24 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-12 pt-(--section) pb-(--section) max-tab:grid-cols-1 max-tab:gap-5"
      aria-labelledby="faq-title"
    >
      <h2
        id="faq-title"
        class="heading-section"
      >
        Questions
      </h2>
      <div>
        <details
          v-for="faq in LANDING_FAQS"
          :key="faq.question"
          class="group border-b border-hairline-strong first:border-t"
        >
          <summary class="flex min-h-16 cursor-pointer list-none items-center justify-between gap-5 py-4 text-[15px] font-medium tracking-[-0.015em] focus-ring [--ring-offset:3px] [&::-webkit-details-marker]:hidden">
            {{ faq.question }}<Icon
              name="plus"
              :size="16"
              class="shrink-0 text-ink-3 transition-transform duration-200 ease-out-quint group-open:rotate-45 motion-reduce:transition-none"
            />
          </summary>
          <p class="max-w-[60ch] pb-[22px] text-[14px] leading-[1.6] text-ink-2">
            {{ faq.answer }}
          </p>
        </details>
      </div>
    </section>
  </main>
</template>
