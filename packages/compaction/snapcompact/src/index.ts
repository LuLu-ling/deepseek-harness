/**
 * Local snapcompact archive: shape selection, transcript imaging, and the
 * TypeScript frame rasterizer.
 * @module @lulu-ling/dsh-snapcompact
 */

export {
  FRAME_DATA_BYTES_BUDGET,
  FRAME_DATA_BYTES_ESTIMATE,
  FRAME_TOKEN_ESTIMATE,
  MAX_FRAMES_DEFAULT,
  compactSnapcompact,
  computeSnapcompactMaxFrames,
  idealShapeForModel,
  maxFramesForDataBudget,
  normalize,
  providerFrameBudget,
  resolveShapeForTarget,
} from './archive.ts'
export type {
  SnapcompactFrameRecord,
  SnapcompactHistoryBlock,
  SnapcompactModelTarget,
  SnapcompactRaster,
  SnapcompactRequest,
  SnapcompactResult,
  SnapcompactWireApi,
  TranscriptBlock,
  TranscriptMessage,
} from './archive.ts'
export { renderSnapcompactPng, snapcompactSupportedChars } from './raster.ts'
export type { SnapcompactRenderOptions } from './raster.ts'
