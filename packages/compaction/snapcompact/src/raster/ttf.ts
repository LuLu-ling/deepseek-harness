/**
 * Copyright (c) 2025-2026 Can Bölük
 * Copyright (c) 2026 Stencil Labs, Inc.
 *
 * Adapted from oh-my-pi snapcompact (MIT).
 */

import { at, item } from './read.ts'

/**
 * Grayscale glyph produced for `blit_ttf_glyph` / `blit_ttf_glyph_indexed`.
 * Placement uses fontdue-style metrics: `xmin`/`ymin` are the bitmap's
 * lower-left in pixels, `advanceWidth` is the horizontal advance.
 */
export interface RasterizedGlyph {
  width: number
  height: number
  xmin: number
  ymin: number
  advanceWidth: number
  /** Row 0 is the top of the glyph. Coverage 0..255. */
  bitmap: Uint8Array
}

interface CmapGroup {
  start: number
  end: number
  glyph: number
}

/** Parsed glyf face used to test coverage and rasterize Silver outlines. */
export interface Face {
  unitsPerEm: number
  ascender: number
  glyphCount: number
  loca: DataView
  locaOffset: number
  glyf: DataView
  glyfOffset: number
  hmtx: DataView
  hmtxOffset: number
  groups: CmapGroup[]
}

const ON_CURVE = 0x01
const X_SHORT = 0x02
const Y_SHORT = 0x04
const REPEAT = 0x08
const X_SAME = 0x10
const Y_SAME = 0x20
const ARG_WORDS = 0x0001
const ARGS_XY = 0x0002
const WE_HAVE_A_SCALE = 0x0008
const MORE_COMPONENTS = 0x0020
const WE_HAVE_AN_XY_SCALE = 0x0040
const WE_HAVE_A_2X2 = 0x0080

interface Pt {
  x: number
  y: number
  on: boolean
}

function tableOffset(view: DataView, bytes: Uint8Array, tag: string): number {
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16
    if (bytes[rec] === tag.charCodeAt(0)
      && bytes[rec + 1] === tag.charCodeAt(1)
      && bytes[rec + 2] === tag.charCodeAt(2)
      && bytes[rec + 3] === tag.charCodeAt(3)) {
      return view.getUint32(rec + 8)
    }
  }
  throw new Error(`TrueType table ${tag} missing`)
}

function readGroups(view: DataView, cmap: number): CmapGroup[] {
  const records = view.getUint16(cmap + 2)
  let fmt12 = -1
  for (let i = 0; i < records; i++) {
    const rec = cmap + 4 + i * 8
    const format = view.getUint16(cmap + view.getUint32(rec + 4))
    if (format === 12) fmt12 = cmap + view.getUint32(rec + 4)
  }
  if (fmt12 < 0) throw new Error('Silver cmap format 12 missing')
  const groups: CmapGroup[] = []
  const n = view.getUint32(fmt12 + 12)
  for (let i = 0; i < n; i++) {
    const o = fmt12 + 16 + i * 12
    groups.push({
      start: view.getUint32(o),
      end: view.getUint32(o + 4),
      glyph: view.getUint32(o + 8),
    })
  }
  return groups
}

/**
 * Parse Silver (or any glyf/loca TTF) enough to test cmap coverage and rasterize outlines.
 * @param bytes - font file bytes.
 * @returns the parsed face.
 */
export function parseFace(bytes: Uint8Array): Face {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const head = tableOffset(view, bytes, 'head')
  const maxp = tableOffset(view, bytes, 'maxp')
  const hhea = tableOffset(view, bytes, 'hhea')
  const cmap = tableOffset(view, bytes, 'cmap')
  const unitsPerEm = view.getUint16(head + 18)
  const ascender = view.getInt16(hhea + 4)
  return {
    unitsPerEm,
    ascender,
    glyphCount: view.getUint16(maxp + 4),
    loca: view,
    locaOffset: tableOffset(view, bytes, 'loca'),
    glyf: view,
    glyfOffset: tableOffset(view, bytes, 'glyf'),
    hmtx: view,
    hmtxOffset: tableOffset(view, bytes, 'hmtx'),
    groups: readGroups(view, cmap),
  }
}

/**
 * Whether the face maps `code` to a glyph.
 * @param face - parsed face.
 * @param code - Unicode code point.
 * @returns true when the cmap has a non-zero glyph.
 */
export function faceSupports(face: Face, code: number): boolean {
  return glyphId(face, code) > 0
}

function glyphId(face: Face, code: number): number {
  let lo = 0
  let hi = face.groups.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const group = item(face.groups, mid)
    if (code < group.start) hi = mid - 1
    else if (code > group.end) lo = mid + 1
    else {
      const id = group.glyph + (code - group.start)
      return id === 0 ? 0 : id
    }
  }
  return 0
}

