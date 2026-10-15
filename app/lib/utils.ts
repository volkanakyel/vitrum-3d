import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge only knows Tailwind's default scales. Register the tokens from `main.css`
 * (`rounded-window`, `shadow-raise`, `max-split:` …) so an override like `rounded-full` or
 * `shadow-none` replaces them instead of both classes landing on the element.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['window', 'pane', 'tile'],
      shadow: ['raise', 'raise-dark', 'pane'],
      ease: ['spring'],
      animate: ['rise', 'breathe', 'breathe-halo', 'sweep'],
      breakpoint: ['desk', 'split', 'tab', 'fold', 'phone', '2xs', '3xs'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
