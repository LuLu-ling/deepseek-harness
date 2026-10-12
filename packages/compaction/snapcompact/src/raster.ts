/**
 * Copyright (c) 2025-2026 Can Bölük
 * Copyright (c) 2026 Stencil Labs, Inc.
 *
 * Adapted from oh-my-pi snapcompact (MIT).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { at, codePoint, item } from './raster/read.ts'
import { resizeRgb } from './raster/lanczos.ts'
import { PALETTE, encodeIndexedPng, encodeRgbPng } from './raster/png.ts'
import {
  faceAscent,
  faceSupports,
  parseFace,
  rasterizeGlyph,
  type Face,
  type RasterizedGlyph,
} from './raster/ttf.ts'

const MAX_FRAME_SIZE = 16384
const INK_COLORS = 6
const INK_BLACK = 7
const BG_REPEAT = 8
const INK_DIM = 9
const DIM_ON = 0x0e
const DIM_OFF = 0x0f
const FULL_BLOCK = 0x2588
const GUTTER = 3

function codePoints(text: string): number[] {
  const codes: number[] = []
  for (const ch of text) codes.push(codePoint(ch))
  return codes
}

function characters(text: string): string[] {
  const chars: string[] = []
  for (const ch of text) chars.push(ch)
  return chars
}

/** Shape options for one snapcompact frame. Field names match the TypeScript caller, not napi snake_case. */
export interface SnapcompactRenderOptions {
  /** Frame width in pixels. Output height hugs the rows the text uses. */
  size: number
  /** `"5x8"`, `"8x8"`, `"6x12"`, `"8x13"`, or `"silver"`. Default `"5x8"`. */
  font?: string
  /** Target cell advance. Default: the font's natural width. */
  cellWidth?: number
  /** Target cell pitch. Default: the font's natural height. */
  cellHeight?: number
  /** `"sent"` (default) or `"bw"`. */
  variant?: 'sent' | 'bw'
  /** Copies of each text line. Copies after the first sit on a pale band. Default 1. */
  lineRepeat?: number
  /** `false` keeps indexed natural glyphs on the requested cell box. */
  stretch?: boolean
  /** `1` row-major grid, or `2` newspaper columns of pre-wrapped lines. */
  columns?: 1 | 2
}

interface Glyph {
  w: number
  h: number
  xoff: number
  yoff: number
  rows: Uint8Array
}

interface BitmapFont {
  glyphs: Map<number, Glyph>
  ascent: number
  cellW: number
  cellH: number
}

interface Grid {
  cols: number
  rows: number
  repeat: number
  cellW: number
  cellH: number
}

interface SilverFont {
  face: Face
  cellW: number
  cellH: number
  px: number
  cache: Map<string, RasterizedGlyph | undefined>
}

function fontsDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'fonts', '5x8.bdf'))) return path.join(dir, 'fonts')
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('snapcompact fonts directory not found (fonts/5x8.bdf)')
}

function parseBdf(text: string, cellW: number, cellH: number): BitmapFont {
  const glyphs = new Map<number, Glyph>()
  let ascent = 0
  let enc = -1
  const bbx: [number, number, number, number] = [0, 0, 0, 0]
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = item(lines, i)
    if (line.startsWith('FONT_ASCENT')) {
      ascent = Number.parseInt(line.slice('FONT_ASCENT'.length).trim(), 10) || 0
    } else if (line.startsWith('ENCODING')) {
      const parsed = Number.parseInt(line.slice('ENCODING'.length).trim(), 10)
      enc = Number.isNaN(parsed) ? -1 : parsed
    } else if (line.startsWith('BBX')) {
      const parts = line.slice('BBX'.length).trim().split(/\s+/)
      for (let s = 0; s < 4; s++) bbx[s] = Number.parseInt(parts[s] ?? '', 10) || 0
    } else if (line.startsWith('BITMAP')) {
      const rows: number[] = []
      for (i += 1; i < lines.length; i++) {
        const row = item(lines, i)
        if (row.startsWith('ENDCHAR')) break
        const value = Number.parseInt(row.trim(), 16)
        rows.push(Number.isNaN(value) || value > 255 ? 0 : value)
      }
      if (enc >= 0) {
        glyphs.set(enc, {
          w: Math.min(8, Math.max(0, bbx[0])),
          h: bbx[1],
          xoff: bbx[2],
          yoff: bbx[3],
          rows: Uint8Array.from(rows),
        })
      }
    }
  }
  return { glyphs, ascent, cellW, cellH }
}

