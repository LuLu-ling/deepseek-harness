/** General settings row for the automatic compaction method. */
import { useState } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CompactionMethod, CompactionSettings } from './preference.ts'
import css from './CompactionMethodRow.module.css'

/** Accepted method and the immediate write the row calls. */
export interface CompactionMethodInjected {
  hooks: {
    method: ObservableSnapshot<ConfigFormSnapshot<CompactionSettings>>
  }
  /**
   * Persist one automatic method.
   * @param method - `soft` or `snapcompact`.
   * @returns settlement after the Host accepts the write.
   * @throws when the Host refuses the write or the transport fails.
   */
  setMethod(method: CompactionMethod): Promise<void>
}

/** Full General-row props. */
export type CompactionMethodRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.compaction'>
  & InjectFace<CompactionMethodInjected>

const OPTIONS = ['soft', 'snapcompact'] as const

/**
 * Render the automatic-method selector.
 * @param props - accepted preference, writer, and localized copy.
 * @returns the General settings row.
 */
export function CompactionMethodRow({ useMethod, setMethod, t }: CompactionMethodRowProps) {
  const form = useMethod(value => value)
  const method: CompactionMethod = form.value?.method === 'snapcompact' ? 'snapcompact' : 'soft'
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const disabled = busy || form.status !== 'ready' || !form.writable
  const select = (id: string) => {
    setOpen(false)
    if (id !== 'soft' && id !== 'snapcompact') return
    if (id === method) return
    setFailed(false)
    setBusy(true)
    void setMethod(id).catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
  }
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.title')}</div>
        <div className={css.desc}>{t('description')}</div>
        {failed && <div className={css.alert} role="alert">{t('writeFailed')}</div>}
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(id => ({ id, label: t(`settings.method.${id}`) }))}
        selectedId={method}
        onSelect={select}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(`settings.method.${method}`)}
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
