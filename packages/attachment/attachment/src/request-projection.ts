/**
 * Pure request-projection geometry shared by model routes and provider-side
 * request pricing. @module @deepseek-ai/dsh-attachment/request-projection
 */

/** Integer width and height of one projected image. */
export interface ProjectedDimensions {
  width: number
  height: number
}

/**
 * Compute aspect-preserving integer dimensions within a hard total-pixel budget.
 * @param width - positive source width.
 * @param height - positive source height.
 * @param maxPixels - positive width-times-height cap.
 * @returns inward-rounded dimensions; small images are not enlarged.
 */
export function requestImageDimensions(
  width: number,
  height: number,
  maxPixels: number,
): ProjectedDimensions {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)))
  if (scale === 1) return { width, height }
  if (width >= height) {
    let projectedWidth = Math.max(1, Math.floor(width * scale))
    let projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    while (projectedWidth * projectedHeight > maxPixels && projectedWidth > 1) {
      projectedWidth -= 1
      projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    }
    return { width: projectedWidth, height: projectedHeight }
  }
  let projectedHeight = Math.max(1, Math.floor(height * scale))
  let projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  while (projectedWidth * projectedHeight > maxPixels && projectedHeight > 1) {
    projectedHeight -= 1
    projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  }
  return { width: projectedWidth, height: projectedHeight }
}

/**
 * Compute aspect-preserving integer dimensions with an exact long edge; the
 * short edge rounds to the nearest pixel, as an encoder resize by the
 * long edge alone.
 * @param width - positive source width.
 * @param height - positive source height.
 * @param longEdge - positive target for the longer source edge.
 * @returns the target dimensions; a long edge at or above the source returns the source unchanged.
 */
export function longEdgeDimensions(
  width: number,
  height: number,
  longEdge: number,
): ProjectedDimensions {
  if (longEdge >= Math.max(width, height)) return { width, height }
  return width >= height
    ? { width: longEdge, height: Math.max(1, Math.round(longEdge * height / width)) }
    : { width: Math.max(1, Math.round(longEdge * width / height)), height: longEdge }
}

/**
 * Smallest edge length vision backends reliably accept. 200×200 is the
 * smallest size Anthropic documents as valid.
 */
export const REQUEST_IMAGE_MIN_DIMENSION = 200

/**
 * Long-edge cap for enlarging an undersized image. Vision backends tile below
 * this edge; sources already longer than it are not shrunk to it.
 */
export const REQUEST_IMAGE_MAX_EDGE = 1568

/**
 * Lift an undersized image toward a minimum edge with one uniform scale.
 * The scale never crosses `maxWidth` or `maxHeight` and never stretches the
 * aspect ratio. A strip that cannot reach the floor without crossing a cap
 * is returned unchanged. This does not shrink; callers apply their own
 * pixel budget first.
 * @param width - positive source width.
 * @param height - positive source height.
 * @param minDimension - positive minimum edge the result should reach.
 * @param maxWidth - positive width cap the enlargement must not cross.
 * @param maxHeight - positive height cap the enlargement must not cross.
 * @returns aspect-preserving dimensions; an enlargement rounds each edge to the nearest pixel, then clamps it to its cap.
 */
export function liftUndersizedImageDimensions(
  width: number,
  height: number,
  minDimension: number,
  maxWidth: number,
  maxHeight: number,
): ProjectedDimensions {
  const floor = Math.min(minDimension, maxWidth, maxHeight)
  if (width >= floor && height >= floor) return { width, height }
  const shortEdge = Math.min(width, height)
  const upscale = Math.min(floor / shortEdge, maxWidth / width, maxHeight / height)
  if (upscale <= 1) return { width, height }
  return {
    width: Math.min(maxWidth, Math.round(width * upscale)),
    height: Math.min(maxHeight, Math.round(height * upscale)),
  }
}
