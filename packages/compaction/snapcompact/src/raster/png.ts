/**
 * Copyright (c) 2025-2026 Can Bölük
 * Copyright (c) 2026 Stencil Labs, Inc.
 *
 * Adapted from oh-my-pi snapcompact (MIT).
 */

import { deflateSync } from 'node:zlib'
import { at, item } from './read.ts'

/** Indexed palette from the Rust `PALETTE` constant. */
export const PALETTE: readonly (readonly [number, number, number])[] = [
  [255, 255, 255],
  [109, 2, 2],
  [109, 53, 2],
  [24, 109, 2],
  [2, 109, 109],
  [2, 32, 109],
  [75, 2, 109],
  [0, 0, 0],
  [255, 247, 194],
  [128, 128, 128],
]

const PNG_SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c ^= at(data, i)
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out[4] = type.charCodeAt(0)
  out[5] = type.charCodeAt(1)
  out[6] = type.charCodeAt(2)
  out[7] = type.charCodeAt(3)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function ihdr(width: number, height: number, depth: number, colorType: number): Uint8Array {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  data[8] = depth
  data[9] = colorType
  return chunk('IHDR', data)
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0
  for (const part of parts) n += part.length
  const out = new Uint8Array(n)
  let o = 0
  for (const part of parts) {
    out.set(part, o)
    o += part.length
  }
  return out
}

/**
 * Pack palette indices into `bits`-per-pixel scanlines (filter None),
 * remapping global palette slots the way `pack_bits` does.
 */
function packBits(
  pixels: Uint8Array,
  width: number,
  height: number,
  bits: number,
  remap: Uint8Array,
): Uint8Array {
  const per = 8 / bits
  const rowBytes = Math.ceil(width / per)
  const packed = new Uint8Array((rowBytes + 1) * height)
  for (let y = 0; y < height; y++) {
    const dst = y * (rowBytes + 1)
    packed[dst] = 0
    const src = y * width
    for (let x = 0; x < width; x++) {
      const slot = at(remap, at(pixels, src + x))
      const packedIndex = dst + 1 + Math.floor(x / per)
      packed[packedIndex] = at(packed, packedIndex) | (slot << (bits * (per - 1 - (x % per))))
    }
  }
  return packed
}

/**
 * Indexed PNG, palette narrowed to colors actually used, no row filter.
 * @param pixels - palette indexes.
 * @param width - image width.
 * @param height - image height.
 * @returns PNG bytes.
 */
export function encodeIndexedPng(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const used = new Array<boolean>(PALETTE.length).fill(false)
  for (let i = 0; i < pixels.length; i++) used[at(pixels, i)] = true
  const remap = new Uint8Array(PALETTE.length)
  const palette: number[] = []
  let count = 0
  for (let global = 0; global < used.length; global++) {
    if (!used[global]) continue
    remap[global] = count
    count += 1
    const [r, g, b] = item(PALETTE, global)
    palette.push(r, g, b)
  }
  const bits = count <= 2 ? 1 : count <= 4 ? 2 : 4
  const idat = deflateSync(packBits(pixels, width, height, bits, remap), { level: 9 })
  return concat([
    PNG_SIG,
    ihdr(width, height, bits, 3),
    chunk('PLTE', Uint8Array.from(palette)),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/**
 * RGB8 PNG (color type 2). Filter None; deflate still wraps the scanlines.
 * @param pixels - interleaved RGB bytes.
 * @param width - image width.
 * @param height - image height.
 * @returns PNG bytes.
 */
export function encodeRgbPng(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1)
    raw[dst] = 0
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), dst + 1)
  }
  const idat = deflateSync(raw, { level: 9 })
  return concat([
    PNG_SIG,
    ihdr(width, height, 8, 2),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ])
}
