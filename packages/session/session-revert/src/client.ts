/**
 * Client-safe revert types. Client code imports this outlet, not the host service.
 * @module @lulu-ling/dsh-session-revert/client
 */

export type {
  SessionRevertClearResult,
  SessionRevertCommitResult,
  SessionRevertPoint,
  SessionRevertRange,
  SessionRevertStageResult,
  SessionRevertView,
} from './types.ts'
