/**
 * The `turnOutline` projection unit: a pure fold of `turn/start` boundaries,
 * first human prompts, and final assistant responses into the whole-log turn
 * outline the chat rail renders for turns outside a client's paged event
 * window.
 *
 * `turn/start` — not the prompt `user/message` — anchors each entry because
 * its seq is the load-through target for a jump: the loop logs `turn/start`
 * before the turn's prompt and steps, so a window paged back through that seq
 * contains the whole turn. Previews mirror the rail's loaded-turn previews
 * (space-joined text blocks, collapsed whitespace, an ellipsis when clipped)
 * with budgets sized to the rail card's clamps — one prompt line, up to three
 * response lines — so a turn shows the same words before and after its events
 * load. The response commits at `turn/end` from a draft of the newest
 * text-bearing assistant message; draft-only applies keep `visible`'s
 * identity, so the identity-gated change feed pushes at most three times per
 * turn (boundary, prompt, response). A staged or committed revert drops a
 * turn whose first human prompt is hidden; clearing the stage puts it back.
 *
 * @module @deepseek-ai/dsh-session-turn-outline/projection
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { TurnOutlineEntry, TurnOutlineState } from './types.ts'

/** Prompt budget: one rail-card line (13px over ~276px), ASCII worst case included. */
const PROMPT_PREVIEW_LIMIT = 50
/** Response budget: three rail-card lines (12px over ~276px). */
const RESPONSE_PREVIEW_LIMIT = 120

type MessageContent = SessionEvent<'user/message'>['data']['content']

/** Space-join text blocks, collapse whitespace, and cap at `limit` with a trailing ellipsis when clipped. */
function preview(content: MessageContent, limit: number): string {
  let text = ''
  let unread = false
  for (const block of content) {
    if (block.type !== 'text') continue
    if (text.length >= limit * 2) {
      unread = true
      break
    }
    // Per-block bound: the fold runs on every message event, so a single
    // multi-megabyte block must not be concatenated (and regex-normalized)
    // whole for a preview this short.
    const clipped = block.text.length > limit * 2
    const chunk = clipped ? block.text.slice(0, limit * 2) : block.text
    text += text === '' ? chunk : ` ${chunk}`
    if (clipped) {
      unread = true
      break
    }
  }
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length > limit - 1) return `${normalized.slice(0, limit - 1).trimEnd()}…`
  return unread ? `${normalized}…` : normalized
}

const turnOutlineWireSchema: ZodType<readonly TurnOutlineEntry[]> = z.array(z.object({
  turn: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative().transform(SessionSeq),
  prompt: z.string().max(PROMPT_PREVIEW_LIMIT),
  response: z.string().max(RESPONSE_PREVIEW_LIMIT),
}).strict()).superRefine((turns, context) => {
  let previous = -1
  for (const entry of turns) {
    if (entry.turn <= previous) {
      context.addIssue({ code: 'custom', message: 'turn outline entries must be strictly increasing by turn' })
      return
    }
    previous = entry.turn
  }
})

const promptSeqSchema = z.union([
  z.number().int().nonnegative().transform(SessionSeq),
  z.null(),
]).default(null)

const turnOutlineStateSchema: ZodType<TurnOutlineState> = z.object({
  turns: z.array(z.object({
    turn: z.number().int().nonnegative(),
    seq: z.number().int().nonnegative().transform(SessionSeq),
    prompt: z.string().max(PROMPT_PREVIEW_LIMIT),
    response: z.string().max(RESPONSE_PREVIEW_LIMIT),
    promptSeq: promptSeqSchema,
  }).strict()).superRefine((turns, context) => {
    let previous = -1
    for (const entry of turns) {
      if (entry.turn <= previous) {
        context.addIssue({ code: 'custom', message: 'turn outline entries must be strictly increasing by turn' })
        return
      }
      previous = entry.turn
    }
  }),
  draft: z.string().max(RESPONSE_PREVIEW_LIMIT),
  staged: z.object({ atSeq: z.number().int().nonnegative() }).strict().nullable().default(null),
  committed: z.array(z.object({
    atSeq: z.number().int().nonnegative(),
    untilSeq: z.number().int().nonnegative(),
  }).strict()).default([]),
  visible: turnOutlineWireSchema.default([]),
}).strict()

const EMPTY_VISIBLE: readonly TurnOutlineEntry[] = []
const EMPTY_OUTLINE: TurnOutlineState = {
  turns: [],
  draft: '',
  staged: null,
  committed: [],
  visible: EMPTY_VISIBLE,
}