function parseHex(text: string): BitmapFont {
  const glyphs = new Map<number, Glyph>()
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const enc = Number.parseInt(line.slice(0, colon).trim(), 16)
    if (Number.isNaN(enc)) continue
    const bits = line.slice(colon + 1).trim()
    if (bits.length !== 16) continue
    const rows = new Uint8Array(8)
    for (let i = 0; i < 8; i++) {
      const value = Number.parseInt(bits.slice(i * 2, i * 2 + 2), 16)
      rows[i] = Number.isNaN(value) ? 0 : value
    }
    glyphs.set(enc, { w: 8, h: 8, xoff: 0, yoff: -1, rows })
  }
  return { glyphs, ascent: 7, cellW: 8, cellH: 8 }
}

interface Fonts {
  bdf5: BitmapFont
  hex8: BitmapFont
  bdf6: BitmapFont
  bdf13: BitmapFont
  silver: SilverFont
}

let loaded: Fonts | undefined

function fonts(): Fonts {
  if (loaded) return loaded
  const dir = fontsDir()
  const face = parseFace(readFileSync(path.join(dir, 'Silver.ttf')))
  loaded = {
    bdf5: parseBdf(readFileSync(path.join(dir, '5x8.bdf'), 'utf8'), 5, 8),
    hex8: parseHex(readFileSync(path.join(dir, 'unscii-8.hex'), 'utf8')),
    bdf6: parseBdf(readFileSync(path.join(dir, '6x12.bdf'), 'utf8'), 6, 12),
    bdf13: parseBdf(readFileSync(path.join(dir, '8x13.bdf'), 'utf8'), 8, 13),
    silver: { face, cellW: 16, cellH: 16, px: 16, cache: new Map() },
  }
  return loaded
}

type RenderFont =
  | { kind: 'bitmap'; font: BitmapFont }
  | { kind: 'ttf'; font: SilverFont }

function resolveFont(name: string): RenderFont | undefined {
  const all = fonts()
  if (name === '5x8') return { kind: 'bitmap', font: all.bdf5 }
  if (name === '8x8') return { kind: 'bitmap', font: all.hex8 }
  if (name === '6x12') return { kind: 'bitmap', font: all.bdf6 }
  if (name === '8x13') return { kind: 'bitmap', font: all.bdf13 }
  if (name === 'silver') return { kind: 'ttf', font: all.silver }
  return undefined
}

function fontSupports(font: RenderFont, code: number): boolean {
  if (code === DIM_ON || code === DIM_OFF || code === FULL_BLOCK || code === 0x0a) return true
  if (font.kind === 'bitmap') return font.font.glyphs.has(code)
  return faceSupports(font.font.face, code)
}

/** East Asian Wide / Fullwidth ranges mirrored from `is_wide`. */
function isWide(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x115f)
    || (cp >= 0x2e80 && cp <= 0x2eff)
    || (cp >= 0x2f00 && cp <= 0x2fdf)
    || (cp >= 0x3000 && cp <= 0x303e)
    || (cp >= 0x3041 && cp <= 0x33ff)
    || (cp >= 0x3400 && cp <= 0x4dbf)
    || (cp >= 0x4e00 && cp <= 0x9fff)
    || (cp >= 0xa000 && cp <= 0xa4cf)
    || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe30 && cp <= 0xfe4f)
    || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6)
    || (cp >= 0x20000 && cp <= 0x2fffd)
    || (cp >= 0x30000 && cp <= 0x3fffd)
}

function cellUnits(code: number, wideCells: boolean): number {
  if (code === DIM_ON || code === DIM_OFF) return 0
  if (wideCells && isWide(code)) return 2
  return 1
}

function placeCell(cursor: number, cols: number, code: number, wideCells: boolean): [number, number, number] | undefined {
  const units = cellUnits(code, wideCells)
  if (units === 0) return undefined
  let cell = cursor
  if (units === 2 && cols >= 2 && cell % cols === cols - 1) cell += 1
  return [cell, units, cell + units]
}

