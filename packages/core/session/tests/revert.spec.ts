import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq, foldRevert } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** User-message texts currently visible to the model. */
function userTexts(session: Session): string[] {
  return session.deriveMessages().flatMap((message) => {
    if (message.role !== 'user') return []
    return message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
  })
}

/** Append one user message and return its seq. */
function user(session: Session, text: string): SessionSeq {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' }).seq
}

describe('session revert', () => {
  it('hides the staged boundary and later messages, then restores them on clear', () => {
    const session = Session.create(SessionId('revert-stage'))
    user(session, 'one')
    const second = user(session, 'two')
    user(session, 'three')

    const staged = session.append('session/revert/staged', { atSeq: second })
    expect(staged.ignorable).toBe(true)
    expect(userTexts(session)).toEqual(['one'])

    const cleared = session.append('session/revert/cleared', {})
    expect(cleared.ignorable).toBe(true)
    expect(userTexts(session)).toEqual(['one', 'two', 'three'])
  })

  it('keeps a committed range hidden and shows messages appended after the commit', () => {
    const session = Session.create(SessionId('revert-commit'))
    user(session, 'one')
    const second = user(session, 'two')
    const staged = session.append('session/revert/staged', { atSeq: second })
    const committed = session.append('session/revert/committed', { atSeq: second })
    expect(staged.ignorable).toBe(true)
    expect(committed.ignorable).toBe(true)
    user(session, 'three')

    expect(userTexts(session)).toEqual(['one', 'three'])
    expect(foldRevert(session.snapshotEvents())).toMatchObject({
      staged: null,
      committed: [{ atSeq: second }],
    })
  })

  it('moves the staged boundary without disturbing an older committed range', () => {
    const session = Session.create(SessionId('revert-redo'))
    const first = user(session, 'one')
    const second = user(session, 'two')
    session.append('session/revert/staged', { atSeq: second })
    session.append('session/revert/committed', { atSeq: second })
    const third = user(session, 'three')

    session.append('session/revert/staged', { atSeq: third, prev: { atSeq: second } })
    expect(userTexts(session)).toEqual(['one'])
    session.append('session/revert/staged', { atSeq: first, prev: { atSeq: third } })
    expect(userTexts(session)).toEqual([])
    session.append('session/revert/cleared', {})
    expect(userTexts(session)).toEqual(['one', 'three'])
  })

  it('replays a seeded log with the same hidden messages', () => {
    const original = Session.create(SessionId('revert-seed-source'))
    user(original, 'one')
    const second = user(original, 'two')
    original.append('session/revert/staged', { atSeq: second })

    const replayed = Session.create(SessionId('revert-seed'), original.snapshotEvents())
    expect(userTexts(replayed)).toEqual(['one'])
  })

  it('rejects a revert payload that cannot be replayed', () => {
    const session = Session.create(SessionId('revert-invalid'))
    expect(() => session.append('session/revert/staged', { atSeq: 1.5 as never }))
      .toThrow(/atSeq/)
    expect(() => session.append('session/revert/cleared', { extra: true } as never))
      .toThrow(/empty/)
    const bad = {
      type: 'session/revert/committed',
      seq: SessionSeq(0),
      time: 1,
      data: {},
    } as SessionEvent
    expect(() => Session.create(SessionId('revert-bad-seed'), [bad])).toThrow(/atSeq/)
  })
})
