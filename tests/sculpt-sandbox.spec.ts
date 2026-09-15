import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const fixtureCode = readFileSync(
  fileURLToPath(new URL('./fixtures/orange-chair.kit.js', import.meta.url)),
  'utf8',
)
const artefactDir = fileURLToPath(new URL('../.superpowers/sdd/2026-09-15-sculpt/', import.meta.url))

declare global {
  interface Window {
    __sandbox: {
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
  }
}

test.describe('sculpt sandbox', () => {
  test.describe.configure({ mode: 'serial' })

  test('loads, renders and exports the fixture, and survives bad code', async ({ page }) => {
    test.setTimeout(180_000)
    const consoleErrors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

    await page.goto('/sandbox-host')
    await page.waitForFunction(() => Boolean(window.__sandbox), null, { timeout: 30_000 })
    await page.evaluate(() => window.__sandbox.ready())

    // load
    const loaded = await page.evaluate(
      (code) => window.__sandbox.load(code, 'standard', 1),
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
    mkdirSync(artefactDir, { recursive: true })
    writeFileSync(`${artefactDir}task-3-fixture-ref.png`, Buffer.from(rendered[0]!.bytes))

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
      (code) => window.__sandbox.load(code, 'draft', 1),
      fixtureCode,
    )
    expect(reloaded.parts.length).toBeGreaterThanOrEqual(5)
  })
})
