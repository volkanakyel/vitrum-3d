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

/**
 * The draft call does the plan and the build in one turn: the plan prompt,
 * then the build prompt, with their separate "call this tool" lines replaced
 * by one. Same words the two-call path used, so the two cannot drift.
 */
const untooled = (text: string) => text.replace(/^Output \*\*only\*\* by calling the `plan` tool\.\n?/m, '').replace(/^Output only by calling the `build` tool\.\n?/m, '').trimEnd()
const draft = [
  'You read one product photograph and, in the same answer, write the procedural model that rebuilds it. Two halves, one tool call: `spec` is the plan (first section below), `code` is the finished factory built from that plan (second section), `notes` is a short list of what you built. Write the plan first, in full, then the code against it — the code must use the plan\'s component ids and numbers.',
  '# Part one — the plan',
  untooled(plan),
  '# Part two — the model',
  untooled(build),
  'Output only by calling the `draft` tool, with `spec`, `code` and `notes`.',
].join('\n\n')

export const PROMPTS: {
  plan: string
  build: string
  draft: string
  review: string
  kitApi: string
} = { plan, build, draft, review, kitApi }
