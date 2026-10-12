/**
 * Play saved prompt sounds on session edges. Drafts are not read.
 * Subagent rows are the client list summary's `parentId`, the projection of
 * the session-controller list summary's `parentSessionId`.
 */
import type { SoundId } from '../sound-choices.ts'

/** The three saved fields. */
export type SoundField = 'agent' | 'permissions' | 'errors'

/** Client session-list facts this playback reads. */
export interface SoundSessionList {
  /** Host list order. An id absent here is not on the list yet. */
  readonly ids: readonly string[]
  /** Rows by id, including a parent id when the row is a subagent. */
  readonly byId: Readonly<Record<string, { readonly parentId?: string } | undefined>>
}

/** Reads the latest saved choice. Undefined means silence, including `'none'` and unknown ids. */
export type SavedSound = (field: SoundField) => SoundId | undefined

const PERMISSION_COOLDOWN_MS = 5000

/**
 * Observe status, approval, and error edges and play the saved sound for each.
 * Reconnect clears remembered running bits so a replay is not an edge.
 */
export class SoundPlayback {
  private readonly running = new Map<string, boolean>()
  private readonly permissionAt = new Map<string, number>()

  /**
   * @param saved - current saved playable id for one field.
   * @param sessions - client session list.
   * @param play - starts one saved id. Does not cancel menu preview.
   * @param now - clock for the permission cooldown.
   */
  constructor(
    private readonly saved: SavedSound,
    private readonly sessions: { list: { getSnapshot(): SoundSessionList } },
    private readonly play: (id: SoundId) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** Forget running bits. The next status for each session is a baseline, not an edge. */
  resetBaselines(): void {
    this.running.clear()
  }

  /**
   * Remember running, and play the agent sound only on a true-to-false edge
   * for a listed session that is not a subagent.
   * @param sessionId - session whose running bit changed.
   * @param running - the new running bit.
   */
  status(sessionId: string, running: boolean): void {
    const previous = this.running.get(sessionId)
    this.running.set(sessionId, running)
    if (previous !== true || running) return
    const list = this.sessions.list.getSnapshot()
    if (!list.ids.includes(sessionId) || list.byId[sessionId]?.parentId !== undefined) return
    this.playSaved('agent')
  }

  /**
   * Play the permission sound for a new approval request.
   * The same session is silent for five seconds after a sound actually starts.
   * @param sessionId - session that asked.
   */
  permission(sessionId: string): void {
    const at = this.now()
    const last = this.permissionAt.get(sessionId)
    if (last !== undefined && at - last < PERMISSION_COOLDOWN_MS) return
    if (!this.playSaved('permissions')) return
    this.permissionAt.set(sessionId, at)
  }

  /**
   * Play the error sound unless the session is a subagent.
   * A session that is not on the list yet still plays.
   * @param sessionId - session that failed.
   */
  error(sessionId: string): void {
    if (this.sessions.list.getSnapshot().byId[sessionId]?.parentId !== undefined) return
    this.playSaved('errors')
  }

  /** @returns whether a sound started. */
  private playSaved(field: SoundField): boolean {
    const id = this.saved(field)
    if (id === undefined) return false
    this.play(id)
    return true
  }
}
