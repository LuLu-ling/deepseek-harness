import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'

const MODEL = 'mock'
const SIGNAL = new AbortController().signal

class CountingEngine extends BasicCompactionEngine {
  calls: SummarizationInput[] = []

  override summarize(input: SummarizationInput): Promise<SummaryResult> {
    this.calls.push(input)
    return Promise.resolve({
      summary: [{ type: 'text', text: 'should not run' }],
      provider: 'summary-provider',
      model: 'summary-model',
    })
  }
}

class VisionAdapter extends LlmAdapter {
  readonly requests: RequestMessage[][] = []
  modalities: readonly ('text' | 'image')[] = ['text', 'image']
  visualTokens = 1

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 200_000 },
      inputModalities: this.modalities,
    })
  }

  override imageRequestPricing() {
    const visualTokens = this.visualTokens
    return {
      priceImages: (images: readonly unknown[]) => images.map(() => ({ visualTokens, text: 'frame' })),
    }
  }

  override async * stream(options: { messages: readonly RequestMessage[] }): AsyncIterable<StreamChunk> {
    this.requests.push([...options.messages])
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harness(): Promise<{ ctx: Context; agent: Agent; compact: CountingEngine; adapter: VisionAdapter }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  const adapter = new VisionAdapter()
  ctx.llm.registerAdapter([MODEL], adapter)
  ctx.reflect.provide('attachments', {
    saveImages: (inputs: readonly SaveImageAttachment[]) => Promise.resolve(inputs.map((input, index) => ({
      attachmentId: AttachmentId(`frame-${index}`),
      mediaType: 'image/png' as const,
      bytes: input.data.byteLength,
      width: 32,
      height: 32,
    }))),
  })
  const compact = new CountingEngine(ctx, { auto: false })
  const agent = await ctx.agentLoop.create(SessionId('snapcompact-manual'), { provider: MODEL, model: MODEL })
  return { ctx, agent, compact, adapter }
}

async function seed(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

describe('manual snapcompact', () => {
  it('archives locally on a vision model and does not summarize', async () => {
    const { agent, compact, adapter } = await harness()
    await seed(agent, 'x'.repeat(50_000))
    const streams = adapter.requests.length
    const result = await compact.compactNow(agent, SIGNAL, undefined, 'snapcompact')
    expect(result).not.toBeNull()
    expect(compact.calls).toHaveLength(0)
    expect(adapter.requests).toHaveLength(streams)
    const checkpoint = agent.session.deriveMessages().find(message =>
      message.content.some(block => block.type === 'image'))
    expect(checkpoint?.content.some(block => block.type === 'image')).toBe(true)
    const summary = agent.session.snapshotEvents().find(event => event.type === 'compaction/summary')
    expect(summary?.type === 'compaction/summary' && summary.data.snapcompact?.sourceText.length).toBeGreaterThan(0)
    expect(summary?.type === 'compaction/summary' && summary.data.snapcompact?.frames[0]?.attachmentId).toBe('frame-0')
  }, 60_000)

  it('refuses a text-only model before writing a lock', async () => {
    const { agent, compact, adapter } = await harness()
    adapter.modalities = ['text']
    await seed(agent, 'x'.repeat(4_000))
    await expect(compact.compactNow(agent, SIGNAL, undefined, 'snapcompact')).rejects.toBeInstanceOf(ManualCompactionError)
    expect(compact.calls).toHaveLength(0)
    expect(agent.session.snapshotEvents().some(event => event.type === 'compaction/start')).toBe(false)
  })

  it('does not summarize when the priced archive is not smaller', async () => {
    const { agent, compact, adapter } = await harness()
    adapter.visualTokens = 10_000_000
    await seed(agent, 'x'.repeat(50_000))
    const error = await compact.compactNow(agent, SIGNAL, undefined, 'snapcompact').then(
      () => { throw new Error('expected snapcompact to reject an archive that does not shrink') },
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(ManualCompactionError)
    expect(compact.calls).toHaveLength(0)
    expect(agent.session.deriveMessages().some(message => message.content.some(block => block.type === 'image'))).toBe(false)
  }, 60_000)
})
