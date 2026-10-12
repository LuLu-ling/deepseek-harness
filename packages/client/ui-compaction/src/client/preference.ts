/**
 * Saved automatic method and whether the session's selected model declares images.
 */

import type { ModelCatalog, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'

/** Settings namespace edited by the General settings row. */
export const COMPACTION_NS = 'context-compaction'

/** Automatic method the row can save. */
export type CompactionMethod = 'soft' | 'snapcompact'

/** Fields the General row reads from that namespace. */
export interface CompactionSettings {
  method?: CompactionMethod
}

/**
 * Accepted automatic method. Missing or unknown values display as soft.
 * @param scope - bound settings form.
 * @returns the method the row and popup should show.
 */
export function acceptedMethod(scope: { getSnapshot(): { value?: CompactionSettings | undefined } }): 'soft' | 'snapcompact' {
  return scope.getSnapshot().value?.method === 'snapcompact' ? 'snapcompact' : 'soft'
}

/**
 * Whether one catalog row declared image input. Absent modalities are not support.
 * @param catalog - model catalog, when the host has published one.
 * @param selection - selected provider and model.
 * @returns true only when that row lists image input.
 */
export function modelDeclaresImage(
  catalog: ModelCatalog | undefined,
  selection: ModelSelection | undefined,
): boolean {
  if (catalog === undefined || selection === undefined) return false
  const group = catalog.groups.find(item => item.id === selection.provider)
  const model = group?.models.find(item => item.id === selection.model)
  return model !== undefined && declaredImage(model)
}

function declaredImage(model: object): boolean {
  if (!('inputModalities' in model)) return false
  const modalities = model.inputModalities
  return Array.isArray(modalities) && modalities.includes('image')
}
