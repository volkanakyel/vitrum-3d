<script setup lang="ts">
import { Button } from '@/components/ui/button'

const scrolled = ref(false)
onMounted(() => {
  const on = () => (scrolled.value = window.scrollY > 24)
  on()
  window.addEventListener('scroll', on, { passive: true })
  onBeforeUnmount(() => window.removeEventListener('scroll', on))
})
</script>

<template>
  <header class="fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
    <nav
      class="flex h-12 w-full max-w-[1200px] items-center justify-between rounded-full px-2 pl-3 transition-[background-color,box-shadow,backdrop-filter] duration-300"
      :class="scrolled ? 'bg-card/80 shadow-[var(--shadow-float)] backdrop-blur-xl' : 'bg-transparent'"
      aria-label="Site"
    >
      <NuxtLink
        to="/"
        class="flex items-center gap-2.5 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
        aria-label="Vitrum home"
      >
        <AppIcon :size="28" />
        <span class="text-[14px] font-semibold tracking-[-0.02em] text-foreground">Vitrum</span>
      </NuxtLink>
      <div class="flex items-center gap-1">
        <NuxtLink
          to="/studio/icon"
          class="h-8 rounded-full px-3.5 text-[12.5px] leading-8 text-ink-2 transition-colors hover:text-foreground max-sm:hidden"
        >
          Icons
        </NuxtLink>
        <NuxtLink
          to="/studio/product"
          class="h-8 rounded-full px-3.5 text-[12.5px] leading-8 text-ink-2 transition-colors hover:text-foreground max-sm:hidden"
        >
          Products
        </NuxtLink>
        <Button
          as-child
          size="sm"
          class="ml-1 h-8 px-3.5 text-[12.5px]"
        >
          <NuxtLink to="/studio/icon">
            Open studio
          </NuxtLink>
        </Button>
      </div>
    </nav>
  </header>
</template>
