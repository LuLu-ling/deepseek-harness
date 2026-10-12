/** What the browser half registers, and that playback follows saved values until teardown. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createScope } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject, NS } from '../src/client/index.ts'
import z from '@deepseek-ai/schemastery'
import { SOUND_CHOICES } from '../src/sound-choices.ts'
import type { SoundSessionList } from '../src/client/playback.ts'

function choice() {
  return z.union([...SOUND_CHOICES]).default('none').volatile()
}

const documentSchema = z.object({
  agent: choice(),
  permissions: choice(),
  errors: choice(),
})

function view(value: Record<string, string>, revision = 0) {
  return {
    autoGenerate: false, ns: 'sounds', schema: documentSchema.toJSON(), value, base: value, user: {},
    applies: 'live' as const, secrets: [], revision,
  }
}

async function bench(served?: Array<ReturnType<typeof view>>) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const list = createSnapshotStore<SoundSessionList>({ ids: ['root'], byId: { root: {} } })
  const scope = createScope(ctx, SessionId('root'))
  const sessions = {
    list,
    scopeOf: (_owner: Context) => SessionId('root') as SessionId | undefined,
  }
  ctx.provide('sessions', sessions)
  const describeSettings = vi.fn(() => Promise.resolve(served === undefined
    ? { ok: false, error: new RemoteError('gateway/internal', 'no provider', {}) }
    : { ok: true, value: { writable: true, hasDocument: true, namespaces: served } }))
  const remote = new TestRemote(ctx, { settings: { describe: describeSettings } })
  const realOn = remote.$on.bind(remote)
  remote.$on = (event: string, listener: (...args: never[]) => unknown) => {
    if (event !== 'approval/request') return realOn(event, listener)
    return realOn(event, (request: unknown, next: () => unknown) => {
      listener.call(scope.ctx, request as never, next as never)
    })
  }
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, describeSettings, remote, list, sessions }
}

function declareRoot(slots: SlotRegistry): void {
  slots.register({
    name: 'root',
    children: { 'plugins.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

function delay(ms: number): Promise<undefined> {
  const { promise, resolve } = Promise.withResolvers<undefined>()
  setTimeout(resolve, ms)
  return promise
}

const saved = { agent: 'alert-01', permissions: 'nope-01', errors: 'yup-01' }

describe('ui-settings-sounds apply', () => {
  it('declares the services it uses and registers the page in the active locale', async () => {
    expect(inject).toEqual(['slots', 'locale', 'configForms', 'remote', 'sessions'])
    const { ctx, slots } = await bench([view({ agent: 'none', permissions: 'none', errors: 'none' })])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    const entry = slots.entries('plugins.item')[0]!
    expect(entry.options).toMatchObject({ id: 'sounds', order: 51 })
    expect(resolveSlotLabel(entry.options.label)).toBe('音效')
    expect(entry.locale).toBe(NS)
    const hooks = entry.inject?.()?.['hooks']
    if (typeof hooks !== 'object' || hooks === null) throw new Error('sounds card did not inject hooks')
    expect(Object.keys(hooks)).toEqual(['soundsCard'])
  })

  it('plays saved sounds for a stop edge, a new approval, and an error, then drops them on teardown', async () => {
    const started: string[] = []
    vi.stubGlobal('Audio', class {
      constructor(readonly src: string) { started.push(src) }
      play() { return Promise.resolve() }
      pause() {}
      currentTime = 0
    })
    const { ctx, slots, remote, list, sessions } = await bench([view(saved)])
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    remote.emit('api-session/status', [SessionId('root'), true])
    remote.emit('api-session/status', [SessionId('root'), false])
    const next = vi.fn(() => Promise.resolve('allowed-once'))
    remote.emit('approval/request', [{}, next])
    remote.emit('api-session/error', [SessionId('root'), 'failed'])
    list.set({ ids: ['child'], byId: { child: { parentId: 'root' } } })
    remote.emit('api-session/error', [SessionId('child'), 'failed'])
    await vi.waitFor(() => { expect(started).toHaveLength(3) })
    expect(next).toHaveBeenCalledOnce()

    sessions.scopeOf = () => undefined
    const skipped = vi.fn(() => Promise.resolve('allowed-once'))
    remote.emit('approval/request', [{}, skipped])
    expect(skipped).toHaveBeenCalledOnce()
    expect(started).toHaveLength(3)

    ctx.emit('connection/reset')
    remote.emit('api-session/status', [SessionId('root'), false])
    expect(started).toHaveLength(3)

    const preview = slots.entries('plugins.item')[0]?.inject?.()?.['preview']
    if (typeof preview !== 'function') throw new Error('sounds card did not inject preview')
    const play = preview as (id: string) => void
    play('staplebops-01')
    await fiber.dispose()
    expect(slots.entries('plugins.item')).toHaveLength(0)
    await delay(120)
    expect(started.filter(src => src.includes('staplebops'))).toEqual([])
    vi.unstubAllGlobals()
  })

  it('registers nothing while the namespace is absent and withdraws when the Host stops serving it', async () => {
    const { ctx, slots, describeSettings, remote } = await bench([])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
    expect(slots.entries('plugins.item')).toHaveLength(0)
    describeSettings.mockResolvedValue({
      ok: true,
      value: { writable: true, hasDocument: true, namespaces: [view({ agent: 'none', permissions: 'none', errors: 'none' }, 1)] },
    })
    remote.emit('settings/document-updated', ['sounds', 1])
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    describeSettings.mockResolvedValue({ ok: true, value: { writable: true, hasDocument: true, namespaces: [] } })
    remote.emit('settings/document-updated', ['sounds', 2])
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(0) })
  })
})
