import { MATERIAL_PRESETS, type MaterialPreset } from '~/utils/presets'

/** Finishes the hero can preview. Order is the swatch order. */
export const LANDING_LOOK_IDS = ['chrome', 'silver', 'titanium', 'black', 'smoke', 'obsidian', 'frosted', 'clear'] as const

export interface LandingExample {
  /** Sample id in `samples.ts`; the card opens it in the studio. */
  id: string
  name: string
  finish: string
  preset: string
  image: string
}

export interface LandingFaq {
  question: string
  answer: string
}

/** Rendered in the studio at its default size, angle view. Images live in `public/images`. */
export const LANDING_EXAMPLES: LandingExample[] = [
  { id: 'github', name: 'GitHub', finish: 'Polished chrome', preset: 'chrome', image: 'set/github-chrome' },
  { id: 'figma', name: 'Figma', finish: 'Ceramic', preset: 'ceramic', image: 'set/figma-ceramic' },
  { id: 'spotify', name: 'Spotify', finish: 'Titanium', preset: 'titanium', image: 'set/spotify-titanium' },
  { id: 'discord', name: 'Discord', finish: 'Milk glass', preset: 'milk', image: 'set/discord-milk' },
  { id: 'apple', name: 'Apple', finish: 'Brushed aluminium', preset: 'silver', image: 'set/apple-silver' },
  { id: 'linear', name: 'Linear', finish: 'Obsidian glass', preset: 'obsidian', image: 'set/linear-obsidian' },
]

export const LANDING_FAQS: LandingFaq[] = [
  { question: 'Do I need to know 3D?', answer: 'No. Drop in a logo or icon, pick a finish and turn it to the angle you want. Vitrum builds the geometry for you. Depth, bevel, lighting and material stay adjustable if you want to go further.' },
  { question: 'What files work best?', answer: 'SVG, PNG, JPG and WebP. A mark with a clear silhouette gives the cleanest result. A transparent background helps but isn’t required: Vitrum detects the shape either way.' },
  { question: 'Can I use the GLB in three.js or React Three Fiber?', answer: 'Yes. The GLB is a standard glTF binary with physically based materials, sized in metres, so it loads in three.js, React Three Fiber, Spline, Blender and most 3D tools.' },
  { question: 'Can I use it for client work?', answer: 'Everything you export is yours to use. Only upload artwork you own or have permission to use, and check a brand’s guidelines before rendering its logo.' },
  { question: 'Do my files leave my device?', answer: 'No. Tracing, modelling and rendering all run in your browser. Nothing is uploaded, and there’s no account to create.' },
]

/** Resolves hero swatches from the shared material list so a renamed preset fails loudly. */
export function landingLooks(): MaterialPreset[] {
  return LANDING_LOOK_IDS.map((id) => {
    const preset = MATERIAL_PRESETS.find(item => item.id === id)
    if (!preset) throw new Error(`Missing material preset: ${id}`)
    return preset
  })
}
