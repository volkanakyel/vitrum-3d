import tailwindcss from '@tailwindcss/vite'
import { studioCsp } from './server/utils/csp'

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
  runtimeConfig: { public: { siteUrl: '' } },
  modules: ['shadcn-nuxt', 'motion-v/nuxt', '@nuxt/fonts'],
  // Self-hosted at build time: no render-blocking third-party stylesheet, no extra origins in the
  // CSP, and metric-matched fallbacks so the swap from system font to Geist does not shift layout.
  fonts: {
    defaults: { subsets: ['latin'], styles: ['normal'] },
    families: [
      { name: 'Geist', provider: 'google', weights: ['300 700'], preload: true },
    ],
  },
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  // Folder names organise the source; they are not part of the component name.
  components: [{ path: '~/components', pathPrefix: false }],
  css: ['~/assets/main.css'],
  experimental: {
    // The hero's stage morphs into the studio's stage (both carry `view-transition-name: stage`).
    // `true` skips it for visitors who prefer reduced motion.
    viewTransition: true,
    defaults: {
      // The studio bundle includes Three.js. Prefetch it on hover or focus, not merely because
      // a landing link is in view, so the prerendered page can paint before that download starts.
      nuxtLink: { prefetchOn: { interaction: true, visibility: false } },
    },
  },
  routeRules: {
    // The landing page is static HTML with a WebGL layer on top; the studio is a WebGL editor
    // with nothing worth rendering on the server.
    '/': { prerender: true },
    // See `studioCsp` for what every source in the policy is for.
    '/studio': {
      ssr: false,
      headers: { 'content-security-policy': studioCsp(IS_DEV) },
    },
  },
  app: {
    head: {
      title: 'Vitrum',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Vitrum turns any icon, logo or wordmark into a true-to-size 3D object in glass, metal or full colour that you can orbit and export.' },
        { name: 'theme-color', content: '#eceef2' },
      ],
      script: [{ innerHTML: STORAGE_SHIM }],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '64x64', href: '/favicon.png' },
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['three', 'three/examples/jsm/exporters/GLTFExporter.js', 'd3-contour'],
    },
  },
})
