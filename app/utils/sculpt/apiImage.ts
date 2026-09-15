/**
 * The source photo as the API takes it: a JPEG data URL no longer than
 * `MAX_IMAGE_PX` on its long side (Anthropic's image budget — anything larger
 * is resampled server-side and paid for twice).
 *
 * The arithmetic is split out as `apiImageSize` so it can be tested without a
 * canvas.
 */

/** Long side of the photo sent to the API. */
export const MAX_IMAGE_PX = 1568
export const IMAGE_QUALITY = 0.9

/**
 * The pixel size to draw at: aspect preserved, long side capped, never
 * upscaled, and never smaller than one pixel.
 */
export function apiImageSize(width: number, height: number, max = MAX_IMAGE_PX): { width: number, height: number } {
  const long = Math.max(width, height)
  if (!(long > 0)) return { width: 1, height: 1 }
  const k = Math.min(1, max / long)
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
  }
}

export function toApiImage(img: HTMLImageElement, max = MAX_IMAGE_PX): string {
  const size = apiImageSize(img.naturalWidth || img.width, img.naturalHeight || img.height, max)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  // JPEG has no alpha: a transparent cut-out would come out black otherwise.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
}
