/**
 * Basic replay-aware compaction backend.
 *
 * @module @deepseek-ai/dsh-compaction-basic
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CompactionEngine, ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction'
import { foldRevert, type EpochHeader, type Session, type SessionSeq } from '@deepseek-ai/dsh-session'
import { CONTEXT_WINDOW_EXCEEDED_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
// Type-only: makes the optional sibling service available to `ctx.get()`.
import type {} from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import type {} from '@lulu-ling/dsh-session-revert'
import {
  resolveCompactSpec,
  resolveConfig,
  resolveTargetPolicy,
  TargetPressureConfigError,
} from './config.ts'
import {
  assertNoActiveCompaction,
  compactSurfaceRegion,
  selectCompactableRange,
} from './region.ts'
import { archiveCompactionSpan, snapcompactFrameCap, snapcompactWireApi } from './snapcompact-pass.ts'
import { summarizeWithLlm } from './summarizer.ts'
import type { SummarizationInput, SummaryResult } from './summarizer.ts'
import type {
  BasicCompactionConfig,
  ModelCompactPolicyConfig,
  ResolvedConfig,
} from './types.ts'

export type {
  BasicCompactionConfig,
  CompactionPolicyConfig,
  ModelCompactPolicyConfig,
  ResolvedCompactSpec,
  ResolvedConfig,
  ResolvedRetention,
  ResolvedTargetPolicy,
} from './types.ts'

/** Resolve the exact provider/model durably routed for the latest request. */
function routedTarget(
  session: Session,
): Pick<LlmCallConfig, 'provider' | 'model'> | undefined {
  const config = session.requestHeader()?.config
  if (config === undefined || config.provider.length === 0 || config.model.length === 0) {
    return undefined
  }
  return { provider: config.provider, model: config.model }
}

/**
 * Output tokens the routed request reserves, which the provider charges to the
 * same window as the prompt. The effective envelope's own cap wins; otherwise
 * the adapter's per-request default, which the adapter materializes when that
 * envelope omits one. No declared cap means no reservation.
 */
function reservedCompletionTokens(header: EpochHeader, defaultMaxTokens: number | undefined): number {
  return header.config.maxTokens ?? defaultMaxTokens ?? 0
}

/** Resolve the conversation target used to select an optional policy override. */
function conversationTarget(
  agent: Agent,
): Pick<LlmCallConfig, 'provider' | 'model'> | undefined {
  const routed = routedTarget(agent.session)
  if (routed !== undefined) return routed
  if (agent.options.provider === undefined || agent.options.provider.length === 0
    || agent.options.model === undefined || agent.options.model.length === 0) return undefined
  return { provider: agent.options.provider, model: agent.options.model }
}

const thresholdRatioSchema = z.number()
const headroomTokensSchema = z.number().step(1).min(0)
const retainRatioSchema = z.number()
const retainTokensSchema = z.number().step(1).min(0)
const summarizationProviderSchema = z.string()
const summarizationModelSchema = z.string()
const maxTokensSchema = z.number().step(1).min(1)
const compactionRetriesSchema = z.number().step(1).min(0)
const maxOverflowRetriesSchema = z.number().step(1).min(0)

const modelPolicy: z<ModelCompactPolicyConfig> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  thresholdRatio: thresholdRatioSchema,
  headroomTokens: headroomTokensSchema,
  retainRatio: retainRatioSchema,
  retainTokens: retainTokensSchema,
  summarizationProvider: summarizationProviderSchema,
  summarizationModel: summarizationModelSchema,
  maxTokens: maxTokensSchema,
  compactionRetries: compactionRetriesSchema,
  maxOverflowRetries: maxOverflowRetriesSchema,
})

/**
 * Freeze a staged undo so the checkpoint appended next stays visible.
 * The revert service, when mounted, also drops the file-snapshot stage.
 * @param ctx - context that may provide `sessionRevert`.
 * @param agent - idle agent whose log receives the commit.
 */
async function commitStagedRevert(ctx: Context, agent: Agent): Promise<void> {
  const staged = foldRevert(agent.session.snapshotEvents()).staged
  if (staged === null) return
  const revert = ctx.get('sessionRevert')
  if (revert !== undefined) {
    await revert.commit(agent)
    return
  }
  agent.session.append('session/revert/committed', { atSeq: staged.atSeq })
}
/**
 * Dependency-light compaction backend using `ctx.tokenMeter` for pressure,
 * retention, cited source events, and summary-convergence pricing.
 *
 * `summarize()` is the sole subclass customization hook; the replay and durable
 * mutation strategy stays fixed so every pricing decision uses the singleton
 * token meter.
 */
