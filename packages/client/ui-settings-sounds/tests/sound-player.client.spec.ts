import { afterEach, describe, expect, it, vi } from 'vitest'
import * as sources from '../src/client/audio-sources.ts'
import { playSound, playSoundById, resetSoundCache, soundSrc } from '../src/client/sound-player.ts'
import { SOUND_IDS } from '../src/sound-choices.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetSoundCache()
})

describe('sound player', () => {
  it('plays a loaded id and stops that element', async () => {
    const pause = vi.fn()
    const play = vi.fn(() => Promise.resolve())
    vi.stubGlobal('Audio', class {
      currentTime = 4
      constructor(readonly src: string) {}
      play = play
      pause = pause
    })
    const stop = await playSoundById('alert-01')
    expect(play).toHaveBeenCalledOnce()
    stop?.()
    expect(pause).toHaveBeenCalledOnce()
  })

  it('resolves an unknown id and a failed load to silence', async () => {
    vi.spyOn(sources, 'soundSource').mockRejectedValueOnce(new Error('unreadable'))
    await expect(soundSrc('alert-02')).resolves.toBeUndefined()
    await expect(soundSrc('nope-99')).resolves.toBeUndefined()
    await expect(soundSrc(undefined)).resolves.toBeUndefined()
  })

  it('caches a source and treats an empty source as silence', async () => {
    const load = vi.spyOn(sources, 'soundSource')
    load.mockResolvedValueOnce('')
    await expect(soundSrc('yup-01')).resolves.toBeUndefined()
    load.mockResolvedValue('data:audio/aac;base64,YQ==')
    resetSoundCache()
    const first = soundSrc('yup-01')
    const second = soundSrc('yup-01')
    expect(second).toBe(first)
    await expect(first).resolves.toBe('data:audio/aac;base64,YQ==')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does nothing without Audio or a source, and swallows play rejection', async () => {
    vi.stubGlobal('Audio', undefined)
    expect(playSound('data:audio/aac;base64,YQ==')).toBeUndefined()
    vi.stubGlobal('Audio', class {
      currentTime = 0
      play() { return Promise.reject(new Error('blocked')) }
      pause() {}
    })
    expect(playSound(undefined)).toBeUndefined()
    expect(playSound('')).toBeUndefined()
    expect(() => playSound('data:audio/aac;base64,YQ==')).not.toThrow()
    await Promise.resolve()
  })

  it('ships a source for every playable id', () => {
    expect(Object.keys(sources.SOUND_SOURCES)).toEqual([...SOUND_IDS])
    for (const id of SOUND_IDS) expect(sources.SOUND_SOURCES[id]?.length).toBeGreaterThan(0)
  })
})
