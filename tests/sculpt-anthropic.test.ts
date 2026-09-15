import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRICES, costFor, makeCallTool, priceKey } from '../server/utils/sculpt/anthropic'
import type { MessageLike, StreamFn, ToolCall } from '../server/utils/sculpt/anthropic'

function message(over: Partial<MessageLike> = {}): MessageLike {
  return {
    content: [{ type: 'tool_use', input: { ok: true } }],
    usage: { input_tokens: 1000, output_tokens: 500 },
    stop_reason: 'tool_use',
    ...over,
  }
}

/** Replays queued messages or errors, one per attempt, and records the params sent. */
function stubStream(queue: (MessageLike | Error)[]) {
  const params: Record<string, unknown>[] = []
  const stream: StreamFn = (p) => {
    params.push(p)
    const next = queue.shift()
    return {
      finalMessage: async () => {
        if (next instanceof Error) throw next
        if (!next) throw new Error('stub stream: queue exhausted')
        return next
      },
    }
  }
  return { stream, params }
}

function call(): ToolCall<unknown> {
  return {
    system: 'be precise',
    user: [
      { type: 'text', text: 'hello' },
      { type: 'image', base64: 'AAAA', mediaType: 'image/png' },
    ],
    tool: { name: 'intake', description: 'report it', schema: { type: 'object' } },
    model: 'claude-opus-5',
    maxTokens: 16_000,
  }
}

function apiError(status: number): Error & { status: number } {
  return Object.assign(new Error(`request failed with ${status}`), { status })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('costFor', () => {
  it('maps a model id to its family', () => {
    expect(priceKey('claude-opus-5')).toBe('opus')
    expect(priceKey('claude-sonnet-5')).toBe('sonnet')
    expect(priceKey('claude-haiku-4-5')).toBe('haiku')
    expect(priceKey('gpt-9')).toBe('unknown')
  })

  it('prices a call per million tokens', () => {
    // 1M in at $5 + 0.5M out at $25 = 5 + 12.5
    expect(costFor('claude-opus-5', { input: 1_000_000, output: 500_000 }, DEFAULT_PRICES)).toBeCloseTo(17.5)
    expect(costFor('claude-sonnet-5', { input: 1000, output: 2000 }, DEFAULT_PRICES)).toBeCloseTo(0.022)
  })

  it('throws for a model family with no price, so a config typo surfaces', () => {
    expect(() => costFor('claude-fable-5', { input: 10, output: 10 }, DEFAULT_PRICES))
      .toThrow(/no price for model "claude-fable-5"/)
  })
})

describe('makeCallTool', () => {
  it('sends the call and returns the tool block with usage and cost', async () => {
    const { stream, params } = stubStream([message()])
    const callTool = makeCallTool({ apiKey: 'k', stream })
    const result = await callTool(call())

    expect(result.data).toEqual({ ok: true })
    expect(result.usage).toEqual({ input: 1000, output: 500 })
    expect(result.costUsd).toBeCloseTo(1000 * 5 / 1e6 + 500 * 25 / 1e6)
    expect(result.raw).toBe('{"ok":true}')

    const sent = params[0]!
    expect(sent.model).toBe('claude-opus-5')
    expect(sent.max_tokens).toBe(16_000)
    // Forced tool choice is rejected alongside the models' default thinking.
    expect(sent.tool_choice).toEqual({ type: 'auto' })
    const system = (sent.system as { text: string, cache_control: unknown }[])[0]!
    expect(system.text).toContain('be precise')
    expect(system.text).toContain('Always answer by calling the `intake` tool')
    expect(system.cache_control).toEqual({ type: 'ephemeral' })
    const content = (sent.messages as { content: Record<string, unknown>[] }[])[0]!.content
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    })
  })

  it('skips a text-only answer and retries once', async () => {
    const { stream, params } = stubStream([
      message({ content: [{ type: 'text' }], stop_reason: 'end_turn' }),
      message(),
    ])
    const callTool = makeCallTool({ apiKey: 'k', stream })
    await expect(callTool(call())).resolves.toMatchObject({ data: { ok: true } })
    expect(params).toHaveLength(2)
  })

  it('gives up after a second answer with no tool call', async () => {
    const prose = () => message({ content: [{ type: 'text' }], stop_reason: 'end_turn' })
    const { stream, params } = stubStream([prose(), prose()])
    const callTool = makeCallTool({ apiKey: 'k', stream })
    await expect(callTool(call())).rejects.toThrow('no tool call')
    expect(params).toHaveLength(2)
  })

  it('rejects a truncated turn even when it carries a tool block, and retries once', async () => {
    const { stream, params } = stubStream([message({ stop_reason: 'max_tokens' }), message()])
    const callTool = makeCallTool({ apiKey: 'k', stream })
    await expect(callTool(call())).resolves.toMatchObject({ data: { ok: true } })
    expect(params).toHaveLength(2)
  })

  it('gives up after a second truncated turn', async () => {
    const { stream } = stubStream([
      message({ stop_reason: 'max_tokens' }),
      message({ stop_reason: 'max_tokens' }),
    ])
    const callTool = makeCallTool({ apiKey: 'k', stream })
    await expect(callTool(call())).rejects.toThrow('truncated at max_tokens')
  })

  it('backs off across three attempts on 429 and succeeds on the last', async () => {
    vi.useFakeTimers()
    const { stream, params } = stubStream([apiError(429), apiError(429), message()])
    const callTool = makeCallTool({ apiKey: 'k', stream })

    const pending = callTool(call())
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toMatchObject({ data: { ok: true } })
    expect(params).toHaveLength(3)
  })

  it('stops at three attempts and rethrows the transient error', async () => {
    vi.useFakeTimers()
    const { stream, params } = stubStream([apiError(529), apiError(529), apiError(529)])
    const callTool = makeCallTool({ apiKey: 'k', stream })

    const pending = callTool(call()).catch((e: Error) => e)
    await vi.runAllTimersAsync()

    expect((await pending as Error).message).toContain('529')
    expect(params).toHaveLength(3)
  })

  it('retries a stream the far end terminated', async () => {
    vi.useFakeTimers()
    const terminated = Object.assign(new TypeError('terminated'), { cause: new Error('other side closed') })
    const { stream, params } = stubStream([terminated, message()])
    const callTool = makeCallTool({ apiKey: 'k', stream })

    const pending = callTool(call())
    await vi.runAllTimersAsync()

    expect((await pending).data).toBeDefined()
    expect(params).toHaveLength(2)
  })

  it('does not retry a 400', async () => {
    const { stream, params } = stubStream([apiError(400), message()])
    const callTool = makeCallTool({ apiKey: 'k', stream })
    await expect(callTool(call())).rejects.toThrow('400')
    expect(params).toHaveLength(1)
  })
})
