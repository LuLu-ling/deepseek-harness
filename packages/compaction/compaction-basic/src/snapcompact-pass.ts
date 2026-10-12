/**
 * One snapcompact pass over a span the basic engine has already selected.
 * The caller owns the marker pair. This module admits frames and prices them
 * with the token meter; it does not summarize when the archive is unsafe.
 * @module @deepseek-ai/dsh-compaction-basic/snapcompact-pass
 */

import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import { compactCheckpointSource, isCompactCheckpointSource, type CompactionId } from '@deepseek-ai/dsh-compaction'
import type { ContentBlock, ImageBlock, Message, UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import { estimateContent, estimateMessage, estimateStructuralBlock } from '@deepseek-ai/dsh-token-meter/estimate'
import type TokenMeter from '@deepseek-ai/dsh-token-meter'
import {
  FRAME_DATA_BYTES_BUDGET,
  compactSnapcompact,
  computeSnapcompactMaxFrames,
  type SnapcompactModelTarget,
  type SnapcompactWireApi,
  type TranscriptBlock,
  type TranscriptMessage,
} from '@lulu-ling/dsh-snapcompact'

/** Geometry and attachment ids stored on `compaction/summary` for a later unfold. */
export interface SnapcompactSummaryRecord {
  sourceText: string
  frames: {
    cols: number
    rows: number
    chars: number
    font: string
    variant: string
    attachmentId: string
  }[]
}

const PATH_KEYS: Record<string, true> = {
  path: true,
  file_path: true,
  filePath: true,
  target_file: true,
  notebook_path: true,
  old_path: true,
  new_path: true,
}

/**
 * Map a DSH provider id onto the snapcompact billing family.
 * @param provider - provider id from the routed model.
 * @returns the billing family. Unrecognized ids use area billing.
 */
export function snapcompactWireApi(provider: string): SnapcompactWireApi {
  const id = provider.toLowerCase()
  if (id.includes('anthropic') || id.includes('bedrock')) return 'anthropic'
  if (id.includes('openai') || id.includes('azure')) return 'openai'
  if (id.includes('google') || id.includes('gemini') || id.includes('vertex')) return 'google'
  return 'unknown'
}

/**
 * Frame cap for one selected span. `0` means the kept context leaves no room.
 * @param meter - route-priced measurement of the current surface.
 * @param session - session that owns the surface positions.
 * @param start - inclusive first surface seq.
 * @param end - inclusive last surface seq.
 * @param contextWindow - routed model window, or 0 when undeclared.
 * @param reserveTokens - completion tokens reserved from that window.
 * @param model - shape target.
 * @param provider - provider id used for the image-count cap.
 * @returns the maximum number of frames this pass may render.
 */
export function snapcompactFrameCap(
  meter: TokenMeter,
  session: Session,
  start: SessionSeq,
  end: SessionSeq,
  contextWindow: number,
  reserveTokens: number,
  model: SnapcompactModelTarget,
  provider: string,
): number {
  const measurement = meter.measure(session)
  const nodes = session.surface.nodes
  const startIdx = nodes.indexOf(start)
  const endIdx = nodes.indexOf(end)
  const selected = startIdx >= 0 && endIdx >= startIdx
    ? measurement.nodes.slice(startIdx, endIdx + 1)
    : []
  const shadowed = selected.reduce((total, node) => total + node.tokens, 0)
  return computeSnapcompactMaxFrames({
    contextWindow,
    baseTokens: measurement.totalTokens - shadowed,
    reserveTokens,
    model,
    provider,
  })
}

function textOf(message: Message): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function toBlock(block: ContentBlock): TranscriptBlock | undefined {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'reasoning':
      return { type: 'reasoning', text: block.text }
    case 'tool-call':
      return { type: 'tool-call', id: String(block.id), name: block.name, arguments: block.arguments }
    case 'image':
      return { type: 'image' }
    case 'file':
      return { type: 'file', name: block.attachment.name }
    default:
      return undefined
  }
}

function toTranscript(message: Message): TranscriptMessage | undefined {
  switch (message.role) {
    case 'user':
    case 'assistant':
      return {
        role: message.role,
        blocks: message.content.flatMap((block) => {
          const transcribed = toBlock(block)
          return transcribed === undefined ? [] : [transcribed]
        }),
      }
    case 'tool':
      return {
        role: 'tool',
        toolCallId: String(message.toolCallId),
        ...(message.isError === undefined ? {} : { isError: message.isError }),
        text: textOf(message),
      }
    default:
      return undefined
  }
}

function walkPaths(value: unknown, key: string | undefined, into: Set<string>): void {
  if (typeof value === 'string') {
    if (key !== undefined && PATH_KEYS[key] === true && value.length > 0) into.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) walkPaths(entry, key, into)
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [child, nested] of Object.entries(value)) walkPaths(nested, child, into)
  }
}

function filePaths(messages: readonly TranscriptMessage[]): string[] {
  const paths = new Set<string>()
  for (const message of messages) {
    for (const block of message.blocks ?? []) {
      if (block.type !== 'tool-call') continue
      try {
        walkPaths(JSON.parse(block.arguments), undefined, paths)
      } catch (error: unknown) {
        // A tool call's arguments are model text. Non-JSON contributes no path.
        void error
      }
    }
  }
  return [...paths]
}

function previousOf(
  message: Message,
): { kind: 'soft'; summary: string } | { kind: 'snapcompact'; sourceText: string } | undefined {
  if (message.role !== 'user' || !isCompactCheckpointSource(message.source)) return undefined
  const sourceText = message.source.snapcompactSourceText
  if (sourceText !== undefined && sourceText.length > 0) {
    return { kind: 'snapcompact', sourceText }
  }
  const text = textOf(message)
  return text.length > 0 ? { kind: 'soft', summary: text } : undefined
}

