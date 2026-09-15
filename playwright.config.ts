import { defineConfig } from '@playwright/test'

/**
 * End-to-end config — `pnpm test:e2e`. Kept apart from vitest: vitest owns
 * `tests/**\/*.test.ts`, Playwright owns `tests/*.spec.ts`.
 *
 * Headless chromium has no GPU, so WebGL comes from ANGLE on SwiftShader —
 * without these flags the sandbox page cannot create a renderer.
 */
export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3010',
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        // A sandboxed iframe sharing the host's renderer process freezes the
        // host along with itself when generated code spins, and a wedged frame
        // keeps spinning after it is detached — so each sandboxed document gets
        // its own process. Real Chrome isolates by default; the headless shell
        // needs telling.
        '--site-per-process',
        '--enable-features=IsolateSandboxedIframes:grouping/per-document',
      ],
    },
  },
  webServer: {
    command: 'pnpm dev --port 3010',
    url: 'http://localhost:3010/sandbox-host',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
