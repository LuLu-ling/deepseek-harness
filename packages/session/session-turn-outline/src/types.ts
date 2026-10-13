/**
 * Pure types of the turn-outline domain: the ONE home of the `turnOutline`
 * projection-key declaration, free of this package's host-side value imports
 * (zod, the projection definition). Host consumers import `./types`; client
 * aggregates import `./client`, which re-exports this module.
 *
 * @module @deepseek-ai/dsh-session-turn-outline/types
 */

import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

export {}

/** One started turn's outline facts, independent of what a client has paged in. */
export interface TurnOutlineEntry {
  /** Host-assigned turn number (the `turn/start` payload). */
  readonly turn: number
  /** The turn's `turn/start` event seq — paging a window back through this seq loads the whole turn. */
  readonly seq: SessionSeq
  /** Bounded first-human-prompt preview (one rail-card line); `''` until an eligible prompt lands. */
  readonly prompt: string
  /** Bounded final-response preview (up to three rail-card lines); `''` until the turn ends with assistant text. */
  readonly response: string
}

/**
 * One started turn inside the host fold. `promptSeq` is the first human
 * message even when its preview is empty, so a revert can drop the turn
 * without putting that seq on the wire.
 */
export interface TurnOutlineRecord {
  /** Host-assigned turn number (the `turn/start` payload). */
  readonly turn: number
  /** The turn's `turn/start` event seq. */
  readonly seq: SessionSeq
  /** Bounded first-human-prompt preview; `''` until eligible text lands. */
  readonly prompt: string
  /** Bounded final-response preview; `''` until the turn ends with assistant text. */
  readonly response: string
  /** Seq of the first human `user/message`, or null before one arrives. */
  readonly promptSeq: SessionSeq | null
}

/**
 * Fold state. `visible` is the wire list: turns whose opening prompt a
 * staged or committed revert hides are omitted, and that array keeps its
 * identity when only the draft or an already-hidden turn changes.
 */
export interface TurnOutlineState {
  /** Started turns in ascending turn order, including ones the wire omits. */
  readonly turns: readonly TurnOutlineRecord[]
  /** Newest text-bearing assistant preview of the open turn; `''` outside one. */
  readonly draft: string
  /** Active hide boundary, or null when nothing is staged. */
  readonly staged: { readonly atSeq: number } | null
  /** Frozen ranges, exclusive of each commit event. */
  readonly committed: readonly { readonly atSeq: number; readonly untilSeq: number }[]
  /** Turns still navigable. Identity is stable across hidden-only updates. */
  readonly visible: readonly TurnOutlineEntry[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Whole-log turn outline fold state (entries plus the open turn's response draft). */
    turnOutline: TurnOutlineState
  }
  interface SessionProjectionMap {
    /** Every started turn with its `turn/start` seq and bounded previews, strictly increasing by turn; see {@link TurnOutlineEntry}. */
    turnOutline: readonly TurnOutlineEntry[]
  }
}
