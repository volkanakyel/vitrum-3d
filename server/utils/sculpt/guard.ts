/**
 * Defence in depth for the `/api/sculpt/*` routes.
 *
 * These routes spend the owner's Anthropic credit and have NO authentication:
 * real auth and paid credits are the next phase. Until then a per-IP rate
 * limit and a daily spend ceiling keep an accident (or a bored stranger who
 * found the deploy) from emptying the account.
 *
 * IMPORTANT, and the reason every function here takes its state explicitly:
 * the counters live in this process's memory. On a serverless platform each
 * instance has its own, so the effective limits are "per instance", not
 * global — a fleet of N instances allows up to N times these numbers. That is
 * a speed bump, NOT a substitute for authentication. The README's deployment
 * posture note is the rule that matters: do not set NUXT_ANTHROPIC_KEY on a
 * publicly reachable deploy before the auth phase.
 *
 * Everything below is pure apart from the state object it is handed, and the
 * clock is always a parameter, so the whole thing is unit-testable.
 */

/** Requests allowed per IP per window. */
export const RATE_LIMIT_MAX = 30
/** Length of the fixed window, in milliseconds. */
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
/** Hard cap on how many IPs we track before the oldest expired ones are dropped. */
const MAX_TRACKED_IPS = 10_000

export interface RateWindow {
  count: number
  /** Epoch ms at which this window ends and the count resets. */
  resetAt: number
}

export interface GuardState {
  windows: Map<string, RateWindow>
  /** UTC day (`YYYY-MM-DD`) the spend below belongs to. */
  day: string
  spentUsd: number
}

export function createGuardState(): GuardState {
  return { windows: new Map(), day: '', spentUsd: 0 }
}

/** The UTC calendar day a timestamp falls in, as `YYYY-MM-DD`. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/**
 * The caller's address: the first hop of `x-forwarded-for` when a proxy set
 * one (later hops are appended by the proxies themselves and are not the
 * client), else the socket's peer address. Unknown collapses to a single
 * bucket, which is the conservative choice.
 */
export function clientIp(forwardedFor: string | undefined, remoteAddress: string | undefined): string {
  const first = forwardedFor?.split(',')[0]?.trim()
  if (first) return first
  return remoteAddress?.trim() || 'unknown'
}

/** Drops finished windows; called on every take, and bounded so it stays cheap. */
function sweep(state: GuardState, now: number): void {
  for (const [ip, window] of state.windows) {
    if (window.resetAt <= now) state.windows.delete(ip)
  }
  // A flood of one-shot addresses can outrun the sweep above (every window is
  // still open); dropping the whole table is correct-but-lenient and keeps the
  // map from growing without bound.
  if (state.windows.size > MAX_TRACKED_IPS) state.windows.clear()
}

/**
 * Counts one request against `ip`. Returns `false` when the IP has already
 * used its allowance for the current window, along with when it resets.
 */
export function takeToken(
  state: GuardState,
  ip: string,
  now: number,
  max: number = RATE_LIMIT_MAX,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): { allowed: boolean, retryAfterSeconds: number } {
  sweep(state, now)
  const existing = state.windows.get(ip)
  if (!existing || existing.resetAt <= now) {
    state.windows.set(ip, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) }
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
  if (existing.count >= max) return { allowed: false, retryAfterSeconds }
  existing.count += 1
  return { allowed: true, retryAfterSeconds }
}

/**
 * True when today's recorded spend has already reached the ceiling. Checked
 * BEFORE the Anthropic call; the call's own cost is added afterwards, so one
 * request can overshoot the ceiling by its own size. That is deliberate: a
 * pre-charged estimate would need a refund path for every failure mode, and
 * one request's worth of overshoot is a few dollars at most.
 */
export function budgetExceeded(state: GuardState, now: number, limitUsd: number): boolean {
  if (!(limitUsd > 0)) return false
  const day = utcDay(now)
  if (state.day !== day) return false
  return state.spentUsd >= limitUsd
}

/** Adds the cost of a completed call to today's tally, rolling over at UTC midnight. */
export function recordSpend(state: GuardState, now: number, costUsd: number): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return
  const day = utcDay(now)
  if (state.day !== day) {
    state.day = day
    state.spentUsd = 0
  }
  state.spentUsd += costUsd
}

/** What today's tally looks like; for diagnostics and tests. */
export function spendToday(state: GuardState, now: number): number {
  return state.day === utcDay(now) ? state.spentUsd : 0
}

/** The one process-wide instance the routes share. */
export const guardState: GuardState = createGuardState()
