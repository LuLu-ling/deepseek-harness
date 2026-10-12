/**
 * Host-plane preference for automatic compaction.
 * The isolated compaction engine reads {@link CompactionPreference}; a mode
 * token on `/compact` does not write this value.
 * @module @lulu-ling/dsh-compaction-preference
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name. The settings namespace is the loader entry id. */
export const name = 'context-compaction'

/** No injected services. The value is published for any context that can see root services. */
export const inject = []

/** Automatic compaction method. `snapcompact` still falls back per model at compaction time. */
export type CompactionMethod = 'soft' | 'snapcompact'

/**
 * Live preference read by compaction. `method` updates in place when settings save.
 */
export interface CompactionPreference {
  /** Saved automatic method. Default `soft`. */
  readonly method: CompactionMethod
}

/** Validated preference configuration. */
export interface Config {
  /** Automatic method. Invalid values fail at load. */
  method: Volatile<CompactionMethod>
}

/** Schema for the one settings field. */
export const Config = z.object({
  method: z.union([z.const('soft'), z.const('snapcompact')]).default('soft').volatile(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Automatic compaction method for the process. */
    compactionPreference: CompactionPreference
  }
}

export function apply(ctx: Context, config: Config): void {
  const preference: CompactionPreference = {
    get method() {
      return config.method.get()
    },
  }
  const dispose = ctx.reflect.provide('compactionPreference', preference)
  ctx.effect(() => () => { void dispose() }, 'context-compaction preference')
}
