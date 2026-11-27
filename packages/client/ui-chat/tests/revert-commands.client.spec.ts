// @vitest-environment jsdom

import type { Context } from '@deepseek-ai/cordis'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { hiddenUserMessages, redoSession, registerRevertCommands, stageUndo, stagedRevertActions } from '../src/client/revert-commands.ts'

const sessionId = SessionId('session-undo')
const seq = SessionSeq(4)

function userEvent(text: string | undefined): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq,
    time: 0,
    surfaceOp: 'append',
    data: {
      role: 'user',
      id: 'message-undo',
      source: { kind: 'user' },
      content: text === undefined ? [] : [{ type: 'text', text }],
    },
  } as never
}

const accepted = { ok: true as const, value: { atSeq: seq, changed: true } }

/** A copy of `session` whose snapshot shows a revert staged at `atSeq`. */
function stagedAt(session: SessionFace, atSeq: number): SessionFace {
  return { ...session, getSnapshot: () => ({ running: false, revert: { staged: { atSeq }, committed: [] } }) } as never
}

/** Let an undo or redo that already got its Host reply release the session. */
async function settled(): Promise<void> {
  const tick = Promise.withResolvers<undefined>()
  setTimeout(tick.resolve, 0)
  await tick.promise
}

function undoneSession(event: SessionEvent<'user/message'>, running = false): {
  session: SessionFace
  revertStage: ReturnType<typeof vi.fn<(seq: SessionSeq) => Promise<unknown>>>
  cancel: () => Promise<void>
} {
  const revertStage = vi.fn<(seq: SessionSeq) => Promise<unknown>>(() => Promise.resolve(accepted))
  const cancel = vi.fn(() => Promise.resolve())
  const session: SessionFace = {
    sessionId,
    eventSource: { getSnapshot: () => ({ entries: [{ type: 'event', event }] }) },
    getSnapshot: () => ({ running, subagent: null, revert: { staged: null, committed: [] } }),
    revertStage,
    cancel,
  } as never
  return { session, revertStage, cancel }
}

function clientFor(
  session: SessionFace,
  shell: {
    setDraft: (text: string) => void
    focus: () => void
    addAttachments?: (ids: readonly string[]) => boolean
    removeAttachment?: (id: string) => boolean
    state?: { getSnapshot: () => { attachmentIds: readonly string[] } }
  },
  drafts?: {
    createDrafts?: (sessionId: SessionId, files: readonly File[], uploadImages: boolean) => readonly { id: string }[]
    releaseDraftAttachment?: (id: string) => void
    releaseDraftAttachments?: (attachments: readonly { id: string }[]) => void
  },
): Context {
  const input = { state: { getSnapshot: () => ({ draft: '', attachmentIds: [] }) }, ...shell }
  const scope = {
    get: (name: string) => name === 'conversation' ? {
      input: { for: () => input },
      createDrafts: drafts?.createDrafts ?? vi.fn(() => []),
      releaseDraftAttachment: drafts?.releaseDraftAttachment ?? vi.fn(),
      releaseDraftAttachments: drafts?.releaseDraftAttachments ?? vi.fn(),
    } : undefined,
  }
  return {
    sessions: {
      binding: () => ({ session, ctx: scope }),
    },
  } as never
}

