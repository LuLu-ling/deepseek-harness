import type { SessionRevertView } from '@lulu-ling/dsh-session-revert/client'

/**
 * Whether a chat anchor is inside the staged boundary or a frozen range.
 * @param revert - current session revert view; absence hides nothing.
 * @param seq - chat node anchor seq.
 * @returns whether the transcript should omit this seq.
 */
export function seqHiddenByRevert(revert: SessionRevertView | undefined, seq: number): boolean {
  if (revert === undefined) return false
  if (revert.staged !== null && seq >= revert.staged.atSeq) return true
  return revert.committed.some(range => seq >= range.atSeq && seq < range.untilSeq)
}

/** Turn chrome that can sit before the undone user message and must leave with that turn. */
export const REVERT_CHROME_KINDS: Record<string, true> = {
  'turn-process': true,
  'turn-tail': true,
  'turn-error': true,
  'turn-max-tokens': true,
}

const EMPTY_TURNS: ReadonlySet<number> = new Set()

/**
 * Turns whose content nodes are all inside the revert, so their chrome should
 * leave the rail and the transcript with them.
 * @param nodes - loaded chat nodes that carry a turn number when they have one.
 * @param revert - current revert view.
 * @returns turn numbers with content, none of it still visible.
 */
export function collectRetractedTurns(
  nodes: readonly { readonly kind: string; readonly anchorSeq: number; readonly turn: number | undefined }[],
  revert: SessionRevertView | undefined,
): ReadonlySet<number> {
  if (revert === undefined || (revert.staged === null && revert.committed.length === 0)) return EMPTY_TURNS
  const hasContent = new Set<number>()
  const hasVisible = new Set<number>()
  for (const node of nodes) {
    if (node.turn === undefined || REVERT_CHROME_KINDS[node.kind] === true) continue
    hasContent.add(node.turn)
    if (!seqHiddenByRevert(revert, node.anchorSeq)) hasVisible.add(node.turn)
  }
  const retracted = new Set<number>()
  for (const turn of hasContent) {
    if (!hasVisible.has(turn)) retracted.add(turn)
  }
  return retracted
}

/**
 * Move rows that landed after a reverted span back to the visible cursor.
 * Reverted rows stay after that cursor so a later compact is not drawn
 * behind the undone turn.
 * @param entries - transcript rows in log order.
 * @param reverted - whether the row belongs to the hidden span.
 * @returns the same array when nothing follows the hidden span.
 */
export function placeVisibleBeforeRevert<Entry>(
  entries: readonly Entry[],
  reverted: (entry: Entry) => boolean,
): readonly Entry[] {
  const before: Entry[] = []
  const hidden: Entry[] = []
  const after: Entry[] = []
  let passed = false
  for (const entry of entries) {
    if (reverted(entry)) {
      passed = true
      hidden.push(entry)
      continue
    }
    if (passed) after.push(entry)
    else before.push(entry)
  }
  if (after.length === 0) return entries
  return [...before, ...after, ...hidden]
}
