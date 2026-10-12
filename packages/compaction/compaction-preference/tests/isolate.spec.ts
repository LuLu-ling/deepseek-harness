import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as preference from '@lulu-ling/dsh-compaction-preference'

describe('compaction preference visibility', () => {
  it('is visible inside a context that isolates compaction', async () => {
    const ctx = new Context()
    await ctx.plugin(preference, {})
    expect(ctx.compactionPreference.method).toBe('soft')
    const isolated = ctx.isolate('compaction')
    expect(isolated.get('compactionPreference')).toBe(ctx.compactionPreference)
    expect(isolated.get('compactionPreference')?.method).toBe('soft')
  })
})