describe('stageUndo', () => {
  it('puts the undone message text into the composer and stages that message', () => {
    const undone = undoneSession(userEvent('edit this'))
    const setDraft = vi.fn()
    const focus = vi.fn()
    stageUndo(clientFor(undone.session, { setDraft, focus }), undone.session, seq)
    expect(setDraft).toHaveBeenCalledExactlyOnceWith('edit this')
    expect(focus).toHaveBeenCalledOnce()
    expect(undone.revertStage).toHaveBeenCalledExactlyOnceWith(seq)
    expect(undone.cancel).not.toHaveBeenCalled()
  })

  it('leaves the composer alone when the undone message has no text', () => {
    const undone = undoneSession(userEvent(undefined))
    const setDraft = vi.fn()
    stageUndo(clientFor(undone.session, { setDraft, focus: vi.fn() }), undone.session, seq)
    expect(setDraft).not.toHaveBeenCalled()
    expect(undone.revertStage).toHaveBeenCalledExactlyOnceWith(seq)
  })

  it('fills the composer before cancelling a running turn', () => {
    const undone = undoneSession(userEvent('edit this'), true)
    const setDraft = vi.fn()
    stageUndo(clientFor(undone.session, { setDraft, focus: vi.fn() }), undone.session, seq)
    expect(setDraft).toHaveBeenCalledExactlyOnceWith('edit this')
    expect(undone.cancel).toHaveBeenCalledOnce()
    expect(undone.revertStage).not.toHaveBeenCalled()
  })

  it('restores an image-only message into the composer without replacing the text draft', async () => {
    const attachment = {
      attachmentId: 'img-1',
      mediaType: 'image/png' as const,
      bytes: 3,
      width: 1,
      height: 1,
      name: 'shot.png',
    }
    const undone = undoneSession({
      type: 'user/message',
      seq,
      time: 0,
      surfaceOp: 'append',
      data: {
        role: 'user',
        id: 'message-undo',
        source: { kind: 'user' },
        content: [{ type: 'image', attachment }],
      },
    } as never)
    const readAttachment = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { attachment, data: Uint8Array.of(1, 2, 3) },
    }))
    Object.assign(undone.session, { readAttachment })
    const drafts = [{ id: 'draft-1' }]
    const createDrafts = vi.fn<
      (sessionId: SessionId, files: readonly File[], uploadImages: boolean) => readonly { id: string }[]
    >(() => drafts)
    const releaseDraftAttachment = vi.fn()
    const addAttachments = vi.fn(() => true)
    const removeAttachment = vi.fn(() => true)
    const setDraft = vi.fn()
    const shell = {
      setDraft,
      focus: vi.fn(),
      addAttachments,
      removeAttachment,
      state: { getSnapshot: () => ({ attachmentIds: ['old-draft'] }) },
    }
    stageUndo(clientFor(undone.session, shell, { createDrafts, releaseDraftAttachment }), undone.session, seq)
    expect(setDraft).not.toHaveBeenCalled()
    expect(shell.focus).toHaveBeenCalledOnce()
    await vi.waitFor(() => { expect(addAttachments).toHaveBeenCalledExactlyOnceWith(['draft-1']) })
    expect(readAttachment).toHaveBeenCalledExactlyOnceWith(attachment)
    const file = createDrafts.mock.calls[0]?.[1][0]
    expect(file).toBeInstanceOf(File)
    if (!(file instanceof File)) return
    expect(file.name).toBe('shot.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBe(3)
    expect(removeAttachment).toHaveBeenCalledExactlyOnceWith('old-draft')
    expect(releaseDraftAttachment).toHaveBeenCalledExactlyOnceWith('old-draft')
    expect(createDrafts).toHaveBeenCalledExactlyOnceWith(sessionId, [file], true)
  })

  it('leaves existing composer attachments when the image cannot be read', async () => {
    const undone = undoneSession({
      type: 'user/message',
      seq,
      time: 0,
      surfaceOp: 'append',
      data: {
        role: 'user',
        id: 'message-undo',
        source: { kind: 'user' },
        content: [{ type: 'image', attachment: { attachmentId: 'missing' } }],
      },
    } as never)
    const pending = Promise.withResolvers<{ ok: false; error: Error }>()
    Object.assign(undone.session, { readAttachment: () => pending.promise })
    const createDrafts = vi.fn(() => [])
    const removeAttachment = vi.fn(() => true)
    const shell = {
      setDraft: vi.fn(),
      focus: vi.fn(),
      addAttachments: vi.fn(() => true),
      removeAttachment,
      state: { getSnapshot: () => ({ attachmentIds: ['old-draft'] }) },
    }
    stageUndo(clientFor(undone.session, shell, { createDrafts }), undone.session, seq)
    expect(shell.focus).toHaveBeenCalledOnce()
    pending.resolve({ ok: false, error: new Error('missing') })
    await pending.promise
    const flushed = Promise.withResolvers<undefined>()
    setTimeout(flushed.resolve, 0)
    await flushed.promise
    expect(removeAttachment).not.toHaveBeenCalled()
    expect(createDrafts).not.toHaveBeenCalled()
    expect(shell.setDraft).not.toHaveBeenCalled()
  })
})

