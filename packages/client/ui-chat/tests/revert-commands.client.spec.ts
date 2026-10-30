// @vitest-environment jsdom

import type { Context } from '@deepseek-ai/cordis'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { redoSession, stageUndo, stagedRevertActions } from '../src/client/revert-commands.ts'

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
      content: text === undefined ? [{ type: 'image' }] : [{ type: 'text', text }, { type: 'image' }],
    },
  } as never
}

function undoneSession(event: SessionEvent<'user/message'>, running = false): {
  session: SessionFace
  revertStage: (seq: SessionSeq) => Promise<void>
  cancel: () => Promise<void>
} {
  const revertStage = vi.fn((_seq: SessionSeq) => Promise.resolve())
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
  const scope = {
    get: (name: string) => name === 'conversation' ? {
      input: { for: () => shell },
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

describe('restore', () => {
  function stagedSession(events: readonly SessionEvent<'user/message'>[], atSeq: number) {
    const revertStage = vi.fn((_seq: SessionSeq) => Promise.resolve())
    const revertClear = vi.fn(() => Promise.resolve())
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

  it('clears the composer when the dock restores one message or all of them', () => {
    const staged = stagedSession([userEvent('edit this')], 4)
    const shell = shellWith(['draft-1'])
    const releaseDraftAttachment = vi.fn()
    const actions = stagedRevertActions(clientFor(staged.session, shell, { releaseDraftAttachment }), staged.session)
    actions.restore(4)
    expect(shell.setDraft).toHaveBeenCalledExactlyOnceWith('')
    expect(shell.removeAttachment).toHaveBeenCalledExactlyOnceWith('draft-1')
    expect(releaseDraftAttachment).toHaveBeenCalledExactlyOnceWith('draft-1')
    expect(staged.revertClear).toHaveBeenCalledOnce()

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