function usedRows(text: string, grid: Grid, doc: boolean, wideCells: boolean): number {
  let rows: number
  if (doc) {
    rows = text.split('\n').length
  } else {
    let cursor = 0
    for (const ch of text) {
      const placed = placeCell(cursor, grid.cols, codePoint(ch), wideCells)
      if (placed) cursor = placed[2]
    }
    rows = Math.ceil(cursor / grid.cols)
  }
  return Math.min(grid.rows, Math.max(1, rows))
}

function fillRepeatBands(pixels: Uint8Array, width: number, height: number, grid: Grid): void {
  if (grid.repeat <= 1) return
  for (let row = 0; row < grid.rows; row++) {
    for (let copy = 1; copy < grid.repeat; copy++) {
      const bandTop = (row * grid.repeat + copy) * grid.cellH
      const bandEnd = Math.min(height, bandTop + grid.cellH)
      for (let y = bandTop; y < bandEnd; y++) pixels.fill(BG_REPEAT, y * width, y * width + width)
    }
  }
}

function blitGlyph(
  pixels: Uint8Array,
  width: number,
  height: number,
  glyph: Glyph,
  left: number,
  top: number,
  ink: number,
): void {
  for (let r = 0; r < glyph.rows.length; r++) {
    const bits = at(glyph.rows, r)
    if (bits === 0) continue
    const y = top + r
    if (y < 0 || y >= height) continue
    const rowBase = y * width
    for (let b = 0; b < glyph.w; b++) {
      if ((bits & (0x80 >> b)) !== 0) {
        const x = left + b
        if (x >= 0 && x < width) pixels[rowBase + x] = ink
      }
    }
  }
}

function fillCell(
  pixels: Uint8Array,
  width: number,
  height: number,
  grid: Grid,
  xOrigin: number,
  row: number,
  ink: number,
): void {
  const x0 = Math.min(width, xOrigin)
  const x1 = Math.min(width, xOrigin + grid.cellW)
  if (x0 >= x1) return
  for (let copy = 0; copy < grid.repeat; copy++) {
    const top = (row * grid.repeat + copy) * grid.cellH
    const end = Math.min(height, top + grid.cellH)
    for (let y = top; y < end; y++) pixels.fill(ink, y * width + x0, y * width + x1)
  }
}

function fillRepeatBandsRgb(pixels: Uint8Array, width: number, height: number, grid: Grid): void {
  if (grid.repeat <= 1) return
  const band = item(PALETTE, BG_REPEAT)
  for (let row = 0; row < grid.rows; row++) {
    for (let copy = 1; copy < grid.repeat; copy++) {
      const bandTop = (row * grid.repeat + copy) * grid.cellH
      const bandEnd = Math.min(height, bandTop + grid.cellH)
      for (let y = bandTop; y < bandEnd; y++) {
        const rowBase = y * width * 3
        for (let x = 0; x < width; x++) {
          const o = rowBase + x * 3
          pixels[o] = band[0]
          pixels[o + 1] = band[1]
          pixels[o + 2] = band[2]
        }
      }
    }
  }
}

function fillCellRgb(
  pixels: Uint8Array,
  width: number,
  height: number,
  grid: Grid,
  xOrigin: number,
  row: number,
  ink: number,
): void {
  const x0 = Math.min(width, xOrigin)
  const x1 = Math.min(width, xOrigin + grid.cellW)
  if (x0 >= x1) return
  const color = item(PALETTE, ink)
  for (let copy = 0; copy < grid.repeat; copy++) {
    const top = (row * grid.repeat + copy) * grid.cellH
    const end = Math.min(height, top + grid.cellH)
    for (let y = top; y < end; y++) {
      const rowBase = y * width * 3
      for (let x = x0; x < x1; x++) {
        const o = rowBase + x * 3
        pixels[o] = color[0]
        pixels[o + 1] = color[1]
        pixels[o + 2] = color[2]
      }
    }
  }
}

function ttfPixelSize(grid: Grid, wide: boolean): number {
  const silver = fonts().silver
  const sx = ((wide ? 2 : 1) * grid.cellW) / silver.cellW
  const sy = grid.cellH / silver.cellH
  return silver.px * Math.min(sx, sy)
}

