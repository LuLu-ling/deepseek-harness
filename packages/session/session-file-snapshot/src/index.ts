/**
 * Worktree snapshots for session revert. Capture runs at the first pre-step
 * of a turn, and at any later pre-step that admits a human message, before
 * the model can write files. Stage and clear rewrite only the paths that
 * differ between the saved trees. The trees an open revert needs are saved
 * beside the snapshots, so a restart can still put files back. Optional
 * limits drop old trees.
 * @module @lulu-ling/dsh-session-file-snapshot
 */

// Type-only: the loader event that reports a live config change.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { humanPromptStarts, type SessionRevertFiles } from '@lulu-ling/dsh-session-revert'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import {
  MAX_UNTRACKED_BYTES,
  captureTree,
  collectSnapshots,
  coverTree,
  diffTrees,
  readStageRecord,
  readTurnBinding,
  recordTurnBinding,
  restoreChanged,
  restoreTree,
  snapshotRoot,
  worktreeRoot,
  writeStageRecord,
  type FileDiff,
  type SnapshotId,
  type SnapshotRetention,
  type StageRecord,
} from './git.ts'

export { MAX_UNTRACKED_BYTES, type FileDiff, type SnapshotId, type StageRecord }

/** How many trees one worktree keeps when `historyLimit` is omitted. */
export const DEFAULT_HISTORY_LIMIT = 100

/** How many bytes the snapshot root may use when `diskLimitBytes` is omitted. 5 GiB. */
export const DEFAULT_DISK_LIMIT_BYTES = 5 * 1024 * 1024 * 1024

/** How long one tree is kept when `maxAgeMs` is omitted. Matches a 7-day prune. */
export const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** How often a timed sweep runs when `gcIntervalMs` is omitted. Matches an hourly cleanup. */
export const DEFAULT_GC_INTERVAL_MS = 60 * 60 * 1000

/** Plugin config. Every limit has a default and applies live. */
export interface SessionSnapshotConfig {
  /** `false` makes capture, restore, and sweeps do nothing. Omitted means on. */
  snapshots?: boolean
  /** Directory that holds snapshot git dirs. Omitted uses `$DSH_HOME/snapshot`. */
  dataDir?: string
  /** Maximum snapshot trees kept for one worktree. Default {@link DEFAULT_HISTORY_LIMIT}. */
  historyLimit: Volatile<number>
  /** Maximum bytes of the snapshot root. Default {@link DEFAULT_DISK_LIMIT_BYTES}. */
  diskLimitBytes: Volatile<number>
  /** Maximum snapshot age in milliseconds. Default {@link DEFAULT_MAX_AGE_MS}. */
  maxAgeMs: Volatile<number>
  /** Sweep period in milliseconds. Default {@link DEFAULT_GC_INTERVAL_MS}. */
  gcIntervalMs: Volatile<number>
  /** Largest untracked file, in bytes, that enters a tree. Default {@link MAX_UNTRACKED_BYTES}. */
  maxUntrackedBytes: Volatile<number>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionSnapshots: SessionSnapshotService
  }
}

/** Host fold: the turn and step that logged each user message, so a revert finds its capture without reading history. */
export interface SnapshotStepsState {
  /** Turn of the latest `turn/start`, or null before the first. */
  readonly turn: number | null
  /** Step of the latest `step/start` in that turn, or 0 before one. */
  readonly step: number
  /** `[seq, turn, step]` of every user message logged inside a turn, in seq order. */
  readonly messages: readonly (readonly [seq: number, turn: number, step: number])[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    fileSnapshotSteps: SnapshotStepsState
  }
}

const EMPTY_STEPS: SnapshotStepsState = { turn: null, step: 0, messages: [] }
const count = zod.number().int().nonnegative()

/** Host-only projection behind {@link SessionSnapshotService}'s boundary lookup. */
export const snapshotStepsProjectionDefinition = {
  key: 'fileSnapshotSteps',
  stateSchema: zod.object({
    turn: count.nullable(),
    step: count,
    messages: zod.array(zod.tuple([count, count, count]).readonly()).readonly(),
  }).strict().readonly(),
  init: (): SnapshotStepsState => EMPTY_STEPS,
  apply: applySnapshotSteps,
  stateVersion: 1,
} satisfies ProjectionDefinition<'fileSnapshotSteps', SnapshotStepsState>

/**
 * Track the open turn and step, and record where each user message landed.
 * @param state - fold of every earlier event.
 * @param event - next committed event.
 * @returns the same reference when the event changes nothing.
 */
