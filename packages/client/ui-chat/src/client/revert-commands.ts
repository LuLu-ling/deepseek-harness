/**
 * Client `/undo` and `/redo` commands. They stage or clear the session revert
 * boundary from the loaded event window. Undo places that message's text and
 * images in the composer. Redo and the dock's restore actions clear that
 * composer content. Files stay out of the composer.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ConversationController, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { IconRefreshOutlineRegular, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionSeq, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session/types'
import { NS } from './locale.ts'
import css from './revert-commands.module.css'

interface EventWindow {
  getSnapshot(): { readonly entries: readonly { readonly type: string; readonly event: SessionEvent }[] }
}

function eventWindow(session: SessionFace): EventWindow | undefined {
  if (!('eventSource' in session)) return undefined
  const source = session.eventSource
  if (typeof source !== 'object' || source === null || !('getSnapshot' in source)) return undefined
  const read = source.getSnapshot
  if (typeof read !== 'function') return undefined
  return source as EventWindow
}

/** Whether a seq is hidden by the current revert view. */
function hidden(session: SessionFace, seq: number): boolean {
  const revert = session.getSnapshot().revert
  if (revert.staged !== null && seq >= revert.staged.atSeq) return true
  return revert.committed.some(range => seq >= range.atSeq && seq < range.untilSeq)
}

/** Human user messages in the loaded window, in log order. */
function userMessages(session: SessionFace): SessionEvent<'user/message'>[] {
  const window = eventWindow(session)
  if (window === undefined) return []
  const found: SessionEvent<'user/message'>[] = []
  for (const entry of window.getSnapshot().entries) {
    if (entry.type !== 'event' || entry.event.type !== 'user/message') continue
    if (entry.event.data.source.kind !== 'user') continue
    found.push(entry.event)
  }
  return found
}

/** Hidden human prompts, oldest first, with their plain text. */
export function hiddenUserMessages(session: SessionFace): readonly { readonly seq: number; readonly text: string }[] {
  const staged = session.getSnapshot().revert.staged
  if (staged === null) return []
  return userMessages(session).flatMap((event) => {
    if (event.seq < staged.atSeq || !hidden(session, event.seq)) return []
    const text = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    return [{ seq: event.seq, text }]
  })
}

/**
 * Stage a revert at a user message and place its text and images in the composer.
 * An image-only message keeps the current text draft and still restores its images.
 * @param ctx - client root that owns sessions and the conversation input.
 * @param session - session being undone.
 * @param seq - user message that becomes the revert boundary.
 */
export function stageUndo(ctx: Context, session: SessionFace, seq: SessionSeq): void {
  placeUndonePrompt(ctx, session, seq)
  const stage = (): void => { void session.revertStage(seq) }
  if (session.getSnapshot().running) void session.cancel().then(stage)
  else stage()
}

/** A newer undo supersedes an image read that is still in flight. */
const imageRestores = new Map<string, number>()

type PromptImage = Extract<SessionEvent<'user/message'>['data']['content'][number], { type: 'image' }>

/** Replace the composer draft with the undone prompt text, and its images when present. */
function placeUndonePrompt(ctx: Context, session: SessionFace, seq: SessionSeq): void {
  const event = userMessages(session).find(item => item.seq === seq)
  if (event === undefined) return
  const text = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  const images = promptImages(event)
  if (text === '' && images.length === 0) return
  const binding = ctx.sessions.binding(session.sessionId)
  if (binding === undefined || binding.session !== session) return
  const conversation = binding.ctx.get('conversation') as ConversationController | undefined
  if (conversation === undefined) return
  const shell = conversation.input.for(binding.ctx)
  if (text !== '') shell.setDraft(text)
  shell.focus()
  if (images.length > 0) void restoreImages(conversation, session, shell, images)
}

function promptImages(event: SessionEvent<'user/message'>): PromptImage[] {
  return event.data.content.flatMap(block =>
    block.type === 'image' && block.attachment?.attachmentId !== undefined ? [block] : [])
}

