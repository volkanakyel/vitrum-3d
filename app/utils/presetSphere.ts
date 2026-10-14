import type { MaterialPreset } from '~/utils/presets'

/** A preset's swatch lit as a little sphere: a key highlight, then a bounce light or a core shadow. */
export function presetSphere(p: MaterialPreset): { background: string; boxShadow: string } {
  const glassy = p.group !== 'metal'
  return {
    background: [
      'radial-gradient(circle at 30% 26%, rgba(255,255,255,0.95) 0, rgba(255,255,255,0.45) 9%, rgba(255,255,255,0) 26%)',
      glassy ? 'radial-gradient(circle at 68% 78%, rgba(255,255,255,0.55) 0, rgba(255,255,255,0) 32%)' : 'radial-gradient(circle at 70% 78%, rgba(0,0,0,0.28) 0, rgba(0,0,0,0) 46%)',
      p.swatch,
    ].join(','),
    boxShadow: glassy
      ? 'inset 0 0 0 1px rgba(0,0,0,0.08), inset -4px -6px 10px rgba(0,0,0,0.10), 0 8px 14px -8px rgba(0,0,0,0.35)'
      : 'inset -5px -7px 12px rgba(0,0,0,0.28), inset 3px 4px 8px rgba(255,255,255,0.25), 0 8px 14px -8px rgba(0,0,0,0.45)',
  }
}