export function applySnapshotSteps(state: SnapshotStepsState, event: SessionEvent): SnapshotStepsState {
  switch (event.type) {
    case 'turn/start':
      return { ...state, turn: event.data.turn, step: 0 }
    case 'step/start':
      return { ...state, step: event.data.step }
    case 'user/message':
      return state.turn === null ? state : { ...state, messages: [...state.messages, [event.seq, state.turn, state.step]] }
    default:
      return state
  }
}

/**
 * `ctx.sessionSnapshots`: capture a worktree and restore it when a revert moves.
 */
export class SessionSnapshotService extends Service {
  static inject = ['sessionRevert', 'sessionProjections']

  static Config: z<{
    snapshots?: boolean
    dataDir?: string
    historyLimit?: number
    diskLimitBytes?: number
    maxAgeMs?: number
    gcIntervalMs?: number
    maxUntrackedBytes?: number
  }, SessionSnapshotConfig> = z.object({
    snapshots: z.boolean().default(true),
    dataDir: z.string(),
    historyLimit: z.number().step(1).min(1).default(DEFAULT_HISTORY_LIMIT).volatile(),
    diskLimitBytes: z.number().step(1).min(1).default(DEFAULT_DISK_LIMIT_BYTES).volatile(),
    maxAgeMs: z.number().step(1).min(1).default(DEFAULT_MAX_AGE_MS).volatile(),
    gcIntervalMs: z.number().step(1).min(1).default(DEFAULT_GC_INTERVAL_MS).volatile(),
    maxUntrackedBytes: z.number().step(1).min(1).default(MAX_UNTRACKED_BYTES).volatile(),
  })

  private readonly enabled: boolean
  private readonly dataDir: string
  private readonly config: SessionSnapshotConfig
  private sweepTimer: ReturnType<typeof setInterval> | undefined
  private sweepEvery: number | undefined
  private readonly turns = new Map<string, SnapshotId>()
  /** Trees a stage or clear is using right now. A sweep must not delete them. */
  private readonly holds = new Set<Set<string>>()
  /** Open reverts by session. A miss reads the saved record, so a restart keeps file undo. */
  private readonly stages = new Map<string, StageRecord>()
  /** Where each user message landed. Resolves once the projection registers. */
  private readonly steps: Promise<ProjectionHandle<SnapshotStepsState>>