function glyphRange(face: Face, id: number): [number, number] {
  const o = face.locaOffset + id * 4
  return [face.glyfOffset + face.loca.getUint32(o), face.glyfOffset + face.loca.getUint32(o + 4)]
}

function advanceOf(face: Face, id: number, scale: number): number {
  return face.hmtx.getUint16(face.hmtxOffset + id * 4) * scale
}

function readCoords(view: DataView, p: number, flags: Uint8Array, shortBit: number, sameBit: number): [Float64Array, number] {
  const xs = new Float64Array(flags.length)
  let v = 0
  for (let i = 0; i < flags.length; i++) {
    const f = at(flags, i)
    if (f & shortBit) {
      const d = view.getUint8(p)
      p += 1
      v += (f & sameBit) ? d : -d
    } else if ((f & sameBit) === 0) {
      v += view.getInt16(p)
      p += 2
    }
    xs[i] = v
  }
  return [xs, p]
}

function readSimple(view: DataView, start: number, contours: number): Pt[][] {
  let p = start + 10
  const ends: number[] = []
  for (let i = 0; i < contours; i++) {
    ends.push(view.getUint16(p))
    p += 2
  }
  const instr = view.getUint16(p)
  p += 2 + instr
  const nPts = at(ends, ends.length - 1) + 1
  const flags = new Uint8Array(nPts)
  for (let i = 0; i < nPts;) {
    const f = view.getUint8(p)
    p += 1
    flags[i++] = f
    if (f & REPEAT) {
      const n = view.getUint8(p)
      p += 1
      for (let r = 0; r < n && i < nPts; r++) flags[i++] = f
    }
  }
  const [xs, afterX] = readCoords(view, p, flags, X_SHORT, X_SAME)
  const [ys] = readCoords(view, afterX, flags, Y_SHORT, Y_SAME)
  const out: Pt[][] = []
  let from = 0
  for (const end of ends) {
    const contour: Pt[] = []
    for (let i = from; i <= end; i++) {
      contour.push({ x: at(xs, i), y: at(ys, i), on: (at(flags, i) & ON_CURVE) !== 0 })
    }
    out.push(contour)
    from = end + 1
  }
  return out
}

function f2dot14(view: DataView, p: number): number {
  return view.getInt16(p) / 16384
}

function readComposite(face: Face, start: number, depth: number): Pt[][] {
  if (depth > 8) return []
  const view = face.glyf
  let p = start + 10
  const contours: Pt[][] = []
  for (;;) {
    const flags = view.getUint16(p)
    const index = view.getUint16(p + 2)
    p += 4
    let ax = 0
    let ay = 0
    if (flags & ARG_WORDS) {
      ax = view.getInt16(p)
      ay = view.getInt16(p + 2)
      p += 4
    } else {
      ax = view.getInt8(p)
      ay = view.getInt8(p + 1)
      p += 2
    }
    if ((flags & ARGS_XY) === 0) {
      ax = 0
      ay = 0
    }
    let a = 1
    let b = 0
    let c = 0
    let d = 1
    if (flags & WE_HAVE_A_SCALE) {
      a = d = f2dot14(view, p)
      p += 2
    } else if (flags & WE_HAVE_AN_XY_SCALE) {
      a = f2dot14(view, p)
      d = f2dot14(view, p + 2)
      p += 4
    } else if (flags & WE_HAVE_A_2X2) {
      a = f2dot14(view, p)
      b = f2dot14(view, p + 2)
      c = f2dot14(view, p + 4)
      d = f2dot14(view, p + 6)
      p += 8
    }
    for (const contour of outlines(face, index, depth + 1)) {
      const mapped: Pt[] = []
      for (const pt of contour) {
        mapped.push({
          x: a * pt.x + b * pt.y + ax,
          y: c * pt.x + d * pt.y + ay,
          on: pt.on,
        })
      }
      contours.push(mapped)
    }
    if ((flags & MORE_COMPONENTS) === 0) break
  }
  return contours
}

function outlines(face: Face, id: number, depth: number): Pt[][] {
  const [start, end] = glyphRange(face, id)
  if (end <= start) return []
  const contours = face.glyf.getInt16(start)
  if (contours < 0) return readComposite(face, start, depth)
  if (contours === 0) return []
  return readSimple(face.glyf, start, contours)
}

