<script setup lang="ts">
import { useEventListener, useIntersectionObserver } from '@vueuse/core'
import { AnimatePresence, motion } from 'motion-v'

const links = [
  { id: 'features', label: 'Features' },
  { id: 'examples', label: 'Examples' },
  { id: 'questions', label: 'Questions' },
]
const scrolled = ref(false)
const menuOpen = ref(false)
const menuToggle = ref<HTMLButtonElement | null>(null)
const active = ref('')
/** The link under the pointer; the highlight pill follows it and falls back to the active one. */
const hovered = ref('')
const sections = ref<HTMLElement[]>([])
const lit = computed(() => hovered.value || active.value)

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
  <!-- Sits flat on the bench at the top; once the page moves it becomes a frosted slab. -->
  <header
    class="frame-nav fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] z-40 rounded-[22px] transition-[background-color,box-shadow,backdrop-filter] duration-300 ease-[ease] motion-reduce:transition-none max-tab:rounded-[20px]"
    :class="
      scrolled || menuOpen
        ? 'glass [--glass-blur:20px]'
        : 'bg-transparent shadow-[0_0_0_1px_transparent]'
    "
    v-glass
    @keydown.esc="onEscape"
  >
    <a
      class="absolute -top-[90px] left-5 rounded-[8px] bg-ink p-3 text-shell focus:top-2.5 focus:z-50"
      :class="focus"
      href="#main-content"
    >
      Skip to content
    </a>
    <nav
      class="grid h-[60px] grid-cols-[1fr_auto_1fr] items-center gap-6 pr-2.5 pl-3.5 max-tab:flex max-tab:justify-between max-tab:gap-2.5 max-tab:pr-[9px] max-tab:pl-[13px]"
      aria-label="Main navigation"
    >
      <NuxtLink
        to="/"
        class="group/brand flex items-center gap-[9px] justify-self-start rounded-full text-ink max-3xs:gap-[7px]"
        :class="focus"
        aria-label="Vitrum home"
        @click="closeMenu"
      >
        <AppIcon
          :size="30"
          class="transition-transform duration-500 ease-spring motion-reduce:transition-none pointer-fine:group-hover/brand:-rotate-8"
        />
        <span class="text-[16px] font-semibold tracking-[-.03em] max-3xs:text-[15px]">Vitrum</span>
      </NuxtLink>

      <div
        class="flex max-tab:hidden"
        @pointerleave="hovered = ''"
      >
        <a
          v-for="link in links"
          :key="link.id"
          :href="`#${link.id}`"
          class="relative flex min-h-[34px] items-center rounded-full px-3.5 text-[13px] transition-colors duration-150 ease-[ease] motion-reduce:transition-none"
          :class="[focus, lit === link.id ? 'text-ink' : 'text-ink-2']"
          :aria-current="active === link.id ? 'location' : undefined"
          @pointerenter="hovered = link.id"
          @focus="hovered = link.id"
          @blur="hovered = ''"
        >
          <motion.span
            v-if="lit === link.id"
            layout-id="nav-pill"
            class="absolute inset-0 rounded-full bg-well-strong"
            :transition="{ type: 'spring', stiffness: 520, damping: 40 }"
            aria-hidden="true"
          />
          <span class="relative">{{ link.label }}</span>
        </a>
      </div>

      <div class="flex items-center gap-2 justify-self-end">
        <span
          class="mr-1 flex items-center gap-2 text-[12px] text-ink-3 max-desk:hidden"
        >
          <LiveDot on />
          Runs on your device
        </span>
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
          class="hidden size-10 items-center justify-center rounded-full bg-surface text-ink shadow-raise transition-[scale] duration-300 ease-spring active:scale-[.94] active:duration-100 max-tab:flex"
          :class="focus"
          :aria-expanded="menuOpen"
          aria-controls="mobile-navigation"
          :aria-label="menuOpen ? 'Close menu' : 'Open menu'"
          @click="menuOpen = !menuOpen"
        >
          <Icon
            :name="menuOpen ? 'x' : 'menu'"
            :size="18"
          />
        </button>
      </div>
    </nav>
    <AnimatePresence>
      <motion.div
        v-if="menuOpen"
        id="mobile-navigation"
        key="menu"
        class="hidden overflow-hidden max-tab:block"
        :initial="{ opacity: 0, height: 0 }"
        :animate="{ opacity: 1, height: 'auto' }"
        :exit="{ opacity: 0, height: 0, transition: { duration: 0.18, ease: 'easeOut' } }"
        :transition="{ type: 'spring', stiffness: 420, damping: 38 }"
      >
        <div class="grid border-t border-hairline px-[18px] pt-[9px] pb-[17px]">
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
              class="text-ink-3"
            />
          </a>
          <p class="flex items-center gap-2 pt-2.5 text-[12px] text-ink-3">
            <LiveDot on /> Free, and it runs on your device.
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  </header>
</template>