  constructor(ctx: Context, config: SessionSnapshotConfig) {
    super(ctx, 'sessionSnapshots')
    this.config = config
    this.enabled = config.snapshots !== false
    this.dataDir = snapshotRoot(config.dataDir)
    this.steps = ctx.sessionProjections.register(snapshotStepsProjectionDefinition)
    this.armSweep()
    ctx.on('loader/volatile-update', () => { this.armSweep() })
    ctx.effect(() => () => { this.clearSweep() })
    const files: SessionRevertFiles = {
      stage: (agent, atSeq, prev) => this.onStage(agent, atSeq, prev),
      clear: agent => this.onClear(agent),
      commit: agent => this.onCommit(agent),
    }
    ctx.effect(() => ctx.sessionRevert.bindFiles(files))
    ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.step <= 1 || humanPromptStarts(payload.messages)) {
        try {
          await this.captureTurn(payload.agent, payload.turn, payload.step)
        } catch (error: unknown) {
          // A git failure must not block the turn. Undo then skips file restore for it.
          this.warn(`session "${payload.agent.session.id}": capture before turn ${payload.turn} failed, so undo cannot restore its files`, error)
        }
      }
      return next()
    })
  }

  /**
   * Capture `directory` when snapshots are enabled and it is a git checkout.
   * @param directory - project path.
   * @returns the tree id, or undefined when capture is off or the path is not git.
   */
  async capture(directory: string): Promise<SnapshotId | undefined> {
    if (!this.enabled) return undefined
    const id = await captureTree(directory, this.dataDir, this.config.maxUntrackedBytes.get())
    if (id === undefined) return undefined
    await collectSnapshots(this.dataDir, this.retention(id))
    return id
  }

  /**
   * Restore one tree into its worktree.
   * @param directory - project path.
   * @param snapshot - tree id from {@link capture}.
   */
  restore(directory: string, snapshot: SnapshotId): Promise<void> {
    if (!this.enabled) return Promise.resolve()
    return restoreTree(directory, snapshot, this.dataDir, this.config.maxUntrackedBytes.get())
  }

  /**
   * Diff two trees.
   * @param directory - project path.
   * @param from - older tree.
   * @param to - newer tree.
   * @returns per-path addition and deletion counts.
   */
  diff(directory: string, from: SnapshotId, to: SnapshotId): Promise<FileDiff[]> {
    if (!this.enabled) return Promise.resolve([])
    return diffTrees(directory, from, to, this.dataDir)
  }

  /**
   * Remember the snapshot that belongs to one turn, or to one later step of it.
   * The pre-step hook calls this.
   * @param sessionId - session whose turn just opened.
   * @param turn - turn number from `turn/start`.
   * @param snapshot - tree captured before that turn, or that step, wrote files.
   * @param step - step that admitted a human message after the first. Omitted means the turn.
   */
  rememberTurn(sessionId: SessionId, turn: number, snapshot: SnapshotId, step?: number): void {
    this.turns.set(bindingKey(sessionId, turn, step ?? 1), snapshot)
  }

  /**
   * Drop snapshot trees that exceed the configured count, disk, or age limits.
   * A tree an open revert is using stays, including one saved by an earlier
   * process. A remembered turn does not.
   */
  collect(): Promise<void> {
    if (!this.enabled) return Promise.resolve()
    return collectSnapshots(this.dataDir, this.retention())
  }

  private armSweep(): void {
    const interval = this.config.gcIntervalMs.get()
    if (interval === this.sweepEvery) return
    this.clearSweep()
    this.sweepEvery = interval
    if (!this.enabled) return
    const timer = setInterval(() => {
      void this.collect().catch((error: unknown) => {
        // A sweep failure leaves the trees in place until the next one.
        this.warn('snapshot sweep failed', error)
      })
    }, interval)
    timer.unref()
    this.sweepTimer = timer
  }

  private clearSweep(): void {
    if (this.sweepTimer === undefined) return
    clearInterval(this.sweepTimer)
    this.sweepTimer = undefined
    this.sweepEvery = undefined
  }

  private retention(extra?: SnapshotId): SnapshotRetention {
    return {
      historyLimit: this.config.historyLimit.get(),
      diskLimitBytes: this.config.diskLimitBytes.get(),
      maxAgeMs: this.config.maxAgeMs.get(),
      pinned: this.pinned(extra),
      now: Date.now(),
    }
  }

  /** Ids a sweep must keep: trees in use, open reverts, plus `extra` from the capture in progress. */
  private pinned(extra?: SnapshotId): Set<string> {
    const ids = new Set<string>()
    for (const hold of this.holds) for (const id of hold) ids.add(id)
    for (const record of this.stages.values()) {
      ids.add(record.outer)
      if (record.staged !== undefined) ids.add(record.staged)
    }
    if (extra !== undefined) ids.add(extra)
    return ids
  }

  /** Open a set of ids a sweep keeps until the returned release runs. */
  private hold(): { add(id: SnapshotId | undefined): void; release(): void } {
    const ids = new Set<string>()
    this.holds.add(ids)
    return {
      add: (id) => { if (id !== undefined) ids.add(id) },
      release: () => { this.holds.delete(ids) },
    }
  }

  private async captureTurn(agent: Agent, turn: number, step: number): Promise<void> {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return
    const snapshot = await this.capture(cwd)
    if (snapshot === undefined) return
    const at = Math.max(1, step)
    this.rememberTurn(agent.session.id, turn, snapshot, at)
    await recordTurnBinding(cwd, this.dataDir, agent.session.id, turn, snapshot, at)
  }

  private async onStage(agent: Agent, atSeq: number, prev: { atSeq: number } | null): Promise<void> {
    const cwd = agent.session.header.cwd
    if (cwd === undefined || !this.enabled) return
    const id = agent.session.id
    const pins = this.hold()
    try {
      const target = await this.turnSnapshot(agent, cwd, atSeq)
      pins.add(target)
      let record: StageRecord | undefined
      if (prev === null) {
        // A fresh stage never reuses trees a cleared or committed revert left behind.
        await this.saveStage(cwd, id, undefined)
        record = await this.captureOuter(cwd, id)
        if (record === undefined) return
      } else {
        record = await this.stageOf(cwd, id)
        if (record === undefined) {
          await this.warnInGit(cwd, `session "${id}": no saved worktree for the open revert, so files stay where they are`)
          return
        }
      }
      pins.add(record.outer)
      pins.add(record.staged)
      if (record.staged !== undefined) {
        if (record.staged === target) return
        await restoreChanged(cwd, record.staged, record.outer, this.dataDir)
        record = { outer: record.outer }
        await this.saveStage(cwd, id, record)
      }
      if (target === undefined) {
        await this.warnInGit(cwd, `session "${id}": no snapshot was captured for the turn at seq ${atSeq}, so its files stay`)
        return
      }
      // Every path the target overwrites must be in `outer`, or clear could not write it back.
      const outer = await coverTree(cwd, record.outer, target, this.dataDir)
      pins.add(outer)
      // Saved before the write, so a clear after a partial write still knows which paths moved.
      await this.saveStage(cwd, id, { outer, staged: target })
      await restoreChanged(cwd, outer, target, this.dataDir)
    } catch (error: unknown) {
      // The tree was collected, or git failed. Message revert still applies.
      this.warn(`session "${id}": moving files for the revert failed; the messages still move`, error)
    } finally {
      pins.release()
    }
  }

  /** Capture the worktree a first stage returns to, and save it. */
  private async captureOuter(cwd: string, id: string): Promise<StageRecord | undefined> {
    const outer = await this.capture(cwd)
    if (outer === undefined) return undefined
    const record = { outer }
    await this.saveStage(cwd, id, record)
    return record
  }

  private async onClear(agent: Agent): Promise<void> {
    const cwd = agent.session.header.cwd
    if (cwd === undefined || !this.enabled) return
    const id = agent.session.id
    const pins = this.hold()
    try {
      const record = await this.stageOf(cwd, id)
      if (record === undefined) {
        await this.warnInGit(cwd, `session "${id}": no saved worktree for the open revert, so files stay where they are`)
        return
      }
      pins.add(record.outer)
      pins.add(record.staged)
      if (record.staged !== undefined) await restoreChanged(cwd, record.staged, record.outer, this.dataDir)
    } catch (error: unknown) {
      // The tree was collected, or git failed. Clearing the stage still applies.
      this.warn(`session "${id}": restoring files for the redo failed; the messages still return`, error)
    } finally {
      pins.release()
    }
    await this.dropStage(cwd, id)
  }

  private async onCommit(agent: Agent): Promise<void> {
    const cwd = agent.session.header.cwd
    this.stages.delete(agent.session.id)
    if (cwd === undefined || !this.enabled) return
    await this.dropStage(cwd, agent.session.id)
  }

  /** Forget an open revert. A record left behind is replaced by the next first stage. */
  private async dropStage(cwd: string, id: string): Promise<void> {
    try {
      await this.saveStage(cwd, id, undefined)
    } catch (error: unknown) {
      this.warn(`session "${id}": dropping the saved revert failed`, error)
    }
  }

  /** Cached open revert, else the record a previous process saved. */
  private async stageOf(cwd: string, id: string): Promise<StageRecord | undefined> {
    const cached = this.stages.get(id)
    if (cached !== undefined) return cached
    const stored = await readStageRecord(cwd, this.dataDir, id)
    if (stored !== undefined) this.stages.set(id, stored)
    return stored
  }

  /** Update the cache and the saved record together. `undefined` drops both. */
  private async saveStage(cwd: string, id: string, record: StageRecord | undefined): Promise<void> {
    if (record === undefined) this.stages.delete(id)
    else this.stages.set(id, record)
    await writeStageRecord(cwd, this.dataDir, id, record)
  }

  /** Tree captured before the step that logged `atSeq`, else before its turn. */
  private async turnSnapshot(agent: Agent, cwd: string, atSeq: number): Promise<SnapshotId | undefined> {
    const steps = (await this.steps).stateOf(agent.session)
    const position = steps.messages.find(([seq]) => seq === atSeq)
    if (position === undefined) return undefined
    const [, turn, step] = position
    const exact = step > 1 ? await this.binding(agent.session.id, cwd, turn, step) : undefined
    return exact ?? await this.binding(agent.session.id, cwd, turn, 1)
  }

  private async binding(sessionId: SessionId, cwd: string, turn: number, step: number): Promise<SnapshotId | undefined> {
    const key = bindingKey(sessionId, turn, step)
    const cached = this.turns.get(key)
    if (cached !== undefined) return cached
    const stored = await readTurnBinding(cwd, this.dataDir, sessionId, turn, step)
    if (stored !== undefined) this.turns.set(key, stored)
    return stored
  }

  /** Warn only for a git checkout. Elsewhere file restore is off by design. */
  private async warnInGit(cwd: string, message: string): Promise<void> {
    if (await worktreeRoot(cwd) !== undefined) this.warn(message)
  }

  private warn(message: string, error?: unknown): void {
    this.ctx.logger.warn(error === undefined ? `session-snapshot: ${message}` : `session-snapshot: ${message}: ${describe(error)}`)
  }
}

/** One-line text for a caught value; an Error keeps its name and message. */
function describe(error: unknown): string {
  return String(error)
}

function bindingKey(sessionId: string, turn: number, step: number): string {
  return step <= 1 ? `${sessionId}:${turn}` : `${sessionId}:${turn}:${step}`
}

export default SessionSnapshotService
