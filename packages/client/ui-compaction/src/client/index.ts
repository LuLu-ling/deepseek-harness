/**
 * Browser half: decorate host `/compact` with a popup, and publish the
 * automatic method on General settings. A mode pick submits the host command.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelCatalog, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CommandUiContract, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { CompactionMethodRow, type CompactionMethodInjected } from './CompactionMethodRow.tsx'
import { en, zh, type CompactionLocaleKey } from './locales.ts'
import { acceptedMethod, COMPACTION_NS, modelDeclaresImage, type CompactionMethod, type CompactionSettings } from './preference.ts'

export type { CompactionMethodInjected, CompactionMethodRowProps } from './CompactionMethodRow.tsx'
export type { CompactionLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Compaction popup and settings copy. */
    'settings.compaction': CompactionLocaleKey
  }
}

const NS = 'settings.compaction'

export const inject = [
  'commandUi', 'slots', 'locale', 'configForms', 'sessions', 'remote', 'remote.session',
] as const

function selectionOf(value: unknown, catalog: ModelCatalog | undefined): ModelSelection | undefined {
  if (typeof value === 'object' && value !== null && 'next' in value) {
    const next = value.next
    if (typeof next === 'object' && next !== null && 'provider' in next && 'model' in next
      && typeof next.provider === 'string' && typeof next.model === 'string') {
      return { provider: next.provider, model: next.model }
    }
  }
  return catalog?.default
}

/**
 * Mount the popup decoration and the General settings row.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const command = ctx.get('commandUi') as CommandUiContract
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-compaction: dictionaries')
  const scope = ctx.configForms.get<CompactionSettings>(COMPACTION_NS)
  const setMethod = async (method: CompactionMethod): Promise<void> => {
    const accepted = await scope.set('method', method)
    if (!accepted) throw new Error('context-compaction method was not accepted')
  }

  const submit = async (sessionId: SessionId, mode: 'soft' | 'snapcompact'): Promise<void> => {
    const live = ctx.sessions.binding(sessionId)?.session
    if (live === undefined) throw new Error('this session is not materialized yet')
    const result = await live.command(`/compact ${mode}`)
    if (!result.ok) throw new Error(`compaction failed: ${result.error.code}: ${result.error.message}`)
    if (!result.value.matched) throw new Error('the host offers no /compact command')
  }

  ctx.effect(() => command.decorate({
    name: 'compact',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async (session: ClientSessionContext): Promise<SelectOption[]> => {
        const live = ctx.sessions.binding(session.sessionId)?.session
        const loaded = await ctx.remote.session.modelCatalog()
        const catalog = loaded.ok ? loaded.value : undefined
        const projected = live?.projections.faceOf('modelSelection').getSnapshot()
        const vision = modelDeclaresImage(catalog, selectionOf(projected, catalog))
        const saved = acceptedMethod(scope)
        const active = saved === 'snapcompact' && !vision ? 'soft' : saved
        const rows: SelectOption[] = [{
          id: 'soft',
          label: t('popup.soft.label'),
          detail: t('popup.soft.detail'),
          ...(active === 'soft' ? { active: true } : {}),
        }]
        if (vision) {
          rows.push({
            id: 'snapcompact',
            label: t('popup.snapcompact.label'),
            detail: t('popup.snapcompact.detail'),
            ...(active === 'snapcompact' ? { active: true } : {}),
          })
        }
        return rows
      },
      onSelect: (option, session) => {
        const mode = option.id === 'snapcompact' ? 'snapcompact' : 'soft'
        return submit(session.sessionId, mode)
      },
    },
  }), 'ui-compaction: /compact decoration')

  ctx.effect(() => ctx.configForms.whileServed([COMPACTION_NS], () => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'context-compaction',
    order: 40,
    locale: NS,
    inject: (): CompactionMethodInjected => ({
      hooks: { method: scope },
      setMethod,
    }),
  }, CompactionMethodRow))), 'ui-compaction: general settings row')
}