describe('stageUndo refusals', () => {
  function draftShell(initial: string) {
    let draft = initial
    return {
      setDraft: vi.fn((text: string) => { draft = text }),
      focus: vi.fn(),
      state: { getSnapshot: () => ({ draft, attachmentIds: [] }) },
      type(text: string) { draft = text },
    }
  }

  it('puts the previous draft back when the Host refuses the undo', async () => {
    const undone = undoneSession(userEvent('edit this'))
    undone.revertStage.mockResolvedValue({ ok: false, error: { code: 'session/revert-busy', message: 'busy' } })
    const shell = draftShell('my draft')
    stageUndo(clientFor(undone.session, shell), undone.session, seq)
    expect(shell.setDraft).toHaveBeenLastCalledWith('edit this')
    await vi.waitFor(() => { expect(shell.setDraft).toHaveBeenLastCalledWith('my draft') })
  })

  it('puts the previous draft back when the undo request fails', async () => {
    const undone = undoneSession(userEvent('edit this'))
    undone.revertStage.mockRejectedValue(new Error('disconnected'))
    const shell = draftShell('my draft')
    stageUndo(clientFor(undone.session, shell), undone.session, seq)
    await vi.waitFor(() => { expect(shell.setDraft).toHaveBeenLastCalledWith('my draft') })
  })

  it('keeps text the user typed after the undo even when the Host refuses', async () => {
    const undone = undoneSession(userEvent('edit this'))
    const refused = Promise.withResolvers<unknown>()
    undone.revertStage.mockReturnValue(refused.promise)
    const shell = draftShell('my draft')
    stageUndo(clientFor(undone.session, shell), undone.session, seq)
    shell.type('typed meanwhile')
    refused.resolve({ ok: false, error: { code: 'session/revert-busy', message: 'busy' } })
    await refused.promise
    await Promise.resolve()
    expect(shell.setDraft).toHaveBeenCalledExactlyOnceWith('edit this')
  })

  it('ignores a second undo while the first still waits on the Host', async () => {
    const undone = undoneSession(userEvent('edit this'))
    const pending = Promise.withResolvers<unknown>()
    undone.revertStage.mockReturnValue(pending.promise)
    const shell = draftShell('')
    const client = clientFor(undone.session, shell)
    stageUndo(client, undone.session, seq)
    stageUndo(client, undone.session, seq)
    redoSession(client, stagedAt(undone.session, seq))
    expect(undone.revertStage).toHaveBeenCalledOnce()
    expect(shell.setDraft).toHaveBeenCalledOnce()
    pending.resolve(accepted)
    await pending.promise
    await vi.waitFor(() => {
      stageUndo(client, undone.session, seq)
      expect(undone.revertStage).toHaveBeenCalledTimes(2)
    })
  })
})

