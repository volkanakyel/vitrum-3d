/**
 * Whether a sculpt run is possible at all: the key is server-only, so the
 * client cannot see it, and `public.sculptEnabled` is a build-time default the
 * deploy may not have set. This endpoint is the effective answer. It spends
 * nothing and reveals nothing beyond "the owner configured a key".
 */
export default defineEventHandler((event) => {
  const runtime = useRuntimeConfig(event)
  return { enabled: !!runtime.anthropicKey }
})
