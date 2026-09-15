import Anthropic from '@anthropic-ai/sdk'
import type { Usage } from '../../../app/utils/sculpt/types'

export type ImageMediaType = 'image/jpeg' | 'image/png'

export type UserPart =
  | { type: 'text', text: string }
  | { type: 'image', base64: string, mediaType: ImageMediaType }

export interface ToolCall<T> {
  system: string
  user: UserPart[]
  tool: { name: string, description: string, schema: Record<string, unknown> }
  model: string
  maxTokens: number
  /**
   * Ask for extended thinking. The 5-series takes adaptive thinking only — a
   * `budget_tokens` budget is rejected with a 400 — so a number here is read as
   * "yes, think", not as a budget.
   */
  thinking?: boolean | number
  /** Present only to keep `T` load-bearing at call sites. */
  readonly _result?: T
}

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

/** `claude-opus-5-...` → `opus`. Unknown families cost nothing rather than guessing high. */
export function priceKey(model: string): string {
  const m = /^claude-(opus|sonnet|haiku)/.exec(model)
  return m?.[1] ?? 'unknown'
}

export function costFor(model: string, usage: Usage, prices: Prices): number {
  const price = prices[priceKey(model)]
  if (!price) return 0
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
  return /overloaded|rate.?limit|timeout|timed out|econnreset|enotfound|econnrefused|socket hang up|fetch failed|network/.test(message)
}

export class NoToolCallError extends Error {
  constructor() {
    super('no tool call')
    this.name = 'NoToolCallError'
  }
}

export function makeCallTool(cfg: { apiKey: string, prices?: Prices, workspaceId?: string }): CallTool {
  // A key that is not scoped to a workspace is refused unless the request names one.
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    ...(cfg.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': cfg.workspaceId } } : {}),
  })
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
    const thinking = call.thinking ? { thinking: { type: 'adaptive' as const } } : {}
    const toolChoice = { type: 'auto' as const }
    const system = `${call.system}\n\nAlways answer by calling the \`${call.tool.name}\` tool. Never reply with prose instead of the tool call.`

    const run = async (): Promise<ToolResult<T>> => {
      const stream = client.messages.stream({
        model: call.model,
        max_tokens: call.maxTokens,
        system,
        messages: [{ role: 'user', content }],
        tools: [{
          name: call.tool.name,
          description: call.tool.description,
          input_schema: call.tool.schema as never,
        }],
        tool_choice: toolChoice,
        ...thinking,
      })
      const message = await stream.finalMessage()

      const block = message.content.find(b => b.type === 'tool_use')
      if (!block) throw new NoToolCallError()

      const usage: Usage = {
        input: message.usage.input_tokens ?? 0,
        output: message.usage.output_tokens ?? 0,
      }
      return {
        data: (block as { input: unknown }).input as T,
        usage,
        costUsd: costFor(call.model, usage, prices),
        raw: JSON.stringify((block as { input: unknown }).input),
      }
    }

    let lastError: unknown
    let noToolRetried = false
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        return await run()
      }
      catch (error) {
        lastError = error
        if (error instanceof NoToolCallError && !noToolRetried) {
          noToolRetried = true
          continue
        }
        if (!isTransient(error) || attempt === RETRIES - 1) throw error
        await sleep(BASE_DELAY_MS * 2 ** attempt)
      }
    }
    throw lastError
  }
}