describe('restore', () => {
  function stagedSession(events: readonly SessionEvent<'user/message'>[], atSeq: number) {
    const revertStage = vi.fn((_seq: SessionSeq) => Promise.resolve(accepted))
    const revertClear = vi.fn(() => Promise.resolve({ ok: true as const, value: { cleared: true } }))
    const session: SessionFace = {
      sessionId,
      eventSource: { getSnapshot: () => ({ entries: events.map(event => ({ type: 'event', event })) }) },
      getSnapshot: () => ({ running: false, revert: { staged: { atSeq }, committed: [] } }),
      revertStage,
      revertClear,
      cancel: vi.fn(() => Promise.resolve()),
    } as never
    return { session, revertStage, revertClear }
  }

  function shellWith(textIds: readonly string[]) {
    return {
      setDraft: vi.fn(),
      focus: vi.fn(),
      addAttachments: vi.fn(() => true),
      removeAttachment: vi.fn(() => true),
      state: { getSnapshot: () => ({ attachmentIds: textIds }) },
    }
  }

  it('clears the composer and drops the boundary when redo restores the only hidden message', () => {
    const staged = stagedSession([userEvent('edit this')], 4)
    const shell = shellWith(['draft-1'])
    const releaseDraftAttachment = vi.fn()
    redoSession(clientFor(staged.session, shell, { releaseDraftAttachment }), staged.session)
    expect(shell.setDraft).toHaveBeenCalledExactlyOnceWith('')
    expect(shell.removeAttachment).toHaveBeenCalledExactlyOnceWith('draft-1')
    expect(releaseDraftAttachment).toHaveBeenCalledExactlyOnceWith('draft-1')
    expect(staged.revertClear).toHaveBeenCalledOnce()
    expect(staged.revertStage).not.toHaveBeenCalled()
  })

  it('clears the composer and stages the next hidden message', () => {
    const later = { ...userEvent('next'), seq: SessionSeq(8) }
    const staged = stagedSession([userEvent('edit this'), later], 4)
    const shell = shellWith([])
    redoSession(clientFor(staged.session, shell), staged.session)
    expect(shell.setDraft).toHaveBeenCalledExactlyOnceWith('')
    expect(staged.revertStage).toHaveBeenCalledExactlyOnceWith(SessionSeq(8))
    expect(staged.revertClear).not.toHaveBeenCalled()
  })

  it('clears the composer when the dock restores one message or all of them', async () => {
    const staged = stagedSession([userEvent('edit this')], 4)
    const shell = shellWith(['draft-1'])
    const releaseDraftAttachment = vi.fn()
    const actions = stagedRevertActions(clientFor(staged.session, shell, { releaseDraftAttachment }), staged.session)
    actions.restore(4)
    expect(shell.setDraft).toHaveBeenCalledExactlyOnceWith('')
    expect(shell.removeAttachment).toHaveBeenCalledExactlyOnceWith('draft-1')
    expect(releaseDraftAttachment).toHaveBeenCalledExactlyOnceWith('draft-1')
    expect(staged.revertClear).toHaveBeenCalledOnce()

    await settled()
    shell.setDraft.mockClear()
    shell.removeAttachment.mockClear()
    actions.clear()
    expect(shell.setDraft).toHaveBeenCalledExactlyOnceWith('')
    expect(staged.revertClear).toHaveBeenCalledTimes(2)
  })

  it('does not attach an image undo that is still loading when the message is restored', async () => {
    const attachment = { attachmentId: 'img-1', mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1, name: 'a.png' }
    const event = {
      type: 'user/message',
      seq,
      time: 0,
      surfaceOp: 'append',
      data: { role: 'user', id: 'message-undo', source: { kind: 'user' }, content: [{ type: 'image', attachment }] },
    } as never
    const staged = stagedSession([event], 4)
    const pending = Promise.withResolvers<{ ok: true; value: { attachment: typeof attachment; data: Uint8Array } }>()
    Object.assign(staged.session, { readAttachment: () => pending.promise })
    const createDrafts = vi.fn(() => [{ id: 'draft-1' }])
    const shell = shellWith(['kept'])
    stageUndo(clientFor(staged.session, shell, { createDrafts }), staged.session, seq)
    await settled()
    redoSession(clientFor(staged.session, shell, { createDrafts }), staged.session)
    pending.resolve({ ok: true, value: { attachment, data: Uint8Array.of(1) } })
    await pending.promise
    const flushed = Promise.withResolvers<undefined>()
    setTimeout(flushed.resolve, 0)
    await flushed.promise
    expect(createDrafts).not.toHaveBeenCalled()
    expect(shell.setDraft).toHaveBeenCalledExactlyOnceWith('')
  })
})

