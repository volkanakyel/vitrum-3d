import type { H3Event } from 'h3'
import type { ApiResult } from '../../../app/utils/sculpt/types'
import type { CallTool, Prices } from './anthropic'
import { makeCallTool } from './anthropic'
import type { RouteCfg } from './routes'

type Core<T> = (body: unknown, callTool: CallTool, cfg: RouteCfg) => Promise<ApiResult<T>>

/**
 * The thin half of every sculpt route: read the body, refuse without a key, run
 * the pure core, and map the result onto the status code. Nothing but an error's
 * own `message` ever reaches the client — SDK errors carry request details.
 */
export async function runSculptRoute<T>(event: H3Event, core: Core<T>): Promise<ApiResult<T>> {
  const runtime = useRuntimeConfig(event)

  if (!runtime.anthropicKey) {
    setResponseStatus(event, 503)
    return { ok: false, error: 'NUXT_ANTHROPIC_KEY is not set on the server' }
  }

  let body: unknown
  try {
    body = await readBody(event)
  }
  catch {
    setResponseStatus(event, 422)
    return { ok: false, error: 'request body must be valid JSON' }
  }

  const cfg: RouteCfg = {
    modelAuthor: runtime.public.sculptModelAuthor,
    modelReview: runtime.public.sculptModelReview,
  }

  try {
    const callTool = makeCallTool({
      apiKey: runtime.anthropicKey,
      prices: runtime.public.sculptPrices as Prices,
      workspaceId: runtime.anthropicWorkspaceId,
    })
    const result = await core(body, callTool, cfg)
    if (!result.ok) setResponseStatus(event, 422)
    return result
  }
  catch (error) {
    setResponseStatus(event, 500)
    return { ok: false, error: error instanceof Error ? error.message : 'unexpected error' }
  }
}
