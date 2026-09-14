<template>
  <footer class="relative z-10 mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-[12px] text-ink-3">
    <span class="flex items-center gap-2.5">
      <BrandMark
        :size="14"
        class="text-ink-2"
      />
      Vitrum runs in your browser. Images never leave it.
    </span>
    <span class="flex items-center gap-4">
      <NuxtLink
        to="/studio/icon"
        class="transition-colors hover:text-foreground"
      >
        Icon studio
      </NuxtLink>
      <NuxtLink
        to="/studio/product"
        class="transition-colors hover:text-foreground"
      >
        Product studio
      </NuxtLink>
    </span>
  </footer>
</template>
