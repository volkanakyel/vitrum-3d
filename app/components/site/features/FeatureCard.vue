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
    class="flex h-full min-w-0 flex-col rounded-[22px] bg-slab p-1.5 shadow-pane"
    :class="WASH[tone]"
  >
    <!-- Radius 16 inside 22 with a 6 px gutter: the stage's corners run concentric with the card's. -->
    <div class="lightbox relative isolate grid h-[232px] place-items-center overflow-hidden rounded-[16px] bg-[radial-gradient(120%_90%_at_85%_0%,var(--wash)_0%,transparent_62%),radial-gradient(90%_80%_at_0%_100%,var(--wash-2)_0%,transparent_60%),linear-gradient(180deg,#f3f4f7,#eceef2)] shadow-[inset_0_0_0_1px_rgba(38,40,46,.05),inset_0_1px_0_#fff] max-fold:h-[220px]">
      <span class="glass absolute top-2.5 left-2.5 z-10 rounded-full px-2 py-[5px] text-[12px] leading-none font-medium text-ink-2 [--glass-blur:8px]">
        {{ tag }}
      </span>
      <slot
        :running="running"
        :seen="seen || reduced"
      />
    </div>
    <div class="px-3.5 pt-4 pb-[18px]">
      <h3 class="font-(family-name:--font-display) text-[15px] leading-[1.3] font-medium tracking-[-0.02em] text-ink">
        {{ title }}
      </h3>
      <p class="mt-1.5 max-w-[56ch] text-[12.5px] leading-[1.55] text-pretty text-ink-2">
        {{ text }}<span
          v-if="hint"
          class="hover-none:hidden"
        >{{ ` ${hint}` }}</span>
      </p>
    </div>
  </article>
</template>
