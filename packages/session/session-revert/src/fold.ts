/**
 * Pure projection fold for session revert markers.
 * @module @lulu-ling/dsh-session-revert/fold
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionRevertState, SessionRevertView } from './types.ts'

/** Empty host fold. */
export const EMPTY_REVERT_STATE: SessionRevertState = {
  staged: null,
  committed: [],
  userSeqs: [],
}

/**
 * Whether a step's admitted messages include a human prompt.
 * Commit runs only for that case, before those messages are logged.
 * @param messages - messages the step is about to enter.
 * @returns true when one source is `kind: 'user'`.
 */
export function humanPromptStarts(messages: readonly { source: { kind: string } }[]): boolean {
  return messages.some(message => message.source.kind === 'user')
}

/**
 * Apply one session event to the revert fold.
 * @param state - fold of every earlier event.
 * @param event - next committed event.
 * @returns the same reference when the event does not affect revert state.
 */
export function applyRevertProjection(state: SessionRevertState, event: SessionEvent): SessionRevertState {
  if (event.type === 'user/message') {
    if (state.userSeqs.includes(event.seq)) return state
    return { ...state, userSeqs: [...state.userSeqs, event.seq] }
  }
  if (event.type === 'session/revert/staged') {
    if (state.staged?.atSeq === event.data.atSeq) return state
    return { ...state, staged: { atSeq: event.data.atSeq } }
  }
  if (event.type === 'session/revert/cleared') {
    if (state.staged === null) return state
    return { ...state, staged: null }
  }
  if (event.type === 'session/revert/committed') {
    return {
      ...state,
      staged: null,
      committed: [...state.committed, { atSeq: event.data.atSeq, untilSeq: event.seq }],
    }
  }
  return state
}

/**
 * Drop host-only seq lists from the client view.
 * @param state - host fold.
 * @returns staged boundary and frozen ranges.
 */
export function revertView(state: SessionRevertState): SessionRevertView {
  return { staged: state.staged, committed: state.committed }
}
