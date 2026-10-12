/** Load and play one prompt sound. Event playback and preview each own their Audio element. */
import { isSoundId, type SoundId } from '../sound-choices.ts'
import { soundSource } from './audio-sources.ts'

const cache = new Map<SoundId, Promise<string | undefined>>()

/** Drop cached loads. Tests use this so one failure cannot leak into the next case. */
export function resetSoundCache(): void {
  cache.clear()
}

/**
 * Resolve a playable id to its source. An unknown id, or a load that fails, resolves empty.
 * @param id - candidate sound id.
 * @returns the source string, or undefined when there is nothing to play.
 */
export function soundSrc(id: string | undefined): Promise<string | undefined> {
  if (id === undefined || !isSoundId(id)) return Promise.resolve(undefined)
  const hit = cache.get(id)
  if (hit !== undefined) return hit
  const next = soundSource(id).then(src => src === '' ? undefined : src).catch(() => undefined)
  cache.set(id, next)
  return next
}

/**
 * Start one element. No `Audio`, or an empty source, does nothing.
 * A `play()` rejection is swallowed. The returned function stops that element.
 * @param src - audio source, or empty when the id did not load.
 * @returns a stop function, or undefined when nothing started.
 */
export function playSound(src: string | undefined): (() => void) | undefined {
  if (typeof Audio === 'undefined' || src === undefined || src === '') return
  const audio = new Audio(src)
  audio.play().catch(() => undefined)
  return () => {
    audio.pause()
    audio.currentTime = 0
  }
}

/**
 * Load an id and play it. Unknown ids and failed loads resolve without an element.
 * @param id - candidate sound id.
 * @returns the stop function, when an element started.
 */
export function playSoundById(id: string | undefined): Promise<(() => void) | undefined> {
  return soundSrc(id).then(src => playSound(src))
}