function routePrice(message: Message, ctx: Context, provider: string, model: string): number {
  const images = message.content.filter((block): block is ImageBlock => block.type === 'image')
  let tokens = estimateMessage(message)
  const pricing = ctx.get('llm')?.imageRequestPricing(provider, model)
  if (pricing === undefined || images.length === 0) return tokens
  const prices = pricing.priceImages(images)
  if (prices.length !== images.length) {
    throw new Error(`snapcompact: image pricing returned ${prices.length} prices for ${images.length} frames`)
  }
  for (const image of images) tokens -= estimateStructuralBlock(image)
  for (const price of prices) {
    tokens += price.visualTokens + estimateContent([{ type: 'text', text: price.text }])
  }
  return tokens
}

/**
 * Render the span, admit its frames, and build the checkpoint.
 * Throws when the archive does not strictly reduce the priced context or
 * the PNG payload exceeds the frame byte budget. The caller must not summarize.
 * @param input - session, span, route price, and cancellation.
 * @returns the summary event fields and the replacement user message.
 */
export async function archiveCompactionSpan(input: {
  ctx: Context
  meter: TokenMeter
  session: Session
  shadowedSeqs: readonly SessionSeq[]
  shadowedRouteTokenCount: number
  agent: Agent
  compactionId: CompactionId
  sourceCommandId?: CommandId
  signal?: AbortSignal
}): Promise<{
  summary: ContentBlock[]
  provider: string
  model: string
  checkpointMessage: UserMessage
  snapcompact: SnapcompactSummaryRecord
}> {
  const target = input.session.requestHeader()?.config
  const provider = target?.provider || input.agent.options.provider || ''
  const model = target?.model || input.agent.options.model || ''
  if (provider.length === 0 || model.length === 0) {
    throw new Error('Snapcompact needs a model that declares image input.')
  }
  const info = await input.ctx.llm.resolveModelInfo(provider, model, input.signal)
  if (info.inputModalities?.includes('image') !== true) {
    throw new Error('Snapcompact needs a model that declares image input.')
  }
  const api = snapcompactWireApi(provider)
  const messages: TranscriptMessage[] = []
  let previous: { kind: 'soft'; summary: string } | { kind: 'snapcompact'; sourceText: string } | undefined
  for (const seq of input.shadowedSeqs) {
    // shadowedSeqs are current surface seqs.
    // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-deprecated
    const event = input.session.eventAt(seq)!
    const message = input.session.deriveEventMessage(event)
    if (message === null) continue
    if (previous === undefined) {
      const checkpoint = previousOf(message)
      if (checkpoint !== undefined) {
        previous = checkpoint
        continue
      }
    }
    const transcript = toTranscript(message)
    if (transcript !== undefined) messages.push(transcript)
  }
  const first = input.shadowedSeqs[0] ?? input.session.surface.nodes[0]
  const last = input.shadowedSeqs[input.shadowedSeqs.length - 1] ?? first
  if (first === undefined || last === undefined) {
    throw new Error('snapcompact: the shadowed span is empty')
  }
  const cap = snapcompactFrameCap(
    input.meter,
    input.session,
    first,
    last,
    info.context?.contextWindow ?? 0,
    target?.maxTokens ?? info.defaultMaxTokens ?? 0,
    { api, id: model },
    provider,
  )
  if (cap < 1) throw new Error('Snapcompact cannot fit a frame in the context window.')
  const archived = await compactSnapcompact({
    messages,
    ...(previous === undefined ? {} : { previous }),
    model: { api, id: model },
    includeThinking: api !== 'anthropic',
    maxFrames: cap,
    filePaths: filePaths(messages),
  })
  if (archived.frameDataBytes > FRAME_DATA_BYTES_BUDGET) {
    throw new Error(
      `snapcompact frame payload exceeds the byte budget (${archived.frameDataBytes} > ${FRAME_DATA_BYTES_BUDGET})`,
    )
  }
  const attachments = input.ctx.get('attachments')
  if (attachments === undefined) throw new Error('snapcompact requires the attachment service to store frames')
  const pngs = archived.frames.map(frame => ({
    data: Uint8Array.from(Buffer.from(frame.pngBase64, 'base64')),
    mediaType: 'image/png' as const,
  }))
  const refs: readonly ImageAttachmentRef[] = pngs.length === 0
    ? []
    : await attachments.saveImages(pngs)
  let image = 0
  const content: ContentBlock[] = [{ type: 'text', text: archived.summary }]
  for (const block of archived.blocks) {
    if (block.type === 'text' && block.text !== undefined && block.text.length > 0) {
      content.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'image') {
      const ref = refs[image]
      image += 1
      if (ref === undefined) throw new Error('snapcompact admitted fewer frames than it rendered')
      content.push({ type: 'image', attachment: ref })
    }
  }
  const checkpointMessage = createUserMessage({
    content,
    source: compactCheckpointSource(input.compactionId, input.sourceCommandId, archived.sourceText),
  })
  const priced = routePrice(checkpointMessage, input.ctx, provider, model)
  if (priced >= input.shadowedRouteTokenCount) {
    throw new Error(
      `snapcompact is not smaller than the shadowed content (${priced} priced tokens >= ${input.shadowedRouteTokenCount})`,
    )
  }
  return {
    summary: [{ type: 'text', text: archived.summary }],
    provider,
    model,
    checkpointMessage,
    snapcompact: {
      sourceText: archived.sourceText,
      frames: archived.frames.map((frame, index) => ({
        cols: frame.cols,
        rows: frame.rows,
        chars: frame.chars,
        font: frame.font,
        variant: frame.variant,
        attachmentId: String(refs[index]?.attachmentId ?? ''),
      })),
    },
  }
}
