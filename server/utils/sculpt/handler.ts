import type { H3Event } from 'h3'
import type { ApiResult } from '../../../app/utils/sculpt/types'
import type { CallTool, Prices } from './anthropic'
import { makeCallTool } from './anthropic'
import type { RouteCfg } from './routes'
import { budgetExceeded, clientIp, guardState, recordSpend, takeToken } from './guard'

type Core<T> = (body: unknown, callTool: CallTool, cfg: RouteCfg) => Promise<ApiResult<T>>

/**
 * Hard ceiling on a request body, checked from `content-length` before a byte
 * is read. The largest legitimate body is a review (photo + sheet, each ≤ 4 MB
 * of image, base64-expanded), so 8 MB of raw bytes is generous.
 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

/** Fixed, safe messages; the detail goes to the server log under a ref id. */
const CATEGORY = {
  upstream: 'the model service failed',
  unexpected: 'the request failed',
} as const

/**
 * The thin half of every sculpt route: refuse oversized bodies, apply the
 * unauthenticated-deploy guards (per-IP rate limit, daily spend ceiling), read
 * the body, refuse without a key, run the pure core, and map the result onto
 * the status code.
 *
 * Errors thrown by the SDK never reach the client in production: they carry
 * request ids, headers and sometimes prompt fragments. The full error is
 * logged with a correlation id and the client is told the category plus that
 * id. Validation failures produced by the cores are different — they are
 * written for the user and are shown in the panel, so they pass through.
 */
export async function runSculptRoute<T>(event: H3Event, core: Core<T>): Promise<ApiResult<T>> {
  const runtime = useRuntimeConfig(event)

  const declared = Number(getRequestHeader(event, 'content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    setResponseStatus(event, 413)
    return { ok: false, error: `request body must be under ${Math.floor(MAX_BODY_BYTES / (1024 * 1024))} MB` }
  }

  const now = Date.now()
  const ip = clientIp(getRequestHeader(event, 'x-forwarded-for'), event.node.req.socket.remoteAddress)
  const rate = takeToken(guardState, ip, now)
  if (!rate.allowed) {
    setResponseStatus(event, 429)
    setResponseHeader(event, 'retry-after', rate.retryAfterSeconds)
    return { ok: false, error: 'rate limited' }
  }

  if (!runtime.anthropicKey) {
    setResponseStatus(event, 503)
    return { ok: false, error: 'NUXT_ANTHROPIC_KEY is not set on the server' }
  }

  const budgetUsd = Number(runtime.sculptDailyBudgetUsd)
  if (budgetExceeded(guardState, now, budgetUsd)) {
    setResponseStatus(event, 503)
    return { ok: false, error: 'daily budget reached' }
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
    const startedAt = Date.now()
    const result = await core(body, callTool, cfg)
    // One line per call is how a slow pass gets found: which route, how long,
    // how many tokens, what it cost.
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    const usage = result.usage ? `${result.usage.input}/${result.usage.output} tok` : 'no usage'
    console.info(`[sculpt] ${event.path ?? ''} ${result.ok ? 'ok' : 'failed'} in ${seconds}s · ${usage} · $${(result.costUsd ?? 0).toFixed(3)}`)
    // A failed core may still have paid for calls (validation after the model
    // answered); charge the day for whatever it reports.
    recordSpend(guardState, Date.now(), result.costUsd ?? 0)
    if (!result.ok) setResponseStatus(event, 422)
    return result
  }
  catch (error) {
    // Tokens may have been spent before this threw, but nothing survives the
    // throw to report them: this path is invisible to the daily ceiling.
    const ref = correlationId()
    console.error(`[sculpt ${ref}] ${event.path ?? ''}`, error)
    setResponseStatus(event, 500)
    const detail = error instanceof Error ? error.message : String(error)
    const category = looksUpstream(detail) ? CATEGORY.upstream : CATEGORY.unexpected
    return {
      ok: false,
      error: import.meta.dev
        ? `${category}: ${detail} (ref ${ref})`
        : `${category} (ref ${ref})`,
    }
  }
}

/** Short, greppable, and not a secret: it only has to match a log line. */
function correlationId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function looksUpstream(message: string): boolean {
  return /anthropic|api|status|rate|overload|timeout|connect|network/i.test(message)
}