describe('revert command registration', () => {
  interface Registered {
    readonly name?: string
    readonly id?: string
    readonly label: () => string
    readonly description?: () => string
    readonly icon?: (props: { size?: number; className?: string }) => unknown
    readonly available?: (client: { sessionId: SessionId }) => boolean
    readonly ui?: { run: (client: { sessionId: SessionId }) => void }
    readonly resolve?: () => { status: string; run?: () => void }
  }

  function revertSession(options: {
    events: readonly SessionEvent<'user/message'>[]
    staged: number | null
    committed?: readonly { atSeq: number; untilSeq: number }[]
    eventSource?: unknown
  }) {
    const revertStage = vi.fn((atSeq: SessionSeq) => Promise.resolve({ ok: true as const, value: { atSeq, changed: true } }))
    const revertClear = vi.fn(() => Promise.resolve({ ok: true as const, value: { cleared: true } }))
    const session = {
      sessionId,
      eventSource: 'eventSource' in options
        ? options.eventSource
        : { getSnapshot: () => ({ entries: options.events.map(event => ({ type: 'event', event })) }) },
      getSnapshot: () => ({
        running: false,
        subagent: null,
        revert: { staged: options.staged === null ? null : { atSeq: options.staged }, committed: options.committed ?? [] },
      }),
      revertStage,
      revertClear,
      cancel: vi.fn(() => Promise.resolve()),
    } as unknown as SessionFace
    return { session, revertStage, revertClear }
  }

  function registry(session: SessionFace | undefined, mainView: boolean) {
    const commands: Registered[] = []
    const shortcuts: Registered[] = []
    const disposed: string[] = []
    const effects: (() => void)[] = []
    const scope = {
      locale: { bind: () => (key: string) => key },
      sessions: {
        binding: () => session === undefined ? undefined : { session, ctx: { get: () => undefined } },
        list: { getSnapshot: () => ({ byId: { [sessionId]: { id: sessionId, retainedBy: mainView ? { mainView: 1 } : {} } } }) },
      },
      effect: (run: () => () => void) => { effects.push(run()) },
      commandUi: { register: (entry: Registered) => { commands.push(entry); return () => { disposed.push(entry.name ?? '') } } },
      shortcuts: { register: (entry: Registered) => { shortcuts.push(entry); return () => { disposed.push(entry.id ?? '') } } },
    }
    const ctx = { ...scope, inject: (_names: readonly string[], apply: (scope: unknown) => void) => { apply(scope) } }
    registerRevertCommands(ctx as never)
    const find = (list: Registered[], key: string) => {
      const found = list.find(entry => entry.name === key || entry.id === key)
      if (found === undefined) throw new Error(`missing ${key}`)
      return found
    }
    return {
      command: (name: string) => find(commands, name),
      shortcut: (id: string) => find(shortcuts, id),
      dispose: () => { for (const stop of effects) stop() },
      disposed,
    }
  }

  const later = (text: string, at: number) => ({ ...userEvent(text), seq: SessionSeq(at) })

  it('offers undo for the last visible prompt and runs it', async () => {
    const live = revertSession({ events: [userEvent('one'), later('two', 8)], staged: null })
    const commands = registry(live.session, true)
    const undo = commands.command('undo')
    expect(undo.label()).toBe('command.undo')
    expect(undo.description?.()).toBe('command.undo.description')
    expect(undo.available?.({ sessionId })).toBe(true)
    undo.ui?.run({ sessionId })
    await vi.waitFor(() => { expect(live.revertStage).toHaveBeenCalledExactlyOnceWith(SessionSeq(8)) })
    await settled()

    const shortcut = commands.shortcut('session.undo')
    expect(shortcut.label()).toBe('command.undo')
    const resolved = shortcut.resolve?.()
    expect(resolved?.status).toBe('handled')
    resolved?.run?.()
    await vi.waitFor(() => { expect(live.revertStage).toHaveBeenCalledTimes(2) })
    await settled()
    commands.dispose()
    expect(commands.disposed).toEqual(['undo', 'redo', 'session.undo', 'session.redo'])
  })

  it('offers redo only while a revert is staged and moves to the next hidden prompt', async () => {
    const staged = revertSession({ events: [userEvent('one'), later('two', 8)], staged: 4 })
    const commands = registry(staged.session, true)
    const redo = commands.command('redo')
    expect(redo.label()).toBe('command.redo')
    expect(redo.description?.()).toBe('command.redo.description')
    expect(redo.available?.({ sessionId })).toBe(true)
    redo.ui?.run({ sessionId })
    await vi.waitFor(() => { expect(staged.revertStage).toHaveBeenCalledExactlyOnceWith(SessionSeq(8)) })
    await settled()
    const shortcut = commands.shortcut('session.redo')
    expect(shortcut.label()).toBe('command.redo')
    shortcut.resolve?.().run?.()
    await vi.waitFor(() => { expect(staged.revertStage).toHaveBeenCalledTimes(2) })
    await settled()

    const idle = revertSession({ events: [userEvent('one')], staged: null })
    const none = registry(idle.session, true)
    expect(none.command('redo').available?.({ sessionId })).toBe(false)
    expect(none.shortcut('session.redo').resolve?.()).toEqual({ status: 'pass' })
    redoSession({} as never, idle.session)
    expect(idle.revertClear).not.toHaveBeenCalled()
  })

  it('passes when there is no session, no main view, or nothing left to undo', () => {
    const missing = registry(undefined, true)
    expect(missing.command('undo').available?.({ sessionId })).toBe(false)
    expect(missing.command('redo').available?.({ sessionId })).toBe(false)
    missing.command('undo').ui?.run({ sessionId })
    missing.command('redo').ui?.run({ sessionId })

    const hiddenAll = revertSession({ events: [userEvent('one')], staged: 4 })
    const commands = registry(hiddenAll.session, false)
    expect(commands.shortcut('session.undo').resolve?.()).toEqual({ status: 'pass' })
    expect(commands.shortcut('session.redo').resolve?.()).toEqual({ status: 'pass' })
    const visible = registry(hiddenAll.session, true)
    expect(visible.command('undo').available?.({ sessionId })).toBe(false)
    visible.command('undo').ui?.run({ sessionId })
    expect(visible.shortcut('session.undo').resolve?.()).toEqual({ status: 'pass' })
    expect(hiddenAll.revertStage).not.toHaveBeenCalled()
  })

  it('undoes the last prompt a committed range leaves visible', async () => {
    const live = revertSession({ events: [userEvent('one'), later('frozen', 8)], staged: null, committed: [{ atSeq: 7, untilSeq: 9 }] })
    const commands = registry(live.session, true)
    commands.command('undo').ui?.run({ sessionId })
    await vi.waitFor(() => { expect(live.revertStage).toHaveBeenCalledExactlyOnceWith(seq) })
    await settled()
  })

  it('mirrors the undo glyph for redo', () => {
    const commands = registry(undefined, false)
    const icon = commands.command('redo').icon
    expect(icon?.({ size: 16 })).toBeDefined()
    expect(icon?.({ size: 16, className: 'extra' })).toBeDefined()
  })

  it('reads hidden prompts across committed ranges and ignores a session without an event window', () => {
    const withImage = later('three', 12)
    const mixed = {
      ...withImage,
      data: { ...withImage.data, content: [...withImage.data.content, { type: 'image', attachment: { attachmentId: 'img' } }] },
    } as never as SessionEvent<'user/message'>
    const staged = revertSession({
      events: [userEvent('one'), later('two', 8), mixed],
      staged: 8,
      committed: [{ atSeq: 10, untilSeq: 13 }],
    })
    expect(hiddenUserMessages(staged.session)).toEqual([{ seq: 8, text: 'two' }, { seq: 12, text: 'three' }])
    const clear = revertSession({ events: [userEvent('one')], staged: null })
    expect(hiddenUserMessages(clear.session)).toEqual([])
    for (const eventSource of [undefined, null, {}, { getSnapshot: 'not a function' }]) {
      const windowless = revertSession({ events: [], staged: 4, eventSource })
      expect(hiddenUserMessages(windowless.session)).toEqual([])
    }
    const withoutWindow = { ...clear.session } as Record<string, unknown>
    delete withoutWindow['eventSource']
    expect(hiddenUserMessages({ ...withoutWindow, getSnapshot: () => staged.session.getSnapshot() } as never)).toEqual([])
  })

  it('restores one hidden prompt by moving the boundary to the next one', async () => {
    const staged = revertSession({ events: [userEvent('one'), later('two', 8)], staged: 4 })
    const shell = { setDraft: vi.fn(), focus: vi.fn() }
    stagedRevertActions(clientFor(staged.session, shell), staged.session).restore(4)
    expect(shell.setDraft).toHaveBeenCalledExactlyOnceWith('')
    await vi.waitFor(() => { expect(staged.revertStage).toHaveBeenCalledExactlyOnceWith(SessionSeq(8)) })
    await settled()
    const none = stagedRevertActions({} as never, undefined)
    none.restore(1)
    none.clear()
  })
})

