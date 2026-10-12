/**
 * Human-facing `/compact` command over the backend-independent compaction seam.
 * @module @deepseek-ai/dsh-command-compact
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-llm'

export const name = 'command-compact'
export const inject = ['commands', 'compaction']

const USAGE = 'Usage: /compact [soft|snapcompact]'
const SNAPCOMPACT_IMAGE = 'Snapcompact needs a model that declares image input.'

type CompactMode = 'soft' | 'snapcompact'

/** Fail loudly if a locally closed union gains an unhandled member. */
/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
function assertNever(value: never): never {
  throw new TypeError(`unknown manual compaction error code: ${String(value)}`)
}
/* v8 ignore stop */

/** Convert expected capability failures into concise human-only outcomes. */
function expectedFailure(error: ManualCompactionError): CommandResult {
  switch (error.code) {
    case 'busy':
      return {
        kind: 'error',
        text: 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.',
      }
    case 'cancelled':
      return { kind: 'error', text: 'Compaction cancelled.' }
    case 'changed':
      return {
        kind: 'error',
        text: 'The history selected for compaction changed before it could be replaced. The attempt is recorded in the session log.',
      }
    case 'summary':
      return { kind: 'error', text: summaryFailure(error) }
    case 'commit':
      return {
        kind: 'error',
        text: 'Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.',
      }
    case 'persistence':
      return {
        kind: 'error',
        text: 'Compaction finished, but the session could not be saved.',
      }
    /* v8 ignore next 2 -- ManualCompactionErrorCode is closed and every member is handled above */
    default: return assertNever(error.code)
  }
}

/** The failure's own reason, plus a distinct cause when one was recorded. */
function summaryFailure(error: ManualCompactionError): string {
  const reason = error.message.trim()
  const cause = error.cause instanceof Error ? error.cause.message.trim() : ''
  return cause.length > 0 && cause !== reason
    ? `Compaction failed: ${reason} ${cause}`
    : `Compaction failed: ${reason}`
}

/** Parse one optional mode token. Extra text is rejected. */
function parseMode(raw: string): CompactMode | 'bare' | 'invalid' {
  const token = raw.trim()
  if (token.length === 0) return 'bare'
  if (token === 'soft' || token === 'snapcompact') return token
  return 'invalid'
}

/** Session route, then the agent's configured route. Absent fields are not image support. */
function currentRoute(invocation: CommandInvocation): { provider: string; model: string } | undefined {
  const header = invocation.agent.session.requestHeader()?.config
  if (header !== undefined && header.provider.length > 0 && header.model.length > 0) {
    return { provider: header.provider, model: header.model }
  }
  const provider = invocation.agent.options.provider
  const model = invocation.agent.options.model
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) return undefined
  return { provider, model }
}

/**
 * Positive image declaration only. A missing modality list is not support.
 * @param ctx - context that may carry `ctx.llm`.
 * @param invocation - command whose agent owns the current route.
 * @returns whether the routed model declared `image` input.
 */
async function declaresImage(ctx: Context, invocation: CommandInvocation): Promise<boolean> {
  const route = currentRoute(invocation)
  if (route === undefined) return false
  const llm = ctx.get('llm')
  if (llm === undefined) return false
  const info = await llm.resolveModelInfo(route.provider, route.model, invocation.signal)
  return info.inputModalities?.includes('image') === true
}

/** Execute one manual compaction request. A mode token does not change the saved preference. */
async function executeCompact(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const mode = parseMode(invocation.rawInput)
  if (mode === 'invalid') return { kind: 'error', text: USAGE }
  if (mode === 'snapcompact' && !await declaresImage(ctx, invocation)) {
    return { kind: 'error', text: SNAPCOMPACT_IMAGE }
  }
  try {
    const result = await ctx.compaction.compactNow(
      invocation.agent,
      invocation.signal,
      invocation.commandId,
      mode === 'bare' ? undefined : mode,
    )
    if (result === null) return { kind: 'success', text: 'No compactable history yet.' }
    return {
      kind: 'success',
      text: `Compacted ${result.shadowedSeqs.length} history items (~${result.shadowedTokenCount} tokens).`,
      sourceEventSeq: result.summarySeq,
    }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Compaction cancelled.' }
    if (error instanceof ManualCompactionError) return expectedFailure(error)
    throw error
  }
}

/**
 * Register `/compact` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the compaction seam.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeCompact(ctx, invocation)
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    // Both branches retire without rethrowing, so the derived observer promise
    // cannot become an unhandled mirror of an expected handler rejection.
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-compact'),
      name: 'compact',
      description: 'Compact older conversation history',
      handler,
    })
  }, 'command-compact lifecycle')
}
