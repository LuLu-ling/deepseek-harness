/** Locale bundles for the file-snapshot settings page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the page renders. */
export type SnapshotSettingsLocaleKey =
  | 'title' | 'description'
  | 'historyLimit' | 'historyLimitHint'
  | 'diskLimitBytes' | 'diskLimitBytesHint'
  | 'maxAgeMs' | 'maxAgeMsHint'
  | 'gcIntervalMs' | 'gcIntervalMsHint'
  | 'maxUntrackedBytes' | 'maxUntrackedBytesHint'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed' | 'invalidNumber'

/** English copy. */
export const en: Record<SnapshotSettingsLocaleKey, string> = {
  title: 'File snapshots',
  description: 'Set how many worktree snapshots a revert keeps, how often they are swept, and how large an untracked file may be.',
  historyLimit: 'Trees kept',
  historyLimitHint: 'How many snapshot trees one worktree keeps.',
  diskLimitBytes: 'Disk cap (bytes)',
  diskLimitBytesHint: 'How many bytes the snapshot root may use.',
  maxAgeMs: 'Keep for (ms)',
  maxAgeMsHint: 'How long one snapshot tree is kept before a sweep drops it.',
  gcIntervalMs: 'Sweep interval (ms)',
  gcIntervalMsHint: 'How long to wait between timed sweeps. A capture also sweeps.',
  maxUntrackedBytes: 'Untracked file cap (bytes)',
  maxUntrackedBytesHint: 'Untracked files larger than this stay out of the snapshot and are not deleted on restore.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a whole number.',
}

/** Simplified Chinese copy. */
export const zh: Record<SnapshotSettingsLocaleKey, string> = {
  title: '文件快照',
  description: '设置撤回时工作区快照的保留数量、清理节奏和未跟踪文件大小。',
  historyLimit: '保留数量',
  historyLimitHint: '一个工作区最多保留多少棵快照。',
  diskLimitBytes: '磁盘上限（字节）',
  diskLimitBytesHint: '快照根目录最多占用多少字节。',
  maxAgeMs: '保留时间（毫秒）',
  maxAgeMsHint: '一棵快照最多保留多久，到期后由清理删掉。',
  gcIntervalMs: '清理间隔（毫秒）',
  gcIntervalMsHint: '两次定时清理相隔多久。每次捕获之后也会清理一次。',
  maxUntrackedBytes: '未跟踪文件上限（字节）',
  maxUntrackedBytesHint: '大于这个字节数的未跟踪文件不会进入快照，恢复时也不会被删掉。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请输入整数。',
}

/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: SnapshotSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
