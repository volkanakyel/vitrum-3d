<script setup lang="ts">
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const props = defineProps<{ label: string; modelValue: string; swatches?: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const defaultSwatches = ['#ffffff', '#f5f5f4', '#e6e9f0', '#cfe0ff', '#7fb2ff', '#b8f0e3', '#ffe2c0', '#ffb3b3', '#d9c8ff', '#17181b']
const palette = computed(() => props.swatches ?? defaultSwatches)

// --- colour maths -------------------------------------------------------------
function hexToHsv(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 1]
  const n = parseInt(m[1]!, 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
  }
  return [h, max ? d / max : 0, max]
}
function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

const hsv = ref<[number, number, number]>(hexToHsv(props.modelValue))
watch(() => props.modelValue, v => {
  if (v.toLowerCase() !== hsvToHex(...hsv.value).toLowerCase()) hsv.value = hexToHsv(v)
})
function commit() { emit('update:modelValue', hsvToHex(...hsv.value)) }

const hueHex = computed(() => hsvToHex(hsv.value[0], 1, 1))
const hexDraft = ref(props.modelValue.replace(/^#/, ''))
watch(() => props.modelValue, v => (hexDraft.value = v.replace(/^#/, '')))
function commitHex() {
  const v = `#${hexDraft.value.replace(/^#/, '')}`
  if (/^#[0-9a-f]{6}$/i.test(v)) emit('update:modelValue', v.toLowerCase())
  else hexDraft.value = props.modelValue.replace(/^#/, '')
}
function pickSwatch(v: unknown) {
  if (typeof v === 'string' && v) emit('update:modelValue', v)
}

// --- pointer handling on the saturation/value square and hue strip ------------
// The markers follow the pointer 1:1 (no transition on their position); pointer capture keeps the
// drag alive outside the square, and a second finger can't hijack it.
function drag(e: PointerEvent, onMove: (x: number, y: number) => void) {
  if (!e.isPrimary) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const rect = el.getBoundingClientRect()
  const update = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height))
    onMove(x, y)
    commit()
  }
  update(e)
  const stop = () => {
    el.removeEventListener('pointermove', update)
    el.removeEventListener('pointerup', stop)
    el.removeEventListener('pointercancel', stop)
  }
  el.addEventListener('pointermove', update)
  el.addEventListener('pointerup', stop)
  el.addEventListener('pointercancel', stop)
}
const onSquare = (e: PointerEvent) => drag(e, (x, y) => { hsv.value = [hsv.value[0], x, 1 - y] })
const onHue = (e: PointerEvent) => drag(e, x => { hsv.value = [x * 359.99, hsv.value[1], hsv.value[2]] })
</script>

<template>
  <div class="flex h-6 items-center justify-between">
    <span class="text-[13.5px] text-ink-2">{{ label }}</span>
    <Popover>
      <PopoverTrigger as-child>
        <button
          type="button"
          :aria-label="`${label}: ${modelValue}`"
          class="group -mr-1.5 flex h-6 items-center gap-2 rounded-[8px] pr-2 pl-1 transition-[background-color,box-shadow] duration-150 ease-[ease] hover:bg-well focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none data-[state=open]:bg-card data-[state=open]:shadow-raise"
        >
          <span
            class="size-4 rounded-[5px] shadow-[inset_0_0_0_1px_rgba(38,40,46,0.12),inset_0_1px_0_rgba(255,255,255,0.35),0_1px_1px_rgba(38,40,46,0.08)]"
            :style="{ background: modelValue }"
          />
          <span class="text-[13px] font-medium text-ink-2 uppercase tabular-nums transition-colors duration-150 ease-[ease] group-hover:text-foreground">{{ modelValue.replace('#', '') }}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" :side-offset="6" class="w-56 rounded-2xl p-3">
        <div
          class="relative h-32 w-full cursor-crosshair touch-none rounded-xl shadow-[inset_0_0_0_1px_rgba(17,18,20,0.08)]"
          :style="{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})` }"
          @pointerdown="onSquare"
        >
          <span
            class="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
            :style="{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: modelValue }"
          />
        </div>
        <div
          class="relative mt-3 h-3 w-full cursor-pointer touch-none rounded-full shadow-[inset_0_0_0_1px_rgba(17,18,20,0.08)]"
          style="background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
          @pointerdown="onHue"
        >
          <span
            class="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
            :style="{ left: `${(hsv[0] / 360) * 100}%`, background: hueHex }"
          />
        </div>
        <InputGroup class="mt-3 h-8 rounded-[10px] border-0 bg-card shadow-raise has-[[data-slot=input-group-control]:focus-visible]:ring-ring/35">
          <InputGroupAddon class="pl-1.5">
            <span
              class="size-5 rounded-[6px] shadow-[inset_0_0_0_1px_rgba(38,40,46,0.12),inset_0_1px_0_rgba(255,255,255,0.35)]"
              :style="{ background: modelValue }"
            />
            <span class="text-[13px] font-medium text-muted-foreground">#</span>
          </InputGroupAddon>
          <InputGroupInput
            v-model="hexDraft"
            :aria-label="`${label} hex value`"
            maxlength="7"
            class="pl-0 text-[13px] font-medium uppercase tabular-nums md:text-[13px]"
            spellcheck="false"
            @blur="commitHex"
            @keydown.enter="commitHex"
          />
        </InputGroup>
        <ToggleGroup
          type="single"
          :model-value="palette.find(c => c.toLowerCase() === modelValue.toLowerCase())"
          class="mt-3 grid w-full grid-cols-10 gap-1"
          @update:model-value="pickSwatch"
        >
          <ToggleGroupItem
            v-for="c in palette" :key="c"
            :value="c"
            :aria-label="c"
            class="aspect-square h-auto min-w-0 rounded-full p-0 shadow-[inset_0_0_0_1px_rgba(38,40,46,0.1)] transition-[scale,box-shadow] duration-150 ease-out hover:scale-110 active:scale-95 active:duration-100 data-[state=on]:shadow-[inset_0_0_0_1px_rgba(38,40,46,0.1),0_0_0_2px_var(--card),0_0_0_3.5px_var(--lamp)]"
            :style="{ background: c }"
          />
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  </div>
</template>