export class BasicCompactionEngine extends CompactionEngine {
  static inject = ['llm', 'tokenMeter', 'sessions']

  static Config: z<BasicCompactionConfig> = z.object({
    thresholdRatio: thresholdRatioSchema,
    headroomTokens: headroomTokensSchema,
    retainRatio: retainRatioSchema,
    retainTokens: retainTokensSchema,
    summarizationProvider: summarizationProviderSchema,
    summarizationModel: summarizationModelSchema,
    maxTokens: maxTokensSchema,
    compactionRetries: compactionRetriesSchema,
    maxOverflowRetries: maxOverflowRetriesSchema,
    modelPolicies: z.array(modelPolicy),
    auto: z.boolean(),
  })

  /** Resolved and validated compaction configuration. */
  readonly config: ResolvedConfig

  private readonly warnedPressureConfigTargets = new Set<string>()
  private readonly overflowRetries = new WeakMap<Agent, number>()
  private readonly overflowAgents = new WeakMap<Session, Agent>()

  constructor(ctx: Context, config: BasicCompactionConfig = {}) {
    super(ctx)
    this.config = resolveConfig(config)
    if (this.config.auto) this._registerAutomaticCompaction()
  }

  /**
   * Register between-step pressure, model-switch pressure, and request-overflow
   * recovery. Pre-step and overflow listeners dispatch through `compactIfNeeded`;
   * model switches price the proposed header directly. All summaries use `summarize`.
   */
  private _registerAutomaticCompaction(): void {
    const { ctx } = this
    const logResult = (result: CompactionResult, trigger: string): void => {
      ctx.logger.info(
        `compaction (${trigger}): shadowed ${result.shadowedSeqs.length} surface nodes `
        + `(seqs ${result.shadowedRange.start}-${result.shadowedRange.end}, `
        + `~${result.shadowedTokenCount} tokens)`,
      )
    }

    ctx.on('agent/pre-step', async (
      { agent, signal },
      next,
    ): Promise<PreStepDecision> => {
      if (!signal.aborted) {
        try {
          const result = await this.compactIfNeeded(agent, 'pressure', signal)
          if (result !== null) logResult(result, 'step pressure')
        } catch (error: unknown) {
          if (error instanceof TargetPressureConfigError) {
            if (this.warnedPressureConfigTargets.has(error.targetKey)) return next()
            this.warnedPressureConfigTargets.add(error.targetKey)
          }
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger.warn(`step compaction failed: ${message}; continuing the turn`)
        }
      }
      return next()
    })

    ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') this.overflowRetries.delete(agent)
    })

    // Prepend wraps routing listeners: await their final selection while the
    // committed header still identifies the model that can summarize the history.
    ctx.on('agent/request', async ({ agent, signal }, next) => {
      const config = await next()
      const previous = agent.session.requestHeader()
      if (signal.aborted || previous === undefined || config.provider === '' || config.model === ''
        || (previous.config.provider === config.provider && previous.config.model === config.model)) return config
      try {
        const header = { ...previous, config }
        const result = await this.compactPressure(agent, header, signal, true)
        if (result !== null) logResult(result, 'model switch')
      } catch (error: unknown) {
        signal.throwIfAborted()
        const message = error instanceof Error ? error.message : String(error)
        throw new LlmError(
          `Cannot switch to ${config.provider}/${config.model}: context compaction failed: ${message}. `
          + 'The previous request model is preserved; retry or select a model with a larger context window.',
          'MODEL_SWITCH_COMPACTION_FAILED',
          { cause: error },
        )
      }
      return config
    }, { prepend: true })

    // A successful response starts a fresh overflow-recovery sequence even
    // when tool calls continue the same turn into another request.
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'assistant/message') return
      const agent = this.overflowAgents.get(session)
      if (agent !== undefined) this.overflowRetries.delete(agent)
    })

    ctx.on('agent/request-error', async (
      { agent, failure, signal },
      next,
    ) => {
      if (failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE || signal.aborted) return next()
      this.overflowAgents.set(agent.session, agent)
      const target = routedTarget(agent.session)
      if (target === undefined) return next()
      const policy = resolveTargetPolicy(this.config, target)
      const retries = this.overflowRetries.get(agent) ?? 0
      if (retries >= policy.maxOverflowRetries) return next()

      const generation = agent.session.surface.replaceGeneration
      let result: CompactionResult | null
      try {
        result = await this.compactIfNeeded(agent, 'context-overflow', signal)
      } catch (recoveryError: unknown) {
        const message = recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        // A model-free prune can land before later summary work fails. That
        // durable reduction is sufficient retry proof; do not discard it just
        // because the optional second phase threw. Cancellation still wins.
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while recovery is awaited.
        if (!signal.aborted && agent.session.surface.replaceGeneration > generation) {
          ctx.logger.warn(
            `context-overflow compaction failed after durable surface progress: ${message}; `
            + 'retrying from the replacement surface',
          )
          this.overflowRetries.set(agent, retries + 1)
          return { kind: 'retry' }
        }
        ctx.logger.warn(
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while recovery is awaited.
          `context-overflow compaction failed: ${message}; ${signal.aborted
            ? 'cancellation prevents retry'
            : 'preserving the original request error'}`,
        )
        return next()
      }
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while compaction is awaited.
      if (signal.aborted
        || agent.session.surface.replaceGeneration <= generation) return next()
      if (result !== null) logResult(result, 'context overflow recovery')
      this.overflowRetries.set(agent, retries + 1)
      return { kind: 'retry' }
    })
  }

  /**
   * Summarize the replayed conversation region through a direct one-shot
   * `ctx.llm.stream()` call whose prefix reuses the conversation's own system
   * prompt, tools, and messages so the provider's KV cache is not invalidated.
   * Override this sole hook for a template or remote summarizer.
   * @param input - replayed conversation prefix (system, tools, and leading messages) to condense.
   * @param agent - supplies routed-model history, fallback model, and session id.
   * @param signal - optional cancellation forwarded to the adapter.
   * @returns safe text summary blocks and the exact auxiliary call envelope and output.
   */
  protected async summarize(
    input: SummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    const target = conversationTarget(agent)
    const config = target === undefined
      ? this.config
      : resolveTargetPolicy(this.config, target)
    return summarizeWithLlm(this.ctx, config, input, agent, signal)
  }

  /**
   * Compact for replayed step-boundary pressure or one provider-confirmed context
   * overflow. Both triggers price the latest durable routed request envelope;
   * overflow bypasses the normal threshold and retained-tail policy so it can
   * force one useful balanced reduction.
   * @param agent - agent whose latest durable routed request is measured.
   * @param trigger - normal step-boundary pressure or context-overflow recovery.
   * @param signal - live turn cancellation signal forwarded to summarization.
   * @returns the latest summary compaction result, or `null` when no summary ran.
   */
  override async compactIfNeeded(
    agent: Agent,
    trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    const header = agent.session.requestHeader()
    if (header === undefined || routedTarget(agent.session) === undefined) return null
    switch (trigger) {
      case 'pressure':
        return this.compactPressure(agent, header, signal, false)
      case 'context-overflow': {
        this.ctx.get('toolResultPruner')?.pruneSession(agent.session)
        const measurement = this.ctx.tokenMeter.measure(agent.session, header)
        const range = selectCompactableRange(agent.session, measurement, 0)
        if (range === null) return null
        const mode = await this.automaticMode(agent, signal)
        if (mode === 'snapcompact' && await this.frameCap(agent, range.start, range.end, signal) < 1) return null
        return mode === 'snapcompact'
          ? this.replaceRange(range.start, range.end, agent, signal, mode)
          : this.compactRegion(range.start, range.end, agent, signal)
      }
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        assertNever(trigger, 'compaction trigger')
    }
  }

  /** Price the proposed header; switch checks require history below its threshold. */
  private async compactPressure(
    agent: Agent,
    header: EpochHeader,
    signal: AbortSignal,
    requireBelowThreshold: boolean,
  ): Promise<CompactionResult | null> {
    const target = header.config
    const policy = resolveTargetPolicy(this.config, target)
    const meter = this.ctx.tokenMeter
    let measurement = meter.measure(agent.session, header)
    const prune = this.ctx.get('toolResultPruner')

    const info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)
    assertNoActiveCompaction(agent.session, 'automatic pressure compaction')
    const targetKey = `${target.provider}/${target.model}`
    if (info.context === undefined) {
      throw new TargetPressureConfigError(
        targetKey,
        `compaction-basic: no context capacity for ${targetKey}; `
        + 'configure contextWindow on that adapter model',
      )
    }
    const spec = resolveCompactSpec(
      policy,
      info.context.contextWindow,
      reservedCompletionTokens(header, info.defaultMaxTokens),
    )
    if (measurement.totalTokens < spec.thresholdTokens) return null

    // Once pressure qualifies, land the model-free pass before choosing a
    // summary range, then remeasure through the singleton replay fold.
    if (prune !== undefined) {
      prune.pruneSession(agent.session)
      measurement = meter.measure(agent.session, header)
    }
    if (measurement.totalTokens < spec.thresholdTokens) return null

    let result: CompactionResult | null = null
    const mode = this.savedMethod() === 'snapcompact' && info.inputModalities?.includes('image') === true
      ? 'snapcompact' as const
      : 'soft' as const
    for (let attempt = 0; attempt <= spec.compactionRetries; attempt += 1) {
      const range = selectCompactableRange(agent.session, measurement, spec.retainTokens)
      if (range === null) {
        if (result === null && !requireBelowThreshold) return null
        throw new Error(
          'no safe compaction range can reduce context below threshold '
          + `(${measurement.totalTokens} estimated tokens >= threshold ${spec.thresholdTokens})`,
        )
      }
      if (mode === 'snapcompact' && this.frameCapFrom(agent, range.start, range.end, info, header) < 1) return result
      result = mode === 'snapcompact'
        ? await this.replaceRange(range.start, range.end, agent, signal, mode)
        : await this.compactRegion(range.start, range.end, agent, signal)
      measurement = meter.measure(agent.session, header)
      if (measurement.totalTokens < spec.thresholdTokens) return result
    }

    throw new Error(
      `compaction still above threshold after ${spec.compactionRetries + 1} compaction attempts `
      + `(${measurement.totalTokens} estimated tokens >= threshold ${spec.thresholdTokens})`,
    )
  }

  /**
   * Compact one inclusive positional range from the agent-owned surface using
   * the effective token meter for all retention and shrink pricing.
   * @param start - inclusive first surface-node seq.
   * @param end - inclusive last surface-node seq.
   * @param agent - owner of the target session, used by the summarizer.
   * @param signal - optional summarization cancellation signal.
   * @returns the successful durable compaction result.
   */
  override async compactRegion(
    start: SessionSeq,
    end: SessionSeq,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    return compactSurfaceRegion(
      this.regionDependencies(),
      agent.session,
      start,
      end,
      agent,
      { owner: 'current-turn', stability: 'whole-surface' },
      signal,
    )
  }

  /**
   * Force one useful idle-session compaction below the pressure threshold, and
   * resolve only after its standalone marker pair is durably checkpointed.
   * @param agent - idle agent whose next-turn admission this call reserves.
   * @param signal - cancellation scoped to this compaction request.
   * @param sourceCommandId - initiating command identity for presentation correlation.
   * @param mode - one-shot method. Omitted and `soft` summarize. `snapcompact` does not fall back.
   * @returns the committed result, or `null` when no safe useful range exists.
   */
  override compactNow(
    agent: Agent,
    signal: AbortSignal,
    sourceCommandId?: CommandId,
    mode?: 'soft' | 'snapcompact',
  ): Promise<CompactionResult | null> {
    signal.throwIfAborted()
    const requested = mode ?? 'soft'
    try {
      return agent.runMaintenance(async (agentSignal) => {
        const operationSignal = AbortSignal.any([agentSignal, signal])
        try {
          operationSignal.throwIfAborted()
          await commitStagedRevert(this.ctx, agent)
          const range = selectCompactableRange(
            agent.session,
            this.ctx.tokenMeter.measure(agent.session),
            0,
          )
          if (range === null) return null
          if (requested === 'snapcompact') {
            if (!await this.declaresImage(agent, operationSignal)) {
              throw new ManualCompactionError('summary', 'Snapcompact needs a model that declares image input.')
            }
            if (await this.frameCap(agent, range.start, range.end, operationSignal) < 1) {
              throw new ManualCompactionError('summary', 'Snapcompact cannot fit a frame in the context window.')
            }
          }
          return await this.replaceRange(
            range.start,
            range.end,
            agent,
            operationSignal,
            requested,
            null,
            'selected-span',
            sourceCommandId,
            async () => { await this.ctx.sessions.flush(agent.session) },
          )
        } catch (error: unknown) {
          if (agentSignal.aborted && operationSignal.reason === agentSignal.reason) {
            throw new ManualCompactionError(
              'cancelled',
              'manual compaction was cancelled',
              { cause: error },
            )
          }
          operationSignal.throwIfAborted()
          throw error
        }
      })
    } catch (error: unknown) {
      if (error instanceof ManualCompactionError) throw error
      throw new ManualCompactionError(
        'busy',
        'manual compaction requires an idle agent with no waking queued work',
        { cause: error },
      )
    }
  }

  /** Bind the token meter, the summarizer, and the snapcompact archive. */
  private regionDependencies(): Parameters<typeof compactSurfaceRegion>[0] {
    return {
      meter: this.ctx.tokenMeter,
      summarize: (input, owner, abort) => this.summarize(input, owner, abort),
      recover: (error, agent, sourceEventSeqs, signal) => this.ctx.waterfall('compaction/summary-error', {
        session: agent.session,
        sourceEventSeqs,
        error,
        ...signal === undefined ? {} : { signal },
      }, () => false),
      snapcompact: (session, prepared, agent, compactionId, sourceCommandId, signal) => archiveCompactionSpan({
        ctx: this.ctx,
        meter: this.ctx.tokenMeter,
        session,
        shadowedSeqs: prepared.shadowedSeqs,
        shadowedRouteTokenCount: prepared.shadowedRouteTokenCount,
        agent,
        compactionId,
        ...sourceCommandId === undefined ? {} : { sourceCommandId },
        ...signal === undefined ? {} : { signal },
      }),
    }
  }

  /** Saved automatic method. An absent preference service stays soft. */
  private savedMethod(): 'soft' | 'snapcompact' {
    return this.ctx.get('compactionPreference')?.method === 'snapcompact' ? 'snapcompact' : 'soft'
  }

  /** Snapcompact only when the saved preference and the routed model both allow it. */
  private async automaticMode(agent: Agent, signal: AbortSignal): Promise<'soft' | 'snapcompact'> {
    if (this.savedMethod() !== 'snapcompact') return 'soft'
    return await this.declaresImage(agent, signal) ? 'snapcompact' : 'soft'
  }

  /** Positive image declaration. A missing modality list is not support. */
  private async declaresImage(agent: Agent, signal: AbortSignal): Promise<boolean> {
    const target = conversationTarget(agent)
    if (target === undefined) return false
    const info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)
    return info.inputModalities?.includes('image') === true
  }

  /** Frame cap using model info the caller already resolved. */
  private frameCapFrom(
    agent: Agent,
    start: SessionSeq,
    end: SessionSeq,
    info: { context?: { contextWindow: number }; defaultMaxTokens?: number },
    header: EpochHeader | undefined = agent.session.requestHeader(),
  ): number {
    const target = conversationTarget(agent)
    if (target === undefined || header === undefined) return 0
    return snapcompactFrameCap(
      this.ctx.tokenMeter,
      agent.session,
      start,
      end,
      info.context?.contextWindow ?? 0,
      reservedCompletionTokens(header, info.defaultMaxTokens),
      { api: snapcompactWireApi(target.provider), id: target.model },
      target.provider,
    )
  }

  /** Frame cap after resolving the routed model's window. */
  private async frameCap(agent: Agent, start: SessionSeq, end: SessionSeq, signal: AbortSignal): Promise<number> {
    const target = conversationTarget(agent)
    if (target === undefined) return 0
    const info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)
    return this.frameCapFrom(agent, start, end, info)
  }

  /**
   * Run one marker transaction.
   * @param mode - `snapcompact` archives; `soft` summarizes.
   */
  private replaceRange(
    start: SessionSeq,
    end: SessionSeq,
    agent: Agent,
    signal: AbortSignal | undefined,
    mode: 'soft' | 'snapcompact',
    owner: 'current-turn' | null = 'current-turn',
    stability: 'whole-surface' | 'selected-span' = 'whole-surface',
    sourceCommandId?: CommandId,
    flush?: () => Promise<void>,
  ): Promise<CompactionResult> {
    return compactSurfaceRegion(this.regionDependencies(), agent.session, start, end, agent, {
      owner,
      stability,
      ...mode === 'snapcompact' ? { mode } : {},
      ...sourceCommandId === undefined ? {} : { sourceCommandId },
      ...flush === undefined ? {} : { flush },
    }, signal)
  }
}

export default BasicCompactionEngine
