/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { renderSnapcompactPng, snapcompactSupportedChars } from '../src/raster.ts'

describe('snapcompact raster', () => {
  it('renders A as an indexed PNG hugging one 5x8 row', async () => {
    const encoded = await renderSnapcompactPng('A', {
      size: 40,
      font: '5x8',
      cellWidth: 5,
      cellHeight: 8,
      variant: 'bw',
      lineRepeat: 1,
    })
    const bytes = Buffer.from(encoded, 'base64')
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(bytes.readUInt32BE(16)).toBe(40)
    expect(bytes.readUInt32BE(20)).toBe(8)
  })

  it('rejects a zero frame size', () => {
    expect(() => renderSnapcompactPng('A', { size: 0 })).toThrow(/Invalid frame size/)
  })

  it('keeps drawable bitmap characters and the dim toggle', () => {
    expect(snapcompactSupportedChars('5x8', 'A\u000e\u4e00')).toBe('A\u000e')
  })
})