function flatten(contour: Pt[], scale: number, segs: number[]): void {
  const n = contour.length
  if (n === 0) return
  const first = item(contour, 0)
  const last = item(contour, n - 1)
  let x0: number
  let y0: number
  if (first.on) {
    x0 = first.x
    y0 = first.y
  } else if (last.on) {
    x0 = last.x
    y0 = last.y
  } else {
    x0 = (first.x + last.x) / 2
    y0 = (first.y + last.y) / 2
  }
  let cx = x0
  let cy = y0
  const emitLine = (x: number, y: number): void => {
    segs.push(cx * scale, cy * scale, x * scale, y * scale)
    cx = x
    cy = y
  }
  const emitQuad = (x1: number, y1: number, x2: number, y2: number): void => {
    const steps = 8
    const ox = cx
    const oy = cy
    let px = cx
    let py = cy
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      const m = 1 - t
      const x = m * m * ox + 2 * m * t * x1 + t * t * x2
      const y = m * m * oy + 2 * m * t * y1 + t * t * y2
      segs.push(px * scale, py * scale, x * scale, y * scale)
      px = x
      py = y
    }
    cx = x2
    cy = y2
  }
  let i = first.on ? 1 : 0
  while (i < n) {
    const p = item(contour, i)
    const next = item(contour, (i + 1) % n)
    if (p.on) {
      emitLine(p.x, p.y)
      i += 1
    } else {
      let ex: number
      let ey: number
      let consumed = 1
      if (next.on) {
        ex = next.x
        ey = next.y
        consumed = 2
      } else {
        ex = (p.x + next.x) / 2
        ey = (p.y + next.y) / 2
      }
      emitQuad(p.x, p.y, ex, ey)
      i += consumed
    }
  }
  if (cx !== x0 || cy !== y0) emitLine(x0, y0)
}

/**
 * Rasterize one glyf outline at `px`.
 * No TrueType hinting or dropout control: quadratic contours are flattened
 * and scan-converted with 4×4 non-zero-winding supersampling. That is enough
 * for Silver ASCII to land as non-blank coverage in the cell box.
 * @param face - parsed face.
 * @param code - Unicode code point.
 * @param px - pixel size.
 * @returns coverage, or undefined when the face has no glyph.
 */
export function rasterizeGlyph(face: Face, code: number, px: number): RasterizedGlyph | undefined {
  const id = glyphId(face, code)
  if (id <= 0) return undefined
  const scale = px / face.unitsPerEm
  const advanceWidth = advanceOf(face, id, scale)
  const segs: number[] = []
  for (const contour of outlines(face, id, 0)) flatten(contour, scale, segs)
  if (segs.length === 0) {
    return { width: 0, height: 0, xmin: 0, ymin: 0, advanceWidth, bitmap: new Uint8Array(0) }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < segs.length; i += 2) {
    const x = at(segs, i)
    const y = at(segs, i + 1)
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const xmin = Math.floor(minX)
  const ymin = Math.floor(minY)
  const xmax = Math.ceil(maxX)
  const ymax = Math.ceil(maxY)
  const width = Math.max(0, xmax - xmin)
  const height = Math.max(0, ymax - ymin)
  if (width === 0 || height === 0) {
    return { width: 0, height: 0, xmin, ymin, advanceWidth, bitmap: new Uint8Array(0) }
  }
  const ss = 4
  const counts = new Uint16Array(width * height)
  const hits: Array<{ x: number; dir: number }> = []
  for (let sy = 0; sy < height * ss; sy++) {
    const y = ymax - (sy + 0.5) / ss
    hits.length = 0
    for (let i = 0; i < segs.length; i += 4) {
      const x0 = at(segs, i)
      const y0 = at(segs, i + 1)
      const x1 = at(segs, i + 2)
      const y1 = at(segs, i + 3)
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        const t = (y - y0) / (y1 - y0)
        hits.push({ x: x0 + t * (x1 - x0), dir: y1 > y0 ? 1 : -1 })
      }
    }
    hits.sort((p, q) => p.x - q.x)
    let wind = 0
    let prev = 0
    for (const hit of hits) {
      if (wind !== 0) {
        const x0 = Math.min(prev, hit.x)
        const x1 = Math.max(prev, hit.x)
        const s0 = Math.max(0, Math.floor((x0 - xmin) * ss))
        const s1 = Math.min(width * ss, Math.ceil((x1 - xmin) * ss))
        const row = Math.floor(sy / ss)
        for (let sx = s0; sx < s1; sx++) {
          const cx = xmin + (sx + 0.5) / ss
          if (cx >= x0 && cx < x1) {
            const countIndex = row * width + Math.floor(sx / ss)
            counts[countIndex] = at(counts, countIndex) + 1
          }
        }
      }
      wind += hit.dir
      prev = hit.x
    }
  }
  const bitmap = new Uint8Array(width * height)
  const denom = ss * ss
  for (let i = 0; i < counts.length; i++) {
    bitmap[i] = Math.round(at(counts, i) * 255 / denom)
  }
  return { width, height, xmin, ymin, advanceWidth, bitmap }
}

/**
 * Pixel ascent at `px`, matching `horizontal_line_metrics(px).ascent` from hhea.
 * @param face - parsed face.
 * @param px - pixel size.
 * @returns the ascent in pixels.
 */
export function faceAscent(face: Face, px: number): number {
  return face.ascender * px / face.unitsPerEm
}
