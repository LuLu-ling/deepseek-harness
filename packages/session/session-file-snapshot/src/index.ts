/**
 * Worktree snapshots for session revert. Capture runs at the first pre-step
 * of a turn, before the model can write files. Stage and clear rewrite only
 * the paths that differ between the saved trees. Optional limits drop old trees.
 * @module @deepseek-ai/dsh-session-snapshot
 */

// Type-only: the loader event that reports a live config change.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRevertFiles } from '@lulu-ling/dsh-session-revert'
import z from '@deepseek-ai/schemastery'
import {
  MAX_UNTRACKED_BYTES,
  captureTree,
  collectSnapshots,
  diffTrees,
  recordSnapshot,
  restoreChanged,
  restoreTree,
  snapshotRoot,
  type FileDiff,
  type SnapshotId,
  type SnapshotRetention,
} from './git.ts'

export { MAX_UNTRACKED_BYTES, type FileDiff, type SnapshotId }

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

/**
 * `ctx.sessionSnapshots`: capture a worktree and restore it when a revert moves.
 */
export class SessionSnapshotService extends Service {
  static inject = ['sessionRevert']

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
  private readonly held = new Set<string>()
  private readonly outers = new Map<string, SnapshotId>()
  /** Tree the worktree's reverted paths currently match. */
  private readonly staged = new Map<string, SnapshotId>()

  constructor(ctx: Context, config: SessionSnapshotConfig) {
    super(ctx, 'sessionSnapshots')
    this.config = config
    this.enabled = config.snapshots !== false
    this.dataDir = snapshotRoot(config.dataDir)
    this.armSweep()
    ctx.on('loader/volatile-update', () => { this.armSweep() })
    ctx.effect(() => () => { this.clearSweep() })
    const files: SessionRevertFiles = {
      stage: (agent, atSeq, prev) => this.onStage(agent, atSeq, prev),
      clear: agent => this.onClear(agent),
      commit: (agent) => {
        this.outers.delete(agent.session.id)
        this.staged.delete(agent.session.id)
      },
    }
    ctx.sessionRevert.bindFiles(files)
    ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.step === 1) {
        try {
          await this.captureTurn(payload.agent, payload.turn)
        } catch (error: unknown) {
          // A git failure must not block the turn. Undo then skips file restore.
          if (!(error instanceof Error)) throw error
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
    await recordSnapshot(directory, this.dataDir, id, Date.now())
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
   * Remember the snapshot that belongs to one turn. The pre-step hook calls this.
   * @param sessionId - session whose turn just opened.
   * @param turn - turn number from `turn/start`.
   * @param snapshot - tree captured before that turn wrote files.
   */
  rememberTurn(sessionId: SessionId, turn: number, snapshot: SnapshotId): void {
    this.turns.set(`${sessionId}:${turn}`, snapshot)
  }

  /**
   * Drop snapshot trees that exceed the configured count, disk, or age limits.
   * A tree an open revert is using stays. A remembered turn does not.
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
        if (!(error instanceof Error)) throw error
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

  /** Ids a sweep must keep: the open revert, plus `extra` from the capture in progress. */
  private pinned(extra?: SnapshotId): Set<string> {
    const ids = new Set<string>(this.held)
    for (const id of this.outers.values()) ids.add(id)
    for (const id of this.staged.values()) ids.add(id)
    if (extra !== undefined) ids.add(extra)
    return ids
  }

  /** Keep `ids` across a sweep that runs before the revert finishes using them. */
  private hold(ids: readonly (SnapshotId | undefined)[]): () => void {
    const added: string[] = []
    for (const id of ids) {
      if (id === undefined || this.held.has(id)) continue
      this.held.add(id)
      added.push(id)
    }
    return () => {
      for (const id of added) this.held.delete(id)
    }
  }

  private async captureTurn(agent: Agent, turn: number): Promise<void> {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return
    const snapshot = await this.capture(cwd)
    if (snapshot === undefined) return
    this.rememberTurn(agent.session.id, turn, snapshot)
  }

  private async onStage(
    agent: Agent,
    atSeq: number,
    prev: { atSeq: number } | null,
  ): Promise<void> {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return
    const id = agent.session.id
    const target = this.turnSnapshot(agent, atSeq)
    const previous = this.staged.get(id)
    const release = this.hold([previous, target])
    try {
      if (prev === null) {
        const outer = await this.capture(cwd)
        if (outer !== undefined) this.outers.set(id, outer)
      }
      const outer = this.outers.get(id)
      if (outer !== undefined && previous !== undefined && previous !== target) {
        await this.restoreChanged(cwd, previous, outer)
      }
      if (outer !== undefined && target !== undefined) await this.restoreChanged(cwd, outer, target)
      if (target === undefined) this.staged.delete(id)
      else this.staged.set(id, target)
    } catch (error: unknown) {
      // The tree was collected, or git failed. Message revert still applies.
      if (!(error instanceof Error)) throw error
    } finally {
      release()
    }
  }

  private async onClear(agent: Agent): Promise<void> {
    const cwd = agent.session.header.cwd
    const id = agent.session.id
    const outer = this.outers.get(id)
    const previous = this.staged.get(id)
    const release = this.hold([outer, previous])
    this.outers.delete(id)
    this.staged.delete(id)
    try {
      if (cwd === undefined || outer === undefined || previous === undefined) return
      await this.restoreChanged(cwd, previous, outer)
    } catch (error: unknown) {
      // The tree was collected, or git failed. Clearing the stage still applies.
      if (!(error instanceof Error)) throw error
    } finally {
      release()
    }
  }

  /** Tree captured for the turn that contains `atSeq`, when one was recorded. */
  private turnSnapshot(agent: Agent, atSeq: number): SnapshotId | undefined {
    const turn = turnOf(agent, atSeq)
    if (turn === undefined) return undefined
    return this.turns.get(`${agent.session.id}:${turn}`)
  }

  /** Rewrite only the paths that differ between two captured trees. */
  private restoreChanged(directory: string, from: SnapshotId, to: SnapshotId): Promise<void> {
    if (!this.enabled || from === to) return Promise.resolve()
    return restoreChanged(directory, from, to, this.dataDir)
  }
}

function turnOf(agent: Agent, atSeq: number): number | undefined {
  let turn: number | undefined
  for (const event of agent.session.snapshotEvents()) {
    if (event.seq > atSeq) break
    if (event.type === 'turn/start') turn = event.data.turn
  }
  return turn
}

export default SessionSnapshotService
