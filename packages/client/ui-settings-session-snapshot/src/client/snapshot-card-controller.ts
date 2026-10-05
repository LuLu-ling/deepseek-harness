/** The file-snapshot page's staged form over the `session-snapshot` entry. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Profile entry id of the worktree snapshot plugin. */
export const SNAPSHOT_NS = 'session-snapshot'

/** The limit fields this page edits. Each one has a schema default. */
export interface SnapshotSettings {
  /** Maximum snapshot trees kept for one worktree. */
  historyLimit?: number
  /** Maximum bytes of the snapshot root. */
  diskLimitBytes?: number
  /** Maximum snapshot age in milliseconds. */
  maxAgeMs?: number
  /** Sweep period in milliseconds. */
  gcIntervalMs?: number
  /** Largest untracked file, in bytes, that enters a tree. */
  maxUntrackedBytes?: number
}

/** What the file-snapshot page renders. */
export interface SnapshotCardState extends SettingsFormShell {
  /** Trees kept for one worktree. */
  historyLimit: SettingsFieldState
  /** Bytes the snapshot root may use. */
  diskLimitBytes: SettingsFieldState
  /** How long one tree is kept, in milliseconds. */
  maxAgeMs: SettingsFieldState
  /** Milliseconds between timed sweeps. */
  gcIntervalMs: SettingsFieldState
  /** Largest untracked file that enters a tree, in bytes. */
  maxUntrackedBytes: SettingsFieldState
}

/** The registration-side face the page's slot entry injects. */
export interface SnapshotCardFace extends SettingsFormActions {
  hooks: {
    /** Page snapshot bound by the renderer as useSnapshotCard. */
    snapshotCard: SnapshotStore<SnapshotCardState>
  }
}

/** Bridges the session-snapshot entry's form onto the page's staged form. */
export class SnapshotCardController {
  private readonly form: SettingsFormModel<SnapshotSettings>
  private readonly store: SnapshotStore<SnapshotCardState>

  /** @param scope - the shared configuration form of the session-snapshot entry. */
  constructor(scope: SettingsFormScope<SnapshotSettings>) {
    this.form = new SettingsFormModel(scope, [
      settingsNumberField('historyLimit'),
      settingsNumberField('diskLimitBytes'),
      settingsNumberField('maxAgeMs'),
      settingsNumberField('gcIntervalMs'),
      settingsNumberField('maxUntrackedBytes'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SnapshotCardState {
    return {
      ...this.form.shell(),
      historyLimit: this.form.field('historyLimit'),
      diskLimitBytes: this.form.field('diskLimitBytes'),
      maxAgeMs: this.form.field('maxAgeMs'),
      gcIntervalMs: this.form.field('gcIntervalMs'),
      maxUntrackedBytes: this.form.field('maxUntrackedBytes'),
    }
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its form actions.
   */
  inject(): SnapshotCardFace {
    return { hooks: { snapshotCard: this.store }, ...this.form.actions() }
  }

  /** Release the form subscription. */
  dispose(): void { this.form.dispose() }
}
