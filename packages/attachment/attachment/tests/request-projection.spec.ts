import { describe, expect, it } from 'vitest'
import { liftUndersizedImageDimensions, longEdgeDimensions, requestImageDimensions } from '../src/index.ts'

describe('request image dimensions', () => {
  it.each([
    [4096, 4096, 800, 800],
    [4096, 2048, 1130, 565],
    [3840, 2160, 1066, 600],
    [320, 240, 320, 240],
  ])('projects %sx%s under 640,000 pixels as %sx%s', (width, height, expectedWidth, expectedHeight) => {
    const projected = requestImageDimensions(width, height, 640_000)
    expect(projected).toEqual({
      width: expectedWidth,
      height: expectedHeight,
    })
    expect(projected.width * projected.height).toBeLessThanOrEqual(640_000)
  })

  it('projects a portrait within the same total-pixel budget', () => {
    const projected = requestImageDimensions(2160, 3840, 640_000)

    expect(projected).toEqual({ width: 600, height: 1066 })
    expect(projected.width * projected.height).toBeLessThanOrEqual(640_000)
  })

  it('rounds a portrait inward when integer aspect rounding crosses the pixel cap', () => {
    expect(requestImageDimensions(2, 4, 5)).toEqual({ width: 1, height: 2 })
  })
})

describe('long-edge dimensions', () => {
  it('keeps the long edge exact and rounds the short edge', () => {
    expect(longEdgeDimensions(8000, 40, 4096)).toEqual({ width: 4096, height: 20 })
    expect(longEdgeDimensions(10_000, 100, 4096)).toEqual({ width: 4096, height: 41 })
    expect(longEdgeDimensions(1080, 2400, 1862)).toEqual({ width: 838, height: 1862 })
    expect(longEdgeDimensions(1, 9000, 4096)).toEqual({ width: 1, height: 4096 })
  })

  it('never enlarges a source at or below the long edge', () => {
    expect(longEdgeDimensions(320, 240, 320)).toEqual({ width: 320, height: 240 })
    expect(longEdgeDimensions(320, 240, 4096)).toEqual({ width: 320, height: 240 })
  })
})

describe('undersized image lift', () => {
  it('lifts a 16x16 icon to the 200px floor', () => {
    expect(liftUndersizedImageDimensions(16, 16, 200, 1568, 1568)).toEqual({ width: 200, height: 200 })
  })

  it('lifts a short strip only until the long edge hits the cap', () => {
    expect(liftUndersizedImageDimensions(16, 512, 200, 1568, 1568)).toEqual({ width: 49, height: 1568 })
    expect(liftUndersizedImageDimensions(512, 16, 200, 1568, 1568)).toEqual({ width: 1568, height: 49 })
  })

  it('leaves an image that already meets the floor, and a strip that cannot', () => {
    expect(liftUndersizedImageDimensions(320, 240, 200, 1568, 1568)).toEqual({ width: 320, height: 240 })
    expect(liftUndersizedImageDimensions(4, 8000, 200, 1568, 1568)).toEqual({ width: 4, height: 8000 })
  })

  it('clamps the floor to a cap smaller than the requested minimum', () => {
    expect(liftUndersizedImageDimensions(1, 1, 200, 10, 10)).toEqual({ width: 10, height: 10 })
  })
})
