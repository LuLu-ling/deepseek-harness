import { describe, expect, it } from 'vitest'
import { SessionSeq, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session/types'
import { Session } from '../src/client/sessions/session.ts'
import type { SessionRemotes } from '../src/client/sessions/remotes.ts'
import type { SessionSnapshot } from '../src/client/contract/snapshot.ts'

const SID = 'revert-client' as SessionId

function remotes(): SessionRemotes & {
  stageCalls: SessionSeq[]
  clearCalls: number
} {
  const stageCalls: SessionSeq[] = []
  let clearCalls = 0
  const reject = (): Promise<never> => Promise.reject(new Error('unused'))
  const remote = {
    $stream: () => { throw new Error('unused') },
    session: { prompt: reject, cancel: reject },
    commands: { execute: reject },
    sessionRevert: {
      stage: (_sessionId: SessionId, atSeq: SessionSeq) => {
        stageCalls.push(atSeq)
        return Promise.resolve({ ok: true as const, value: { atSeq, changed: true } })
      },
      clear: () => {
        clearCalls += 1
        return Promise.resolve({ ok: true as const, value: { cleared: true } })
      },
    },
    subagents: { prompt: reject, interruptByParent: reject },
    stageCalls,
    get clearCalls() { return clearCalls },
  }
  return remote as unknown as SessionRemotes & { stageCalls: SessionSeq[]; clearCalls: number }
}

function marker(type: 'session/revert/staged' | 'session/revert/cleared' | 'session/revert/committed', seq: number, atSeq = 1): SessionEvent {
  if (type === 'session/revert/cleared') {
    return { type, seq: SessionSeq(seq), time: seq, data: {} }
  }
  return { type, seq: SessionSeq(seq), time: seq, data: { atSeq: SessionSeq(atSeq) } }
}

describe('client session revert', () => {
  it('forwards stage and clear to the remote', async () => {
    const remote = remotes()
    const session = new Session(SID, remote)
    await session.revertStage(SessionSeq(4))
    await session.revertClear()
    expect(remote.stageCalls).toEqual([SessionSeq(4)])
    expect(remote.clearCalls).toBe(1)
  })

  it('folds staged and committed markers from the loaded window', () => {
    const session = new Session(SID, remotes())
    session.eventSource.append({ type: 'event', event: marker('session/revert/staged', 2, 1) })
    session.eventSource.append({ type: 'event', event: marker('session/revert/committed', 3, 1) })
    session.eventSource.append({ type: 'event', event: marker('session/revert/staged', 4, 4) })
    session.handleRunning(true)
    expect(session.getSnapshot().revert).toEqual({
      staged: { atSeq: 4 },
      committed: [{ atSeq: 1, untilSeq: 3 }],
    })
  })

  it('republishes the session snapshot when the revert projection changes', async () => {
    const session = new Session(SID, remotes())
    const published: SessionSnapshot['revert'][] = []
    const stop = session.subscribe(() => { published.push(session.getSnapshot().revert) })
    session.projections.apply('revert', { staged: { atSeq: 4 }, committed: [] }, SessionSeq(2))
    await Promise.resolve()
    await Promise.resolve()
    expect(session.getSnapshot().revert).toEqual({ staged: { atSeq: 4 }, committed: [] })
    expect(published.at(-1)).toEqual({ staged: { atSeq: 4 }, committed: [] })
    stop()
  })

  it('paints a revert before the host replies and restores it on refusal', async () => {
    const remote = remotes()
    let finish!: (result: { ok: false }) => void
    const gate = new Promise<{ ok: false }>((resolve) => { finish = resolve })
    const revertRemote = remote as unknown as { sessionRevert: { stage: () => Promise<{ ok: false }> } }
    revertRemote.sessionRevert.stage = () => gate
    const session = new Session(SID, remote)
    const published: SessionSnapshot['revert'][] = []
    const stop = session.subscribe(() => { published.push(session.getSnapshot().revert) })
    const pending = session.revertStage(SessionSeq(4))
    expect(session.getSnapshot().revert).toEqual({ staged: { atSeq: 4 }, committed: [] })
    expect(published.at(-1)).toEqual({ staged: { atSeq: 4 }, committed: [] })
    finish({ ok: false })
    await pending
    expect(session.getSnapshot().revert).toEqual({ staged: null, committed: [] })
    stop()
  })

  it('drops a later revert click while an earlier request is in flight', async () => {
    const remote = remotes()
    let finishFirst!: (result: { ok: true; value: { atSeq: number; changed: boolean } }) => void
    const firstGate = new Promise<{ ok: true; value: { atSeq: number; changed: boolean } }>((resolve) => {
      finishFirst = resolve
    })
    let calls = 0
    const revertRemote = remote as unknown as { sessionRevert: { stage: () => Promise<unknown> } }
    revertRemote.sessionRevert.stage = () => {
      calls += 1
      return firstGate
    }
    const session = new Session(SID, remote)
    const first = session.revertStage(SessionSeq(4))
    const second = session.revertStage(SessionSeq(1))
    expect(session.getSnapshot().revert).toEqual({ staged: { atSeq: 4 }, committed: [] })
    expect(calls).toBe(1)
    await expect(second).resolves.toEqual({ ok: true, value: { atSeq: 1, changed: false } })
    finishFirst({ ok: true, value: { atSeq: 4, changed: true } })
    await first
    expect(calls).toBe(1)
  })
})
