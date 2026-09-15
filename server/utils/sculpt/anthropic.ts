import Anthropic from '@anthropic-ai/sdk'
import type { Usage } from '../../../app/utils/sculpt/types'

export type ImageMediaType = 'image/jpeg' | 'image/png'

export type UserPart =
  | { type: 'text', text: string }
  | { type: 'image', base64: string, mediaType: ImageMediaType }

export interface ToolCall<T> {
  system: string
  user: UserPart[]
  tool: {
    name: string
    description: string
    schema: Record<string, unknown>
    /** Structured outputs. Defaults to true; off for schemas too large for the strict grammar. */
    strict?: boolean
  }
  model: string
  maxTokens: number
  /**
   * How hard the model thinks before it answers. Thinking is on by default on
   * the current models and its tokens are billed as output, so this is the
   * cost lever: `low` for a scored review, `medium` for a plan or a targeted
   * fix, `high` (the API default) for the one call that writes the model.
   */
  effort?: 'low' | 'medium' | 'high'
  /** Present only to keep `T` load-bearing at call sites. */
  readonly _result?: T
}

/** The slice of an API message this module reads — the seam the tests stub. */
export interface MessageLike {
  content: { type: string, input?: unknown }[]
  usage: { input_tokens?: number, output_tokens?: number, cache_read_input_tokens?: number, cache_creation_input_tokens?: number }
  stop_reason?: string | null
}

export type StreamFn = (params: Record<string, unknown>) => { finalMessage: () => Promise<MessageLike> }

export interface ToolResult<T> {
  data: T
  usage: Usage
  costUsd: number
  raw: string
}

export type CallTool = <T>(call: ToolCall<T>) => Promise<ToolResult<T>>

export interface Price { input: number, output: number }
export type Prices = Record<string, Price>

/** USD per million tokens, keyed by the family the model id starts with. */
export const DEFAULT_PRICES: Prices = {
  opus: { input: 5, output: 25 },
  sonnet: { input: 2, output: 10 },
  haiku: { input: 1, output: 5 },
}

/** `claude-opus-5-...` → `opus`; an id from no known family yields `unknown`, which is unpriced. */
export function priceKey(model: string): string {
  const m = /^claude-(opus|sonnet|haiku)/.exec(model)
  return m?.[1] ?? 'unknown'
}

export function costFor(model: string, usage: Usage, prices: Prices): number {
  const key = priceKey(model)
  const price = prices[key]
  // Silently costing a call at zero hides a typo in runtimeConfig until the bill
  // arrives, so an unpriced model is an error.
  if (!price) {
    throw new Error(`no price for model "${model}" (family "${key}"); known families: ${Object.keys(prices).join(', ') || 'none'}`)
  }
  return (usage.input * price.input + usage.output * price.output) / 1_000_000
}

const RETRIES = 3
const BASE_DELAY_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 429, 529, overloaded and transport errors are worth another attempt; 400s are not. */
function isTransient(error: unknown): boolean {
  const e = error as { status?: number, message?: string, name?: string } | null
  if (!e) return false
  if (e.status === 429 || e.status === 529 || e.status === 500 || e.status === 503) return true
  const message = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase()
  // `terminated` is undici's word for a stream the far end (or a middlebox)
  // closed mid-body; a long build stream sees it now and then.
  return /overloaded|rate.?limit|timeout|timed out|econnreset|enotfound|econnrefused|socket hang up|fetch failed|network|terminated|other side closed/.test(message)
}

export class NoToolCallError extends Error {
  constructor() {
    super('no tool call')
    this.name = 'NoToolCallError'
  }
}

/** The turn hit `max_tokens` before the tool call closed: the input is unusable. */
export class TruncatedError extends Error {
  constructor() {
    super('response truncated at max_tokens')
    this.name = 'TruncatedError'
  }
}

export interface CallToolConfig {
  apiKey: string
  prices?: Prices
  workspaceId?: string
  /** Seam for the tests: defaults to the SDK client's streaming messages call. */
  stream?: StreamFn
}

export function makeCallTool(cfg: CallToolConfig): CallTool {
  // A key that is not scoped to a workspace is refused unless the request names one.
  const client = cfg.stream
    ? null
    : new Anthropic({
        apiKey: cfg.apiKey,
        ...(cfg.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': cfg.workspaceId } } : {}),
      })
  const stream: StreamFn = cfg.stream
    ?? (params => client!.messages.stream(params as never) as unknown as { finalMessage: () => Promise<MessageLike> })
  const prices = cfg.prices ?? DEFAULT_PRICES

  return async function callTool<T>(call: ToolCall<T>): Promise<ToolResult<T>> {
    const content = call.user.map(part =>
      part.type === 'text'
        ? { type: 'text' as const, text: part.text }
        : {
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: part.mediaType, data: part.base64 },
          },
    )

    // The current models think by default and reject a forced `tool_choice`
    // alongside it, so the tool is always requested rather than forced, and the
    // system prompt carries the instruction instead. A turn that answers in prose
    // is retried once below.
    const system = `${call.system}\n\nAlways answer by calling the \`${call.tool.name}\` tool. Never reply with prose instead of the tool call.`

    const run = async (): Promise<ToolResult<T>> => {
      const message = await stream({
        model: call.model,
        max_tokens: call.maxTokens,
        // The system prompt is the same for every call of a kind (the build
        // one carries the kit doc and the exemplar, ~20k tokens), so it is
        // cached: the fix call and every run in the next five minutes read it
        // at a tenth of the price.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
        ...(call.effort ? { output_config: { effort: call.effort } } : {}),
        tools: [{
          name: call.tool.name,
          description: call.tool.description,
          input_schema: call.tool.schema,
          // Structured outputs: the API guarantees the input matches the schema,
          // so a flattened or partial object can no longer reach validation.
          strict: call.tool.strict ?? true,
        }],
        tool_choice: { type: 'auto' },
      }).finalMessage()

      // A truncated turn can still carry a half-parsed tool block, so this is
      // checked before the block is trusted.
      if (message.stop_reason === 'max_tokens') throw new TruncatedError()

      const block = message.content.find(b => b.type === 'tool_use')
      if (!block) throw new NoToolCallError()

      // Cached reads are billed at a tenth and cache writes at 1.25×; both
      // are folded into the input figure at their real weight so the tally
      // the user sees is what the run actually cost.
      const cacheRead = message.usage.cache_read_input_tokens ?? 0
      const cacheWrite = message.usage.cache_creation_input_tokens ?? 0
      const usage: Usage = {
        input: Math.round((message.usage.input_tokens ?? 0) + cacheRead * 0.1 + cacheWrite * 1.25),
        output: message.usage.output_tokens ?? 0,
      }
      return {
        data: block.input as T,
        usage,
        costUsd: costFor(call.model, usage, prices),
        raw: JSON.stringify(block.input),
      }
    }

    let lastError: unknown
    let softRetried = false
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        return await run()
      }
      catch (error) {
        lastError = error
        // A prose answer or a truncated one is worth exactly one more attempt;
        // repeating it usually means the request itself is too big.
        if ((error instanceof NoToolCallError || error instanceof TruncatedError) && !softRetried) {
          softRetried = true
          continue
        }
        if (!isTransient(error) || attempt === RETRIES - 1) throw error
        await sleep(BASE_DELAY_MS * 2 ** attempt)
      }
    }
    throw lastError
  }
}
