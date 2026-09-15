/**
 * Content-Security-Policy strings, as pure functions so `nuxt.config.ts` can
 * import them and the unit tests can assert both variants.
 *
 * Two pages need a policy of their own:
 *
 * - `/sandbox` executes model-written code. The security boundary is the
 *   opaque origin of `<iframe sandbox="allow-scripts">`; this policy is the
 *   second wall, and the thing it mainly buys is that generated code cannot
 *   open a socket or fetch anything at all.
 * - `/studio/**` parses an untrusted GLB (the sandbox's export) with three's
 *   loader on the app's own origin, and runs the depth model. It gets the
 *   tightest policy the studio still works under.
 *
 * `isDev` is decided at config time by the caller (`process.env.NODE_ENV`),
 * the same way `vite.server.cors` is gated: dev needs Vite's eval-based HMR
 * client and its WebSocket, and neither may leak into a production build.
 */

/**
 * Hosts the depth pipeline reaches, verified against the network log of a real
 * carve in Chromium:
 * - `huggingface.co` serves the model's config, and redirects the weights to
 *   `us.aws.cdn.hf.co` (`@huggingface/transformers` with
 *   `env.allowLocalModels = false`);
 * - `cdn.jsdelivr.net` is onnxruntime-web's own default for its WASM backend
 *   (`ort-wasm-simd-threaded.asyncify.{mjs,wasm}`), which it fetches from
 *   inside the depth worker. Pointing `env.backends.onnx.wasm.wasmPaths` at a
 *   self-hosted copy would let this line go; until then the policy has to say
 *   what the app actually does.
 */
const MODEL_HOSTS = [
  'https://huggingface.co',
  'https://*.huggingface.co',
  'https://*.hf.co',
  'https://cdn.jsdelivr.net',
] as const

/** Where the onnxruntime loader module comes from; see `MODEL_HOSTS`. */
const ORT_CDN = 'https://cdn.jsdelivr.net'

const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com'
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com'

/**
 * The sandbox page's policy.
 *
 * `connect-src 'none'` in production: generated code gets no network at all,
 * neither fetch nor WebSocket. Dev relaxes it to `'self' ws: wss:` purely so
 * Vite's HMR client can connect — which is also why the dev sandbox is only
 * usable behind `VITRUM_SANDBOX_E2E=1`.
 *
 * Note on `script-src 'self'`: on an opaque ("null") origin `'self'` matching
 * the page's own bundle is Chromium-verified behaviour only; other engines
 * have historically been less consistent. The sandbox attribute, not this
 * directive, is what the isolation rests on.
 *
 * `frame-ancestors` is header-only (a meta tag cannot express it) and is what
 * stops another site embedding this page WITHOUT the sandbox attribute, which
 * would run generated code on our own origin.
 */
export function sandboxCsp(isDev: boolean): string {
  return [
    'default-src \'none\'',
    // 'unsafe-eval' is the point of this page: generated code runs in new Function().
    'script-src \'self\' \'unsafe-eval\' \'unsafe-inline\'',
    'style-src \'self\' \'unsafe-inline\'',
    'img-src data: blob:',
    isDev ? 'connect-src \'self\' ws: wss:' : 'connect-src \'none\'',
    'frame-ancestors \'self\'',
    'base-uri \'none\'',
    'form-action \'none\'',
  ].join('; ')
}

/**
 * The studio's policy. Each source is here for a reason:
 *
 * - `script-src 'wasm-unsafe-eval'` — onnxruntime-web compiles the depth
 *   model's WASM backend; `'unsafe-inline'` — Nuxt's own payload script and
 *   the storage shim in `app.head` are inline; the jsDelivr host — the
 *   onnxruntime loader module the depth worker imports. Dev adds
 *   `'unsafe-eval'` for Vite's HMR client.
 * - `worker-src 'self' blob:` — the trace and depth workers; the bundler ships
 *   one of them through a blob URL in dev.
 * - `connect-src` — the app's own API, `blob:`/`data:` for the workers' own
 *   payloads, and the Hugging Face hosts the ~27 MB of depth weights come
 *   from. Dev adds `ws:`/`wss:` for HMR.
 * - `img-src data: blob:` — every texture, screenshot and imported photo is a
 *   canvas blob or a data URL.
 * - `style-src 'unsafe-inline'` + the Google Fonts stylesheet host — Tailwind's
 *   runtime-set custom properties and three's injected styles are inline.
 * - `frame-src 'self'` — the sculpt sandbox iframe.
 * - `object-src`/`base-uri`/`form-action` `'none'` — nothing in the studio
 *   needs a plugin, a `<base>` or a form post, and a parsed-GLB or
 *   injected-markup foothold does.
 */
export function studioCsp(isDev: boolean): string {
  const script = ['\'self\'', '\'wasm-unsafe-eval\'', '\'unsafe-inline\'', ORT_CDN]
  if (isDev) script.push('\'unsafe-eval\'')
  const connect = ['\'self\'', 'data:', 'blob:', ...MODEL_HOSTS]
  if (isDev) connect.push('ws:', 'wss:')

  return [
    'default-src \'self\'',
    `script-src ${script.join(' ')}`,
    `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS}`,
    `font-src 'self' data: ${GOOGLE_FONTS_FILES}`,
    'img-src \'self\' data: blob:',
    `connect-src ${connect.join(' ')}`,
    'worker-src \'self\' blob:',
    'frame-src \'self\'',
    'object-src \'none\'',
    'base-uri \'none\'',
    'form-action \'none\'',
    'frame-ancestors \'self\'',
  ].join('; ')
}
