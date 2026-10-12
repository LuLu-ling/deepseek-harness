/** Prompt-sound settings page: three menu rows inside the shared settings form. */
import { useId, useRef, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, Menu, MenuItemButton, SettingsForm, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsFieldState } from '@deepseek-ai/dsh-client-ui-primitives'
import { SOUND_IDS } from '../sound-choices.ts'
import type { SoundField } from './playback.ts'
import { formLabels, type SoundsLocaleKey } from './locales.ts'
import type { SoundsCardFace } from './sounds-card-controller.ts'
import css from './SoundsCard.module.css'

/** Props the renderer binds for the sounds page. */
export type SoundsCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.sounds'>
  & InjectFace<SoundsCardFace>

/**
 * Render the one-line summary or the three sound menus.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function SoundsCard(props: SoundsCardProps) {
  const { t } = props
  const state = props.useSoundsCard(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <SoundRow
        field="agent"
        title={t('agent')}
        description={t('agentHint')}
        state={state.agent}
        disabled={!state.writable}
        t={t}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalid')}
        onSelect={props.select}
        onPreview={props.preview}
        onReset={props.resetField}
      />
      <SoundRow
        field="permissions"
        title={t('permissions')}
        description={t('permissionsHint')}
        state={state.permissions}
        disabled={!state.writable}
        t={t}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalid')}
        onSelect={props.select}
        onPreview={props.preview}
        onReset={props.resetField}
      />
      <SoundRow
        field="errors"
        title={t('errors')}
        description={t('errorsHint')}
        state={state.errors}
        disabled={!state.writable}
        t={t}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalid')}
        onSelect={props.select}
        onPreview={props.preview}
        onReset={props.resetField}
      />
    </SettingsForm>
  )
}

/** One labeled menu. Keyboard focus and pointer entry preview; selection only stages a draft. */
function SoundRow({
  field, title, description, state, disabled, t,
  overriddenLabel, resetLabel, invalidLabel, onSelect, onPreview, onReset,
}: {
  field: SoundField
  title: string
  description: string
  state: SettingsFieldState
  disabled: boolean
  t: (key: SoundsLocaleKey) => string
  overriddenLabel: string
  resetLabel: string
  invalidLabel: string
  onSelect: (field: SoundField, id: string) => void
  onPreview: (id: string | undefined) => void
  onReset: (field: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selectorRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const selected = state.text
  const selectedLabel = selected === 'none' ? t('none') : t(selected as SoundsLocaleKey)
  const options = [
    { id: 'none', label: t('none') },
    ...SOUND_IDS.map(id => ({ id, label: t(id) })),
  ]
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title} id={titleId}>{title}</div>
        <div className={css.desc}>{description}</div>
        {state.invalid ? <p className={css.invalid}>{invalidLabel}</p> : null}
      </div>
      <div className={css.aside}>
        {state.overridden
          ? (
            <>
              <Tag tone="neutral">{overriddenLabel}</Tag>
              <button type="button" className={css.reset} disabled={disabled} onClick={() => { onReset(field) }}>
                {resetLabel}
              </button>
            </>
          )
          : null}
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          align="end"
          portal
          anchor={(
            <button
              ref={selectorRef}
              type="button"
              className={css.selector}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-labelledby={titleId}
              disabled={disabled}
              onClick={() => { setOpen(value => !value) }}
            >
              {selectedLabel}
              <IconChevronDownOutlineRegular className={css.chevron} />
            </button>
          )}
        >
          {options.map(option => (
            <div
              key={option.id}
              data-sound-id={option.id}
              onFocus={() => { onPreview(option.id) }}
              onPointerEnter={() => { onPreview(option.id) }}
            >
              <MenuItemButton onSelect={() => {
                selectorRef.current?.focus({ preventScroll: true })
                setOpen(false)
                onSelect(field, option.id)
              }}>
                {option.label}
                {option.id === selected ? <IconCheckOutlineRegular className={css.check} /> : null}
              </MenuItemButton>
            </div>
          ))}
        </Menu>
      </div>
    </div>
  )
}
