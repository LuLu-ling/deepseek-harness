/**
 * Per-model reasoning wires for a pi-ai row, listed in selector order.
 * An empty wire is omitted; an all-empty list drops `reasoningEfforts`.
 */

import type { ReactNode } from 'react'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Selector order. The visible name is the id with its first letter capitalized, as the effort menu shows it. */
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** The stored wire for one level, or `''` when the level is absent or not text. */
function wireOf(model: DeepSeekModelDraft, level: string): string {
  const value = model['reasoningEfforts']
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  const wire = (value as Record<string, unknown>)[level]
  return typeof wire === 'string' ? wire : ''
}

/** Props of {@link ModelReasoningEfforts}. */
interface ModelReasoningEffortsProps {
  /** Effective model row, including fields outside the curated editor. */
  model: DeepSeekModelDraft
  /** One-based row position for the accessible group label. */
  position: number
  /** Prevent changes while read-only or saving. */
  disabled: boolean
  /** Section copy. */
  t: (key: ModelsKey) => string
  /** Replace this row, preserving unrelated configuration. */
  onChange: (model: DeepSeekModelDraft) => void
}

/**
 * Edit each reasoning level's wire value. An empty field omits that level.
 * @param props - model declaration and row replacement action.
 * @returns the labeled wire fields, one per level.
 */
export function ModelReasoningEfforts({ model, position, disabled, t, onChange }: ModelReasoningEffortsProps): ReactNode {
  const write = (level: string, wire: string): void => {
    const efforts: Record<string, string> = {}
    for (const id of LEVELS) {
      const text = id === level ? wire : wireOf(model, id)
      if (text !== '') efforts[id] = text
    }
    const row = { ...model }
    if (Object.keys(efforts).length === 0) Reflect.deleteProperty(row, 'reasoningEfforts')
    else row['reasoningEfforts'] = efforts
    onChange(row)
  }
  return (
    <fieldset className={styles['modelReasoning']} aria-label={`${t('modelReasoning')} ${String(position)}`}>
      <legend className={styles['modelFieldLabel']}>{t('modelReasoning')}</legend>
      <div className={styles['modelReasoningList']}>
        {LEVELS.map((level) => {
          const name = `${level.charAt(0).toUpperCase()}${level.slice(1)}`
          return (
            <label className={styles['modelReasoningTier']} key={level}>
              <span className={styles['modelReasoningName']}>{name}</span>
              <input
                className={styles['input']}
                type="text"
                value={wireOf(model, level)}
                placeholder={t('modelReasoningWire')}
                title={t('modelReasoningEmpty')}
                aria-label={`${name} ${String(position)}`}
                disabled={disabled}
                onChange={(event) => { write(level, event.target.value) }}
              />
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
