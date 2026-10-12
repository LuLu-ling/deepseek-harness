import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import * as HostPlugin from '../src/index.ts'
import { Config, apply } from '../src/index.ts'

const silence = { agent: 'none', permissions: 'none', errors: 'none' }

describe('sounds host schema', () => {
  it('defaults every field to silence and rejects an unknown id', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    expect(plainConfig(configuration.fiber.config)).toEqual(silence)
    await configuration.update({ agent: 'alert-01', permissions: 'nope-12', errors: 'yup-06' })
    expect(plainConfig(configuration.fiber.config)).toEqual({
      agent: 'alert-01', permissions: 'nope-12', errors: 'yup-06',
    })
    await expect(configuration.update({ agent: 'nope-99' })).rejects.toThrow()
    expect(plainConfig(configuration.fiber.config)).toMatchObject({ agent: 'alert-01' })
    await configuration.fiber.dispose()
  })

  it('keeps its own instance off the generated settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
})
