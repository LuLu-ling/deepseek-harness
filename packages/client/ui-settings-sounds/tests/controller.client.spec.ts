import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { savedSoundId, SoundsCardController, type SoundsSettings } from '../src/client/sounds-card-controller.ts'

afterEach(() => { vi.useRealTimers() })

function acceptWrites(host: StubConfigForm<SoundsSettings>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
      }
    }
    host.publish({ value, user })
    return Promise.resolve(true)
  })
}

describe('SoundsCardController', () => {
  it('stages a choice, saves it against the read revision, and returns none on reset', async () => {
    vi.useFakeTimers()
    const host = stubConfigForm<SoundsSettings>()
    acceptWrites(host)
    const played: Array<string | undefined> = []
    const controller = new SoundsCardController(host.scope, async (id) => {
      played.push(id)
      return () => {}
    })
    host.publish({
      status: 'ready', writable: true, revision: 4,
      value: { agent: 'none', permissions: 'none', errors: 'none' },
      base: { agent: 'none', permissions: 'none', errors: 'none' },
      user: {},
    })
    const face = controller.inject()
    face.select('agent', 'nope-99')
    expect(face.hooks.soundsCard.getSnapshot().agent).toMatchObject({ text: 'none', invalid: false })
    expect(played).toEqual([])
    expect(host.mutate).not.toHaveBeenCalled()

    face.select('agent', 'alert-01')
    expect(face.hooks.soundsCard.getSnapshot().agent).toMatchObject({ text: 'alert-01', overridden: true })
    expect(host.mutate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(played).toEqual(['alert-01'])
    vi.useRealTimers()
    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['agent'], value: 'alert-01' }], 4)
    })

    face.select('agent', 'none')
    expect(face.hooks.soundsCard.getSnapshot().agent.text).toBe('none')
    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['agent'], value: 'none' }], 4)
    })

    host.publish({ user: { agent: 'alert-01' }, value: { agent: 'alert-01', permissions: 'none', errors: 'none' } })
    face.resetField('agent')
    expect(face.hooks.soundsCard.getSnapshot().agent.text).toBe('none')
    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenLastCalledWith([{ op: 'unset', path: ['agent'] }], 4)
    })
    controller.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  it('treats a stored unknown id as invalid and does not play it', () => {
    const host = stubConfigForm<SoundsSettings>()
    const controller = new SoundsCardController(host.scope, () => Promise.resolve(undefined))
    host.publish({
      status: 'ready', writable: true,
      value: { agent: 'nope-99' as 'none', permissions: 'none', errors: 'none' },
    })
    const state = controller.inject().hooks.soundsCard.getSnapshot()
    expect(state.agent).toMatchObject({ text: 'nope-99', invalid: true })
    expect(state.invalid).toBe(true)
    expect(savedSoundId(host.scope.getSnapshot().value, 'agent')).toBeUndefined()
    expect(savedSoundId(undefined, 'errors')).toBeUndefined()
    expect(savedSoundId({ errors: 'yup-01' }, 'errors')).toBe('yup-01')
    const face = controller.inject()
    face.edit('agent', 'bogus')
    expect(face.hooks.soundsCard.getSnapshot().agent).toMatchObject({ text: 'bogus', invalid: true })
    controller.dispose()
  })
})
