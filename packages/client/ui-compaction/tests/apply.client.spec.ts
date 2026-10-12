/** What the browser half registers, and that choosing a method writes it. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import type { CompactionMethodInjected } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { CompactionMethodRow } from '../src/client/CompactionMethodRow.tsx'

const NS = 'context-compaction'
const SLOT = 'settings.general.item'

interface PreferenceNamespace {
  autoGenerate: boolean
  ns: string
  schema: Record<string, never>
  value: { method?: 'soft' | 'snapcompact' }
  applies: 'live'
  secrets: never[]
  revision: number
}

function namespace(method: 'soft' | 'snapcompact' | undefined, revision: number): PreferenceNamespace {
  return {
    autoGenerate: true,
    ns: NS,
    schema: {},
    value: method === undefined ? {} : { method },
    applies: 'live',
    secrets: [],
    revision,
  }
}

async function bench(served: boolean, method?: 'soft' | 'snapcompact') {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  let revision = 0
  let saved = method
  const describe = vi.fn(async () => ({
    ok: true as const,
    value: {
      writable: true,
      hasDocument: true,
      namespaces: served ? [namespace(saved, revision)] : [],
    },
  }))
  const mutate = vi.fn(async (
    _ns: string,
    ops: { op: string; path: string[]; value?: unknown }[],
  ): Promise<{ ok: true; value: PreferenceNamespace } | { ok: false; error: { code: string; message: string } }> => {
    const next = ops[0]?.value
    saved = next === 'snapcompact' ? 'snapcompact' : 'soft'
    revision += 1
    return { ok: true, value: namespace(saved, revision) }
  })
  const remote = new TestRemote(ctx, { settings: { describe, mutate }, session: {} })
  ctx.provide('commandUi', { decorate: () => () => {} })
  ctx.provide('sessions', { binding: () => undefined })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, describe, mutate, remote }
}

function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

function hasMethodFace(value: Record<string, unknown>): value is CompactionMethodInjected & Record<string, unknown> {
  const hooks = value.hooks
  return typeof value.setMethod === 'function'
    && typeof hooks === 'object'
    && hooks !== null
    && 'method' in hooks
}

function faceOf(slots: SlotRegistry): CompactionMethodInjected {
  const entry = slots.entries(SLOT).find(item => item.component === CompactionMethodRow)
  const produced = entry?.inject?.()
  if (produced === undefined || !hasMethodFace(produced)) {
    throw new Error('context-compaction row inject is not the method face')
  }
  return produced
}

describe('ui-compaction apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['commandUi', 'slots', 'locale', 'configForms', 'sessions', 'remote', 'remote.session'])
  })

  it('registers the General row while the Host serves the preference, and writes the chosen method', async () => {
    const { ctx, slots, mutate } = await bench(true, 'soft')
    declareItems(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(slots.entries(SLOT)).toHaveLength(1) })
    const entry = slots.entries(SLOT)[0]!
    expect(entry.options).toMatchObject({ id: NS, order: 40 })
    expect(entry.locale).toBe('settings.compaction')
    expect(slots.entries('plugins.item')).toHaveLength(0)
    const face = faceOf(slots)
    await face.setMethod('snapcompact')
    expect(mutate).toHaveBeenCalledWith(NS, [{ op: 'set', path: ['method'], value: 'snapcompact' }], 0)
  })

  it('registers nothing while the preference is absent, and follows the Host', async () => {
    const { ctx, slots, describe, remote } = await bench(false)
    declareItems(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })
    expect(slots.entries(SLOT)).toHaveLength(0)

    describe.mockResolvedValue({
      ok: true,
      value: { writable: true, hasDocument: true, namespaces: [namespace('soft', 1)] },
    })
    remote.emit('settings/document-updated', [NS, 1])
    await vi.waitFor(() => { expect(slots.entries(SLOT)).toHaveLength(1) })

    describe.mockResolvedValue({ ok: true, value: { writable: true, hasDocument: true, namespaces: [] } })
    remote.emit('settings/document-updated', [NS, 2])
    await vi.waitFor(() => { expect(slots.entries(SLOT)).toHaveLength(0) })
  })

  it('refuses a write the Host does not accept', async () => {
    const { ctx, slots, mutate } = await bench(true, 'soft')
    mutate.mockResolvedValue({ ok: false, error: { code: 'settings/rejected', message: 'read-only' } })
    declareItems(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(slots.entries(SLOT)).toHaveLength(1) })
    await expect(faceOf(slots).setMethod('snapcompact')).rejects.toThrow('context-compaction method was not accepted')
  })

  it('removes the row when the plugin stops', async () => {
    const { ctx, slots } = await bench(true, 'soft')
    declareItems(slots)
    const fiber = await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(slots.entries(SLOT)).toHaveLength(1) })
    await fiber.dispose()
    expect(slots.entries(SLOT)).toHaveLength(0)
  })
})
