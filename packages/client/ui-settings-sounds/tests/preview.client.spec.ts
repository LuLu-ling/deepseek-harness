import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSoundPreviewController } from '../src/client/preview.ts'

afterEach(() => { vi.useRealTimers() })

describe('sound preview', () => {
  it('plays 100ms after a highlight and lets a later highlight cancel the first', async () => {
    vi.useFakeTimers()
    const played: string[] = []
    const stopped: string[] = []
    const preview = createSoundPreviewController(async (id) => {
      played.push(id ?? '')
      return () => { stopped.push(id ?? '') }
    })
    preview.play('alert-01')
    preview.play('alert-02')
    await vi.advanceTimersByTimeAsync(100)
    expect(played).toEqual(['alert-02'])
    preview.play('yup-01')
    expect(stopped).toEqual(['alert-02'])
    await vi.advanceTimersByTimeAsync(100)
    expect(played).toEqual(['alert-02', 'yup-01'])
  })
  it('stops on none and on dispose, and a stale start stops itself', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<(() => void) | undefined>()
    const stopped: string[] = []
    const preview = createSoundPreviewController(() => pending.promise)
    preview.play('alert-01')
    preview.play(undefined)
    await vi.advanceTimersByTimeAsync(100)
    preview.play('alert-03')
    await vi.advanceTimersByTimeAsync(100)
    preview.stop()
    pending.resolve(() => { stopped.push('late') })
    await Promise.resolve()
    expect(stopped).toEqual(['late'])
  })

  it('swallows a player rejection', async () => {
    vi.useFakeTimers()
    const preview = createSoundPreviewController(() => Promise.reject(new Error('blocked')))
    preview.play('alert-01')
    await vi.advanceTimersByTimeAsync(100)
  })
})
