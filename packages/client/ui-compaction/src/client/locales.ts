/** Locale keys for the compaction popup and General settings row. */
export const en = {
  'popup.soft.label': 'Summarize',
  'popup.soft.detail': 'Summarize locally with the active model.',
  'popup.snapcompact.label': 'Snapcompact',
  'popup.snapcompact.detail': 'Archive history onto dense bitmap images the model reads back.',
  'settings.title': 'Context compaction',
  description: 'Choose how automatic compaction treats older history',
  'settings.method.soft': 'Summarize',
  'settings.method.snapcompact': 'Snapcompact',
  writeFailed: 'The deployment did not accept this value.',
} as const

/** Chinese copy. Keys match {@link en}. */
export const zh = {
  'popup.soft.label': 'soft',
  'popup.soft.detail': '使用主动模型进行局部总结。',
  'popup.snapcompact.label': 'snapcompact',
  'popup.snapcompact.detail': '将历史记录存档到高密度位图图像中，模型可以读取这些图像。',
  'settings.title': '上下文压缩',
  description: '选择自动压缩较早历史的方式',
  'settings.method.soft': 'soft',
  'settings.method.snapcompact': 'snapcompact',
  writeFailed: '本部署没有接受这个值。',
} as const

/** Dictionary key for compaction popup and settings copy. */
export type CompactionLocaleKey = keyof typeof en
