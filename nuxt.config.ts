import tailwindcss from '@tailwindcss/vite'
import { sandboxCsp, studioCsp } from './server/utils/sculpt/csp'

/**
 * Decided once, at config time, the same way `vite.server.cors` below is: the
 * dev-only relaxations (Vite's eval-based HMR client and its WebSocket) must
 * never be baked into a production build.
 */
const IS_DEV = process.env.NODE_ENV !== 'production'

/** Installed inline, ahead of the app bundle; a no-op wherever storage works. */
const STORAGE_SHIM = `(function(){try{window.localStorage;return}catch(e){}
function mem(){var m=new Map();return{getItem:function(k){k=String(k);return m.has(k)?m.get(k):null},setItem:function(k,v){m.set(String(k),String(v))},removeItem:function(k){m.delete(String(k))},clear:function(){m.clear()},key:function(i){return Array.from(m.keys())[i]||null},get length(){return m.size}}}
Object.defineProperty(window,'localStorage',{value:mem(),configurable:true});
Object.defineProperty(window,'sessionStorage',{value:mem(),configurable:true})})()`

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  modules: ['shadcn-nuxt', 'motion-v/nuxt'],
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  // Folder names organise the source; they are not part of the component name.
  components: [{ path: '~/components', pathPrefix: false }],
  css: ['~/assets/main.css'],
  routeRules: {
    // The landing page is static HTML with a WebGL layer on top; the studio is a WebGL editor
    // with nothing worth rendering on the server.
    '/': { prerender: true },
    // The studio parses a GLB the sandbox exported — untrusted geometry run
    // through three's loader on our own origin — and runs the depth model.
    // See `studioCsp` for what every source in the policy is for.
    '/studio/**': {
      ssr: false,
      headers: { 'content-security-policy': studioCsp(IS_DEV) },
    },
    // The sandbox runs generated code in an opaque-origin iframe; there is
    // nothing to render on the server, and its dev-only host page is the same.
    // The CSP travels as a response header, not a meta tag: `frame-ancestors`
    // is header-only, and it is what stops another site embedding this page
    // WITHOUT the sandbox attribute — which would run generated code on our
    // own origin.
    '/sandbox': {
      ssr: false,
      headers: { 'content-security-policy': sandboxCsp(IS_DEV) },
    },
    '/sandbox-host': { ssr: false },
  },
  // The sandbox page runs on an opaque origin ("null"), and ES modules are
  // always fetched in CORS mode — without this its own bundle is blocked.
  // Dev is covered by `vite.server.cors` below; doing both would emit the
  // header twice, which browsers reject.
  $production: {
    routeRules: { '/_nuxt/**': { headers: { 'access-control-allow-origin': '*' } } },
  },
  app: {
    head: {
      title: 'Vitrum',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Vitrum turns any icon, logo or product photo into a true-to-size 3D object in glass, metal or full colour that you can orbit and export.' },
        { name: 'theme-color', content: '#eceef2' },
      ],
      script: [
        // The sandbox page runs in an opaque-origin iframe, where reading
        // window.localStorage throws — and Vue Router's devtools hook reads it
        // while the bundle is still evaluating, which would kill the app before
        // it mounts. A memory shim, installed only where the real one throws.
        { innerHTML: STORAGE_SHIM },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Inter:opsz,wght@14..32,400..600&family=IBM+Plex+Mono:wght@400;500&display=swap' },
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // The sandbox iframe cannot recover from vite's mid-flight dependency
    // re-optimisation, so everything it imports is pre-bundled.
    optimizeDeps: {
      include: ['three', 'three/examples/jsm/exporters/GLTFExporter.js', 'd3-contour'],
      exclude: ['@huggingface/transformers'],
    },
    // Same reason as the `$production` rule above, for the dev server: the
    // sandbox iframe asks for its modules from origin "null". Allowing the
    // null origin also lets any page that can reach this dev server read source
    // from a sandboxed frame, so it is opt-in: the e2e run sets the variable,
    // ordinary `pnpm dev` does not (and the sandbox page is then unusable in
    // dev, which is the safer default).
    server: process.env.VITRUM_SANDBOX_E2E === '1'
      ? { cors: { origin: ['null', /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/] } }
      : undefined,
  },
  // A sculpt run is a chain of long tool calls; the platform default (10 s / 60 s)
  // cuts the author model off mid-file.
  //
  // This is deliberately global. Only `/api/sculpt/**` needs it, but Nitro
  // 2.13's `NitroRouteConfig` has no `vercel` key, so there is no supported
  // per-route way to say it from here — the alternative would be hand-writing
  // `functions` into `.vercel/output/config.json` after the build. Two things
  // follow: a 300 s duration requires a Vercel Pro plan (Hobby caps at 60 s),
  // and every other function in this app inherits the same ceiling even though
  // none of them runs for more than a moment.
  nitro: {
    vercel: { functions: { maxDuration: 300 } },
    rollupConfig: {
      // The sculpt prompts are Markdown imported as strings. Vite resolves the
      // `?raw` query natively, but Nitro's own raw plugin keys on the extension
      // alone and hands rollup "intake.md?raw" as a filename, which does not
      // exist. Drop the query here; Nitro's raw plugin then loads the .md as
      // text, exactly as Vite's ?raw does for the test run.
      plugins: [{
        name: 'raw-query',
        async resolveId(id: string, importer: string | undefined, options: unknown) {
          if (!id.endsWith('.md?raw')) return null
          const resolved = await (this as {
            resolve: (id: string, importer?: string, options?: unknown) => Promise<{ id: string } | null>
          }).resolve(id.slice(0, -4), importer, options)
          return resolved?.id ?? null
        },
      }],
    },
  },
  runtimeConfig: {
    /** Server-only: set with NUXT_ANTHROPIC_KEY. Never exposed to the client. */
    anthropicKey: '',
    /** Only needed when the key is not itself scoped to a workspace (NUXT_ANTHROPIC_WORKSPACE_ID). */
    anthropicWorkspaceId: '',
    /**
     * Ceiling on what the sculpt routes may spend in one UTC day, in USD
     * (NUXT_SCULPT_DAILY_BUDGET_USD). Counted in this process's memory — see
     * `server/utils/sculpt/guard.ts` for what that does and does not buy. 0
     * disables the ceiling.
     */
    sculptDailyBudgetUsd: 25,
    public: {
      /** Depth model id on the Hugging Face hub, or a path under `/models/` when self-hosted. */
      depthModel: 'onnx-community/depth-anything-v2-small',
      /**
       * Writes the draft — the plan and the first model in one call, the call
       * the user waits for. Sonnet 5 was tried here and was both slower (it
       * writes twice the tokens) and worse; see RouteCfg.
       */
      sculptModelDraft: 'claude-opus-5',
      /** Writes the fix from the reviewer's defects. */
      sculptModelAuthor: 'claude-opus-5',
      /** Scores the renders — cheaper, and the judgement is vision-bound, not authoring-bound. */
      sculptModelReview: 'claude-sonnet-5',
      /** USD per million tokens, by model family. */
      sculptPrices: {
        opus: { input: 5, output: 25 },
        sonnet: { input: 2, output: 10 },
      },
      /**
       * The studio hides the sculpt panel when the server has no key. This is
       * a runtime flag (NUXT_PUBLIC_SCULPT_ENABLED), false by default: the key
       * is server-only and a build machine's environment says nothing about
       * the deploy's. Leaving it false is the ordinary case — the client also
       * asks `/api/sculpt/status`, which reports the key the server actually
       * has, and either source being true enables the panel.
       */
      sculptEnabled: false,
    },
  },
})
