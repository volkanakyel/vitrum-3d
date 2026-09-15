import plan from './prompts/plan.md?raw'
import buildCommon from './prompts/build.md?raw'
import exemplar from './prompts/exemplar.md?raw'
import review from './prompts/review.md?raw'
import kitApi from './prompts/kit-api.md?raw'
import { FORBIDDEN } from './validateCode'

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
  plan: string
  build: string
  review: string
  kitApi: string
} = { plan, build, review, kitApi }
