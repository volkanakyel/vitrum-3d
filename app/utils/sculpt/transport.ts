/**
 * Fetch-based `Transport` for `/api/sculpt/*`. Every route already replies
 * with `ApiResult<T>` (`{ ok: true, data, usage, costUsd }` or
 * `{ ok: false, error }`), so this only has to POST JSON and normalise
 * network/parse failures into the same shape.
 */

import type { ApiResult } from './types'
import type { Transport } from './job'

async function post<T>(url: string, body: unknown, signal: AbortSignal): Promise<ApiResult<T>> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  }
  catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    return { ok: false, error: err instanceof Error ? err.message : 'network request failed' }
  }

  let json: unknown
  try {
    json = await response.json()
  }
  catch {
    return { ok: false, error: `request failed with status ${response.status}` }
  }

  if (!response.ok) {
    const error = isErrorBody(json) ? json.error : `request failed with status ${response.status}`
    return { ok: false, error }
  }

  return json as ApiResult<T>
}

function isErrorBody(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value
    && typeof (value as { error: unknown }).error === 'string'
}

export function fetchTransport(base = '/api/sculpt'): Transport {
  return {
    draft: (req, signal) => post(`${base}/draft`, req, signal),
    build: (req, signal) => post(`${base}/build`, req, signal),
    review: (req, signal) => post(`${base}/review`, req, signal),
  }
}
