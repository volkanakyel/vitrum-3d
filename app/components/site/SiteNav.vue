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
const header = ref<HTMLElement | null>(null)
const reduced = useReducedMotion()
/* Springs collapse to an instant change when the visitor asks for less motion. */
const pillTransition = computed(() => (reduced.value ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 40 }))
const menuTransition = computed(() => (reduced.value ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 38 }))
const menuExit = computed(() => (reduced.value ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' as const }))

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
// The menu is a disclosure, not a dialog: it closes when the pointer goes elsewhere or the layout
// grows past the phone breakpoint (where the menu no longer exists).
useEventListener('pointerdown', (e: PointerEvent) => {
  if (menuOpen.value && !header.value?.contains(e.target as Node)) closeMenu()
})
useEventListener('resize', () => {
  if (menuOpen.value && window.innerWidth > 800) closeMenu()
}, { passive: true })
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
    ref="header"
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
      class="absolute -top-[90px] left-3 flex h-10 items-center rounded-full bg-primary px-4 text-[15px] font-medium text-primary-foreground shadow-raise-dark focus:top-2.5 focus:z-50"
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
          class="relative flex min-h-[38px] items-center rounded-full px-4 text-[15px] transition-colors duration-150 ease-[ease] motion-reduce:transition-none"
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
            :transition="pillTransition"
            aria-hidden="true"
          />
          <span class="relative">{{ link.label }}</span>
        </a>
      </div>

      <div class="flex items-center gap-2 justify-self-end">
        <SiteButton
          to="/studio"
          size="md"
          icon="arrow-up-right"
          tile
          class="max-3xs:gap-[9px] max-3xs:pl-3 max-3xs:text-[14px]"
        >
          Open studio
        </SiteButton>
        <button
          ref="menuToggle"
          type="button"
          class="hidden size-11 items-center justify-center rounded-full bg-surface text-ink shadow-raise transition-[scale] duration-300 ease-spring active:scale-[.94] active:duration-100 max-tab:flex"
          :class="focus"
          :aria-expanded="menuOpen"
          aria-controls="mobile-navigation"
          aria-label="Menu"
          @click="menuOpen = !menuOpen"
        >
          <Icon
            :name="menuOpen ? 'x' : 'menu'"
            :size="18"
          />
        </button>
      </div>
    </nav>
    <!-- Always in the DOM so the toggle's aria-controls points at something; the list mounts on open. -->
    <div
      id="mobile-navigation"
      class="hidden max-tab:block"
    >
      <AnimatePresence>
        <motion.nav
          v-if="menuOpen"
          key="menu"
          class="overflow-hidden"
          aria-label="Menu"
          :initial="{ opacity: 0, height: 0 }"
          :animate="{ opacity: 1, height: 'auto' }"
          :exit="{ opacity: 0, height: 0, transition: menuExit }"
          :transition="menuTransition"
        >
          <div class="grid border-t border-hairline px-[18px] pt-[9px] pb-[17px]">
            <a
              v-for="link in links"
              :key="link.id"
              :href="`#${link.id}`"
              class="flex min-h-12 items-center justify-between rounded-[10px] text-[17px] text-ink"
              :class="focus"
              :aria-current="active === link.id ? 'location' : undefined"
              @click="closeMenu"
            >
              {{ link.label }}
              <Icon
                name="arrow-up-right"
                :size="16"
                class="text-ink-3"
              />
            </a>
          </div>
        </motion.nav>
      </AnimatePresence>
    </div>
  </header>
</template>
