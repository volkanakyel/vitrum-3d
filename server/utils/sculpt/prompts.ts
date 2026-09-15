import intake from './prompts/intake.md?raw'
import spec from './prompts/spec.md?raw'
import buildCommon from './prompts/build.md?raw'
import blockout from './prompts/build-blockout.md?raw'
import structural from './prompts/build-structural.md?raw'
import form from './prompts/build-form.md?raw'
import material from './prompts/build-material.md?raw'
import surface from './prompts/build-surface.md?raw'
import exemplar from './prompts/exemplar.md?raw'
import review from './prompts/review.md?raw'
import kitApi from './prompts/kit-api.md?raw'
import { FORBIDDEN } from './validateCode'
import type { PassId } from '../../../app/utils/sculpt/types'

/**
 * The build prompt states the forbidden identifiers verbatim from the validator,
 * so the rule the model is told and the rule the code is judged by cannot drift.
 */
const build = [
  buildCommon.replace('{{FORBIDDEN}}', FORBIDDEN.map(name => `\`${name}\``).join(', ')),
  kitApi,
  exemplar,
].join('\n\n')

export const PROMPTS: {
  intake: string
  spec: string
  build: string
  buildPass: Record<PassId, string>
  review: string
  kitApi: string
} = {
  intake,
  spec,
  build,
  buildPass: { blockout, structural, form, material, surface },
  review,
  kitApi,
}
