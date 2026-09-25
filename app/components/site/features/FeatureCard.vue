<script setup lang="ts">
/**
 * One feature on the landing page: a small light box with a live demo, then a title and a line
 * of copy. The card owns visibility, so every demo inside gets the same two signals:
 * `running` (on screen, motion allowed) and `seen` (has been on screen at least once).
 */
withDefaults(defineProps<{ title: string; text: string; hint?: string; wide?: boolean; tone?: 'ice' | 'mint' | 'rose' | 'amber' | 'slate' }>(), { tone: 'slate' })

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
    class="flex min-w-0 flex-col rounded-[24px] bg-surface p-1.5 shadow-pane"
    :class="[WASH[tone], { 'col-span-2 max-fold:col-auto': wide }]"
  >
    <div class="relative isolate grid h-[300px] place-items-center overflow-hidden rounded-[18px] bg-[radial-gradient(120%_90%_at_85%_0%,var(--wash)_0%,transparent_62%),radial-gradient(90%_80%_at_0%_100%,var(--wash-2)_0%,transparent_60%),linear-gradient(180deg,#f3f4f7,#eceef2)] shadow-[inset_0_0_0_1px_var(--hairline),inset_0_1px_0_#fff] max-lap:h-[270px] max-fold:h-[250px]">
      <slot
        :running="running"
        :seen="seen || reduced"
      />
    </div>
    <div class="px-3 pt-4 pb-3">
      <h3 class="font-(family-name:--font-display) text-[17px] font-medium tracking-[-0.03em] text-ink">
        {{ title }}
      </h3>
      <p class="mt-1.5 max-w-[52ch] text-[13.5px] leading-[1.55] text-pretty text-ink-2">
        {{ text }}<span
          v-if="hint"
          class="hover-none:hidden"
        >{{ ` ${hint}` }}</span>
      </p>
    </div>
  </article>
</template>
