/**
 * Log-backed session revert. Stage hides a user message and everything after
 * it. Clear restores that stage. Commit freezes the stage when a human prompt
 * is about to be logged. The session log stays intact; `Session.deriveMessages`
 * omits the hidden seqs.
 * @module @lulu-ling/dsh-session-revert
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionSeq, type Session, type SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { applyRevertProjection, EMPTY_REVERT_STATE, humanPromptStarts, revertView } from './fold.ts'
import type {
  SessionRevertClearResult,
  SessionRevertCommitResult,
  SessionRevertStageResult,
  SessionRevertState,
  SessionRevertView,
} from './types.ts'

/** Optional file restore. Absent when the snapshot plugin is not mounted. */
export interface SessionRevertFiles {
  /** Move the worktree to the snapshot for `atSeq`'s turn. `prev` is the boundary being replaced. */
  stage(agent: Agent, atSeq: SessionSeq, prev: { atSeq: number } | null): Promise<void>
  /** Put the worktree back to the snapshot taken at the first stage. */
  clear(agent: Agent): Promise<void>
  /** Drop the saved worktree snapshot without restoring it. */
  commit(agent: Agent): void
}

export type {
  SessionRevertClearResult,
  SessionRevertCommitResult,
  SessionRevertPoint,
  SessionRevertRange,
  SessionRevertStageResult,
  SessionRevertState,
  SessionRevertView,
} from './types.ts'
export { applyRevertProjection, humanPromptStarts, revertView } from './fold.ts'

const pointSchema = z.object({ atSeq: z.number() }).strict()
const rangeSchema = z.object({ atSeq: z.number(), untilSeq: z.number() }).strict()

const revertStateSchema: z.ZodType<SessionRevertState> = z.object({
  staged: pointSchema.nullable(),
  committed: z.array(rangeSchema),
  userSeqs: z.array(z.number()),
}).strict()

const revertViewSchema: z.ZodType<SessionRevertView> = z.object({
  staged: pointSchema.nullable(),
  committed: z.array(rangeSchema),
}).strict()

/** Client-visible revert projection. Host state also records user-message seqs. */
export const revertProjectionDefinition = {
  key: 'revert',
  stateSchema: revertStateSchema,
  init: (): SessionRevertState => EMPTY_REVERT_STATE,
  apply: applyRevertProjection,
  wire: { viewSchema: revertViewSchema, view: revertView },
  stateVersion: 1,
} satisfies ProjectionDefinition<'revert', SessionRevertState>

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionRevert: SessionRevertService
  }
}

/** `ctx.sessionRevert`: stage, clear, and commit one session's revert boundary. */
export class SessionRevertService extends TypertRemoteService {
  static inject = ['agents', 'sessionProjections']

  private files?: SessionRevertFiles
  /** One file change and its log append at a time, per session. */
  private readonly tails = new Map<SessionId, Promise<void>>()

  constructor(ctx: Context) {
    super(ctx, 'sessionRevert')
    ctx.sessionProjections.register(revertProjectionDefinition)
    ctx.on('agent/pre-step', async (payload, next) => {
      if (humanPromptStarts(payload.messages)) await this.commit(payload.agent)
      return next()
    })
  }

  /**
   * Attach worktree restore. The snapshot plugin calls this once it is mounted.
   * @param files - capture and restore callbacks.
   */
  bindFiles(files: SessionRevertFiles): void {
    this.files = files
  }