/** Whether the turn's opening prompt, or its start when no prompt has landed, is hidden. */
function turnOmitted(state: TurnOutlineState, turn: TurnOutlineState['turns'][number]): boolean {
  const seq = turn.promptSeq ?? turn.seq
  if (state.staged !== null && seq >= state.staged.atSeq) return true
  for (const range of state.committed) {
    if (seq >= range.atSeq && seq < range.untilSeq) return true
  }
  return false
}

/** Recompute the wire list, reusing the previous array when every served turn is unchanged. */
function withVisible(state: TurnOutlineState): TurnOutlineState {
  const visible: TurnOutlineEntry[] = []
  for (const turn of state.turns) {
    if (turnOmitted(state, turn)) continue
    visible.push({ turn: turn.turn, seq: turn.seq, prompt: turn.prompt, response: turn.response })
  }
  const previous = state.visible
  if (previous.length !== visible.length) return { ...state, visible }
  for (let index = 0; index < visible.length; index += 1) {
    const prior = previous[index]
    const next = visible[index]
    if (prior === undefined || next === undefined
      || prior.turn !== next.turn || prior.seq !== next.seq
      || prior.prompt !== next.prompt || prior.response !== next.response) {
      return { ...state, visible }
    }
  }
  return previous === visible ? state : { ...state, visible: previous }
}

/** The `turnOutline` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const turnOutlineProjectionDefinition = {
  key: 'turnOutline',
  stateVersion: 3,
  stateSchema: turnOutlineStateSchema,
  init: () => EMPTY_OUTLINE,
  apply: (state, event) => {
    // Every uninteresting event returns the same reference (Object.is gates
    // the drive), and draft-only changes keep `visible` identity (the raw-view
    // identity gate then keeps the change feed quiet).
    switch (event.type) {
      case 'turn/start': {
        const last = state.turns.at(-1)
        // Order guard: a boundary that does not advance the turn number keeps
        // the outline sorted, and a retried turn's previews land on the
        // standing entry.
        if (last !== undefined && event.data.turn <= last.turn) return state
        return withVisible({
          ...state,
          turns: [...state.turns, {
            turn: event.data.turn, seq: event.seq, prompt: '', response: '', promptSeq: null,
          }],
          draft: '',
        })
      }
      case 'user/message': {
        // Only the newest turn can still be waiting for its opening human
        // prompt. The first human message owns `promptSeq` even when its
        // preview is empty; a later one fills that preview only while it is
        // still empty.
        if (event.data.source.kind !== 'user') return state
        const last = state.turns.at(-1)
        if (last === undefined) return state
        const prompt = preview(event.data.content, PROMPT_PREVIEW_LIMIT)
        if (last.promptSeq === null) {
          return withVisible({
            ...state,
            turns: [...state.turns.slice(0, -1), {
              ...last,
              promptSeq: event.seq,
              ...(prompt === '' ? {} : { prompt }),
            }],
          })
        }
        if (last.prompt !== '' || prompt === '') return state
        return withVisible({
          ...state,
          turns: [...state.turns.slice(0, -1), { ...last, prompt }],
        })
      }
      case 'assistant/message': {
        // Newest text-bearing message wins; the buffer commits at turn/end.
        const draft = preview(event.data.message.content, RESPONSE_PREVIEW_LIMIT)
        if (draft === '' || draft === state.draft) return state
        return { ...state, draft }
      }
      case 'turn/end': {
        if (state.draft === '') return state
        const last = state.turns.at(-1)
        if (last === undefined || last.response === state.draft) return { ...state, draft: '' }
        return withVisible({
          ...state,
          turns: [...state.turns.slice(0, -1), { ...last, response: state.draft }],
          draft: '',
        })
      }
      case 'session/revert/staged': {
        if (state.staged?.atSeq === event.data.atSeq) return state
        return withVisible({ ...state, staged: { atSeq: event.data.atSeq } })
      }
      case 'session/revert/cleared': {
        if (state.staged === null) return state
        return withVisible({ ...state, staged: null })
      }
      case 'session/revert/committed': {
        return withVisible({
          ...state,
          staged: null,
          committed: [...state.committed, { atSeq: event.data.atSeq, untilSeq: event.seq }],
        })
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema: turnOutlineWireSchema,
    view: state => state.visible,
  },
} satisfies ProjectionDefinition<'turnOutline', TurnOutlineState>
