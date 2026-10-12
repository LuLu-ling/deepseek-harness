/**
 * Prompt-sound settings, browser half. The page registers into `plugins.item`
 * while the Host serves the `sounds` namespace. Playback reads saved values
 * and the session list; it does not import the approval UI.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SoundsCard } from './SoundsCard.tsx'
import { savedSoundId, SOUNDS_NS, SOUNDS_ORDER, SoundsCardController, type SoundsSettings } from './sounds-card-controller.ts'
import { SoundPlayback } from './playback.ts'
import { playSoundById } from './sound-player.ts'
import { en, zh, type SoundsLocaleKey } from './locales.ts'

export type { SoundsCardProps } from './SoundsCard.tsx'
export type { SoundsCardFace, SoundsCardState, SoundsSettings } from './sounds-card-controller.ts'
export type { SoundsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Prompt-sound settings page copy. */
    'settings.sounds': SoundsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.sounds'

/** Required services: the page, copy, saved settings, remote events, and the session list. */
export const inject = ['slots', 'locale', 'configForms', 'remote', 'sessions']

/**
 * Mount the page while the Host serves `sounds`, and play saved sounds on later edges.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-sounds: dictionaries')
  const scope = ctx.configForms.get<SoundsSettings>(SOUNDS_NS)
  const card = new SoundsCardController(scope)
  const playback = new SoundPlayback(
    field => savedSoundId(scope.getSnapshot().value, field),
    ctx.sessions,
    (id) => { void playSoundById(id) },
  )
  ctx.effect(() => () => {
    card.dispose()
  }, 'ui-settings-sounds: form subscription')
  ctx.effect(() => ctx.remote.$on('api-session/status', (sessionId, running) => {
    playback.status(sessionId, running)
  }), 'ui-settings-sounds: agent sound')
  ctx.effect(() => ctx.remote.$on('api-session/error', (sessionId) => {
    playback.error(sessionId)
  }), 'ui-settings-sounds: error sound')
  ctx.effect(() => ctx.remote.$on('approval/request', function (_request, next) {
    const sessionId = ctx.sessions.scopeOf(this)
    if (sessionId !== undefined) playback.permission(sessionId)
    return next()
  }), 'ui-settings-sounds: permission sound')
  ctx.effect(() => ctx.on('connection/reset', () => { playback.resetBaselines() }), 'ui-settings-sounds: reconnect baseline')
  ctx.effect(() => ctx.configForms.whileServed([SOUNDS_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item',
    id: 'sounds',
    order: SOUNDS_ORDER,
    label: () => t('title'),
    locale: NS,
    inject: () => card.inject(),
  }, SoundsCard))), 'ui-settings-sounds: page')
}
