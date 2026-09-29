<script setup lang="ts">
/**
 * One feature on the landing page: a slab holding a lightbox with a live demo, then a title and a
 * line of copy. The card owns visibility, so every demo inside gets the same two signals:
 * `running` (on screen, motion allowed) and `seen` (has been on screen at least once).
 */
withDefaults(defineProps<{ title: string; text: string; tag: string; hint?: string; tone?: 'ice' | 'mint' | 'rose' | 'amber' | 'slate' }>(), { tone: 'slate' })

const root = ref<HTMLElement | null>(null)
const inView = useInView(root)
const reduced = useReducedMotion()
const seen = ref(false)
watch(inView, (value) => { if (value) seen.value = true })
const running = computed(() => inView.value && !reduced.value)

/* Washes borrow the hero finishes, faint enough that the demo stays the subject. */
const WASH = {
  slate: '[--wash:#dfe3ec] [--wash-2:#e9e6f1]',
  ice: '[--wash:#d3e0fb] [--wash-2:#e6e3f6]',
  mint: '[--wash:#d2efe2] [--wash-2:#e1eef4]',
  rose: '[--wash:#f7dde6] [--wash-2:#e8e3f5]',
  amber: '[--wash:#f8e7cc] [--wash-2:#efe8e2]',
} as const
</script>

<template>
  <article
    ref="root"
    class="flex h-full min-w-0 flex-col rounded-card bg-slab p-2 shadow-pane"
    :class="WASH[tone]"
  >
    <div class="lightbox relative isolate grid h-[272px] place-items-center overflow-hidden rounded-pane bg-[radial-gradient(120%_90%_at_85%_0%,var(--wash)_0%,transparent_62%),radial-gradient(90%_80%_at_0%_100%,var(--wash-2)_0%,transparent_60%),linear-gradient(180deg,#f3f4f7,#eceef2)] shadow-[inset_0_0_0_1px_rgba(13,14,18,.05),inset_0_1px_0_#fff] max-lap:h-[256px] max-fold:h-[240px]">
      <span class="glass absolute top-3 left-3 z-10 rounded-full px-2.5 py-1 text-[11px] leading-none font-medium text-ink-2 [--glass-blur:8px]">
        {{ tag }}
      </span>
      <slot
        :running="running"
        :seen="seen || reduced"
      />
    </div>
    <div class="px-4 pt-5 pb-4 max-tab:px-3 max-tab:pt-4 max-tab:pb-3">
      <h3 class="font-(family-name:--font-display) text-[16px] font-medium tracking-[-0.025em] text-ink">
        {{ title }}
      </h3>
      <p class="mt-2 max-w-[52ch] text-[13px] leading-[1.6] text-pretty text-ink-2">
        {{ text }}<span
          v-if="hint"
          class="hover-none:hidden"
        >{{ ` ${hint}` }}</span>
      </p>
    </div>
  </article>
</template>
