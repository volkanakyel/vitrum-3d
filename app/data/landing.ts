import { MATERIAL_PRESETS, type MaterialPreset } from '~/utils/presets'

/** Finishes the hero can preview. Order is the swatch order. */
export const LANDING_LOOK_IDS = ['sapphire', 'crystal', 'chrome', 'gold', 'rose'] as const

export interface LandingExample {
  id: string
  name: string
  type: string
  material: string
  preset: string
  image: string
  tone: 'blue' | 'silver' | 'pink'
  alt: string
  label: string
}

export interface LandingFaq {
  question: string
  answer: string
}

export const LANDING_EXAMPLES: LandingExample[] = [
  {
    id: 'camera',
    name: 'A fresh perspective.',
    type: 'For your next big launch',
    material: 'Sapphire glass',
    preset: 'sapphire',
    image: 'sapphire',
    tone: 'blue',
    alt: 'Sapphire glass camera rendered in 3D',
    label: 'Open Sapphire glass camera in the studio',
  },
  {
    id: 'chat',
    name: 'Start a conversation.',
    type: 'Give your brand a voice',
    material: 'Polished chrome',
    preset: 'chrome',
    image: 'chrome',
    tone: 'silver',
    alt: 'Polished chrome chat rendered in 3D',
    label: 'Open Polished chrome chat in the studio',
  },
  {
    id: 'heart',
    name: 'Make them feel it.',
    type: 'A little love for your feed',
    material: 'Rosé glass',
    preset: 'rose',
    image: 'rose',
    tone: 'pink',
    alt: 'Rosé glass heart rendered in 3D',
    label: 'Open Rosé glass heart in the studio',
  },
]

export const LANDING_FAQS: LandingFaq[] = [
  { question: 'Do I need to know 3D?', answer: 'No. Start with a logo or icon, choose a material, and turn it around. Vitrum builds the geometry for you. You can adjust the depth, bevel, lighting and finish whenever you want.' },
  { question: 'What can I upload?', answer: 'PNG, JPG, WebP and SVG files. Logos and icons with a clear silhouette make a great starting point. A transparent background helps, but is not required.' },
  { question: 'Can I use it in client work?', answer: 'You can export your designs as a PNG for presentations and social posts, a GLB for 3D and web projects, or an STL for fabrication. Use artwork you own or have permission to use.' },
  { question: 'Do my files leave my device?', answer: 'No. Tracing, modelling and rendering happen in your browser. Your uploaded artwork stays on your device. There is no account to create and nothing to install.' },
]

/** Resolves hero swatches from the shared material list so a renamed preset fails loudly. */
export function landingLooks(): MaterialPreset[] {
  return LANDING_LOOK_IDS.map((id) => {
    const preset = MATERIAL_PRESETS.find(item => item.id === id)
    if (!preset) throw new Error(`Missing material preset: ${id}`)
    return preset
  })
}
