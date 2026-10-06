/** The file-snapshot settings page: the limits a revert's worktree snapshots are bound by. */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels, type SnapshotSettingsLocaleKey } from './locales.ts'
import type { SnapshotCardFace, SnapshotCardState } from './snapshot-card-controller.ts'

/** Props the renderer binds for the file-snapshot page. */
export type SnapshotCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.sessionSnapshot'>
  & InjectFace<SnapshotCardFace>

/** One numeric limit, in the order the page shows them. */
const FIELDS: readonly (readonly [
  keyof Pick<SnapshotCardState, 'historyLimit' | 'diskLimitBytes' | 'maxAgeMs' | 'gcIntervalMs' | 'maxUntrackedBytes'>,
  string,
  SnapshotSettingsLocaleKey,
  SnapshotSettingsLocaleKey,
])[] = [
  ['historyLimit', 'plugin-config-snapshot-history', 'historyLimit', 'historyLimitHint'],
  ['diskLimitBytes', 'plugin-config-snapshot-disk', 'diskLimitBytes', 'diskLimitBytesHint'],
  ['maxAgeMs', 'plugin-config-snapshot-age', 'maxAgeMs', 'maxAgeMsHint'],
  ['gcIntervalMs', 'plugin-config-snapshot-gc', 'gcIntervalMs', 'gcIntervalMsHint'],
  ['maxUntrackedBytes', 'plugin-config-snapshot-untracked', 'maxUntrackedBytes', 'maxUntrackedBytesHint'],
]

/**
 * Render the file-snapshot one-liner or its settings form, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function SnapshotCard(props: SnapshotCardProps) {
  const { t } = props
  const state = props.useSnapshotCard(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      {FIELDS.map(([key, id, label, hint]) => (
        <SettingsValueField
          key={key}
          id={id}
          label={t(label)}
          hint={t(hint)}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          numeric
          disabled={disabled}
          {...state[key]}
          onEdit={(text) => { props.edit(key, text) }}
          onReset={() => { props.resetField(key) }}
        />
      ))}
    </SettingsForm>
  )
}
