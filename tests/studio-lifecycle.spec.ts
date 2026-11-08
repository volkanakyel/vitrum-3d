import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Studio } from '~/composables/useStudio'

declare global {
  interface Window { __vs: Studio; __restoreGraphics?: () => void }
}

test.setTimeout(90_000)

test('latest import wins and an immediate STL export uses the requested dimensions', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/studio')
  await page.waitForFunction(() => !!window.__vs?.viewer.value)
  await page.evaluate(async () => {
    const studio = window.__vs
    await Promise.all([studio.loadSample('vitrum'), studio.loadSample('star')])
  })
  await expect.poll(() => page.evaluate(() => window.__vs.ready.value)).toBe(true)
  expect(await page.evaluate(() => ({ name: window.__vs.fileName.value, error: window.__vs.error.value, busy: window.__vs.busy.value })))
    .toEqual({ name: 'star.png', error: '', busy: false })

  const downloaded = page.waitForEvent('download')
  await page.evaluate(() => {
    window.__vs.glass.widthMm = 137
    return window.__vs.doExport('stl')
  })
  const download = await downloaded
  const bytes = await readFile((await download.path())!)
  const triangles = bytes.readUInt32LE(80)
  let minX = Infinity, maxX = -Infinity
  for (let i = 0; i < triangles; i++) {
    for (let vertex = 0; vertex < 3; vertex++) {
      const x = bytes.readFloatLE(84 + i * 50 + 12 + vertex * 12)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
    }
  }
  // Corner rounding can shrink the bounding box slightly. It must match the rebuilt stage,
  // and must already be near the requested width instead of the previous 100 mm target.
  expect(maxX - minX).toBeGreaterThan(130)
  expect(maxX - minX).toBeCloseTo(await page.evaluate(() => window.__vs.dims.value!.widthMm), 4)
  expect(errors).toEqual([])
})

test('studio stays unavailable after context loss and rebuilds current document on restoration', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/studio')
  await page.waitForFunction(() => !!window.__vs?.viewer.value)
  await page.evaluate(() => window.__vs.loadSample('star'))
  await expect.poll(() => page.evaluate(() => window.__vs.ready.value)).toBe(true)
  await page.locator('section[aria-label="Stage"] canvas').evaluate((element) => {
    const gl = (element as HTMLCanvasElement).getContext('webgl2')!
    const extension = gl.getExtension('WEBGL_lose_context')!
    window.__restoreGraphics = () => extension.restoreContext()
    extension.loseContext()
  })
  await expect.poll(() => page.evaluate(() => window.__vs.viewerError.value)).not.toBe('')
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(await page.evaluate(() => window.__vs.ready.value)).toBe(false)
  await page.evaluate(() => window.__restoreGraphics?.())
  await expect.poll(() => page.evaluate(() => window.__vs.ready.value), { timeout: 30_000 }).toBe(true)
  expect(await page.evaluate(() => window.__vs.fileName.value)).toBe('star.png')
  expect(errors).toEqual([])
})

test('landing WebGL availability recovers after context loss', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const scene = page.locator('[data-ready]')
  await expect(scene).toHaveAttribute('data-ready', 'true', { timeout: 45_000 })
  await scene.locator('canvas').evaluate((element) => {
    const extension = (element as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context')!
    window.__restoreGraphics = () => extension.restoreContext()
    extension.loseContext()
  })
  await expect(scene).toHaveAttribute('data-ready', 'false')
  await page.evaluate(() => window.__restoreGraphics?.())
  await expect(scene).toHaveAttribute('data-ready', 'true', { timeout: 45_000 })
  expect(errors).toEqual([])
})
