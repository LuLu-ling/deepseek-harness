import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { SnapshotCardController, type SnapshotSettings } from '../src/client/snapshot-card-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites(host: StubConfigForm<SnapshotSettings>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const key = op.path[0]!
      if (op.op === 'unset') {
        Reflect.deleteProperty(value, key)
        Reflect.deleteProperty(user, key)
      } else {
        Reflect.set(value, key, op.value)
        Reflect.set(user, key, op.value)
      }
    }
    host.publish({ value: value as SnapshotSettings, user })
    return Promise.resolve(true)
  })
}

describe('SnapshotCardController', () => {
  it('saves staged limits in one write and unsets a reset field', async () => {
    const host = stubConfigForm<SnapshotSettings>()
    acceptWrites(host)
    const controller = new SnapshotCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { historyLimit: 20 },
      base: {},
      user: { historyLimit: 20 },
    })
    const face = controller.inject()

    face.edit('diskLimitBytes', '1048576')
    face.resetField('historyLimit')
    expect(face.hooks.snapshotCard.getSnapshot().dirty).toBe(true)

    face.save()
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalledTimes(1) })
    expect(host.mutate.mock.calls[0]?.[0]).toEqual([
      { op: 'set', path: ['diskLimitBytes'], value: 1_048_576 },
      { op: 'unset', path: ['historyLimit'] },
    ])
    expect(face.hooks.snapshotCard.getSnapshot().dirty).toBe(false)
    controller.dispose()
  })
})
