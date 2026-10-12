/**
 * Copyright (c) 2025-2026 Can Bölük
 * Copyright (c) 2026 Stencil Labs, Inc.
 *
 * Adapted from oh-my-pi snapcompact (MIT).
 */

import { at, item } from './read.ts'

const PI = Math.PI

/**
 * Lanczos kernel with radius 3.
 * @param x - distance from the sample, in destination pixels.
 * @returns the kernel weight.
 */
export function lanczos3(x: number): number {
  const ax = Math.abs(x)
  if (ax < 1e-6) return 1
  if (ax >= 3) return 0
  const pix = PI * ax
  return (Math.sin(pix) / pix) * (Math.sin(pix / 3) / (pix / 3))
}

/**
 * Per-output-pixel kernel weights.
 * @param srcLen - source length.
 * @param dstLen - destination length.
 * @returns one contribution run per destination pixel.
 */
export function contributions(srcLen: number, dstLen: number): Array<{ begin: number; weights: number[] }> {
  const scale = srcLen / dstLen
  const filtScale = Math.max(scale, 1)
  const support = 3 * filtScale
  const out: Array<{ begin: number; weights: number[] }> = []
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) * scale
    const begin = Math.max(0, Math.trunc(center - support))
    const end = Math.min(srcLen, Math.max(0, Math.ceil(center + support)))
    const weights: number[] = []
    let total = 0
    for (let x = begin; x < end; x++) {
      const w = lanczos3((x + 0.5 - center) / filtScale)
      weights.push(w)
      total += w
    }
    if (total !== 0) {
      for (let k = 0; k < weights.length; k++) weights[k] = at(weights, k) / total
    }
    out.push({ begin, weights })
  }
  return out
}

/**
 * Separable Lanczos3 resize of interleaved RGB f32 samples.
 * @param src - source samples.
 * @param sw - source width.
 * @param sh - source height.
 * @param dw - destination width.
 * @param dh - destination height.
 * @returns resized RGB samples.
 */
export function resizeRgb(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const horiz = contributions(sw, dw)
  const tmp = new Float32Array(dw * sh * 3)
  for (let y = 0; y < sh; y++) {
    const srcRow = y * sw * 3
    const dstRow = y * dw * 3
    for (let x = 0; x < horiz.length; x++) {
      const { begin, weights } = item(horiz, x)
      let a0 = 0
      let a1 = 0
      let a2 = 0
      for (let k = 0; k < weights.length; k++) {
        const w = at(weights, k)
        const s = srcRow + (begin + k) * 3
        a0 = at(src, s) * w + a0
        a1 = at(src, s + 1) * w + a1
        a2 = at(src, s + 2) * w + a2
      }
      const d = dstRow + x * 3
      tmp[d] = a0
      tmp[d + 1] = a1
      tmp[d + 2] = a2
    }
  }
  const vert = contributions(sh, dh)
  const out = new Float32Array(dw * dh * 3)
  for (let y = 0; y < vert.length; y++) {
    const { begin, weights } = item(vert, y)
    const dstRow = y * dw * 3
    for (let k = 0; k < weights.length; k++) {
      const w = at(weights, k)
      const srcRow = (begin + k) * dw * 3
      for (let d = 0; d < dw * 3; d++) {
        const dest = dstRow + d
        out[dest] = at(tmp, srcRow + d) * w + at(out, dest)
      }
    }
  }
  return out
}
