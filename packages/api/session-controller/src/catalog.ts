/** Shared projection of the live LLM registry into the browser model catalog. */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ModelCatalog,
  ModelProviderGroup,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/**
 * Build the browser model catalog without requiring a Session.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
): Promise<ModelCatalog> {
  const providers = ctx.llm.listProviders()
  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
        }
      }))
      return {
        kind: 'group' as const,
        group: { id: provider.id, name: provider.name, models: entries },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  const groups = catalog.flatMap(item => item.kind === 'group' ? [item.group] : [])
    .filter(group => group.models.length > 0)
  const visible = await omitUnkeyedOfficial(ctx, groups)
  return {
    default: { ...defaultSelection },
    routableProviders: visible.map(group => group.id),
    groups: visible,
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}

/**
 * Check a GUI selection against the current available provider catalog.
 * @param ctx - Host LLM registry.
 * @param selection - stored or explicitly requested selection.
 * @returns whether the exact model is currently advertised as available.
 */
export async function modelAvailable(ctx: Context, selection: ModelSelection): Promise<boolean> {
  if (!ctx.llm.listProviders().some(provider => provider.id === selection.provider)) return false
  let models: readonly LlmModelInfo[]
  try { models = await ctx.llm.listModels(selection.provider) }
  catch (error) {
    throw new RemoteError('session/model-unavailable',
      error instanceof Error ? error.message : String(error),
      { provider: selection.provider, model: selection.model })
  }
  return models.some(model => model.id === selection.model)
}

/**
 * Check configured provider API-key references independently of model availability.
 * @param ctx - Host registry, settings, and credential services.
 * @returns whether any API-key provider has a configured credential.
 */
export async function hasProviderApiKey(ctx: Context): Promise<boolean> {
  const inspected = credentialInspection(ctx)
  const namespaces = inspected.settings.describe({ redactSecrets: true })
  for (const provider of ctx.llm.listConfigurableProviders()) {
    if (provider.provider === 'deepseek-account') continue
    const ref = apiKeyEnvOf(profileOf(namespaces, provider))
    if (ref !== undefined && (await inspected.credentials.describe(credentialRef(ref))).configured) return true
  }
  return false
}

const OFFICIAL_PROVIDER = 'deepseek-official'
const OFFICIAL_KEY = 'DEEPSEEK_API_KEY'

/** Settings and credentials, or a refusal when either service is absent. */
function credentialInspection(ctx: Context): {
  settings: { describe(options: { redactSecrets: boolean }): readonly { ns: string; value: unknown }[] }
  credentials: { describe(ref: CredentialRef): Promise<{ configured: boolean }> }
} {
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  if (settings === undefined || credentials === undefined) {
    throw new RemoteError('session/provider-credentials-unavailable', 'provider credentials are unavailable', {})
  }
  return { settings, credentials }
}

/** The profile object a configurable provider's settings path names. */
function profileOf(
  namespaces: readonly { ns: string; value: unknown }[],
  provider: { settingsNs: string; settingsPath: readonly string[] },
): unknown {
  let profile: unknown = namespaces.find(namespace => namespace.ns === provider.settingsNs)?.value
  for (const key of provider.settingsPath) {
    profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
  }
  return profile
}

/** A non-empty `apiKeyEnv` on a resolved profile. */
function apiKeyEnvOf(profile: unknown): string | undefined {
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref: unknown = Reflect.get(profile, 'apiKeyEnv')
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/**
 * Drop `deepseek-official` when its key is unset and another listed provider
 * can already serve requests. A missing settings service leaves the group in
 * place. No other ready provider leaves it in place too.
 * @param ctx - Host registry, settings, and credential services.
 * @param groups - successful non-empty provider groups.
 * @returns the groups the model menu should show.
 */
async function omitUnkeyedOfficial(
  ctx: Context,
  groups: readonly ModelProviderGroup[],
): Promise<readonly ModelProviderGroup[]> {
  if (!groups.some(group => group.id === OFFICIAL_PROVIDER)) return groups
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  if (settings === undefined || credentials === undefined) return groups
  const namespaces = settings.describe({ redactSecrets: true })
  const configurable = ctx.llm.listConfigurableProviders()
  const official = configurable.find(provider => provider.provider === OFFICIAL_PROVIDER)
  if (official === undefined) return groups
  const officialRef = apiKeyEnvOf(profileOf(namespaces, official)) ?? OFFICIAL_KEY
  if ((await credentials.describe(credentialRef(officialRef))).configured) return groups
  for (const group of groups) {
    if (group.id === OFFICIAL_PROVIDER) continue
    if (group.id === 'deepseek-account') return groups.filter(item => item.id !== OFFICIAL_PROVIDER)
    const entry = configurable.find(provider => provider.provider === group.id)
    if (entry === undefined) continue
    const ref = apiKeyEnvOf(profileOf(namespaces, entry))
    if (ref === undefined || (await credentials.describe(credentialRef(ref))).configured) {
      return groups.filter(item => item.id !== OFFICIAL_PROVIDER)
    }
  }
  return groups
}
