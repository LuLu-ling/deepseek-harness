/**
 * Replay fold for session revert markers. A staged boundary hides every event
 * at and after `atSeq`. Commit freezes that range up to, but not including,
 * the commit event, then clears the stage. Clear drops only the stage.
 * @module @deepseek-ai/dsh-session/revert
 */

import type { SessionEvent, SessionSeq } from './types.ts'

/** One staged hide boundary. */
export interface RevertStage {
  readonly atSeq: SessionSeq
}

/** One frozen hide range. `untilSeq` is the commit event and stays visible. */
export interface RevertRange {
  readonly atSeq: SessionSeq
  readonly untilSeq: SessionSeq
}

/** Mutable accumulator. Callers that retain it must not publish the arrays. */
export interface RevertFoldState {
  staged: RevertStage | null
  committed: RevertRange[]
}

/**
 * Build an empty accumulator.
 * @returns state with no stage and no frozen ranges.
 */
export function emptyRevertFold(): RevertFoldState {
  return { staged: null, committed: [] }
}

/**
 * Apply one event. Unrelated events leave the accumulator unchanged.
 * @param state - mutable fold.
 * @param event - next log event.
 */
export function applyRevertEvent(state: RevertFoldState, event: SessionEvent): void {
  switch (event.type) {
    case 'session/revert/staged':
      state.staged = { atSeq: event.data.atSeq }
      return
    case 'session/revert/cleared':
      state.staged = null
      return
    case 'session/revert/committed':
      state.committed.push({ atSeq: event.data.atSeq, untilSeq: event.seq })
      state.staged = null
      return
    default:
      return
  }
}

/**
 * Whether model-visible history must omit this event seq.
 * @param state - fold of the log that contains `seq`.
 * @param seq - event position to test.
 * @returns true when a stage or a frozen range hides the event.
 */
export function revertExcludes(state: RevertFoldState, seq: SessionSeq): boolean {
  if (state.staged !== null && seq >= state.staged.atSeq) return true
  for (const range of state.committed) {
    if (seq >= range.atSeq && seq < range.untilSeq) return true
  }
  return false
}

/**
 * Fold revert markers from a contiguous log.
 * @param events - session events in seq order.
 * @returns a detached copy of the fold.
 */
export function foldRevert(events: readonly SessionEvent[]): RevertFoldState {
  const state = emptyRevertFold()
  for (const event of events) applyRevertEvent(state, event)
  return { staged: state.staged, committed: [...state.committed] }
}

/** Whether a value is a non-negative safe integer and not negative zero. */
function isSeq(value: unknown): value is SessionSeq {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
}

/** Whether a value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reject a revert payload that cannot be replayed.
 * @param event - candidate event.
 * @param subject - error prefix naming the event.
 * @throws when a revert payload is missing, mistyped, or carries an unknown field.
 */
export function assertRevertEventData(
  event: Pick<SessionEvent, 'type' | 'data'>,
  subject: string,
): void {
  if (event.type !== 'session/revert/staged'
    && event.type !== 'session/revert/cleared'
    && event.type !== 'session/revert/committed') return
  const data: unknown = event.data
  if (!isRecord(data)) throw new Error(`${subject} data must be an object`)
  if (event.type === 'session/revert/cleared') {
    if (Object.keys(data).length !== 0) throw new Error(`${subject} data must be empty`)
    return
  }
  const allowed = event.type === 'session/revert/staged' ? ['atSeq', 'prev'] : ['atSeq']
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) throw new Error(`${subject} has unexpected field ${key}`)
  }
  if (!isSeq(data['atSeq'])) throw new Error(`${subject} atSeq must be a non-negative safe integer`)
  if (event.type !== 'session/revert/staged' || data['prev'] === undefined) return
  const prev = data['prev']
  if (!isRecord(prev) || Object.keys(prev).length !== 1 || !isSeq(prev['atSeq'])) {
    throw new Error(`${subject} prev must be { atSeq }`)
  }
}
