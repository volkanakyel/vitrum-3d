<script setup lang="ts">
const link = 'inline-flex items-center gap-[7px] transition-colors duration-150 hover:text-ink focus-ring [--ring-offset:5px] focus-visible:rounded-[3px] motion-reduce:transition-none'
</script>

<template>
  <footer class="relative overflow-hidden border-t border-hairline bg-shell pb-[env(safe-area-inset-bottom)] text-ink-2">
    <div class="frame relative">
      <div class="grid grid-cols-[1.6fr_1fr_1fr] gap-10 pt-20 max-desk:grid-cols-[1.2fr_1fr_1fr] max-desk:gap-[25px] max-tab:grid-cols-[1fr_1fr] max-tab:gap-x-5 max-tab:gap-y-8 max-tab:pt-12">
        <div class="flex items-start gap-5 max-desk:gap-3 max-tab:col-span-full">
          <AppIcon :size="44" />
          <p class="mt-px font-(family-name:--font-display) text-[24px] leading-[1.15] font-medium tracking-[-.045em] text-ink max-desk:text-[24px]">
            Custom 3D icons,<br>straight from your SVG.
          </p>
        </div>
        <div class="flex flex-col items-start gap-3.5 text-[15px]">
          <h2 class="mb-2 text-[15px] font-medium text-ink">
            On this page
          </h2>
          <a
            href="#features"
            :class="link"
          >Features</a>
          <a
            href="#examples"
            :class="link"
          >Examples</a>
          <a
            href="#questions"
            :class="link"
          >Questions</a>
        </div>
        <div class="flex flex-col items-start gap-3.5 text-[15px]">
          <h2 class="mb-2 text-[15px] font-medium text-ink">
            Studio
          </h2>
          <NuxtLink
            to="/studio"
            :class="link"
          >
            Open the studio <Icon
              name="arrow-up-right"
              :size="13"
            />
          </NuxtLink>
          <NuxtLink
            to="/studio?sample=github&finish=chrome"
            :class="link"
          >
            Start from a sample logo
          </NuxtLink>
          <span class="text-[15px] text-ink-3">PNG, GLB & STL exports</span>
        </div>
      </div>
      <div class="mt-16 mb-8 flex items-center justify-between gap-5 max-tab:mt-10 max-tab:mb-5">
        <span
          aria-hidden="true"
          class="font-(family-name:--font-display) text-[clamp(100px,20.5vw,290px)] leading-[.9] font-medium tracking-[-.075em] max-tab:text-[22vw]"><span class="bg-[linear-gradient(180deg,var(--ink)_10%,color-mix(in_srgb,var(--ink)_8%,transparent)_92%)] bg-clip-text pb-[0.06em] text-transparent">vitrum</span></span>
        <a
          href="#main-content"
          v-glass
          class="glass relative mt-[60px] grid size-14 place-items-center rounded-full text-ink transition-[translate,scale] duration-[380ms] ease-spring focus-ring [--ring-offset:5px] active:scale-[.92] active:duration-100 motion-reduce:transition-none pointer-fine:hover:-translate-y-1 max-tab:mt-[25px] max-tab:size-11 max-tab:shrink-0"
          aria-label="Back to top"
        ><Icon
          name="arrow-up"
          :size="24"
        /></a>
      </div>
      <div class="flex items-center justify-between gap-5 border-t border-hairline pt-6 pb-8 text-[14px] text-ink-3 max-tab:flex-wrap max-tab:gap-2.5">
        <span class="flex items-center gap-[7px]"><Icon
          name="lock"
          :size="15"
        /> Made on your device. Yours to keep.</span>
        <span>© Vitrum</span>
      </div>
    </div>
  </footer>
</template>
