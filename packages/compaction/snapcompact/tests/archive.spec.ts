/**
 * Copyright (c) 2025-2026 Can Bölük
 * Copyright (c) 2026 Stencil Labs, Inc.
 *
 * Adapted from oh-my-pi snapcompact (MIT).
 */

import { describe, expect, it } from 'vitest'
import type { SnapcompactRaster } from '../src/archive.ts'
import {
  compactSnapcompact,
  idealShapeForModel,
  NEWLINE_GLYPH,
  normalize,
  resolveShapeForTarget,
} from '../src/archive.ts'

const FAKE_PNG = 'QQ=='

function fakeRaster(): SnapcompactRaster & { readonly rendered: string[] } {
  const rendered: string[] = []
  return {
    rendered,
    supportedChars(font, chars) {
      void font
      let out = ''
      for (const ch of chars) {
        const cp = ch.codePointAt(0) ?? 0
        const latin = (cp >= 0x20 && cp < 0x7f) || (cp >= 0xa0 && cp <= 0xff)
        if (latin || ch === '\u000e' || ch === '\u000f' || ch === '\u2588') out += ch
      }
      return out
    },
    async renderPng(text) {
      rendered.push(text)
      return FAKE_PNG
    },
  }
}

describe('normalize', () => {
  it('folds a newline run to U+2588 and strips a simple ANSI color sequence', () => {
    const raster = fakeRaster()
    expect(normalize('\u001b[31mhello\u001b[0m\n\n\nworld', { raster })).toBe(`hello${NEWLINE_GLYPH}world`)
  })
})

describe('resolveShapeForTarget', () => {
  it('picks 1932px for opus 4.7, not 4.6, 2048px for gemini, and 8on22 for unknown', () => {
    const opus47 = resolveShapeForTarget({ api: 'anthropic', id: 'claude-opus-4-7' })
    const opus46 = resolveShapeForTarget({ api: 'anthropic', id: 'claude-opus-4-6' })
    const gemini = resolveShapeForTarget({ api: 'google', id: 'gemini-2.5-pro' })
    const local = resolveShapeForTarget({ api: 'unknown', id: 'some-local-model' })

    expect(opus47.frameSize).toBe(1932)
    expect(idealShapeForModel('claude-opus-4-7')).toEqual({ variant: '11on16-bw', frameSize: 1932 })
    expect(opus46.frameSize).not.toBe(1932)
    expect(idealShapeForModel('claude-opus-4-6')?.frameSize).toBeUndefined()
    expect(gemini.font).toBe('8x13')
    expect(gemini.frameSize).toBe(2048)
    expect(local.cellHeight).toBe(22)
    expect(local.cellWidth).not.toBe(11)
  })
})

describe('compactSnapcompact', () => {
  it('unfolds a previous snapcompact source ahead of the new user text', async () => {
    const raster = fakeRaster()
    const result = await compactSnapcompact({
      messages: [{ role: 'user', text: 'new turn' }],
      previous: { kind: 'snapcompact', sourceText: 'older archive' },
      model: { api: 'anthropic', id: 'claude-opus-4-6' },
      includeThinking: true,
      maxFrames: 4,
      filePaths: [],
      raster,
    })
    const older = result.sourceText.indexOf('older archive')
    const newer = result.sourceText.indexOf('new turn')
    expect(older).toBeGreaterThanOrEqual(0)
    expect(newer).toBeGreaterThan(older)
    expect(raster.rendered.join('\n')).not.toContain('real-renderer')
  })

  it('drops a think section from an unfolded source when thinking is excluded', async () => {
    const raster = fakeRaster()
    const result = await compactSnapcompact({
      messages: [{ role: 'user', text: 'after' }],
      previous: { kind: 'snapcompact', sourceText: '¶think:secret plan\n\n¶user:kept' },
      model: { api: 'unknown', id: 'some-local-model' },
      includeThinking: false,
      maxFrames: 4,
      filePaths: [],
      raster,
    })
    expect(result.sourceText).not.toContain('¶think:')
    expect(result.sourceText).not.toContain('secret plan')
    expect(result.sourceText).toContain('¶user:kept')
    expect(result.sourceText.indexOf('¶user:kept')).toBeLessThan(result.sourceText.indexOf('after'))
  })
})
