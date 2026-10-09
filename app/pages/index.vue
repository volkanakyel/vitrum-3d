<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { LANDING_EXAMPLES, LANDING_FAQS, landingLooks } from '~/data/landing'
import { LOGOS } from '~/utils/logos'
import { HERO_FINISH } from '~/utils/samples'

const route = useRoute()
const siteUrl = useRuntimeConfig().public.siteUrl
const socialImage = siteUrl ? new URL('/images/vitrum-social.png', siteUrl).href : '/images/vitrum-social.png'
const looks = landingLooks()
const preset = ref<string>(HERO_FINISH)
const live = ref(false)
const paused = ref(false)
const { status: shareStatus, fallbackUrl: shareUrl, share } = useShare()

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

function restoreFinish(value: unknown) {
  preset.value = typeof value === 'string' && looks.some(look => look.id === value) ? value : HERO_FINISH
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
    Spacing: one section rhythm (--section), one card inset (8px, so inner radii are the outer
    radius minus 8), one grid gap (--gap). Each section has its own form so the page doesn't repeat
    itself: a window, one drawing, a gallery, one dark panel, a plain list.
  -->
  <main
    id="main-content"
    class="relative overflow-clip bg-shell text-ink [--gap:20px] [--section:clamp(136px,15vw,224px)] max-tab:[--gap:14px]"
  >
    <!-- The lamp over the table: one soft overhead light the hero sits under. -->
    <span
      class="pointer-events-none absolute top-[-320px] left-1/2 h-[960px] w-[min(1400px,140vw)] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(255,255,255,.95),rgba(255,255,255,.4)_45%,transparent_75%)]"
      aria-hidden="true"
    />

    <section
      class="frame relative pt-[168px] text-center max-tab:pt-32"
      aria-labelledby="hero-title"
    >
      <!-- The hero copy and window share one entrance, copy first. -->
      <div class="flex flex-col items-center">
        <p
          v-glass
          class="bench glass relative mb-8 inline-flex h-8 animate-rise items-center gap-2.5 rounded-full pr-3.5 pl-3 text-[12px] text-ink-2 [--glass-tint-top:#33353c] [--glass-tint:#25272d] motion-reduce:animate-none max-tab:mb-6"
        >
          <LiveDot on />
          Free, and nothing leaves your browser
        </p>
        <h1
          id="hero-title"
          class="heading-hero bg-[linear-gradient(180deg,var(--ink)_30%,color-mix(in_srgb,var(--ink)_58%,transparent))] bg-clip-text pb-[0.08em] text-transparent max-2xs:text-[34px]"
        >
          <span class="block animate-rise animation-delay-60 motion-reduce:animate-none">Custom 3D icons</span>
          <span class="block animate-rise animation-delay-120 motion-reduce:animate-none">from any logo.</span>
        </h1>
        <p class="mt-6 max-w-[50ch] animate-rise text-[15.5px] leading-[1.55] tracking-[-0.012em] text-balance text-ink-2 animation-delay-180 motion-reduce:animate-none max-tab:text-[16px] max-2xs:text-[15px]">
          Drop in an SVG or PNG and get it back in glass, metal or colour. Export a PNG for your designs, a GLB for three.js or an STL for print.
        </p>
        <div
          class="mt-10 animate-rise justify-center animation-delay-240 motion-reduce:animate-none"
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

      <div class="mt-14 max-tab:mt-10">
        <HeroStudio
          :preset="preset"
          :paused="paused"
          @ready="live = true"
          @unavailable="live = false"
        />
      </div>

      <nav
        class="mt-6 flex items-center justify-center gap-4 max-tab:flex-col max-tab:gap-3"
        aria-label="Open a brand logo in the studio"
      >
        <p class="text-[13px] whitespace-nowrap text-ink-3">
          Try it on a logo you know
        </p>
        <ul class="flex flex-wrap justify-center gap-1.5">
          <li
            v-for="logo in LOGOS"
            :key="logo.id"
          >
            <NuxtLink
              :to="{ path: '/studio', query: { sample: logo.id } }"
              :aria-label="`Open the ${logo.name} logo in the studio`"
              :title="logo.name"
              v-glass
              class="glass relative grid size-10 place-items-center rounded-full text-ink-2 transition-[color,translate,scale] duration-[150ms,380ms,380ms] ease-[ease,var(--ease-spring),var(--ease-spring)] focus-ring [--ring-offset:3px] hover:text-ink active:scale-[.94] active:duration-100 motion-reduce:transition-none max-phone:size-9 pointer-fine:hover:-translate-y-[3px]"
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

      <IsoPipeline />
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
      <!-- A shelf, not cards: small renders in one row, bare on the table. The name is a frosted
           chip on the render; the finish sits underneath. -->
      <div class="grid grid-cols-6 gap-3.5 max-desk:grid-cols-3 max-tab:gap-3 max-phone:grid-cols-2">
        <NuxtLink
          v-for="example in LANDING_EXAMPLES"
          :key="example.id"
          :to="{ path: '/studio', query: { sample: example.id, finish: example.preset } }"
          class="group flex flex-col gap-2.5 rounded-[18px] transition-[scale] duration-[420ms] ease-spring focus-ring [--ring-offset:4px] active:scale-[.97] active:duration-100 motion-reduce:transition-none"
          :aria-label="`Open the ${example.name} example in ${example.finish.toLowerCase()} in the studio`"
        >
          <span class="relative block aspect-square overflow-hidden rounded-[18px] bg-[#e7e9ef] shadow-[0_0_0_1px_var(--hairline),0_20px_40px_-28px_rgba(38,40,46,.4)]">
            <img
              :src="`/images/${example.image}.webp`"
              :alt="`${example.name} logo rendered in 3D, ${example.finish.toLowerCase()}`"
              width="720"
              height="720"
              loading="lazy"
              decoding="async"
              class="absolute inset-0 block size-full object-cover transition-transform duration-[900ms] ease-out-quint motion-reduce:transition-none pointer-fine:group-hover:scale-[1.06]"
            >
            <span class="glass absolute bottom-2 left-2 flex h-7 max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full pr-1 pl-2 [--glass-blur:14px] max-phone:pr-2">
              <LogoMark
                :id="example.id"
                :size="12"
                mono
                class="shrink-0 text-ink"
              />
              <strong class="truncate text-[11.5px] font-medium tracking-[-0.01em]">{{ example.name }}</strong>
              <!-- Hover says where the tile goes. -->
              <span class="grid size-5 shrink-0 place-items-center rounded-full bg-ink text-white opacity-0 transition-[opacity,scale] duration-300 ease-spring scale-50 motion-reduce:transition-none max-phone:hidden pointer-fine:group-hover:scale-100 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-visible:scale-100 pointer-fine:group-focus-visible:opacity-100">
                <Icon
                  name="arrow-up-right"
                  :size="11"
                />
              </span>
            </span>
          </span>
          <small class="px-1 text-[12px] text-ink-3">{{ example.finish }}</small>
        </NuxtLink>
      </div>
      <p class="mt-6 max-w-[70ch] text-[11.5px] leading-normal text-ink-3">
        Logos belong to their owners and appear only to show what Vitrum can do. Vitrum isn’t affiliated with these brands.
      </p>
    </section>

    <!-- The closing panel: copy beside one render, on a white pane. -->
    <section
      class="frame pt-(--section)"
      aria-labelledby="closing-title"
    >
      <div class="grid min-h-[420px] grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] overflow-hidden rounded-window bg-slab p-2 shadow-pane max-tab:grid-cols-1">
        <div class="flex flex-col items-start justify-center p-14 max-desk:px-9 max-desk:py-11 max-tab:px-5 max-tab:pt-8 max-tab:pb-6">
          <p class="mb-6 flex items-center gap-2 text-[12.5px] text-ink-3">
            <LiveDot on />
            Free, no account, nothing to install
          </p>
          <h2
            id="closing-title"
            class="heading-section max-w-[14ch] bg-[linear-gradient(180deg,var(--ink)_30%,color-mix(in_srgb,var(--ink)_55%,transparent))] bg-clip-text pb-[0.06em] text-transparent"
          >
            Your next icon set is a minute away.
          </h2>
          <p class="mt-5 max-w-[40ch] text-[15px] leading-[1.6] text-ink-2">
            Drop in your SVG, pick a finish, export.
          </p>
          <div
            class="mt-9 justify-start"
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
            class="mt-1.5 block w-full rounded-[12px] bg-surface p-2.5 shadow-raise focus-ring [--ring-offset:3px]"
            @focus="($event.target as HTMLInputElement).select()"
          ></label>
        </div>
        <div
          class="relative min-h-[300px] overflow-hidden rounded-pane bg-[#e7e9ef] max-tab:-order-1 max-tab:aspect-[16/10] max-tab:min-h-0"
          aria-hidden="true"
        >
          <img
            src="/images/logo-framer-champagne.webp"
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

    <!-- Frosted rows on the table; the open one brightens. -->
    <section
      id="questions"
      class="frame grid scroll-mt-24 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-16 pt-(--section) pb-(--section) max-tab:grid-cols-1 max-tab:gap-8"
      aria-labelledby="faq-title"
    >
      <div>
        <h2
          id="faq-title"
          class="heading-section"
        >
          Questions
        </h2>
        <p class="mt-5 max-w-[34ch] text-[15px] leading-[1.6] text-ink-2 max-tab:hidden">
          The short answers. The studio explains the rest as you go.
        </p>
      </div>
      <div class="flex flex-col gap-2">
        <details
          v-for="faq in LANDING_FAQS"
          :key="faq.question"
          v-glass
          class="faq glass group relative rounded-[20px] open:[--glass-tint-top:#fff] open:[--glass-tint:rgba(255,255,255,.86)]"
        >
          <summary class="flex min-h-16 cursor-pointer list-none items-center justify-between gap-5 rounded-[20px] py-4 pr-4 pl-5 text-[14.5px] font-medium tracking-[-0.015em] focus-ring [--ring-offset:3px] [&::-webkit-details-marker]:hidden">
            {{ faq.question }}
            <span class="grid size-8 shrink-0 place-items-center rounded-full bg-well-strong text-ink-2 transition-[rotate,background-color,color] duration-[380ms,200ms,200ms] ease-[var(--ease-spring),ease,ease] group-open:rotate-45 group-open:bg-ink group-open:text-shell motion-reduce:transition-none">
              <Icon
                name="plus"
                :size="15"
              />
            </span>
          </summary>
          <p class="max-w-[60ch] pr-5 pb-5 pl-5 text-[14px] leading-[1.6] text-ink-2">
            {{ faq.answer }}
          </p>
        </details>
      </div>
    </section>
  </main>
</template>
