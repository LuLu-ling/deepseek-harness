/**
 * Prompt-sound settings. The Host half owns the `sounds` entry schema.
 * The browser half owns the Plugins page and playback.
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SOUND_CHOICES, type SoundChoice } from './sound-choices.ts'

/** Live prompt-sound choices. `'none'` is silence. */
export interface Config {
  /** Sound after a top-level session stops running. */
  agent: Volatile<SoundChoice>
  /** Sound for a new approval request. */
  permissions: Volatile<SoundChoice>
  /** Sound for an agent error outside a durable turn position. */
  errors: Volatile<SoundChoice>
}

/** One closed-set field. Each call builds its own node so `.volatile()` is not shared. */
function choice() {
  return z.union([...SOUND_CHOICES]).default('none').volatile()
}

/** Live prompt-sound schema. Unknown ids fail validation. */
export const Config = z.object({
  agent: choice(),
  permissions: choice(),
  errors: choice(),
})

/**
 * Keep this entry off the generated settings pages. Playback and the page live in the browser half.
 * @param ctx - Host plugin context.
 * @param _config - validated live choices; the browser reads them through settings.
 */
export function apply(ctx: Context, _config: Config): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
