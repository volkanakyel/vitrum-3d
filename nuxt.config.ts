import tailwindcss from '@tailwindcss/vite'

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
    '/studio/**': { ssr: false },
    // The sandbox runs generated code in an opaque-origin iframe; there is
    // nothing to render on the server, and its dev-only host page is the same.
    // The CSP travels as a response header, not a meta tag: `frame-ancestors`
    // is header-only, and it is what stops another site embedding this page
    // WITHOUT the sandbox attribute — which would run generated code on our
    // own origin. `ws:` only matters to the dev client and is inert in a build.
    '/sandbox': {
      ssr: false,
      headers: {
        'content-security-policy': [
          'default-src \'none\'',
          // 'unsafe-eval' is the point of this page: generated code runs in new Function().
          'script-src \'self\' \'unsafe-eval\' \'unsafe-inline\'',
          'style-src \'self\' \'unsafe-inline\'',
          'img-src data: blob:',
          'connect-src \'self\' ws: wss:',
          'frame-ancestors \'self\'',
        ].join('; '),
      },
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
  runtimeConfig: {
    public: {
      /** Depth model id on the Hugging Face hub, or a path under `/models/` when self-hosted. */
      depthModel: 'onnx-community/depth-anything-v2-small',
    },
  },
})
