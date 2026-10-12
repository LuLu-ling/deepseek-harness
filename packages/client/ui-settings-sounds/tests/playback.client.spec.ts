import { describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SoundPlayback, type SoundSessionList } from '../src/client/playback.ts'
import type { SoundId } from '../src/sound-choices.ts'

function bench(saved: Partial<Record<'agent' | 'permissions' | 'errors', SoundId | undefined>> = {}) {
  const list = createSnapshotStore<SoundSessionList>({ ids: [], byId: {} })
  const played: string[] = []
  let now = 1_000
  const playback = new SoundPlayback(
    field => saved[field],
    { list },
    (id) => { played.push(`${fieldOf(saved, id)}:${id}`) },
    () => now,
  )
  const setNow = (value: number) => { now = value }
  return { list, played, playback, setNow }
}

function fieldOf(saved: Partial<Record<string, string | undefined>>, id: string): string {
  return Object.entries(saved).find(([, value]) => value === id)?.[0] ?? 'unknown'
}

describe('sound playback', () => {
  it('plays the saved agent sound only on a listed top-level stop edge', () => {
    const { list, played, playback } = bench({ agent: 'alert-01' })
    list.set({ ids: ['root', 'child'], byId: { root: {}, child: { parentId: 'root' } } })
    playback.status('root', false)
    playback.status('root', true)
    playback.status('missing', true)
    playback.status('missing', false)
    playback.status('child', true)
    playback.status('child', false)
    playback.status('root', true)
    expect(played).toEqual([])
    playback.status('root', false)
    expect(played).toEqual(['agent:alert-01'])
    playback.resetBaselines()
    playback.status('root', false)
    expect(played).toEqual(['agent:alert-01'])
  })

  it('stays silent while the saved agent sound is none or unknown', () => {
    const { list, played, playback } = bench({})
    list.set({ ids: ['root'], byId: { root: {} } })
    playback.status('root', true)
    playback.status('root', false)
    expect(played).toEqual([])
  })

  it('plays a permission sound once per session within five seconds', () => {
    const { played, playback, setNow } = bench({ permissions: 'nope-03' })
    playback.permission('s1')
    playback.permission('s1')
    setNow(5_999)
    playback.permission('s1')
    setNow(6_000)
    playback.permission('s1')
    playback.permission('s2')
    expect(played).toEqual(['permissions:nope-03', 'permissions:nope-03', 'permissions:nope-03'])
  })

  it('does not start the permission cooldown when the saved sound is silence', () => {
    const { played, playback, setNow } = bench({})
    playback.permission('s1')
    setNow(1_100)
    expect(played).toEqual([])
  })

  it('plays an error for an unlisted session and skips a subagent', () => {
    const { list, played, playback } = bench({ errors: 'yup-01' })
    playback.error('fresh')
    list.set({ ids: ['child'], byId: { child: { parentId: 'root' } } })
    playback.error('child')
    list.set({ ids: ['root'], byId: { root: {} } })
    playback.error('root')
    expect(played).toEqual(['errors:yup-01', 'errors:yup-01'])
  })
})
