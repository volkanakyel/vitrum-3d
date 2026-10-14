<script setup lang="ts">
import { useEventListener } from '@vueuse/core'

/**
 * The studio's keyboard shortcuts (useStudio `onKey`, plus the sidebar's ⌘B). The big caps
 * play through them on their own, and pressing a real key on this page lights that shortcut up.
 */
const props = defineProps<{ running: boolean; seen: boolean }>()

interface Shortcut { keys: string[]; label: string; row: number; code: string; mod?: boolean }
const SHORTCUTS: Shortcut[] = [
  { keys: ['⌘', 'E'], label: 'Export GLB', row: 0, code: 'e', mod: true },
  { keys: ['F'], label: 'Frame the object', row: 1, code: 'f' },
  { keys: ['1'], label: 'Angle view', row: 2, code: '1' },
  { keys: ['2'], label: 'Front view', row: 2, code: '2' },
  { keys: ['3'], label: 'Side view', row: 2, code: '3' },
  { keys: ['4'], label: 'Top view', row: 2, code: '4' },
  { keys: ['R'], label: 'Auto-rotate on or off', row: 3, code: 'r' },
  { keys: ['⌘', 'B'], label: 'Show or hide the panel', row: 4, code: 'b', mod: true },
]
const ROWS = [
  { keys: ['⌘', 'E'], label: 'Export GLB' },
  { keys: ['F'], label: 'Frame' },
  { keys: ['1', '–', '4'], label: 'Angle, front, side, top' },
  { keys: ['R'], label: 'Auto-rotate' },
  { keys: ['⌘', 'B'], label: 'Panel' },
]

const { index, hold } = useCycle(SHORTCUTS.length, 1900, toRef(props, 'running'), 4000)
const current = computed(() => SHORTCUTS[index.value]!)
// Bumped on every press so pressing the same key twice still replays the cap animation.
const presses = ref(0)
watch(index, () => { presses.value++ })

useEventListener('keydown', (e: KeyboardEvent) => {
  if (isEditableTarget(e.target)) return
  const mod = e.metaKey || e.ctrlKey
  const i = SHORTCUTS.findIndex(s => s.code === e.key.toLowerCase() && !!s.mod === mod)
  if (i < 0 || e.altKey) return
  hold(i)
  presses.value++
})
</script>

<template>
  <!-- 5 rows × 30 px + gaps + padding = 170 px list, centred in the 232 px stage beside the caps.
       In a narrow card the list goes and the caps take the stage. -->
  <div class="absolute inset-0 grid grid-cols-[1.1fr_1fr] items-center gap-5 p-5 @max-[460px]:grid-cols-1">
    <div class="flex flex-col items-center gap-4">
      <div
        :key="presses"
        class="group flex h-[76px] gap-2.5"
        :data-play="seen || undefined"
        aria-hidden="true"
      >
        <span
          v-for="(k, i) in current.keys"
          :key="k"
          class="grid size-[76px] place-items-center rounded-[14px] bg-[linear-gradient(180deg,#ffffff,#f4f5f8)] font-(family-name:--font-display) font-medium tracking-[-0.03em] text-[#8b95a8] shadow-[0_0_0_1px_rgba(38,40,46,.07),0_1px_0_1px_rgba(38,40,46,.05),0_6px_0_-1px_#e2e5eb,0_18px_30px_-14px_rgba(38,40,46,.28),inset_0_1px_0_#fff] motion-safe:group-data-play:animate-[key-press_620ms_var(--ease-out-quint)_both]"
          :class="k === '⌘' ? 'text-[30px]' : 'text-[34px]'"
          :style="{ animationDelay: `${i * 70}ms` }"
        >{{ k }}</span>
      </div>
      <p
        class="h-4 text-[12.5px] leading-4 text-ink-2"
        aria-live="polite"
      >
        {{ current.label }}
      </p>
    </div>
    <ul class="flex flex-col gap-0.5 rounded-[14px] bg-white/70 p-1.5 shadow-raise @max-[460px]:hidden">
      <li
        v-for="(r, i) in ROWS"
        :key="r.label"
        class="flex h-[30px] items-center gap-3 rounded-[9px] px-2 text-[12px] transition-colors duration-200 ease-[ease] motion-reduce:transition-none"
        :class="current.row === i ? 'bg-ink/5 text-ink [&_kbd]:text-lamp-ink [&_kbd]:shadow-[0_0_0_1px_var(--lamp),0_1px_0_rgba(42,114,224,.4)]' : 'text-ink-2'"
      >
        <span class="flex min-w-[54px] items-center gap-[3px]"><template
          v-for="k in r.keys"
          :key="k"
        ><span
          v-if="k === '–'"
          class="text-[12px] text-ink-3"
        >–</span><kbd v-else>{{ k }}</kbd></template></span>
        {{ r.label }}
      </li>
    </ul>
  </div>
</template>