  /**
   * Hide `atSeq` and every later event.
   * File restore and the log append wait until any earlier stage, clear, or
   * commit for this session has finished.
   * @param agent - live agent whose log receives the marker.
   * @param atSeq - seq of an existing `user/message`.
   * @returns the staged boundary.
   * @throws {@link RemoteError} `session/revert-busy` when the agent is running or has pending input.
   * @throws {@link RemoteError} `session/revert-invalid` when `atSeq` is not a visible user message.
   */
  @Remote('stage')
  async stage(agent: Agent, atSeq: SessionSeq): Promise<SessionRevertStageResult> {
    await this.ensureIdle(agent)
    return this.enqueue(agent.session.id, async () => {
      this.refuseIfBusy(agent)
      const state = this.state(agent.session)
      if (!state.userSeqs.includes(atSeq)) {
        throw new RemoteError(
          'session/revert-invalid',
          `seq ${atSeq} is not a user message`,
          { reason: 'not-user-message' },
        )
      }
      if (state.committed.some(range => atSeq >= range.atSeq && atSeq < range.untilSeq)) {
        throw new RemoteError(
          'session/revert-invalid',
          `seq ${atSeq} is inside a committed revert`,
          { reason: 'committed' },
        )
      }
      if (state.staged?.atSeq === atSeq) return { atSeq, changed: false }
      const prev = state.staged
      await this.files?.stage(agent, atSeq, prev)
      agent.session.append('session/revert/staged', {
        atSeq,
        ...(prev === null ? {} : { prev: { atSeq: SessionSeq(prev.atSeq) } }),
      })
      return { atSeq, changed: true }
    })
  }

  /**
   * Drop the staged boundary. Frozen ranges stay hidden.
   * File restore and the log append wait until any earlier stage, clear, or
   * commit for this session has finished.
   * @param agent - live agent.
   * @returns whether a stage was cleared.
   * @throws {@link RemoteError} `session/revert-busy` when the agent is running or has pending input.
   */
  @Remote('clear')
  async clear(agent: Agent): Promise<SessionRevertClearResult> {
    await this.ensureIdle(agent)
    return this.enqueue(agent.session.id, async () => {
      this.refuseIfBusy(agent)
      if (this.state(agent.session).staged === null) return { cleared: false }
      await this.files?.clear(agent)
      agent.session.append('session/revert/cleared', {})
      return { cleared: true }
    })
  }

  /**
   * Freeze the staged boundary. No-op when nothing is staged.
   * Waits until an in-flight stage or clear for this session has appended.
   * Called before a human prompt is logged, and by redo's full restore path only through clear.
   * @param agent - live agent.
   * @returns whether a stage was frozen.
   */
  @Remote('commit')
  commit(agent: Agent): Promise<SessionRevertCommitResult> {
    return this.enqueue(agent.session.id, async () => {
      this.assertLive(agent)
      const staged = this.state(agent.session).staged
      if (staged === null) return { committed: false }
      this.files?.commit(agent)
      agent.session.append('session/revert/committed', { atSeq: SessionSeq(staged.atSeq) })
      return { committed: true }
    })
  }

  /** Run `job` after the previous file change for `sessionId` has appended. */
  private enqueue<T>(sessionId: SessionId, job: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const run = previous.then(job, job)
    this.tails.set(sessionId, run.then(() => undefined, () => undefined))
    return run
  }

  /** Refuse once the queued turn has started or gained input. Does not wait. */
  private refuseIfBusy(agent: Agent): void {
    this.assertLive(agent)
    if (agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) {
      throw new RemoteError('session/revert-busy', 'session has pending input', { reason: 'pending' })
    }
    if (agent.status === 'running') {
      throw new RemoteError('session/revert-busy', 'session is running', { reason: 'running' })
    }
  }

  /** Read the host fold, materializing it from the log when needed. */
  private state(session: Session): SessionRevertState {
    const state = this.ctx.sessionProjections.stateOf(session, 'revert')
    if (state === undefined) throw new Error('revert projection is not registered')
    return state
  }

  /** Reject a stale agent object that is not the registry's live instance. */
  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new RemoteError('session/not-found', `agent "${agent.id}" is not live`, { sessionId: agent.id })
    }
  }

  /** Stop a running turn, then refuse only if it is still running or input is pending. */
  private async ensureIdle(agent: Agent): Promise<void> {
    this.assertLive(agent)
    if (agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) {
      throw new RemoteError('session/revert-busy', 'session has pending input', { reason: 'pending' })
    }
    if (agent.status === 'running') {
      agent.cancel({ kind: 'user' }, { keepInbox: true })
      await agent.whenIdle()
    }
    if (agent.status === 'running') {
      throw new RemoteError('session/revert-busy', 'session is running', { reason: 'running' })
    }
  }
}

export default SessionRevertService
