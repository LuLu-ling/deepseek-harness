/**
 * Client-visible revert view and the host fold behind it.
 * @module @lulu-ling/dsh-session-revert/types
 */

/** One staged or frozen boundary, as a plain log seq. */
export interface SessionRevertPoint {
  readonly atSeq: number
}

/** One frozen hide range. `untilSeq` is exclusive and is the commit event. */
export interface SessionRevertRange {
  readonly atSeq: number
  readonly untilSeq: number
}

/** Host fold: the client view plus every user-message seq used to validate stage. */
export interface SessionRevertState {
  readonly staged: SessionRevertPoint | null
  readonly committed: readonly SessionRevertRange[]
  readonly userSeqs: readonly number[]
}

/** Client view of the current revert. Hidden ranges survive history paging. */
export interface SessionRevertView {
  readonly staged: SessionRevertPoint | null
  readonly committed: readonly SessionRevertRange[]
}

/** Receipt after stage. `changed` is false when the boundary was already there. */
export interface SessionRevertStageResult {
  readonly atSeq: number
  readonly changed: boolean
}

/** Receipt after clear. `cleared` is false when nothing was staged. */
export interface SessionRevertClearResult {
  readonly cleared: boolean
}

/** Receipt after commit. `committed` is false when nothing was staged. */
export interface SessionRevertCommitResult {
  readonly committed: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    revert: SessionRevertState
  }
  interface SessionProjectionMap {
    /**
     * Active staged boundary and frozen hide ranges for one session.
     * `session/revert/staged`, `session/revert/cleared`, and
     * `session/revert/committed` maintain it. User-message seqs stay on the host.
     */
    revert: SessionRevertView
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Stage or clear was refused because the agent is running or has pending input. */
    'session/revert-busy': { readonly reason: 'running' | 'pending' }
    /** `atSeq` is not a live user message, or it sits inside a frozen range. */
    'session/revert-invalid': { readonly reason: 'not-user-message' | 'committed' }
  }
}
