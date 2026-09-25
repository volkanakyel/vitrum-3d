import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge only knows Tailwind's default scales. Register the tokens from `main.css`
 * (`rounded-card`, `shadow-raise`, `max-split:` …) so an override like `rounded-full` or
 * `shadow-none` replaces them instead of both classes landing on the element.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['window', 'card', 'pane', 'tile'],
      shadow: ['raise', 'raise-dark', 'float', 'pane', 'hairline'],
      'inset-shadow': ['hairline'],
      ease: ['out-quint', 'out-expo', 'in-out-cubic'],
      animate: ['rise', 'lift', 'settle', 'breathe', 'breathe-halo', 'sweep'],
      breakpoint: ['desk', 'lap', 'split', 'tab', 'fold', 'phone', 'xs', '2xs', '3xs'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
