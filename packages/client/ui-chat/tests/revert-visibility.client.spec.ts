import { describe, expect, it } from 'vitest'
import {
  collectRetractedTurns, placeVisibleBeforeRevert,
} from '../src/client/chat/revert-visibility.ts'

const staged = { staged: { atSeq: 5 }, committed: [] }

describe('reverted turn placement', () => {
  it('marks a turn retracted only when its content is hidden', () => {
    const retracted = collectRetractedTurns([
      { kind: 'user', anchorSeq: 1, turn: 1 },
      { kind: 'turn-process', anchorSeq: 4, turn: 2 },
      { kind: 'user', anchorSeq: 5, turn: 2 },
      { kind: 'turn-process', anchorSeq: 8, turn: 3 },
    ], staged)
    expect([...retracted]).toEqual([2])
  })

  it('draws a later visible row at the cursor, ahead of the reverted span', () => {
    const entries = ['turn-1', 'reverted', 'compact']
    expect(placeVisibleBeforeRevert(entries, entry => entry === 'reverted')).toEqual([
      'turn-1', 'compact', 'reverted',
    ])
  })

  it('keeps the array when nothing visible follows the revert', () => {
    const entries = ['turn-1', 'reverted']
    expect(placeVisibleBeforeRevert(entries, entry => entry === 'reverted')).toBe(entries)
  })
})
