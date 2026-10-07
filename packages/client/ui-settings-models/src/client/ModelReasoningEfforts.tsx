/**
 * Per-model reasoning wires for a pi-ai row, listed in selector order.
 * An empty wire is omitted; an all-empty list drops `reasoningEfforts`.
 * `defaultEffort` names the level the selector starts from.
 */
import type { ReactNode } from 'react'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Selector order. The visible name is the id with its first letter capitalized, as the effort menu shows it. */
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** The stored wire map, or undefined when this row is not a declaration. */
function wiresOf(model: DeepSeekModelDraft): Record<string, unknown> | undefined {
  const value = model['reasoningEfforts']
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** The stored wire for one level, or `''` when the level is absent or not text. */
function wireOf(model: DeepSeekModelDraft, level: string): string {
  const wire = wiresOf(model)?.[level]
  return typeof wire === 'string' ? wire : ''
}

/** Levels a default may name: declared levels with non-empty wire spellings. */
function defaultChoices(model: DeepSeekModelDraft): readonly string[] {
  if (model['reasoningEfforts'] === false) return []
  const wires = wiresOf(model)
  if (wires === undefined) return []
  return LEVELS.filter(level => typeof wires[level] === 'string' && wires[level] !== '')
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
 * Edit each reasoning level's wire value and the optional default level.
 * @param props - model declaration and row replacement action.
 * @returns the labeled wire fields and the default selector.
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
    const chosen = row['defaultEffort']
    if (typeof chosen === 'string' && Object.keys(efforts).length > 0 && efforts[chosen] === undefined) {
      Reflect.deleteProperty(row, 'defaultEffort')
    }
    onChange(row)
  }
  const chooseDefault = (level: string): void => {
    const row = { ...model }
    if (level === '') Reflect.deleteProperty(row, 'defaultEffort')
    else row['defaultEffort'] = level
    onChange(row)
  }
  const stored = typeof model['defaultEffort'] === 'string' ? model['defaultEffort'] : ''
  const choices = defaultChoices(model)
  const options = stored !== '' && !choices.includes(stored) ? [stored, ...choices] : choices
  const label = (level: string): string => `${level.charAt(0).toUpperCase()}${level.slice(1)}`
  return (
    <fieldset className={styles['modelReasoning']} aria-label={`${t('modelReasoning')} ${String(position)}`}>
      <legend className={styles['modelFieldLabel']}>{t('modelReasoning')}</legend>
      <div className={styles['modelReasoningList']}>
        {LEVELS.map((level) => {
          const name = label(level)
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
        <label className={styles['modelReasoningTier']}>
          <span className={styles['modelReasoningName']}>{t('modelDefaultEffort')}</span>
          <select
            className={`${styles['input']} ${styles['selectInput']}`}
            value={stored}
            title={t('modelDefaultEffortEmpty')}
            aria-label={`${t('modelDefaultEffort')} ${String(position)}`}
            disabled={disabled || choices.length === 0}
            onChange={(event) => { chooseDefault(event.target.value) }}
          >
            <option value="">{t('modelDefaultEffortUnset')}</option>
            {options.map(level => <option key={level} value={level}>{label(level)}</option>)}
          </select>
        </label>
      </div>
    </fieldset>
  )
}
