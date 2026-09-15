import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const fixtureCode = readFileSync(
  fileURLToPath(new URL('./fixtures/orange-chair.kit.js', import.meta.url)),
  'utf8',
)
const resultDir = fileURLToPath(new URL('../test-results/', import.meta.url))
const reportDir = fileURLToPath(new URL('../.superpowers/sdd/2026-09-15-sculpt/', import.meta.url))

interface SandboxApi {
  ready(): Promise<void>
  load(code: string, quality: 'draft' | 'standard' | 'hero', seed: number): Promise<{
    parts: string[]
    triangles: number
    drawCalls: number
    bounds: { w: number, h: number, d: number }
  }>
  render(
    views: { name: string, yaw: number, pitch: number, fov: number, distance: number }[],
    size?: number,
  ): Promise<{ name: string, blob: Blob }[]>
  exportGLB(): Promise<ArrayBuffer>
  dispose(): void
}

declare global {
  interface Window {
    __sandbox: SandboxApi
    __probe?: { ok: boolean, message: string }
  }
}

test.describe('sculpt sandbox', () => {
  test.describe.configure({ mode: 'serial' })

  test('serves a framing-proof CSP', async ({ page }) => {
    const response = await page.request.get('/sandbox')
    const csp = response.headers()['content-security-policy']
    expect(csp).toBeTruthy()
    expect(csp).toContain('frame-ancestors \'self\'')
    expect(csp).toContain('default-src \'none\'')
  })

  test('loads, renders and exports the fixture, and survives bad code', async ({ page }) => {
    test.setTimeout(240_000)

    await page.goto('/sandbox-host')
    await page.waitForFunction(() => Boolean(window.__sandbox), null, { timeout: 30_000 })
    await page.evaluate(() => window.__sandbox.ready())

    // load
    const loaded = await page.evaluate(
      code => window.__sandbox.load(code, 'standard', 1),
      fixtureCode,
    )
    expect(loaded.parts.length).toBeGreaterThanOrEqual(5)
    expect(loaded.triangles).toBeGreaterThan(0)
    expect(loaded.drawCalls).toBeGreaterThan(0)
    expect(loaded.bounds.h).toBeGreaterThan(0)

    // render
    const rendered = await page.evaluate(async () => {
      const views = [{ name: 'ref', yaw: 30, pitch: 15, fov: 40, distance: 2.4 }]
      const out = await window.__sandbox.render(views, 512)
      return Promise.all(out.map(async v => ({
        name: v.name,
        type: v.blob.type,
        size: v.blob.size,
        bytes: Array.from(new Uint8Array(await v.blob.arrayBuffer())),
      })))
    })
    expect(rendered).toHaveLength(1)
    expect(rendered[0]!.name).toBe('ref')
    expect(rendered[0]!.type).toBe('image/png')
    expect(rendered[0]!.size).toBeGreaterThan(10_000)
    const png = Buffer.from(rendered[0]!.bytes)
    mkdirSync(resultDir, { recursive: true })
    writeFileSync(`${resultDir}sculpt-fixture-ref.png`, png)
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(`${reportDir}task-3-fixture-ref.png`, png)

    // export
    const magic = await page.evaluate(async () => {
      const glb = await window.__sandbox.exportGLB()
      return new TextDecoder().decode(new Uint8Array(glb.slice(0, 4)))
    })
    expect(magic).toBe('glTF')

    // code that throws rejects with the message
    const thrown = await page.evaluate(async () => {
      try {
        await window.__sandbox.load('function createModel() { throw new Error("boom-from-model") }', 'draft', 1)
        return 'resolved'
      }
      catch (error) {
        return (error as Error).message
      }
    })
    expect(thrown).toContain('boom-from-model')

    // an infinite loop rejects, and the iframe is recreated so the next load works
    const spun = await page.evaluate(async () => {
      const started = Date.now()
      let message = 'resolved'
      try {
        await window.__sandbox.load('function createModel() { while (true) {} }', 'draft', 1)
      }
      catch (error) {
        message = (error as Error).message
      }
      return { message, elapsed: Date.now() - started }
    })
    expect(spun.message).toMatch(/timeout|timed out/i)
    expect(spun.elapsed).toBeLessThan(25_000)

    const reloaded = await page.evaluate(
      code => window.__sandbox.load(code, 'draft', 1),
      fixtureCode,
    )
    expect(reloaded.parts.length).toBeGreaterThanOrEqual(5)
  })

  test('ignores a forged response from generated code', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/sandbox-host')
    await page.waitForFunction(() => Boolean(window.__sandbox), null, { timeout: 30_000 })

    // The model shouts a fake "loaded" for every plausible id before building
    // the real thing. Without the host's nonce none of them is accepted.
    const forge = `
      for (let id = 1; id <= 50; id++) {
        parent.postMessage({ type: 'loaded', id, parts: [], triangles: 0, drawCalls: 0, bounds: { w: 0, h: 0, d: 0 } }, '*')
      }
    `
    const loaded = await page.evaluate(
      code => window.__sandbox.load(code, 'draft', 1),
      fixtureCode.replace('function createModel(kit, THREE, options) {', `function createModel(kit, THREE, options) {\n${forge}`),
    )
    expect(loaded.parts.length).toBeGreaterThanOrEqual(5)
  })

  test('blocks network access from generated code', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/sandbox-host')
    await page.waitForFunction(() => Boolean(window.__sandbox), null, { timeout: 30_000 })

    const probeCode = `
      function createModel(kit, THREE, options) {
        fetch('https://example.com/').then(
          function () { parent.postMessage({ __probe: true, ok: true, message: 'fetch resolved' }, '*') },
          function (e) { parent.postMessage({ __probe: true, ok: false, message: String(e) }, '*') },
        )
        return kit.root([kit.part('block', kit.box(0.2, 0.2, 0.2), kit.plastic({ color: '#888888' }), { position: [0, 0.1, 0] })])
      }
    `
    const probe = await page.evaluate(async (code) => {
      const seen = new Promise<{ ok: boolean, message: string }>((resolve) => {
        window.addEventListener('message', (event) => {
          const data = event.data as { __probe?: boolean, ok: boolean, message: string }
          if (data && data.__probe) resolve({ ok: data.ok, message: data.message })
        })
      })
      await window.__sandbox.load(code, 'draft', 1)
      const timeout = new Promise<{ ok: boolean, message: string }>(resolve =>
        setTimeout(() => resolve({ ok: false, message: 'no probe message' }), 10_000))
      return Promise.race([seen, timeout])
    }, probeCode)

    // A real rejection, not a missing probe: the CSP must be what stopped it.
    expect(probe.ok).toBe(false)
    expect(probe.message).toMatch(/TypeError|Failed to fetch/i)
  })
})
