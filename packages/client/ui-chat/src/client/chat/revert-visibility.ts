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
