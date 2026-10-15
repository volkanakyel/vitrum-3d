import type { MaterialPreset } from '~/utils/presets'

type Sphere = { background: string; boxShadow: string }

/**
 * A preset's swatch lit as a little sphere: a key highlight, then a bounce light or a core shadow.
 *
 * Color finishes are drawn in the colour the model will take, lit by the preset's own surface:
 * the highlight tightens and brightens with gloss and lacquer, sheen adds a soft rim, weave a fine
 * cross-hatch. Pass the picture's colours (`ink`, see `pictureInk`) when the model shows the
 * picture; without them the sphere takes the preset's paint.
 */
export function presetSphere(p: MaterialPreset, ink?: readonly string[] | null): Sphere {
  if (p.group === 'print') return inkSphere(p, ink?.length ? ink : [p.values.paint ?? '#e9e4dc'])
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

function inkSphere(p: MaterialPreset, ink: readonly string[]): Sphere {
  const v = p.values
  const rough = v.roughness ?? 0.5
  const coat = v.clearcoat ?? 0
  const sheen = v.sheen ?? 0
  const weave = v.weave ?? 0
  // 0 on a dead-matte surface, 1 on wet lacquer: drives the key highlight's strength and size.
  const gloss = Math.min(1, (1 - rough) * 0.85 + coat * 0.35)
  const a = (n: number) => Math.max(0, Math.min(1, n)).toFixed(2)
  const spot = 10 + rough * 22
  const base = ink.length > 2
    ? `linear-gradient(135deg, ${ink[0]} 0 30%, ${ink[1]} 37% 63%, ${ink[2]} 70% 100%)`
    : ink.length > 1
      ? `linear-gradient(135deg, ${ink[0]} 0 46%, ${ink[1]} 54% 100%)`
      : `radial-gradient(circle at 38% 32%, color-mix(in srgb, ${ink[0]}, #fff 14%), ${ink[0]} 55%, color-mix(in srgb, ${ink[0]}, #000 22%))`
  const layers = [
    `radial-gradient(circle at 31% 27%, rgba(255,255,255,${a(0.15 + gloss * 0.85)}) 0, rgba(255,255,255,${a(gloss * 0.4)}) ${spot * 0.4}%, rgba(255,255,255,0) ${spot}%)`,
    // A lacquer coat throws a second, crisp reflection low on the far side.
    coat > 0.3 ? `radial-gradient(circle at 70% 80%, rgba(255,255,255,${a(coat * 0.35)}) 0, rgba(255,255,255,0) 18%)` : '',
    sheen > 0 ? `radial-gradient(circle at 50% 50%, rgba(255,255,255,0) 52%, rgba(255,255,255,${a(sheen * 0.42)}) 70%, rgba(255,255,255,0) 74%)` : '',
    weave > 0 ? `repeating-linear-gradient(45deg, rgba(255,255,255,${a(weave * 0.16)}) 0 1px, transparent 1px 3px), repeating-linear-gradient(-45deg, rgba(0,0,0,${a(weave * 0.16)}) 0 1px, transparent 1px 3px)` : '',
    'radial-gradient(circle at 70% 78%, rgba(0,0,0,0.22) 0, rgba(0,0,0,0) 46%)',
    base,
  ].filter(Boolean)
  return {
    background: layers.join(','),
    boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.1), inset -4px -6px 10px rgba(0,0,0,${a(0.12 + (1 - gloss) * 0.1)}), 0 8px 14px -8px rgba(0,0,0,0.4)`,
  }
}
