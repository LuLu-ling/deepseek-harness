/**
 * The file-snapshot settings page, browser half: the retention limits and
 * the untracked-file cap over the `session-snapshot` entry. The page
 * registers into the Plugins page's `plugins.item` slot while the Host
 * serves that entry, so a deployment without worktree snapshots shows no
 * trace of it.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SnapshotCard } from './SnapshotCard.tsx'
import { SNAPSHOT_NS, SnapshotCardController } from './snapshot-card-controller.ts'
import { en, zh, type SnapshotSettingsLocaleKey } from './locales.ts'

export type { SnapshotCardProps } from './SnapshotCard.tsx'
export type { SnapshotCardFace, SnapshotCardState, SnapshotSettings } from './snapshot-card-controller.ts'
export type { SnapshotSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** File-snapshot settings page copy. */
    'settings.sessionSnapshot': SnapshotSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.sessionSnapshot'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Mount the file-snapshot settings page while the Host serves its entry.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-session-snapshot: dictionaries')
  const card = new SnapshotCardController(ctx.configForms.get(SNAPSHOT_NS))
  ctx.effect(() => () => { card.dispose() }, 'ui-settings-session-snapshot: form subscription')
  ctx.effect(() => ctx.configForms.whileServed([SNAPSHOT_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'session-snapshot', order: 50, label: () => t('title'), locale: NS, inject: () => card.inject(),
  }, SnapshotCard))), 'ui-settings-session-snapshot: page')
}
