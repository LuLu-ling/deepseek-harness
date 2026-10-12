/** One preview voice. A newer highlight cancels the previous preview and its pending timer. */

/** Starts one preview and returns the function that stops that element. */
export type SoundPreviewPlayer = (id: string | undefined) => Promise<(() => void) | undefined>

/** One delayed preview voice. */
export interface SoundPreviewController {
  /** Stop the current preview, then play `id` after 100ms. An empty id only stops. */
  play: (id: string | undefined) => void
  /** Stop the current preview and any timer that has not fired. */
  stop: () => void
}

/**
 * Hold one delayed preview. An empty id only stops. Dispose stops the timer and the element.
 * @param player - loads and starts one id.
 * @returns play and stop for the settings menu.
 */
export function createSoundPreviewController(player: SoundPreviewPlayer): SoundPreviewController {
  let cleanup: (() => void) | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let run = 0

  const stop = (): void => {
    run += 1
    cleanup?.()
    clearTimeout(timeout)
    cleanup = undefined
    timeout = undefined
  }

  const play = (id: string | undefined): void => {
    stop()
    if (id === undefined || id === '') return
    const current = ++run
    timeout = setTimeout(() => {
      timeout = undefined
      void player(id).then((next) => {
        if (run === current) {
          cleanup = next
          return
        }
        next?.()
      }).catch(() => undefined)
    }, 100)
  }

  return { play, stop }
}