function cachedTtf(font: SilverFont, ch: string, px: number): RasterizedGlyph | undefined {
  const code = codePoint(ch)
  if (!faceSupports(font.face, code)) return undefined
  const key = `${code}:${px}`
  const hit = font.cache.get(key)
  if (hit !== undefined || font.cache.has(key)) return hit
  const glyph = rasterizeGlyph(font.face, code, px)
  font.cache.set(key, glyph)
  return glyph
}

function blitTtf(
  pixels: Uint8Array,
  width: number,
  height: number,
  glyph: RasterizedGlyph,
  left: number,
  top: number,
  ink: number,
): void {
  if (glyph.width === 0 || glyph.height === 0) return
  const color = item(PALETTE, ink)
  for (let y = 0; y < glyph.height; y++) {
    const dstY = top + y
    if (dstY < 0 || dstY >= height) continue
    for (let x = 0; x < glyph.width; x++) {
      const alpha = at(glyph.bitmap, y * glyph.width + x)
      if (alpha === 0) continue
      const dstX = left + x
      if (dstX < 0 || dstX >= width) continue
      const offset = (dstY * width + dstX) * 3
      const inv = 255 - alpha
      for (let c = 0; c < 3; c++) {
        const bg = at(pixels, offset + c)
        const fg = at(color, c)
        pixels[offset + c] = Math.floor((bg * inv + fg * alpha + 127) / 255)
      }
    }
  }
}

function blitTtfIndexed(
  pixels: Uint8Array,
  width: number,
  height: number,
  glyph: RasterizedGlyph,
  left: number,
  top: number,
  ink: number,
): void {
  if (glyph.width === 0 || glyph.height === 0) return
  for (let y = 0; y < glyph.height; y++) {
    const dstY = top + y
    if (dstY < 0 || dstY >= height) continue
    const rowBase = dstY * width
    for (let x = 0; x < glyph.width; x++) {
      const coverage = at(glyph.bitmap, y * glyph.width + x)
      let cell: number
      if (coverage >= 170) cell = ink
      else if (ink === INK_BLACK && coverage >= 56) cell = INK_DIM
      else if (coverage >= 110) cell = ink
      else continue
      const dstX = left + x
      if (dstX >= 0 && dstX < width) pixels[rowBase + dstX] = cell
    }
  }
}

function ttfOrigin(xOrigin: number, cellW: number, glyph: RasterizedGlyph): number {
  const advance = Math.ceil(glyph.advanceWidth)
  const pad = Math.floor(Math.max(0, cellW - advance) / 2)
  return xOrigin + pad + glyph.xmin
}

function ttfTop(cellTop: number, ascent: number, glyph: RasterizedGlyph): number {
  return Math.round(cellTop + ascent - glyph.height - glyph.ymin)
}

function sentenceBoundary(next: number | undefined, doc: boolean): boolean {
  if (next === undefined) return false
  if (doc) return next === 0x20 || next === 0x0a || next === FULL_BLOCK
  return next === 0x20 || next === FULL_BLOCK
}

function inkFor(dim: boolean, blackInk: boolean, sentence: number): number {
  if (dim) return INK_DIM
  if (blackInk) return INK_BLACK
  return 1 + (sentence % INK_COLORS)
}

function paintBitmapGlyph(
  pixels: Uint8Array,
  width: number,
  height: number,
  font: BitmapFont,
  grid: Grid,
  code: number,
  units: number,
  xOrigin: number,
  row: number,
  ink: number,
): void {
  const glyph = font.glyphs.get(code)
  if (glyph) {
    if (glyph.rows.length === 0) return
    const left = xOrigin + glyph.xoff
    for (let copy = 0; copy < grid.repeat; copy++) {
      const cellTop = (row * grid.repeat + copy) * grid.cellH
      blitGlyph(pixels, width, height, glyph, left, cellTop + font.ascent - glyph.h - glyph.yoff, ink)
    }
    return
  }
  const ch = String.fromCodePoint(code)
  const px = ttfPixelSize(grid, units === 2)
  const fallback = cachedTtf(fonts().silver, ch, px)
  if (!fallback) return
  const left = ttfOrigin(xOrigin, units * grid.cellW, fallback)
  for (let copy = 0; copy < grid.repeat; copy++) {
    const cellTop = (row * grid.repeat + copy) * grid.cellH
    blitTtfIndexed(pixels, width, height, fallback, left, ttfTop(cellTop, font.ascent, fallback), ink)
  }
}