async function restoreImages(
  conversation: ConversationController,
  session: SessionFace,
  shell: SessionInput,
  images: readonly PromptImage[],
): Promise<void> {
  const key = session.sessionId
  const generation = (imageRestores.get(key) ?? 0) + 1
  imageRestores.set(key, generation)
  const previous = shell.state.getSnapshot().attachmentIds
  const loaded = await Promise.all(images.map(async (image) => {
    const result = await session.readAttachment(image.attachment.attachmentId)
    if (!result.ok) return undefined
    const ref = result.value.attachment
    const bytes = Uint8Array.from(result.value.data)
    return new File([bytes], ref.name ?? '', { type: ref.mediaType })
  }))
  if (imageRestores.get(key) !== generation) return
  const files = loaded.filter((file): file is File => file !== undefined)
  if (files.length === 0) return
  const drafts = conversation.createDrafts(session.sessionId, files)
  if (imageRestores.get(key) !== generation) {
    conversation.releaseDraftAttachments(drafts)
    return
  }
  if (!shell.addAttachments(drafts.map(draft => draft.id))) {
    conversation.releaseDraftAttachments(drafts)
    return
  }
  for (const id of previous) {
    if (shell.removeAttachment(id)) conversation.releaseDraftAttachment(id)
  }
}

/** Counterclockwise twin of the message undo glyph. */
function IconRedoOutlineRegular({ size, className }: IconProps) {
  const mirror = className === undefined ? css.counterclockwise : `${className} ${css.counterclockwise}`
  return createElement(IconRefreshOutlineRegular, { size, className: mirror })
}

function sessionOf(ctx: Context, sessionId: SessionId): SessionFace | undefined {
  return ctx.sessions.binding(sessionId)?.session
}

/**
 * Register `/undo` and `/redo`.
 * @param ctx - client root that owns sessions and commandUi.
 */
export function registerRevertCommands(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.inject(['commandUi'], (scope) => {
    scope.effect(() => {
      const undo = scope.commandUi.register({
        name: 'undo',
        label: () => t('command.undo'),
        description: () => t('command.undo.description'),
        icon: IconRefreshOutlineRegular,
        available: client => lastVisible(ctx, client) !== undefined,
        ui: {
          kind: 'action',
          run: (client) => {
            const session = sessionOf(ctx, client.sessionId)
            const seq = session === undefined ? undefined : lastVisible(ctx, client)
            if (session === undefined || seq === undefined) return
            stageUndo(ctx, session, seq)
          },
        },
      })
      const redo = scope.commandUi.register({
        name: 'redo',
        label: () => t('command.redo'),
        description: () => t('command.redo.description'),
        icon: IconRedoOutlineRegular,
        available: (client) => {
          const session = sessionOf(ctx, client.sessionId)
          return session !== undefined && session.getSnapshot().revert.staged !== null
        },
        ui: {
          kind: 'action',
          run: (client) => { redoRevert(ctx, client) },
        },
      })
      return () => { undo(); redo() }
    }, 'ui-chat: /undo /redo')
  })
  ctx.inject(['shortcuts'], (scope) => {
    scope.effect(() => registerRevertShortcuts(scope), 'ui-chat: undo redo shortcuts')
  })
}

function lastVisible(ctx: Context, client: ClientSessionContext): SessionSeq | undefined {
  const session = sessionOf(ctx, client.sessionId)
  return session === undefined ? undefined : lastVisibleSession(session)
}

function redoRevert(ctx: Context, client: ClientSessionContext): void {
  const session = sessionOf(ctx, client.sessionId)
  if (session !== undefined) redoSession(ctx, session)
}

const chord = { code: 'KeyU', modifiers: ['primary', 'alt'] } as const
const redoChord = { code: 'KeyR', modifiers: ['primary', 'alt'] } as const

