/**
 * Content-Security-Policy for `/studio`, as a pure function so `nuxt.config.ts`
 * can import it and the unit tests can assert both variants.
 *
 * `isDev` is decided at config time by the caller (`process.env.NODE_ENV`):
 * dev needs Vite's eval-based HMR client and its WebSocket, and neither may
 * leak into a production build.
 */

const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com'
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com'

/**
 * The studio's policy. Each source is here for a reason:
 *
 * - `script-src 'unsafe-inline'` — Nuxt's own payload script and the storage
 *   shim in `app.head` are inline. Dev adds `'unsafe-eval'` for Vite's HMR
 *   client.
 * - `worker-src 'self' blob:` — the trace worker; the bundler ships it
 *   through a blob URL in dev.
 * - `connect-src` — the app's own API and `blob:`/`data:` for the worker's
 *   own payloads. Dev adds `ws:`/`wss:` for HMR.
 * - `img-src data: blob:` — every texture, screenshot and imported photo is a
 *   canvas blob or a data URL.
 * - `style-src 'unsafe-inline'` + the Google Fonts stylesheet host — Tailwind's
 *   runtime-set custom properties and three's injected styles are inline.
 * - `object-src`/`base-uri`/`form-action` `'none'` — nothing in the studio
 *   needs a plugin, a `<base>` or a form post.
 */
export function studioCsp(isDev: boolean): string {
  const script = ['\'self\'', '\'unsafe-inline\'']
  if (isDev) script.push('\'unsafe-eval\'')
  const connect = ['\'self\'', 'data:', 'blob:']
  if (isDev) connect.push('ws:', 'wss:')

  return [
    'default-src \'self\'',
    `script-src ${script.join(' ')}`,
    `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS}`,
    `font-src 'self' data: ${GOOGLE_FONTS_FILES}`,
    'img-src \'self\' data: blob:',
    `connect-src ${connect.join(' ')}`,
    'worker-src \'self\' blob:',
    'object-src \'none\'',
    'base-uri \'none\'',
    'form-action \'none\'',
    'frame-ancestors \'self\'',
  ].join('; ')
}