describe('revert command edges', () => {
  const imageRef = { attachmentId: 'img-edge', mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 }

  function imageEvent(at: number): SessionEvent<'user/message'> {
    return {
      type: 'user/message', seq: SessionSeq(at), time: 0, surfaceOp: 'append',
      data: { role: 'user', id: `image-${at}`, source: { kind: 'user' }, content: [{ type: 'image', attachment: imageRef }] },
    } as never
  }

  interface EdgeRevert {
    staged: { atSeq: number } | null
    committed: readonly { atSeq: number; untilSeq: number }[]
  }

  function edgeSession(id: string, entries: readonly unknown[], revert: EdgeRevert) {
    const revertStage = vi.fn((atSeq: SessionSeq) => Promise.resolve({ ok: true as const, value: { atSeq, changed: true } }))
    const session = {
      sessionId: SessionId(id),
      eventSource: { getSnapshot: () => ({ entries }) },
      getSnapshot: () => ({ running: false, subagent: null, revert }),
      revertStage,
      revertClear: vi.fn(() => Promise.resolve({ ok: true as const, value: { cleared: true } })),
      cancel: vi.fn(() => Promise.resolve()),
      readAttachment: vi.fn(() => Promise.resolve({ ok: true as const, value: { attachment: imageRef, data: Uint8Array.of(1) } })),
    } as unknown as SessionFace & { revertStage: typeof revertStage }
    return session
  }

  function shell(addAttachments = true) {
    return {
      setDraft: vi.fn(),
      focus: vi.fn(),
      addAttachments: vi.fn(() => addAttachments),
      removeAttachment: vi.fn(() => false),
      state: { getSnapshot: () => ({ draft: '', attachmentIds: ['kept'] }) },
    }
  }

  it('skips transient rows and non-human prompts, and redo steps over a committed range', async () => {
    const watcher = { ...userEvent('notice'), seq: SessionSeq(6), data: { ...userEvent('notice').data, source: { kind: 'watcher' } } }
    const inside = { ...userEvent('inside'), seq: SessionSeq(8) }
    const after = { ...userEvent('after'), seq: SessionSeq(12) }
    const session = edgeSession('edge-redo', [
      { type: 'transient', event: userEvent('streaming') },
      { type: 'event', event: { type: 'turn/start', seq: 5, time: 0, data: { turn: 1 } } },
      { type: 'event', event: watcher },
      { type: 'event', event: inside },
      { type: 'event', event: after },
    ], { staged: { atSeq: 4 }, committed: [{ atSeq: 7, untilSeq: 9 }] })
    redoSession(clientFor(session, shell()), session)
    await vi.waitFor(() => { expect(session.revertStage).toHaveBeenCalledExactlyOnceWith(SessionSeq(12)) })
  })

  it('places nothing for a seq outside the window or a binding to another session', async () => {
    const session = edgeSession('edge-unbound', [{ type: 'event', event: userEvent('visible') }], { staged: null, committed: [] })
    const other = edgeSession('edge-other', [], { staged: null, committed: [] })
    const composer = shell()
    stageUndo(clientFor(other, composer), session, seq)
    await vi.waitFor(() => { expect(session.revertStage).toHaveBeenCalledExactlyOnceWith(seq) })
    await settled()
    stageUndo(clientFor(session, composer), session, SessionSeq(99))
    await vi.waitFor(() => { expect(session.revertStage).toHaveBeenCalledTimes(2) })
    expect(composer.setDraft).not.toHaveBeenCalled()
  })

  it('releases restored drafts when a redo lands mid-restore or the composer refuses them', async () => {
    const racing = edgeSession('edge-race', [{ type: 'event', event: imageEvent(4) }], { staged: null, committed: [] })
    const read = Promise.withResolvers<{ ok: true; value: { attachment: typeof imageRef; data: Uint8Array } }>()
    Object.assign(racing, { readAttachment: () => read.promise })
    const releaseDraftAttachments = vi.fn()
    const holder: { client?: Context } = {}
    const createDrafts = vi.fn(() => {
      // A redo between draft creation and attachment supersedes this restore.
      if (holder.client !== undefined) redoSession(holder.client, stagedAt(racing, 4))
      return [{ id: 'draft-race' }]
    })
    holder.client = clientFor(racing, shell(), { createDrafts, releaseDraftAttachments })
    stageUndo(holder.client, racing, SessionSeq(4))
    await settled()
    read.resolve({ ok: true, value: { attachment: imageRef, data: Uint8Array.of(1) } })
    await vi.waitFor(() => { expect(releaseDraftAttachments).toHaveBeenCalledExactlyOnceWith([{ id: 'draft-race' }]) })

    const refused = edgeSession('edge-refused', [{ type: 'event', event: imageEvent(4) }], { staged: null, committed: [] })
    const released = vi.fn()
    const composer = shell(false)
    stageUndo(clientFor(refused, composer, { createDrafts: () => [{ id: 'draft-refused' }], releaseDraftAttachments: released }), refused, SessionSeq(4))
    await vi.waitFor(() => { expect(released).toHaveBeenCalledExactlyOnceWith([{ id: 'draft-refused' }]) })
    expect(composer.removeAttachment).not.toHaveBeenCalled()
  })

  it('keeps an attachment the composer would not remove and names an unnamed image', async () => {
    const session = edgeSession('edge-keep', [{ type: 'event', event: imageEvent(4) }], { staged: null, committed: [] })
    const composer = shell()
    const releaseDraftAttachment = vi.fn()
    const createDrafts = vi.fn((_id: SessionId, files: readonly File[]) => files.map(file => ({ id: file.name === '' ? 'unnamed' : file.name })))
    stageUndo(clientFor(session, composer, { createDrafts, releaseDraftAttachment }), session, SessionSeq(4))
    await vi.waitFor(() => { expect(composer.addAttachments).toHaveBeenCalledExactlyOnceWith(['unnamed']) })
    expect(composer.removeAttachment).toHaveBeenCalledExactlyOnceWith('kept')
    expect(releaseDraftAttachment).not.toHaveBeenCalled()
    await settled()
    redoSession(clientFor(session, composer, { releaseDraftAttachment }), stagedAt(session, 4))
    expect(releaseDraftAttachment).not.toHaveBeenCalled()
  })

  it('refuses quietly when nothing was placed, and restores text for a first-seen session', async () => {
    const empty = edgeSession('edge-empty', [{ type: 'event', event: { ...userEvent(undefined), data: { ...userEvent(undefined).data, content: [] } } }], { staged: null, committed: [] })
    empty.revertStage.mockResolvedValueOnce({ ok: false, error: { code: 'session/revert-busy', message: 'busy' } } as never)
    const composer = shell()
    stageUndo(clientFor(empty, composer), empty, seq)
    await settled()
    expect(composer.setDraft).not.toHaveBeenCalled()

    const fresh = edgeSession('edge-fresh', [{ type: 'event', event: userEvent('edit this') }], { staged: null, committed: [] })
    fresh.revertStage.mockRejectedValueOnce(new Error('gone'))
    let draft = 'before'
    const typed = {
      setDraft: vi.fn((text: string) => { draft = text }),
      focus: vi.fn(),
      state: { getSnapshot: () => ({ draft, attachmentIds: [] }) },
    }
    stageUndo(clientFor(fresh, typed), fresh, seq)
    await vi.waitFor(() => { expect(draft).toBe('before') })
  })
})
