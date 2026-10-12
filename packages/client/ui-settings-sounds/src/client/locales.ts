/** Locale bundles for the prompt-sound settings page. */
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { SOUND_IDS, type SoundId } from '../sound-choices.ts'

const SOUND_TITLES = {
  alert: 'Alert',
  'bip-bop': 'Bip-bop',
  staplebops: 'Staplebops',
  nope: 'Nope',
  yup: 'Yup',
  jj: 'Jj',
} as const

/** Visible name of one playable id. Both locales use this string. */
function soundName(id: SoundId): string {
  const index = id.lastIndexOf('-')
  const prefix = id.slice(0, index) as keyof typeof SOUND_TITLES
  return `${SOUND_TITLES[prefix]} ${id.slice(index + 1)}`
}

const soundNames: Record<SoundId, string> = Object.fromEntries(SOUND_IDS.map(id => [id, soundName(id)])) as Record<SoundId, string>

/** Locale keys the page renders, including one key per playable id. */
export type SoundsLocaleKey =
  | 'title' | 'description'
  | 'agent' | 'agentHint' | 'permissions' | 'permissionsHint' | 'errors' | 'errorsHint'
  | 'none' | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed' | 'invalid'
  | SoundId

/** English copy. Sound names match the Chinese dictionary. */
export const en: Record<SoundsLocaleKey, string> = {
  title: 'Sound effects',
  description: 'Sounds for the agent, permissions, and errors.',
  agent: 'Agent',
  agentHint: 'Play sound when the agent is complete or needs attention',
  permissions: 'Permissions',
  permissionsHint: 'Play sound when a permission is required',
  errors: 'Errors',
  errorsHint: 'Play sound when an error occurs',
  none: 'None',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalid: 'Choose a listed sound.',
  ...soundNames,
}

/** Simplified Chinese copy. Sound names are not translated. */
export const zh: Record<SoundsLocaleKey, string> = {
  title: '音效',
  description: '智能体、权限和错误的提示音。',
  agent: '智能体',
  agentHint: '当智能体完成或需要注意时播放声音',
  permissions: '权限',
  permissionsHint: '当需要权限时播放声音',
  errors: '错误',
  errorsHint: '发生错误时播放声音',
  none: '无',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalid: '请选择列表中的声音',
  ...soundNames,
}

/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: SoundsLocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}
