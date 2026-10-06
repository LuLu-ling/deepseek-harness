import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionRevertService, { humanPromptStarts } from '@lulu-ling/dsh-session-revert'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    watcher: { kind: 'watcher' } & ContextFormed
  }
}

/** User-message texts currently visible to the model. */
function userTexts(session: Session): string[] {
  return session.deriveMessages().flatMap((message) => {
    if (message.role !== 'user') return []
    return message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
  })
}

/** One human prompt. */
function prompt(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

async function harness(id: string): Promise<{ ctx: Context; agent: Agent; session: Session; setStatus: (status: Agent['status']) => void }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionRevertService)
  const session = ctx.sessions.create(SessionId(id))
  let status: Agent['status'] = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx,
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(agent)
  return { ctx, agent, session, setStatus: (next) => { status = next } }
}

describe('SessionRevertService', () => {
  it('stages the last user message out of model history and clears it', async () => {
    const { ctx, agent, session } = await harness('revert-stage')
    session.append('user/message', prompt('one'), { surfaceOp: 'append' })
    const second = session.append('user/message', prompt('two'), { surfaceOp: 'append' })

    await expect(ctx.sessionRevert.stage(agent, second.seq)).resolves.toEqual({ atSeq: second.seq, changed: true })
    await expect(ctx.sessionRevert.stage(agent, second.seq)).resolves.toEqual({ atSeq: second.seq, changed: false })
    expect(userTexts(session)).toEqual(['one'])
    expect(ctx.sessionProjections.snapshot(session).values.revert).toEqual({
      staged: { atSeq: second.seq },
      committed: [],
    })

    await expect(ctx.sessionRevert.clear(agent)).resolves.toEqual({ cleared: true })
    await expect(ctx.sessionRevert.clear(agent)).resolves.toEqual({ cleared: false })
    expect(userTexts(session)).toEqual(['one', 'two'])
  })

  it('rejects stage while running or while input is pending', async () => {
    const { ctx, agent, session, setStatus } = await harness('revert-busy')
    const first = session.append('user/message', prompt('one'), { surfaceOp: 'append' })
    setStatus('running')
    await expect(ctx.sessionRevert.stage(agent, first.seq)).rejects.toMatchObject({ code: 'session/revert-busy' })
    await expect(ctx.sessionRevert.stage(agent, first.seq)).rejects.toMatchObject({
      code: 'session/revert-busy',
      details: { reason: 'running' },
    })
    setStatus('idle')
    agent.inbox.append('next-turn', prompt('queued'))
    await expect(ctx.sessionRevert.clear(agent)).rejects.toMatchObject({
      code: 'session/revert-busy',
      details: { reason: 'pending' },
    })
  })

  it('rejects a seq that is not a user message or is already committed', async () => {
    const { ctx, agent, session } = await harness('revert-invalid')
    const first = session.append('user/message', prompt('one'), { surfaceOp: 'append' })
    const boundary = session.append('turn/start', { turn: 1 })
    await expect(ctx.sessionRevert.stage(agent, boundary.seq)).rejects.toMatchObject({
      code: 'session/revert-invalid',
      details: { reason: 'not-user-message' },
    })
    await ctx.sessionRevert.stage(agent, first.seq)
    await ctx.sessionRevert.commit(agent)
    await expect(ctx.sessionRevert.stage(agent, first.seq)).rejects.toMatchObject({
      code: 'session/revert-invalid',
      details: { reason: 'committed' },
    })
  })

  it('commits before a human prompt and leaves that prompt visible', async () => {
    const { ctx, agent, session } = await harness('revert-commit')
    session.append('user/message', prompt('one'), { surfaceOp: 'append' })
    const second = session.append('user/message', prompt('two'), { surfaceOp: 'append' })
    await ctx.sessionRevert.stage(agent, second.seq)
    const next = prompt('three')

    await ctx.waterfall('agent/pre-step', {
      agent,
      messages: [next],
      turn: 1,
      step: 0,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages: [next] }))
    session.append('user/message', next, { surfaceOp: 'append' })

    expect(userTexts(session)).toEqual(['one', 'three'])
    expect(ctx.sessionProjections.snapshot(session).values.revert?.staged).toBeNull()
    expect(humanPromptStarts([{ source: { kind: 'agent-instructions' } }])).toBe(false)
  })

  it('does not commit a staged revert for a non-human step', async () => {
    const { ctx, agent, session } = await harness('revert-inject')
    const first = session.append('user/message', prompt('one'), { surfaceOp: 'append' })
    await ctx.sessionRevert.stage(agent, first.seq)
    const injected = createUserMessage({
      content: [{ type: 'text', text: 'notice' }],
      source: { kind: 'watcher' },
    })
    await ctx.waterfall('agent/pre-step', {
      agent,
      messages: [injected],
      turn: 1,
      step: 0,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages: [injected] }))
    expect(userTexts(session)).toEqual([])
    expect(ctx.sessionProjections.snapshot(session).values.revert?.staged).toEqual({ atSeq: first.seq })
  })

  it('refuses an agent that is not the live registry instance', async () => {
    const { ctx, agent } = await harness('revert-live')
    await expect(ctx.sessionRevert.commit(agent)).resolves.toEqual({ committed: false })
    const impostor = { ...agent, session: ctx.sessions.create(SessionId('other')) } as Agent
    await expect(ctx.sessionRevert.commit(impostor)).rejects.toMatchObject({
      code: 'session/not-found',
    })
  })

  it('drops the projection when the service fiber stops', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    const fiber = await ctx.plugin(SessionRevertService)
    const session = ctx.sessions.create(SessionId('revert-dispose'))
    const agent: Agent = {
      id: session.id,
      options: {},
      session,
      inbox: createInboxStub(),
      ctx,
      status: 'idle',
      send: () => {},
      followup: () => {},
      steer: () => {},
      inject: () => {},
      cancel: () => {},
      runMaintenance: task => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    }
    await ctx.agents.register(agent)
    const service = ctx.sessionRevert
    const first = session.append('user/message', prompt('one'), { surfaceOp: 'append' })
    await fiber.dispose()
    await expect(service.stage(agent, first.seq)).rejects.toThrow('revert projection is not registered')
  })

  it('reads the second stage only after the first file restore appends', async () => {
    const { ctx, agent, session } = await harness('revert-queue')
    const first = session.append('user/message', prompt('one'), { surfaceOp: 'append' })
    const second = session.append('user/message', prompt('two'), { surfaceOp: 'append' })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const seen: Array<number | null> = []
    ctx.sessionRevert.bindFiles({
      stage: async (_agent, _atSeq, prev) => {
        seen.push(prev?.atSeq ?? null)
        if (seen.length === 1) {
          entered()
          await gate
        }
      },
      clear: async () => {},
      commit: () => {},
    })
    const earlier = ctx.sessionRevert.stage(agent, second.seq)
    await started
    const later = ctx.sessionRevert.stage(agent, first.seq)
    release()
    await earlier
    await later
    expect(seen).toEqual([null, second.seq])
    expect(ctx.sessionProjections.snapshot(session).values.revert?.staged).toEqual({ atSeq: first.seq })
  })

  it('freezes a stage that is still restoring files when the prompt starts', async () => {
    const { ctx, agent, session } = await harness('revert-queue-commit')
    session.append('user/message', prompt('one'), { surfaceOp: 'append' })
    const second = session.append('user/message', prompt('two'), { surfaceOp: 'append' })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    ctx.sessionRevert.bindFiles({
      stage: async () => {
        entered()
        await gate
      },
      clear: async () => {},
      commit: () => {},
    })
    const staging = ctx.sessionRevert.stage(agent, second.seq)
    await started
    const next = prompt('three')
    const stepped = ctx.waterfall('agent/pre-step', {
      agent,
      messages: [next],
      turn: 1,
      step: 0,
      signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages: [next] }))
    release()
    await staging
    await stepped
    expect(ctx.sessionProjections.snapshot(session).values.revert).toEqual({
      staged: null,
      committed: [{ atSeq: second.seq, untilSeq: expect.any(Number) }],
    })
  })
})
