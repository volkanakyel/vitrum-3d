import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_PX, apiImageSize } from '../app/utils/sculpt/apiImage'

describe('apiImageSize', () => {
  it('caps the long side at the API budget and keeps the aspect', () => {
    expect(apiImageSize(4000, 3000)).toEqual({ width: MAX_IMAGE_PX, height: Math.round(3000 * (MAX_IMAGE_PX / 4000)) })
    expect(apiImageSize(3000, 4000)).toEqual({ width: Math.round(3000 * (MAX_IMAGE_PX / 4000)), height: MAX_IMAGE_PX })
  })

  it('never upscales a photo that is already small enough', () => {
    expect(apiImageSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(apiImageSize(MAX_IMAGE_PX, MAX_IMAGE_PX)).toEqual({ width: MAX_IMAGE_PX, height: MAX_IMAGE_PX })
  })

  it('keeps a sliver at least one pixel wide', () => {
    expect(apiImageSize(4000, 1)).toEqual({ width: MAX_IMAGE_PX, height: 1 })
  })

  it('falls back to 1×1 for a photo with no size', () => {
    expect(apiImageSize(0, 0)).toEqual({ width: 1, height: 1 })
  })
})
