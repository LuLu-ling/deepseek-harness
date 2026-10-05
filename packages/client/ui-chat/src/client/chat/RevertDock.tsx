import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context } from '@deepseek-ai/cordis'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { hiddenUserMessages } from '../revert-commands.ts'
import { NS, type ChatKey } from '../locale.ts'
import css from './RevertDock.module.css'

/** Callbacks the dock uses to move or drop the staged boundary. */
export interface RevertDockInjected {
  hiddenMessages(): readonly { readonly seq: number; readonly text: string }[]
  /** Make this hidden message visible again; later hidden messages stay hidden. */
  restore(seq: number): void
  /** Drop the staged boundary. Frozen ranges stay hidden. */
  clear(): void
}

export interface RevertDockProps extends RevertDockInjected {
  useSession: <T>(select: (snapshot: SessionSnapshot) => T) => T
  t: (key: ChatKey, values?: { count?: number }) => string
}

/**
 * Collapsible list of messages hidden by the staged revert, above the composer.
 * @param props - session snapshot, hidden-message read, and restore actions.
 * @returns nothing when no revert is staged.
 */
export function RevertDock({ useSession, hiddenMessages, restore, clear, t }: RevertDockProps) {
  const staged = useSession(snapshot => snapshot.revert.staged)
  const [open, setOpen] = useState(false)
  if (staged === null) return null
  const items = hiddenMessages().filter(item => item.seq >= staged.atSeq)
  const preview = items[0]?.text ?? ''
  return (
    <div className={css.dock}>
      <div className={css.panel}>
        <button type="button" className={css.header} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
          <span className={css.count}>{t('revert.banner', { count: items.length })}</span>
          {preview === '' ? null : <> </>}
          {preview === '' ? null : <span className={css.preview}>{preview}</span>}
          <span className={css.chevron} data-open={open || undefined} aria-hidden="true">
            <IconChevronDownOutlineRegular />
          </span>
        </button>
        {open && (
          <ul className={css.list}>
            {items.map(item => (
              <li key={item.seq} className={css.row}>
                <span className={css.text}>{item.text}</span>
                <button type="button" className={css.restore} onClick={() => { restore(item.seq) }}>{t('revert.dock.restore')}</button>
              </li>
            ))}
            <li className={css.row}>
              <button type="button" className={css.restore} onClick={clear}>{t('revert.restore')}</button>
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * Register the dock on the strip above the composer.
 * @param ctx - client root.
 */
export function registerRevertDock(ctx: Context): void {
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'revert',
    order: 5,
    locale: NS,
    inject: (sessionId: SessionId): RevertDockInjected => {
      const session = ctx.sessions.binding(sessionId)?.session
      return {
        hiddenMessages: () => session === undefined ? [] : hiddenUserMessages(session),
        restore: (seq) => {
          if (session === undefined) return
          const later = hiddenUserMessages(session).find(item => item.seq > seq)
          if (later === undefined) void session.revertClear()
          else void session.revertStage(SessionSeq(later.seq))
        },
        clear: () => { if (session !== undefined) void session.revertClear() },
      }
    },
  }, RevertDock))
}
