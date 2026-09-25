<script setup lang="ts">
import { useEventListener, useIntersectionObserver } from '@vueuse/core'

const links = [
  { id: 'features', label: 'Features' },
  { id: 'examples', label: 'Examples' },
  { id: 'questions', label: 'Questions' },
]
const scrolled = ref(false)
const menuOpen = ref(false)
const menuToggle = ref<HTMLButtonElement | null>(null)
const active = ref('')
const sections = ref<HTMLElement[]>([])

function onScroll() {
  scrolled.value = window.scrollY > 24
  if (window.scrollY < 200) active.value = ''
}
function closeMenu() {
  menuOpen.value = false
}
function onEscape() {
  if (!menuOpen.value) return
  closeMenu()
  menuToggle.value?.focus()
}

useEventListener('scroll', onScroll, { passive: true })
useIntersectionObserver(
  sections,
  (entries) => {
    for (const entry of entries) if (entry.isIntersecting) active.value = entry.target.id
  },
  { rootMargin: '-15% 0px -60% 0px' },
)
onMounted(() => {
  onScroll()
  sections.value = links.map((link) => document.getElementById(link.id)).filter((el) => el !== null)
})

const focus = 'focus-ring [--ring-offset:4px]'
</script>

<template>
  <header
    class="frame-nav fixed inset-x-0 top-[max(14px,env(safe-area-inset-top))] z-40 rounded-[22px] backdrop-blur-[20px] backdrop-saturate-140 transition-[background-color,box-shadow] duration-200 ease-[ease] motion-reduce:transition-none max-tab:top-[max(12px,env(safe-area-inset-top))] max-tab:rounded-[18px]"
    :class="
      scrolled
        ? 'bg-white/92 shadow-float'
        : 'bg-white/72 shadow-[0_0_0_1px_var(--hairline),inset_0_1px_0_#fff]'
    "
    @keydown.esc="onEscape"
  >
    <a
      class="absolute -top-[90px] left-5 rounded-[8px] bg-white p-3 text-[#20242c] focus:top-2.5 focus:z-50"
      :class="focus"
      href="#main-content"
    >
      Skip to content
    </a>
    <nav
      class="flex h-[60px] items-center justify-between gap-[25px] pr-2 pl-3.5 max-tab:h-[62px] max-tab:gap-2.5 max-tab:pr-[9px] max-tab:pl-[13px]"
      aria-label="Main navigation"
    >
      <NuxtLink
        to="/"
        class="flex items-center gap-[9px] text-ink max-3xs:gap-[7px]"
        :class="focus"
        aria-label="Vitrum home"
        @click="closeMenu"
      >
        <AppIcon :size="32" />
        <span class="text-[17px] font-semibold tracking-[-.03em] max-3xs:text-[16px]">Vitrum</span>
      </NuxtLink>
      <div class="flex gap-[5px] max-tab:hidden">
        <a
          v-for="link in links"
          :key="link.id"
          :href="`#${link.id}`"
          class="flex min-h-[34px] items-center rounded-full px-3.5 text-[13px] transition-colors duration-150 ease-[ease] hover:bg-well hover:text-ink motion-reduce:transition-none max-desk:px-2.5 max-desk:text-[11px]"
          :class="[focus, active === link.id ? 'bg-well text-ink' : 'text-ink-2']"
          :aria-current="active === link.id ? 'location' : undefined"
        >
          {{ link.label }}
        </a>
      </div>
      <div class="flex items-center gap-2">
        <SiteButton
          to="/studio"
          size="md"
          icon="arrow-up-right"
          tile
          class="max-3xs:gap-[9px] max-3xs:pl-3 max-3xs:text-[11px]"
        >
          Open studio
        </SiteButton>
        <button
          ref="menuToggle"
          class="hidden size-[42px] items-center justify-center rounded-full bg-well text-ink max-tab:flex"
          :class="focus"
          :aria-expanded="menuOpen"
          aria-controls="mobile-navigation"
          :aria-label="menuOpen ? 'Close menu' : 'Open menu'"
          @click="menuOpen = !menuOpen"
        >
          <Icon
            :name="menuOpen ? 'x' : 'menu'"
            :size="20"
          />
        </button>
      </div>
    </nav>
    <div
      v-if="menuOpen"
      id="mobile-navigation"
      class="hidden max-tab:grid max-tab:border-t max-tab:border-hairline max-tab:px-[18px] max-tab:pt-[9px] max-tab:pb-[17px]"
    >
      <a
        v-for="link in links"
        :key="link.id"
        :href="`#${link.id}`"
        class="flex justify-between py-[15px] text-[15px] text-ink"
        :class="focus"
        @click="closeMenu"
      >
        {{ link.label }}
        <Icon
          name="arrow-up-right"
          :size="16"
        />
      </a>
      <p class="pt-2.5 text-[12px] text-ink-3">Free, in your browser.</p>
    </div>
  </header>
</template>
