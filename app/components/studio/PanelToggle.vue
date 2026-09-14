<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'

// Opens the controls sheet from the view dock on small screens, where the toolbar trigger is
// easy to miss. Must live inside SidebarProvider.
const { toggleSidebar } = useSidebar()
</script>

<template>
  <Button
    variant="ghost"
    size="sm"
    class="h-8 gap-1.5 px-2.5 text-[12px] pointer-coarse:h-9"
    aria-label="Open controls"
    @click="toggleSidebar"
  >
    <Icon
      name="sliders"
      :size="15"
    />
    Style
  </Button>
</template>
