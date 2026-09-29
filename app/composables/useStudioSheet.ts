import { createSharedComposable } from '@vueuse/core'
import { motionValue } from 'motion-v'

export type SheetSnap = 'peek' | 'half' | 'full'

/**
 * The phone controls sheet, shared between the sheet itself and the stage it floats over.
 *
 * `height` is the sheet's live height in px as a motion value, so the stage can recentre the model
 * and the view dock can ride the sheet's top edge frame by frame without a Vue render. It stays 0
 * on desktop, where the sidebar sits beside the stage instead. `peek` is the height of the resting
 * sheet (grip, finishes and tabs), which the stage treats as its floor.
 */
export const useStudioSheet = createSharedComposable(() => {
  const height = motionValue(0)
  const peek = ref(0)
  const half = ref(0)
  const full = ref(0)
  /** Gap between the screen's bottom edge and the sheet (the safe area on notched phones). */
  const inset = ref(0)
  const snap = ref<SheetSnap>('peek')
  return { height, peek, half, full, inset, snap }
})
