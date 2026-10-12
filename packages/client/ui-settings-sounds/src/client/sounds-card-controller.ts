/** Staged prompt-sound form over the `sounds` settings namespace. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { isSoundChoice, isSoundId, type SoundChoice, type SoundId } from '../sound-choices.ts'
import { createSoundPreviewController, type SoundPreviewController } from './preview.ts'
import { playSoundById } from './sound-player.ts'
import type { SoundField } from './playback.ts'

/** Settings namespace. It is the profile entry id. */
export const SOUNDS_NS = 'sounds'

/** Plugins-page order: one past the highest existing `plugins.item` order. */
export const SOUNDS_ORDER = 51

/** The three saved fields. Absence is the schema default, silence. */
export interface SoundsSettings {
  /** Agent completion sound. */
  agent?: SoundChoice
  /** Permission-request sound. */
  permissions?: SoundChoice
  /** Error sound. */
  errors?: SoundChoice
}

/** What the sound page renders. */
export interface SoundsCardState extends SettingsFormShell {
  /** Agent row. */
  agent: SettingsFieldState
  /** Permissions row. */
  permissions: SettingsFieldState
  /** Errors row. */
  errors: SettingsFieldState
}

/** Registration-side face the page's slot entry injects. */
export interface SoundsCardFace extends SettingsFormActions {
  hooks: {
    /** Page snapshot bound by the renderer as useSoundsCard. */
    soundsCard: SnapshotStore<SoundsCardState>
  }
  /**
   * Stage one choice. An id outside the closed set is ignored.
   * Highlight and selection preview without saving.
   * @param field - which row changed.
   * @param id - menu id, including `none`.
   */
  select: (field: SoundField, id: string) => void
  /**
   * Preview the highlighted id after a short delay. `none` and unknown ids only stop.
   * @param id - highlighted menu id.
   */
  preview: (id: string | undefined) => void
}

/** A choice field. Unknown text is not a write. Missing values render as silence. */
function soundField(field: SoundField): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : 'none',
    parse: text => isSoundChoice(text) ? { kind: 'set', value: text } : undefined,
  }
}

/**
 * Read the saved playable id. Silence, absence, and unknown stored values do not play.
 * @param value - saved section.
 * @param field - which sound.
 * @returns a playable id, or undefined.
 */
export function savedSoundId(value: SoundsSettings | undefined, field: SoundField): SoundId | undefined {
  const stored = value?.[field]
  return typeof stored === 'string' && isSoundId(stored) ? stored : undefined
}

/** Bridges the `sounds` scope onto the staged form and the menu preview. */
export class SoundsCardController {
  private readonly form: SettingsFormModel<SoundsSettings>
  private readonly store: SnapshotStore<SoundsCardState>
  private readonly sounds: SoundPreviewController

  /**
   * @param scope - the bound settings scope for the `sounds` namespace.
   * @param player - preview player. Event playback does not use this voice.
   */
  constructor(
    scope: SettingsFormScope<SoundsSettings>,
    player: (id: string | undefined) => Promise<(() => void) | undefined> = playSoundById,
  ) {
    this.form = new SettingsFormModel(scope, [soundField('agent'), soundField('permissions'), soundField('errors')])
    this.store = this.form.bind(() => this.projection())
    this.sounds = createSoundPreviewController(player)
  }

  private projection(): SoundsCardState {
    const shell = this.form.shell()
    const agent = this.present('agent')
    const permissions = this.present('permissions')
    const errors = this.present('errors')
    const invalid = shell.invalid || agent.invalid || permissions.invalid || errors.invalid
    return { ...shell, invalid, agent, permissions, errors }
  }

  /** A stored value outside the closed set is invalid and is not offered as a draft write. */
  private present(field: SoundField): SettingsFieldState {
    const state = this.form.field(field)
    return isSoundChoice(state.text) ? state : { ...state, invalid: true }
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page snapshot, form actions, and preview.
   */
  inject(): SoundsCardFace {
    const actions = this.form.actions()
    return {
      hooks: { soundsCard: this.store },
      ...actions,
      resetField: (field) => {
        actions.resetField(field)
        this.sounds.stop()
      },
      select: (field, id) => { this.select(field, id) },
      preview: (id) => { this.preview(id) },
    }
  }

  /** Release the form subscription and stop preview. */
  dispose(): void {
    this.sounds.stop()
    this.form.dispose()
  }

  private select(field: string, id: string): void {
    if (!isSoundChoice(id)) return
    this.form.actions().edit(field, id)
    this.preview(id)
  }

  private preview(id: string | undefined): void {
    this.sounds.play(id !== undefined && isSoundId(id) ? id : undefined)
  }
}