function renderBitmap(
  text: string,
  width: number,
  height: number,
  font: BitmapFont,
  grid: Grid,
  blackInk: boolean,
): Uint8Array {
  const pixels = new Uint8Array(width * height)
  const capacity = grid.cols * grid.rows
  if (capacity === 0) return pixels
  fillRepeatBands(pixels, width, height, grid)
  const codes = codePoints(text)
  let sentence = 0
  let dim = false
  let cursor = 0
  for (let i = 0; i < codes.length; i++) {
    if (cursor >= capacity) break
    const code = at(codes, i)
    if (code === DIM_ON) {
      dim = true
      continue
    }
    if (code === DIM_OFF) {
      dim = false
      continue
    }
    const ink = inkFor(dim, blackInk, sentence)
    if ((code === 0x2e || code === 0x21 || code === 0x3f) && sentenceBoundary(codes[i + 1], false)) sentence += 1
    const placed = placeCell(cursor, grid.cols, code, true)
    if (!placed) continue
    const [cellAt, units, next] = placed
    cursor = next
    if (cellAt >= capacity) break
    const row = Math.floor(cellAt / grid.cols)
    const col = cellAt - row * grid.cols
    if (code === FULL_BLOCK) {
      fillCell(pixels, width, height, grid, col * grid.cellW, row, INK_BLACK)
      continue
    }
    paintBitmapGlyph(pixels, width, height, font, grid, code, units, col * grid.cellW, row, ink)
  }
  return pixels
}

function renderDocBitmap(
  text: string,
  width: number,
  height: number,
  font: BitmapFont,
  grid: Grid,
  blackInk: boolean,
): Uint8Array {
  const pixels = new Uint8Array(width * height)
  const colW = Math.floor(Math.max(0, grid.cols - GUTTER) / 2)
  if (colW === 0 || grid.rows === 0) return pixels
  fillRepeatBands(pixels, width, height, grid)
  const codes = codePoints(text)
  let sentence = 0
  let dim = false
  let line = 0
  let col = 0
  for (let i = 0; i < codes.length; i++) {
    const code = at(codes, i)
    if (code === DIM_ON) {
      dim = true
      continue
    }
    if (code === DIM_OFF) {
      dim = false
      continue
    }
    if (code === 0x0a) {
      line += 1
      col = 0
      if (line >= grid.rows * 2) break
      continue
    }
    const ink = inkFor(dim, blackInk, sentence)
    if ((code === 0x2e || code === 0x21 || code === 0x3f) && sentenceBoundary(codes[i + 1], true)) sentence += 1
    const units = cellUnits(code, true)
    let cell = col
    if (units === 2 && colW >= 2 && cell === colW - 1) cell += 1
    col = cell + units
    if (cell + units > colW) continue
    const column = Math.floor(line / grid.rows)
    const row = line - column * grid.rows
    const xOrigin = column * (colW + GUTTER) * grid.cellW
    if (code === FULL_BLOCK) {
      fillCell(pixels, width, height, grid, xOrigin + cell * grid.cellW, row, INK_BLACK)
      continue
    }
    paintBitmapGlyph(pixels, width, height, font, grid, code, units, xOrigin + cell * grid.cellW, row, ink)
  }
  return pixels
}