function registerRevertShortcuts(ctx: Context): () => void {
  const t = ctx.locale.bind(NS)
  const defaults = {
    'desktop:macos': chord,
    'desktop:windows': chord,
    'desktop:linux': chord,
    'web:macos': chord,
    'web:windows': chord,
    'web:linux': chord,
  }
  const redoDefaults = {
    'desktop:macos': redoChord,
    'desktop:windows': redoChord,
    'desktop:linux': redoChord,
    'web:macos': redoChord,
    'web:windows': redoChord,
    'web:linux': redoChord,
  }
  const undo = ctx.shortcuts.register({
    id: 'session.undo' as ShortcutCommandId,
    label: () => t('command.undo'),
    aliases: ['undo'],
    defaults,
    regions: ['page', 'editable'],
    modals: [],
    resolve: () => {
      const session = mainSession(ctx)
      if (session === undefined) return { status: 'pass' }
      const seq = lastVisibleSession(session)
      if (seq === undefined) return { status: 'pass' }
      return {
        status: 'handled',
        run: () => { stageUndo(ctx, session, seq) },
      }
    },
  })
  const redo = ctx.shortcuts.register({
    id: 'session.redo' as ShortcutCommandId,
    label: () => t('command.redo'),
    aliases: ['redo'],
    defaults: redoDefaults,
    regions: ['page', 'editable'],
    modals: [],
    resolve: () => {
      const session = mainSession(ctx)
      if (session === undefined || session.getSnapshot().revert.staged === null) return { status: 'pass' }
      return { status: 'handled', run: () => { redoSession(ctx, session) } }
    },
  })
  return () => { undo(); redo() }
}

function mainSession(ctx: Context): SessionFace | undefined {
  for (const row of Object.values(ctx.sessions.list.getSnapshot().byId)) {
    if ((row.retainedBy.mainView ?? 0) > 0) return sessionOf(ctx, row.id)
  }
  return undefined
}

function lastVisibleSession(session: SessionFace): SessionSeq | undefined {
  let last: SessionSeq | undefined
  for (const event of userMessages(session)) {
    if (!hidden(session, event.seq)) last = event.seq
  }
  return last
}

/**
 * Reveal the next hidden user message, or drop the staged boundary, and clear
 * the composer text and images that undo placed there.
 * @param ctx - client root that owns the conversation input.
 * @param session - session whose staged revert moves forward.
 */
export function redoSession(ctx: Context, session: SessionFace): void {
  const staged = session.getSnapshot().revert.staged
  if (staged === null) return
  clearComposer(ctx, session)
  const next = userMessages(session).find(event => event.seq > staged.atSeq && !session.getSnapshot().revert.committed.some(
    range => event.seq >= range.atSeq && event.seq < range.untilSeq,
  ))
  if (next === undefined) void session.revertClear()
  else void session.revertStage(SessionSeq(next.seq))
}

/**
 * Dock actions for the staged boundary. Restoring one message or all of them
 * clears the composer before the boundary moves.
 * @param ctx - client root that owns the conversation input.
 * @param session - session bound to the dock, when one is open.
 * @returns restore and clear callbacks for the dock.
 */
export function stagedRevertActions(ctx: Context, session: SessionFace | undefined): {
  restore(seq: number): void
  clear(): void
} {
  if (session === undefined) return { restore() {}, clear() {} }
  const clear = (): void => {
    clearComposer(ctx, session)
    void session.revertClear()
  }
  return {
    clear,
    restore(seq) {
      const later = hiddenUserMessages(session).find(item => item.seq > seq)
      if (later === undefined) {
        clear()
        return
      }
      clearComposer(ctx, session)
      void session.revertStage(SessionSeq(later.seq))
    },
  }
}

/** Drop undo's draft text and images, and abandon an image read still in flight. */
function clearComposer(ctx: Context, session: SessionFace): void {
  const key = session.sessionId
  imageRestores.set(key, (imageRestores.get(key) ?? 0) + 1)
  const binding = ctx.sessions.binding(key)
  if (binding === undefined || binding.session !== session) return
  const conversation = binding.ctx.get('conversation') as ConversationController | undefined
  if (conversation === undefined) return
  const shell = conversation.input.for(binding.ctx)
  shell.setDraft('')
  for (const id of shell.state.getSnapshot().attachmentIds) {
    if (shell.removeAttachment(id)) conversation.releaseDraftAttachment(id)
  }
}