function renderTtfRgb(
  text: string,
  width: number,
  height: number,
  font: SilverFont,
  grid: Grid,
  blackInk: boolean,
): Uint8Array {
  const pixels = new Uint8Array(width * height * 3)
  pixels.fill(255)
  const capacity = grid.cols * grid.rows
  if (capacity === 0) return pixels
  fillRepeatBandsRgb(pixels, width, height, grid)
  const px = ttfPixelSize(grid, false)
  const ascent = faceAscent(font.face, px)
  const codes = characters(text)
  let sentence = 0
  let dim = false
  let cell = 0
  for (let i = 0; i < codes.length; i++) {
    if (cell >= capacity) break
    const ch = item(codes, i)
    const code = codePoint(ch)
    if (code === DIM_ON) {
      dim = true
      continue
    }
    if (code === DIM_OFF) {
      dim = false
      continue
    }
    const ink = inkFor(dim, blackInk, sentence)
    if ((code === 0x2e || code === 0x21 || code === 0x3f) && sentenceBoundary(codes[i + 1]?.codePointAt(0), false)) {
      sentence += 1
    }
    const row = Math.floor(cell / grid.cols)
    const col = cell - row * grid.cols
    cell += 1
    if (code === FULL_BLOCK) {
      fillCellRgb(pixels, width, height, grid, col * grid.cellW, row, INK_BLACK)
      continue
    }
    const glyph = cachedTtf(font, ch, px)
    if (!glyph) continue
    const left = ttfOrigin(col * grid.cellW, grid.cellW, glyph)
    for (let copy = 0; copy < grid.repeat; copy++) {
      const cellTop = (row * grid.repeat + copy) * grid.cellH
      blitTtf(pixels, width, height, glyph, left, ttfTop(cellTop, ascent, glyph), ink)
    }
  }
  return pixels
}

function renderTtfDocRgb(
  text: string,
  width: number,
  height: number,
  font: SilverFont,
  grid: Grid,
  blackInk: boolean,
): Uint8Array {
  const pixels = new Uint8Array(width * height * 3)
  pixels.fill(255)
  const colW = Math.floor(Math.max(0, grid.cols - GUTTER) / 2)
  if (colW === 0 || grid.rows === 0) return pixels
  fillRepeatBandsRgb(pixels, width, height, grid)
  const px = ttfPixelSize(grid, false)
  const ascent = faceAscent(font.face, px)
  const codes = characters(text)
  let sentence = 0
  let dim = false
  let line = 0
  let col = 0
  for (let i = 0; i < codes.length; i++) {
    const ch = item(codes, i)
    const code = codePoint(ch)
    if (code === DIM_ON) {
      dim = true
      continue
    }
    if (code === DIM_OFF) {
      dim = false
      continue
    }
    if (code === 0x0a) {
      line += 1
      col = 0
      if (line >= grid.rows * 2) break
      continue
    }
    const ink = inkFor(dim, blackInk, sentence)
    if ((code === 0x2e || code === 0x21 || code === 0x3f) && sentenceBoundary(codes[i + 1]?.codePointAt(0), true)) {
      sentence += 1
    }
    const cell = col
    col += 1
    if (cell >= colW) continue
    const column = Math.floor(line / grid.rows)
    const row = line - column * grid.rows
    const xOrigin = (column * (colW + GUTTER) + cell) * grid.cellW
    if (code === FULL_BLOCK) {
      fillCellRgb(pixels, width, height, grid, xOrigin, row, INK_BLACK)
      continue
    }
    const glyph = cachedTtf(font, ch, px)
    if (!glyph) continue
    const left = ttfOrigin(xOrigin, grid.cellW, glyph)
    for (let copy = 0; copy < grid.repeat; copy++) {
      const cellTop = (row * grid.repeat + copy) * grid.cellH
      blitTtf(pixels, width, height, glyph, left, ttfTop(cellTop, ascent, glyph), ink)
    }
  }
  return pixels
}

function quoteName(value: string): string {
  return JSON.stringify(value)
}

/**
 * Render one snapcompact frame and return base64 PNG bytes.
 * Indexed when a bitmap font is not stretched; RGB when stretched or when the font is silver.
 * Throws synchronously on an invalid size, font, or cell grid.
 * @param text - normalized frame text, including dim markers.
 * @param options - frame size, font, variant, and grid.
 * @returns base64 PNG bytes.
 */
export function renderSnapcompactPng(text: string, options: SnapcompactRenderOptions): Promise<string> {
  const sizeIn = options.size
  if (!Number.isInteger(sizeIn) || sizeIn <= 0 || sizeIn > MAX_FRAME_SIZE) {
    throw new Error(`Invalid frame size ${sizeIn}: expected 1..=${MAX_FRAME_SIZE}`)
  }
  const fontName = options.font ?? '5x8'
  const font = resolveFont(fontName)
  if (!font) {
    throw new Error(
      `Unknown snapcompact font ${quoteName(fontName)}: expected "5x8", "8x8", "6x12", "8x13", or "silver"`,
    )
  }
  const variant = options.variant ?? 'sent'
  const blackInk = variant === 'bw'
  const naturalW = font.font.cellW
  const naturalH = font.font.cellH
  const targetW = Math.max(1, options.cellWidth ?? naturalW)
  const targetH = Math.max(1, options.cellHeight ?? naturalH)
  const repeat = Math.max(1, options.lineRepeat ?? 1)
  const columns = options.columns ?? 1
  const doc = columns === 2
  const size = sizeIn
  const grid: Grid = {
    cols: Math.floor(size / targetW),
    rows: Math.floor(size / targetH / repeat),
    repeat,
    cellW: targetW,
    cellH: targetH,
  }
  if (grid.cols === 0 || grid.rows === 0) {
    throw new Error(`Frame size ${size} cannot fit a ${targetW}x${targetH} cell grid (repeat ${repeat})`)
  }
  const wideCells = font.kind === 'bitmap'
  const used = usedRows(text, grid, doc, wideCells)
  const height = used * grid.repeat * grid.cellH
  let png: Uint8Array
  if (font.kind === 'ttf') {
    const pixels = doc
      ? renderTtfDocRgb(text, size, height, font.font, grid, blackInk)
      : renderTtfRgb(text, size, height, font.font, grid, blackInk)
    png = encodeRgbPng(pixels, size, height)
  } else {
    const stretch = options.stretch !== false && (targetW !== naturalW || targetH !== naturalH)
    if (!stretch) {
      const pixels = doc
        ? renderDocBitmap(text, size, height, font.font, grid, blackInk)
        : renderBitmap(text, size, height, font.font, grid, blackInk)
      png = encodeIndexedPng(pixels, size, height)
    } else {
      const native: Grid = { ...grid, cellW: naturalW, cellH: naturalH }
      const srcW = grid.cols * naturalW
      const srcH = used * grid.repeat * naturalH
      const dstW = grid.cols * targetW
      const dstH = used * grid.repeat * targetH
      const indexed = doc
        ? renderDocBitmap(text, srcW, srcH, font.font, native, blackInk)
        : renderBitmap(text, srcW, srcH, font.font, native, blackInk)
      const rgb = new Float32Array(srcW * srcH * 3)
      for (let i = 0; i < indexed.length; i++) {
        const [r, g, b] = item(PALETTE, at(indexed, i))
        rgb[i * 3] = r
        rgb[i * 3 + 1] = g
        rgb[i * 3 + 2] = b
      }
      const resized = resizeRgb(rgb, srcW, srcH, dstW, dstH)
      const frame = new Uint8Array(size * dstH * 3)
      frame.fill(255)
      const copyW = Math.min(dstW, size)
      for (let y = 0; y < dstH; y++) {
        const srcRow = y * dstW * 3
        const dstRow = y * size * 3
        for (let i = 0; i < copyW * 3; i++) {
          const sample = at(resized, srcRow + i)
          frame[dstRow + i] = Math.max(0, Math.min(255, Math.round(sample)))
        }
      }
      png = encodeRgbPng(frame, size, dstH)
    }
  }
  return Promise.resolve(Buffer.from(png).toString('base64'))
}

/**
 * Subset of `chars` the named font can draw, plus U+000E, U+000F, U+2588, and newline.
 * @param font - bundled font name.
 * @param chars - candidate characters.
 * @returns the characters the font can draw.
 */
export function snapcompactSupportedChars(font: string, chars: string): string {
  const resolved = resolveFont(font)
  if (!resolved) {
    throw new Error(
      `Unknown snapcompact font ${quoteName(font)}: expected "5x8", "8x8", "6x12", "8x13", or "silver"`,
    )
  }
  let supported = ''
  for (const ch of chars) {
    const code = codePoint(ch)
    if (code === DIM_ON || code === DIM_OFF || code === FULL_BLOCK || code === 0x0a || fontSupports(resolved, code)) {
      supported += ch
    }
  }
  return supported
}
