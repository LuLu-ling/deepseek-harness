/**
 * Copyright (c) 2025-2026 Can Bölük
 * Copyright (c) 2026 Stencil Labs, Inc.
 *
 * Adapted from oh-my-pi snapcompact (MIT).
 */

/**
 * Snapcompact compaction: archive conversation history as dense bitmap images.
 *
 * The frame shape is provider-aware. Unknown wire APIs use `8on22-bw` geometry
 * with Anthropic-style area billing. Resolution stays automatic.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSnapcompactPng, snapcompactSupportedChars } from './raster.ts'
import type { SnapcompactRenderOptions } from './raster.ts'

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../prompts')
const SUMMARY_TEMPLATE = readFileSync(join(PROMPT_DIR, 'snapcompact-summary.md'), 'utf8')

// ============================================================================
// Shapes
// ============================================================================

/** One eval-validated frame shape: font, cell, ink, repetition, and size. */
export interface Shape {
  /** Bundled font in the renderer. */
  font: '5x8' | '8x8' | '6x12' | '8x13' | 'silver'
  /** Target cell advance in pixels. */
  cellWidth: number
  /** Target cell pitch in pixels. */
  cellHeight: number
  /** `false` draws glyphs at natural size; otherwise stretch when the cell differs. */
  stretch?: boolean
  /** `sent` cycles six hues at sentence boundaries; `bw` is black. */
  variant: 'sent' | 'bw'
  /** Print stopwords in dim ink. */
  stopwordDim?: boolean
  /** 2 = two word-wrapped newspaper columns. */
  columns?: 1 | 2
  /** Each text line is printed this many times. */
  lineRepeat: number
  /** Frame edge in pixels. */
  frameSize: number
  /** Per-frame billed-token estimate for the shape's target provider. */
  frameTokenEstimate: number
  /** Resolution hint attached to frame images (OpenAI-only). */
  imageDetail?: 'auto' | 'low' | 'high' | 'original'
}

/** Geometry half of a {@link Shape}: everything except provider billing. */
export type ShapeGeometry = Omit<Shape, 'frameTokenEstimate' | 'imageDetail'>

/**
 * Frame variants exercised by the SQuAD evals that the renderer reproduces,
 * keyed by their research names.
 */
export const SHAPE_VARIANTS = {
  '8x8r-bw': { font: '8x8', cellWidth: 8, cellHeight: 8, variant: 'bw', lineRepeat: 2, frameSize: 1568 },
  '8x8r-sent': { font: '8x8', cellWidth: 8, cellHeight: 8, variant: 'sent', lineRepeat: 2, frameSize: 1568 },
  '8x8u-bw': { font: '8x8', cellWidth: 8, cellHeight: 8, variant: 'bw', lineRepeat: 1, frameSize: 1568 },
  '8x8u-sent': { font: '8x8', cellWidth: 8, cellHeight: 8, variant: 'sent', lineRepeat: 1, frameSize: 1568 },
  '6x6u-bw': { font: '8x8', cellWidth: 6, cellHeight: 6, variant: 'bw', lineRepeat: 1, frameSize: 1568 },
  '6x6u-sent': { font: '8x8', cellWidth: 6, cellHeight: 6, variant: 'sent', lineRepeat: 1, frameSize: 1568 },
  '5x8-bw': { font: '5x8', cellWidth: 5, cellHeight: 8, variant: 'bw', lineRepeat: 1, frameSize: 2576 },
  '5x8-sent': { font: '5x8', cellWidth: 5, cellHeight: 8, variant: 'sent', lineRepeat: 1, frameSize: 2576 },
  '6x12-dim': {
    font: '6x12',
    cellWidth: 6,
    cellHeight: 12,
    variant: 'bw',
    stopwordDim: true,
    lineRepeat: 1,
    frameSize: 1568,
  },
  '8x13-bw': { font: '8x13', cellWidth: 8, cellHeight: 13, variant: 'bw', lineRepeat: 1, frameSize: 1568 },
  '8on16-bw': {
    font: '8x13',
    cellWidth: 8,
    cellHeight: 16,
    stretch: false,
    variant: 'bw',
    lineRepeat: 1,
    frameSize: 1568,
  },
  '8on22-bw': {
    font: '8x13',
    cellWidth: 8,
    cellHeight: 22,
    stretch: false,
    variant: 'bw',
    lineRepeat: 1,
    frameSize: 1568,
  },
  '11on16-bw': {
    font: '8x13',
    cellWidth: 11,
    cellHeight: 16,
    stretch: false,
    variant: 'bw',
    lineRepeat: 1,
    frameSize: 1568,
  },
  'silver16-bw': {
    font: 'silver',
    cellWidth: 16,
    cellHeight: 16,
    variant: 'bw',
    lineRepeat: 1,
    frameSize: 1568,
  },
  'doc-8on16-bw': {
    font: '8x13',
    cellWidth: 8,
    cellHeight: 16,
    stretch: false,
    variant: 'bw',
    columns: 2,
    lineRepeat: 1,
    frameSize: 1568,
  },
  'doc-8on16-sent': {
    font: '8x13',
    cellWidth: 8,
    cellHeight: 16,
    stretch: false,
    variant: 'sent',
    columns: 2,
    lineRepeat: 1,
    frameSize: 1568,
  },
  'doc-8on16-sent-dim': {
    font: '8x13',
    cellWidth: 8,
    cellHeight: 16,
    stretch: false,
    variant: 'sent',
    stopwordDim: true,
    columns: 2,
    lineRepeat: 1,
    frameSize: 1568,
  },
} as const satisfies Record<string, ShapeGeometry>

/** Research name of one renderable frame variant. */
export type ShapeVariantName = keyof typeof SHAPE_VARIANTS

/** Provider families with distinct image billing. */
type BillingFamily = 'anthropic' | 'google' | 'openai' | 'unknown'

/** Wire API that carries the frames. Unknown uses Anthropic-style area billing. */
export type SnapcompactWireApi = 'anthropic' | 'openai' | 'google' | 'unknown'

/** What will read the frames: the wire API (billing) and model id (shape). */
export interface SnapcompactModelTarget {
  api?: SnapcompactWireApi
  id?: string
}

function billingFamily(api?: SnapcompactWireApi): BillingFamily {
  switch (api) {
    case 'anthropic':
      return 'anthropic'
    case 'openai':
      return 'openai'
    case 'google':
      return 'google'
    default:
      return 'unknown'
  }
}

/**
 * Per-frame billing for a square frame of edge `frameSize`, by family.
 * - Anthropic / unknown: 28px patches, capped at 4,784 visual tokens, +5%.
 * - Google: fixed 1,120-token media budget per image.
 * - OpenAI: 32px patches × 1.2, 10,000-patch budget at `detail: "original"`.
 */
function familyBilling(family: BillingFamily, frameSize: number): Pick<Shape, 'frameTokenEstimate' | 'imageDetail'> {
  switch (family) {
    case 'google':
      return { frameTokenEstimate: 1120 }
    case 'openai': {
      const patches = Math.min(Math.ceil(frameSize / 32) ** 2, 10_000)
      return { frameTokenEstimate: Math.ceil(patches * 1.2), imageDetail: 'original' }
    }
    default: {
      const patches = Math.min(Math.ceil(frameSize / 28) ** 2, 4784)
      return { frameTokenEstimate: Math.ceil(patches * 1.05) }
    }
  }
}

/** Attach a provider family's billing to a variant geometry. */
function priceShape(base: ShapeGeometry, family: BillingFamily): Shape {
  return { ...base, ...familyBilling(family, base.frameSize) }
}

/** Eval-validated shapes, keyed by the provider family they won on. */
export const SHAPES = {
  /** `11on16-bw`: 8x13 glyphs on an 11px advance, black ink. */
  anthropic: priceShape(SHAPE_VARIANTS['11on16-bw'], 'anthropic'),
  /** `8on22-bw`: 8x13 glyphs on a 22px pitch, black ink. */
  google: priceShape(SHAPE_VARIANTS['8on22-bw'], 'google'),
  /** `8on22-bw`: same leading win for OpenAI. */
  openai: priceShape(SHAPE_VARIANTS['8on22-bw'], 'openai'),
  /** Original 5x8 X.org shape. */
  legacy: priceShape(SHAPE_VARIANTS['5x8-sent'], 'anthropic'),
} satisfies Record<string, Shape>

/** Eval-winning variant per provider family when the model id is unmeasured. */
const FAMILY_VARIANT: Record<BillingFamily, ShapeVariantName> = {
  anthropic: '11on16-bw',
  google: '8on22-bw',
  openai: '8on22-bw',
  unknown: '8on22-bw',
}

/** Denser companion variant per family for the foveated archive middle. */
const FAMILY_VARIANT_LOW: Record<BillingFamily, ShapeVariantName> = {
  anthropic: '8on16-bw',
  google: '8on16-bw',
  openai: '8on16-bw',
  unknown: '8on16-bw',
}

const FAMILY_SHAPE: Record<BillingFamily, Shape> = {
  anthropic: SHAPES.anthropic,
  google: SHAPES.google,
  openai: SHAPES.openai,
  unknown: priceShape(SHAPE_VARIANTS['8on22-bw'], 'unknown'),
}

/** One model line's ideal format, plus an optional frame-size override. */
export interface IdealShape {
  variant: ShapeVariantName
  frameSize?: number
}

/** Opus 4.7+, Fable, and Mythos read 1932px frames natively. */
const HIGH_RES_ANTHROPIC_VARIANT = { variant: '11on16-bw', frameSize: 1932 } as const satisfies IdealShape

const MODEL_VARIANTS: readonly (readonly [RegExp, IdealShape])[] = [
  [/claude.*(fable|mythos)/i, HIGH_RES_ANTHROPIC_VARIANT],
  [/claude/i, { variant: '11on16-bw' }],
  [/gemini/i, { variant: '8on22-bw', frameSize: 2048 }],
  [/gpt|codex/i, { variant: '8on22-bw' }],
  [/kimi/i, { variant: '8on22-bw' }],
  [/glm/i, { variant: '8on16-bw' }],
]

type Revision = readonly [number, number, number]

function parseComponent(value: string): number | undefined {
  if (!value) return undefined
  let out = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 48 || code > 57) return undefined
    out = out * 10 + (code - 48)
    if (out > 255) return undefined
  }
  return out
}

/**
 * Leading revision from a tail that begins with a digit: up to three components
 * separated by `.` or by `-` followed by a digit (`"4-7"` → `[4, 7, 0]`).
 */
function parseRevisionPrefix(value: string): Revision | undefined {
  const out: [number, number, number] = [0, 0, 0]
  let count = 0
  let index = 0
  while (count < 3) {
    const start = index
    while (index < value.length && value.charCodeAt(index) >= 48 && value.charCodeAt(index) <= 57) {
      index++
    }
    const trailing = index < value.length ? value.charCodeAt(index) : 0
    const isSizeToken = (trailing >= 97 && trailing <= 122) || (trailing >= 65 && trailing <= 90)
    const component = isSizeToken ? undefined : parseComponent(value.slice(start, index))
    if (component === undefined) return count > 0 ? out : undefined
    out[count] = component
    count++
    const separator = value[index]
    if (separator === undefined) break
    const next = value.charCodeAt(index + 1)
    if ((separator !== '.' && separator !== '-') || !(next >= 48 && next <= 57)) break
    index++
  }
  return out
}

function compareRevision(a: Revision, b: Revision): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/** Revision after a `claude-` prefix (`claude-opus-4-7` → 4.7.0). */
function claudeRevision(modelId: string): Revision | undefined {
  const at = modelId.toLowerCase().indexOf('claude-')
  if (at < 0) return undefined
  const tail = modelId.slice(at + 'claude-'.length)
  const digit = tail.search(/\d/)
  if (digit < 0) return undefined
  return parseRevisionPrefix(tail.slice(digit))
}

const OPUS_FLOOR: Revision = [4, 7, 0]

/**
 * Eval-ideal format for a model id, or undefined when unmeasured.
 * Opus ≥ 4.7, Fable, and Mythos take the 1932px tier before the regex table.
 * @param modelId - model id used to select the shape.
 * @returns the ideal shape, or undefined when the id is unmeasured.
 */
export function idealShapeForModel(modelId: string): IdealShape | undefined {
  if (/claude.*(fable|mythos)/i.test(modelId)) return HIGH_RES_ANTHROPIC_VARIANT
  if (modelId.toLowerCase().includes('claude') && modelId.toLowerCase().includes('opus')) {
    const revision = claudeRevision(modelId)
    if (revision !== undefined && compareRevision(revision, OPUS_FLOOR) >= 0) {
      return HIGH_RES_ANTHROPIC_VARIANT
    }
  }
  return MODEL_VARIANTS.find(([pattern]) => pattern.test(modelId))?.[1]
}

/**
 * Pick the frame shape for a reader. The model id selects the eval-winning
 * shape and frame size; billing follows the wire API. There is no shape picker.
 */
function resolveShape(model?: SnapcompactModelTarget): Shape {
  const family = billingFamily(model?.api)
  const ideal = model?.id ? idealShapeForModel(model.id) : undefined
  const name = ideal?.variant ?? FAMILY_VARIANT[family]
  if (name === FAMILY_VARIANT[family] && ideal?.frameSize === undefined) return FAMILY_SHAPE[family]
  const base = SHAPE_VARIANTS[name]
  return priceShape(ideal?.frameSize ? { ...base, frameSize: ideal.frameSize } : base, family)
}

/**
 * Geometry fields a caller uses to size frames for `model`.
 * @param model - reader whose id and wire API select the shape.
 * @returns font, variant, frame size, and cell size.
 */
export function resolveShapeForTarget(model?: SnapcompactModelTarget): {
  readonly font: string
  readonly variant: string
  readonly frameSize: number
  readonly cellWidth: number
  readonly cellHeight: number
} {
  const shape = resolveShape(model)
  return {
    font: shape.font,
    variant: shape.variant,
    frameSize: shape.frameSize,
    cellWidth: shape.cellWidth,
    cellHeight: shape.cellHeight,
  }
}

/** Legacy frame edge in pixels (the 5x8 shape). New shapes carry their own `frameSize`. */
export const FRAME_SIZE = 2576

/** Default upper bound on archive frames carried per compaction. */
export const MAX_FRAMES_DEFAULT = 80

/** High-quality frames rendered at each chronological edge of a foveated archive. */
export const HQ_EDGE_FRAMES = 3

/** Conservative per-frame token estimate used for context budgeting. */
export const FRAME_TOKEN_ESTIMATE = 5024

/** Conservative upper bound for one persisted frame's base64 payload. */
export const FRAME_DATA_BYTES_ESTIMATE = 170_000

/** Maximum snapcompact image base64 carried in one rebuilt provider request. */
export const FRAME_DATA_BYTES_BUDGET = 3_000_000

/**
 * Frame-count cap implied by {@link FRAME_DATA_BYTES_BUDGET}.
 * @param maxFrameDataBytes - persisted image-byte budget.
 * @returns how many estimated frames fit in that budget.
 */
export function maxFramesForDataBudget(maxFrameDataBytes: number = FRAME_DATA_BYTES_BUDGET): number {
  return Math.max(1, Math.floor(maxFrameDataBytes / FRAME_DATA_BYTES_ESTIMATE))
}

/**
 * Per-request image-count budgets by provider id. Unknown providers fall to a
 * safe floor rather than sending unbounded attachments.
 */
export const PROVIDER_IMAGE_BUDGETS: Record<string, number> = {
  anthropic: 90,
  'amazon-bedrock': 90,
  openai: 200,
  'openai-codex': 200,
  google: 200,
  'google-vertex': 200,
  'google-gemini-cli': 200,
  openrouter: 90,
  umans: 10,
}

/** Safe floor for unknown providers. */
export const DEFAULT_PROVIDER_IMAGE_BUDGET = 5

/** Per-request image budget for `provider`; unknown providers get the floor. */
function providerImageBudget(provider: string | undefined): number {
  return (provider !== undefined ? PROVIDER_IMAGE_BUDGETS[provider] : undefined) ?? DEFAULT_PROVIDER_IMAGE_BUDGET
}

/**
 * Archive frame cap for `provider`: image budget, never above {@link MAX_FRAMES_DEFAULT}.
 * @param provider - provider id, or undefined for the floor.
 * @returns the frame cap.
 */
export function providerFrameBudget(provider: string | undefined): number {
  return Math.min(providerImageBudget(provider), MAX_FRAMES_DEFAULT)
}

const SUMMARY_TEMPLATE_TOKENS = 2000

/**
 * Frame cap that fits residual context after the kept tail, the text-edge
 * reserve, and one summary template. Returns 0 when there is no headroom,
 * and 1 when a single frame charge would overflow but a text-only archive
 * might still fit.
 * @param args - window, tokens already kept, reserve, model, and provider.
 * @returns how many frames the residual context can carry.
 */
export function computeSnapcompactMaxFrames(args: {
  readonly contextWindow: number
  readonly baseTokens: number
  readonly reserveTokens: number
  readonly model: SnapcompactModelTarget
  readonly provider?: string
}): number {
  const { contextWindow, baseTokens, reserveTokens, model, provider } = args
  if (contextWindow <= 0) {
    return Math.min(MAX_FRAMES_DEFAULT, maxFramesForDataBudget(), providerFrameBudget(provider))
  }
  const totalBudget = contextWindow - reserveTokens
  if (baseTokens >= totalBudget) return 0
  const edgeCap = geometry(resolveShape(model)).capacity
  const textEdgeTokens = Math.ceil((2 * edgeCap * 1.15) / 4)
  const frameBudget = totalBudget - baseTokens - (textEdgeTokens + SUMMARY_TEMPLATE_TOKENS)
  if (frameBudget < FRAME_TOKEN_ESTIMATE) return 1
  return Math.min(
    Math.floor(frameBudget / FRAME_TOKEN_ESTIMATE),
    MAX_FRAMES_DEFAULT,
    maxFramesForDataBudget(),
    providerFrameBudget(provider),
  )
}

// ============================================================================
// Transcript serialization
// ============================================================================

/** One content block inside a transcript message. */
export type TranscriptBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | { readonly type: 'tool-call'; readonly id: string; readonly name: string; readonly arguments: string }
  | { readonly type: 'image' }
  | { readonly type: 'file'; readonly name?: string }

/** One message in the span being archived. */
export interface TranscriptMessage {
  readonly role: 'user' | 'assistant' | 'tool'
  readonly blocks?: readonly TranscriptBlock[]
  readonly toolCallId?: string
  readonly isError?: boolean
  readonly text?: string
}

/** Default per-tool-result character cap in serialized history. */
export const TOOL_RESULT_MAX_CHARS = 2000

/** Default per-argument-value character cap inside serialized tool calls. */
export const TOOL_ARG_MAX_CHARS = 500

/** Default character cap across one tool call's full serialized argument list. */
export const TOOL_CALL_MAX_CHARS = 2000

/** Default fraction of a truncation budget spent on the head. */
export const TRUNCATE_HEAD_RATIO = 0.6

/** Zero-width ink toggles (shift-out/in). Text between them prints dim gray. */
export const DIM_ON = '\u000e'
const DIM_OFF = '\u000f'

/** Keep the head and tail of `text`, eliding the middle beyond `maxChars`. */
function truncateForSummary(text: string, maxChars: number, headRatio: number): string {
  if (text.length <= maxChars) return text
  const ratio = Math.min(Math.max(headRatio, 0), 1)
  const headChars = Math.round(maxChars * ratio)
  const tailChars = maxChars - headChars
  const elided = text.length - maxChars
  const tail = tailChars > 0 ? text.slice(-tailChars) : ''
  return `${text.slice(0, headChars)} […${elided}ch elided…] ${tail}`
}

/** One elision marker as emitted by {@link truncateForSummary} or after normalize. */
const ELIDED_MARKER = String.raw`\[(?:…|\.{3})\d+ch elided(?:…|\.{3})\]`

/** Unquoted RFC 2045 token used as a media-type parameter name or value. */
const MEDIA_TYPE_TOKEN = String.raw`[\w!#$%&'*+.^|~-]+`

const DATA_URL_ATOM = new RegExp(
  String.raw`data:([A-Za-z][\w.+-]*\/[\w.+-]+(?:;${MEDIA_TYPE_TOKEN}=${MEDIA_TYPE_TOKEN})*);base64,` +
    String.raw`([A-Za-z0-9+/=]*(?:\s*${ELIDED_MARKER}\s*[A-Za-z0-9+/=]*)?)` +
    String.raw`(\s*\))?`,
  'gi',
)

const ELIDED_MARKER_RE = new RegExp(String.raw`\s*${ELIDED_MARKER}\s*`)
const MARKDOWN_WHITESPACE_CHAR = /\s/
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/
const DAMAGED_PAYLOAD_MIN_CHARS = 40

type DataUrlContext = 'source' | 'archive'

function adjacentMarkdownOpenerStart(text: string, dataIndex: number, cursor: number): number | undefined {
  let i = dataIndex
  while (i > cursor && MARKDOWN_WHITESPACE_CHAR.test(text.charAt(i - 1))) i--
  if (i - 2 < cursor || text.charAt(i - 1) !== '(' || text.charAt(i - 2) !== ']') return undefined
  let opener = -1
  for (let j = i - 3; j >= cursor; j--) {
    const c = text.charAt(j)
    if (c === ']' || c === '\n') break
    if (c === '[') opener = j
  }
  if (opener < 0) return undefined
  return opener > cursor && text.charAt(opener - 1) === '!' ? opener - 1 : opener
}

/** Replace inline base64 data URLs with a deterministic placeholder. */
function elideDataUrls(text: string, context: DataUrlContext = 'source'): string {
  if (!/;base64,/i.test(text)) return text
  DATA_URL_ATOM.lastIndex = 0
  let match = DATA_URL_ATOM.exec(text)
  if (match === null) return text
  const out: string[] = []
  let cursor = 0
  while (match !== null) {
    const urlStart = match.index
    const urlEnd = urlStart + match[0].length
    const mime = match[1] ?? ''
    const payload = match[2] ?? ''
    const closer = match[3]
    const marker = ELIDED_MARKER_RE.exec(payload)
    const isAtom =
      context === 'archive' ||
      marker !== null ||
      CANONICAL_BASE64.test(payload) ||
      payload.length >= DAMAGED_PAYLOAD_MIN_CHARS
    if (!isAtom) {
      out.push(text.slice(cursor, urlEnd))
      cursor = urlEnd
    } else {
      const b64Chars = marker
        ? payload.length - marker[0].length + Number(/\d+/.exec(marker[0])?.[0] ?? 0)
        : payload.length
      const placeholder = `[data URL omitted: ${mime}, ${b64Chars} base64 chars]`
      const foundOpener = adjacentMarkdownOpenerStart(text, urlStart, cursor)
      const openerStart = foundOpener !== undefined && foundOpener >= cursor ? foundOpener : undefined
      const emitStart = openerStart ?? urlStart
      out.push(text.slice(cursor, emitStart))
      if (openerStart !== undefined && closer !== undefined) {
        out.push(placeholder)
      } else {
        const opener = openerStart !== undefined ? text.slice(openerStart, urlStart) : ''
        out.push(opener, placeholder, closer ?? '')
      }
      cursor = urlEnd
    }
    match = DATA_URL_ATOM.exec(text)
  }
  out.push(text.slice(cursor))
  return out.join('')
}

const DIM_MARKERS = /[\u000e\u000f]/g

function stripDimMarkers(text: string): string {
  return text.replace(DIM_MARKERS, '')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function blocksOf(message: TranscriptMessage): readonly TranscriptBlock[] {
  if (message.blocks && message.blocks.length > 0) return message.blocks
  if (message.text) return [{ type: 'text', text: message.text }]
  return []
}

function textFromBlocks(blocks: readonly TranscriptBlock[]): string {
  let out = ''
  for (const block of blocks) {
    if (block.type === 'text') out += block.text
  }
  return out
}

/** Serialize discarded history into the `¶user:` / `¶ai:` / `¶call:` transcript. */
function serializeConversation(messages: readonly TranscriptMessage[], includeThinking: boolean): string {
  const toolResultMaxChars = TOOL_RESULT_MAX_CHARS
  const toolArgMaxChars = TOOL_ARG_MAX_CHARS
  const toolCallMaxChars = TOOL_CALL_MAX_CHARS
  const headRatio = TRUNCATE_HEAD_RATIO
  const parts: string[] = []
  let lastPrefix: string | null = null

  const pushPart = (prefix: string, content: string) => {
    const lastIndex = parts.length - 1
    if (lastIndex >= 0 && lastPrefix === prefix) {
      const previous = parts[lastIndex] ?? ''
      const sep = previous.endsWith('\n') || content.startsWith('\n') ? '' : '\n'
      parts[lastIndex] = previous + sep + content
    } else {
      parts.push(prefix + content)
      lastPrefix = prefix
    }
  }

  const resultTextByCallId = new Map<string, string>()
  for (const msg of messages) {
    if (msg.role !== 'tool' || !msg.toolCallId) continue
    const text = textFromBlocks(blocksOf(msg))
    if (text) resultTextByCallId.set(msg.toolCallId, text)
  }

  const renderResultBlock = (rawText: string): string => {
    const body = truncateForSummary(elideDataUrls(stripDimMarkers(rawText)), toolResultMaxChars, headRatio)
    return `<out>\n${DIM_ON}${body}${DIM_OFF}\n</out>`
  }

  const formatArguments = (raw: string): string => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error: unknown) {
      // Tool arguments are model text, not guaranteed JSON. The raw string is the transcript.
      void error
      parsed = undefined
    }
    if (!isPlainRecord(parsed)) {
      return truncateForSummary(elideDataUrls(stripDimMarkers(raw)), toolCallMaxChars, headRatio)
    }
    return truncateForSummary(
      Object.entries(parsed)
        .map(([key, value]) => {
          const encoded = JSON.stringify(value)
          return `${key}=${truncateForSummary(elideDataUrls(encoded), toolArgMaxChars, headRatio)}`
        })
        .join(', '),
      toolCallMaxChars,
      headRatio,
    )
  }

  const mergedCallIds = new Set<string>()

  for (const msg of messages) {
    if (msg.role === 'user') {
      const content = stripDimMarkers(textFromBlocks(blocksOf(msg)))
      if (content) pushPart('¶user:', content)
    } else if (msg.role === 'assistant') {
      let pendingThinking: string[] = []
      let pendingText: string[] = []
      const flushAssistant = () => {
        if (pendingThinking.length > 0) pushPart('¶think:', pendingThinking.join('\n'))
        if (pendingText.length > 0) pushPart('¶ai:', pendingText.join('\n'))
        pendingThinking = []
        pendingText = []
      }
      for (const block of blocksOf(msg)) {
        switch (block.type) {
          case 'text': {
            const text = stripDimMarkers(block.text)
            if (text.trim()) pendingText.push(text)
            break
          }
          case 'reasoning': {
            if (!includeThinking) break
            const thinking = stripDimMarkers(block.text)
            if (thinking.trim()) pendingThinking.push(thinking)
            break
          }
          case 'tool-call': {
            flushAssistant()
            const lines = [`${block.name}(${formatArguments(block.arguments)})`]
            const resultText = resultTextByCallId.get(block.id)
            if (resultText !== undefined) {
              mergedCallIds.add(block.id)
              lines.push(renderResultBlock(resultText))
            }
            pushPart('¶call:', lines.join('\n'))
            break
          }
          case 'image':
          case 'file':
            // Images carry no transcript text. File paths come from filePaths.
            break
          default:
            // Open block set: future block kinds contribute no transcript text.
            break
        }
      }
      flushAssistant()
    } else {
      if (!msg.toolCallId || mergedCallIds.has(msg.toolCallId)) continue
      const resultText = resultTextByCallId.get(msg.toolCallId)
      if (resultText !== undefined) pushPart('¶call:', `\n${renderResultBlock(resultText)}`)
    }
  }

  return parts.join('\n\n')
}

// ============================================================================
// Text normalization
// ============================================================================

const CHAR_FOLD: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201a': "'",
  '\u201b': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u201e': '"',
  '\u2032': "'",
  '\u2033': '"',
  '\u2035': "'",
  '\u2036': '"',
  '\u2039': '<',
  '\u203a': '>',
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2212': '-',
  '\u2044': '/',
  '\u2024': '.',
  '\u2025': '..',
  '\u2026': '...',
  '\u22ef': '...',
  '\u2022': '*',
  '\u2023': '*',
  '\u2043': '-',
  '\u2219': '*',
  '\u25cf': '*',
  '\u25a0': '*',
  '\u25aa': '*',
  '\u2190': '<-',
  '\u2191': '^',
  '\u2192': '->',
  '\u2193': 'v',
  '\u2194': '<->',
  '\u21d0': '<=',
  '\u21d2': '=>',
  '\u21d4': '<=>',
  '\u2713': 'v',
  '\u2714': 'v',
  '\u2717': 'x',
  '\u2718': 'x',
}

/** Printed in place of newline runs. The renderer fills this cell with black ink. */
export const NEWLINE_GLYPH = '\u2588'

const COLLAPSIBLE = /[\s\p{Cf}]+/gu
const LINE_BREAK = /[\n\r\u2028\u2029]/
const EDGE_RUNS = /^[ \u2588]+|[ \u2588]+$/g
const UNRENDERABLE = /[\p{Cc}\p{Mn}\p{Me}\p{Cs}]/u
const COMBINING_MARKS = /\p{M}+/gu

const EMOJI_FOLD: Record<string, string> = {
  '✅': '[OK]',
  '☑': '[OK]',
  '✔': '[OK]',
  '❌': '[FAIL]',
  '❎': '[FAIL]',
  '✖': '[FAIL]',
  '⚠': '[WARN]',
  '🚨': '[ALERT]',
  'ℹ': '[INFO]',
  '🐛': '[BUG]',
  '💥': '[CRASH]',
  '🔥': '[HOT]',
  '🔒': '[LOCK]',
  '🔓': '[UNLOCK]',
  '📁': '[DIR]',
  '📂': '[DIR]',
  '📄': '[FILE]',
  '📝': '[NOTE]',
  '🧪': '[TEST]',
  '⏳': '[WAIT]',
  '⌛': '[WAIT]',
  '🚀': '[RUN]',
}

const EMOJI_PICTOGRAPH = /\p{Extended_Pictographic}/u

/** Raster used to measure glyphs and encode frames. Tests inject a fake. */
export interface SnapcompactRaster {
  renderPng(text: string, options: SnapcompactRenderOptions): Promise<string>
  supportedChars(font: string, chars: string): string
}

const defaultRaster: SnapcompactRaster = {
  renderPng: renderSnapcompactPng,
  supportedChars: snapcompactSupportedChars,
}

/** Options for {@link normalize}. */
export interface NormalizeOptions {
  /** Shape whose font is tried before the embedded Silver fallback. */
  shape?: Pick<Shape, 'font'>
  /** Font name when a full shape is not available. */
  font?: string
  /** Glyph coverage probe. Defaults to the real renderer. */
  raster?: SnapcompactRaster
}

interface NormalizedText {
  text: string
  totalGraphics: number
  fallbackCount: number
}

/** CSI, OSC, and single-character ANSI escapes. Replaces `Bun.stripANSI`. */
function stripAnsi(text: string): string {
  return text.replace(
    /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001B\\))/g,
    '',
  )
}

function isAsciiOrLatin1(cp: number): boolean {
  return (cp >= 0x20 && cp < 0x7f) || (cp >= 0xa0 && cp <= 0xff)
}

function foldToAscii(ch: string): string | undefined {
  const decomposed = ch.normalize('NFKD').replace(COMBINING_MARKS, '')
  if (decomposed === ch) return undefined
  let out = ''
  for (const part of decomposed) {
    const cp = part.codePointAt(0)
    if (cp !== undefined && isAsciiOrLatin1(cp)) {
      out += part
      continue
    }
    const fold = CHAR_FOLD[part]
    if (fold === undefined) return undefined
    out += fold
  }
  return out
}

function renderableUnicodeChars(
  chars: readonly string[],
  font: string | undefined,
  raster: SnapcompactRaster,
): ReadonlySet<string> {
  if (chars.length === 0) return new Set()
  const text = chars.join('')
  const primaryFont = font ?? '5x8'
  const supported = new Set(raster.supportedChars(primaryFont, text))
  if (primaryFont !== 'silver') {
    for (const ch of raster.supportedChars('silver', text)) supported.add(ch)
  }
  return supported
}

function charsOf(text: string): string[] {
  const chars: string[] = []
  for (const ch of text) chars.push(ch)
  return chars
}

function normalizedInputChars(text: string): string[] {
  const stripped = text.includes('\u001b') ? stripAnsi(text) : text
  const collapsed = stripped
    .replace(COLLAPSIBLE, run => (LINE_BREAK.test(run) ? NEWLINE_GLYPH : /[^\p{Cf}]/u.test(run) ? ' ' : ''))
    .replace(EDGE_RUNS, '')
  return charsOf(collapsed)
}

function candidateUnicodeChars(chars: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const ch of chars) {
    const cp = ch.codePointAt(0)
    if (cp === undefined || isAsciiOrLatin1(cp) || ch === DIM_ON || ch === DIM_OFF || ch === NEWLINE_GLYPH) {
      continue
    }
    if (
      CHAR_FOLD[ch] !== undefined ||
      (cp >= 0x2500 && cp <= 0x257f) ||
      EMOJI_FOLD[ch] !== undefined ||
      EMOJI_PICTOGRAPH.test(ch) ||
      foldToAscii(ch) !== undefined ||
      UNRENDERABLE.test(ch)
    ) {
      continue
    }
    unique.add(ch)
  }
  return [...unique]
}

function normalizeWithStats(text: string, options?: NormalizeOptions): NormalizedText {
  const chars = normalizedInputChars(text)
  const font = options?.font ?? options?.shape?.font
  const supported = renderableUnicodeChars(candidateUnicodeChars(chars), font, options?.raster ?? defaultRaster)
  const out: string[] = []
  let totalGraphics = 0
  let fallbackCount = 0

  for (const ch of chars) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    if (isAsciiOrLatin1(cp)) {
      out.push(ch)
      totalGraphics++
      continue
    }
    if (ch === DIM_ON || ch === DIM_OFF || ch === NEWLINE_GLYPH) {
      out.push(ch)
      continue
    }
    const emoji = EMOJI_FOLD[ch]
    if (emoji !== undefined) {
      out.push(emoji)
      totalGraphics++
      continue
    }
    const fold = CHAR_FOLD[ch]
    if (fold !== undefined) {
      out.push(fold)
      totalGraphics++
      continue
    }
    if (cp >= 0x2500 && cp <= 0x257f) {
      out.push(cp === 0x2502 || cp === 0x2503 ? '|' : cp === 0x2500 || cp === 0x2501 ? '-' : '+')
      totalGraphics++
      continue
    }
    if (!EMOJI_PICTOGRAPH.test(ch) && supported.has(ch)) {
      out.push(ch)
      totalGraphics++
      continue
    }
    const folded = foldToAscii(ch)
    if (folded !== undefined) {
      out.push(folded)
      totalGraphics++
    } else if (EMOJI_PICTOGRAPH.test(ch)) {
      // Decorative pictographs drop instead of printing `?`.
    } else if (!UNRENDERABLE.test(ch)) {
      out.push('?')
      totalGraphics++
      fallbackCount++
    }
  }

  return { text: out.join('').replace(/ +/g, ' ').replace(EDGE_RUNS, ''), totalGraphics, fallbackCount }
}

/**
 * Prepare text for printing: strip ANSI, collapse whitespace, fold unsupported
 * symbols, and keep Unicode glyphs the selected font or Silver can draw.
 * @param text - source text.
 * @param options - font and raster used to decide which glyphs survive.
 * @returns text the rasterizer can draw.
 */
export function normalize(text: string, options?: NormalizeOptions): string {
  return normalizeWithStats(text, options).text
}

/**
 * Scan text with the same font-aware path as {@link normalize}. Unsafe means
 * more than 5% of graphic characters would hit the `?` fallback.
 */
function scanRenderability(
  text: string,
  options?: NormalizeOptions,
): { isSafe: boolean; unrenderableRatio: number } {
  const normalized = normalizeWithStats(text, options)
  const unrenderableRatio = normalized.totalGraphics > 0 ? normalized.fallbackCount / normalized.totalGraphics : 0
  return { isSafe: unrenderableRatio <= 0.05, unrenderableRatio }
}

const CJK_HEAVY_MIN_WIDE_CHARS = 8
const CJK_HEAVY_WIDE_RATIO = 0.25

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x2eff) ||
    (cp >= 0x2f00 && cp <= 0x2fdf) ||
    (cp >= 0x3000 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd)
  )
}

function isCjkHeavyText(text: string): boolean {
  const chars = normalizedInputChars(text)
  let graphicChars = 0
  let wideChars = 0
  for (const ch of chars) {
    if (ch === ' ' || ch === DIM_ON || ch === DIM_OFF || ch === NEWLINE_GLYPH) continue
    const cp = ch.codePointAt(0)
    if (cp === undefined || UNRENDERABLE.test(ch)) continue
    graphicChars++
    if (isWideCodePoint(cp)) wideChars++
  }
  return graphicChars > 0 && wideChars >= CJK_HEAVY_MIN_WIDE_CHARS && wideChars / graphicChars >= CJK_HEAVY_WIDE_RATIO
}

/**
 * Pick the frame shape for `text`. Auto resolves the model default, then the
 * Silver CJK grid when the default font cannot safely render the text.
 */
function resolveShapeForText(text: string, model?: SnapcompactModelTarget, raster?: SnapcompactRaster): Shape {
  const shape = resolveShape(model)
  const probe = raster ? { raster } : undefined
  const silver = priceShape(
    { ...SHAPE_VARIANTS['silver16-bw'], frameSize: shape.frameSize },
    billingFamily(model?.api),
  )
  if (!scanRenderability(text, { ...probe, shape }).isSafe) {
    return scanRenderability(text, { ...probe, shape: silver }).isSafe ? silver : shape
  }
  return shape.font !== 'silver' && isCjkHeavyText(text) && scanRenderability(text, { ...probe, shape: silver }).isSafe
    ? silver
    : shape
}

// ============================================================================
// Stopwords, wrap, pagination
// ============================================================================

const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'the a an and or of to in on at as is are was were be been by for with that this it its from had has have not but ' +
    'he she his her they their them which also who whom when where while will would could should there then than ' +
    'into over under about after before between during each such these those some most more other only same so'
  ).split(' '),
)

const ALPHA_RUN = /[a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]+/g
const DIM_MARKER_SPLIT = /([\u000e\u000f])/

/** Wrap stopwords in dim toggles. Spans that are already dim pass through. */
function dimStopwords(text: string): string {
  const parts = text.split(DIM_MARKER_SPLIT)
  let dim = false
  let out = ''
  for (const part of parts) {
    if (part === DIM_ON) {
      dim = true
      out += part
    } else if (part === DIM_OFF) {
      dim = false
      out += part
    } else if (dim) {
      out += part
    } else {
      out += part.replace(ALPHA_RUN, word => (STOPWORDS.has(word.toLowerCase()) ? DIM_ON + word + DIM_OFF : word))
    }
  }
  return out
}

/** Char cells between the two doc columns. */
const DOC_GUTTER = 3

function charCells(ch: string, wideCells: boolean): number {
  if (ch === DIM_ON || ch === DIM_OFF) return 0
  const cp = ch.codePointAt(0)
  return wideCells && cp !== undefined && isWideCodePoint(cp) ? 2 : 1
}

function usesWideCells(shape: Pick<Shape, 'font'>): boolean {
  return shape.font !== 'silver'
}

function cellLength(text: string, wideCells: boolean): number {
  let cells = 0
  for (const ch of text) cells += charCells(ch, wideCells)
  return cells
}

function sliceCells(text: string, width: number, wideCells: boolean): string {
  let cells = 0
  let out = ''
  let placed = false
  for (const ch of text) {
    const w = charCells(ch, wideCells)
    if (placed && cells + w > width) break
    out += ch
    cells += w
    if (w > 0) placed = true
  }
  return out
}

/** Split `text` into pages that each fill at most `capacity` grid cells. */
function paginateCells(text: string, capacity: number, cols: number, wideCells: boolean): string[] {
  const chars = charsOf(text)
  const pages: string[] = []
  let start = 0
  let cell = 0
  let hasCell = false
  for (let i = 0; i < chars.length; i++) {
    const w = charCells(chars[i] ?? '', wideCells)
    if (w === 0) continue
    let at = cell
    if (w === 2 && cols >= 2 && at % cols === cols - 1) at += 1
    if (hasCell && at + w > capacity) {
      pages.push(chars.slice(start, i).join(''))
      start = i
      at = 0
    }
    cell = at + w
    hasCell = true
  }
  if (hasCell) pages.push(chars.slice(start).join(''))
  return pages
}

/**
 * Greedy word-wrap, no mid-word breaks (hard split only for width+ words).
 */
function wrap(text: string, width: number, wideCells = false): string[] {
  const lines: string[] = []
  let cur = ''
  let curCells = 0
  for (const token of text.split(/\s+/)) {
    if (token.length === 0) continue
    let word = token
    let wordCells = cellLength(word, wideCells)
    while (wordCells > width) {
      if (cur) {
        lines.push(cur)
        cur = ''
        curCells = 0
      }
      const head = sliceCells(word, width, wideCells)
      lines.push(head)
      word = word.slice(head.length)
      wordCells = cellLength(word, wideCells)
    }
    if (!cur) {
      cur = word
      curCells = wordCells
    } else if (curCells + 1 + wordCells <= width) {
      cur += ` ${word}`
      curCells += 1 + wordCells
    } else {
      lines.push(cur)
      cur = word
      curCells = wordCells
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** Columns, rows, and character capacity of one frame. */
export interface Geometry {
  cols: number
  rows: number
  capacity: number
}

/** Paginate already-normalized text for a two-column doc shape. */
function docPages(normalized: string, geo: Geometry, wideCells: boolean): string[] {
  const lines = wrap(normalized, geo.cols, wideCells)
  const perPage = 2 * geo.rows
  const pages: string[] = []
  for (let offset = 0; offset < lines.length; offset += perPage) {
    pages.push(lines.slice(offset, offset + perPage).join('\n'))
  }
  return pages
}

/** Grid geometry for `shape` at `size` (defaults to the shape's frame size). */
function geometry(shape: Shape, size: number = shape.frameSize): Geometry {
  const gridCols = Math.floor(size / shape.cellWidth)
  const rows = Math.floor(size / shape.cellHeight / shape.lineRepeat)
  if (shape.columns === 2) {
    const cols = Math.floor((gridCols - DOC_GUTTER) / 2)
    return { cols, rows, capacity: 2 * cols * rows }
  }
  return { cols: gridCols, rows, capacity: gridCols * rows }
}

const NEWLINES = /\n/g

function nativeRenderOptions(shape: Shape, size: number): SnapcompactRenderOptions {
  return {
    size,
    font: shape.font,
    cellWidth: shape.cellWidth,
    cellHeight: shape.cellHeight,
    variant: shape.variant,
    lineRepeat: shape.lineRepeat,
    ...shape.stretch === undefined ? {} : { stretch: shape.stretch },
    ...shape.columns === 2 ? { columns: 2 as const } : {},
  }
}

function renderedChars(text: string, shape: Shape, geo: Geometry): number {
  if (shape.columns === 2) {
    let visible = charsOf(text).length - (text.match(DIM_MARKERS)?.length ?? 0)
    visible -= text.match(NEWLINES)?.length ?? 0
    return Math.min(visible, geo.capacity)
  }
  const wideCells = usesWideCells(shape)
  let cell = 0
  let count = 0
  for (const ch of text) {
    const w = charCells(ch, wideCells)
    if (w === 0) continue
    let at = cell
    if (w === 2 && geo.cols >= 2 && at % geo.cols === geo.cols - 1) at += 1
    if (at + w > geo.capacity) break
    cell = at + w
    count++
  }
  return count
}

interface RenderedFrame {
  data: string
  cols: number
  rows: number
  chars: number
}

async function render(
  text: string,
  shape: Shape,
  raster: SnapcompactRaster,
  size: number = shape.frameSize,
): Promise<RenderedFrame> {
  const geo = geometry(shape, size)
  const chars = renderedChars(text, shape, geo)
  const data = await raster.renderPng(text, nativeRenderOptions(shape, size))
  return { data, cols: geo.cols, rows: geo.rows, chars }
}

// ============================================================================
// Archive planning
// ============================================================================

/** Plain-text history kept verbatim at each chronological edge, in HQ pages. */
const TEXT_EDGE_PAGES = 1

function toPlainText(text: string): string {
  return stripDimMarkers(text).replaceAll(NEWLINE_GLYPH, '\n')
}

/** One block of a compaction summary: reading text or one PNG frame. */
export interface SnapcompactHistoryBlock {
  readonly type: 'text' | 'image'
  readonly text?: string
  readonly pngBase64?: string
}

/** One developed frame returned to the caller. Every rendered frame is kept. */
export interface SnapcompactFrameRecord {
  readonly pngBase64: string
  readonly cols: number
  readonly rows: number
  readonly chars: number
  readonly font: string
  readonly variant: string
}

interface StoredFrame {
  data: string
  cols: number
  rows: number
  chars: number
  font: string
  variant: string
}

interface StoredArchive {
  frames: StoredFrame[]
  textHead: string
  textTail: string
  truncatedChars: number
}

/** Ordered blocks: oldest text, imaged middle, newest text. */
function historyBlocks(archive: StoredArchive): SnapcompactHistoryBlock[] {
  const blocks: SnapcompactHistoryBlock[] = []
  const hasImages = archive.frames.length > 0
  if (archive.textHead) {
    const suffix = hasImages ? '\n-------------- imaged middle below\n' : ''
    blocks.push({ type: 'text', text: elideDataUrls(toPlainText(archive.textHead), 'archive') + suffix })
  }
  for (const frame of archive.frames) {
    blocks.push({ type: 'image', pngBase64: frame.data })
  }
  if (archive.textTail) {
    const prefix = hasImages
      ? '-------------- imaged middle above\n'
      : archive.truncatedChars > 0
        ? '\n-------------- middle history omitted above\n'
        : ''
    const tail = prefix + elideDataUrls(toPlainText(archive.textTail), 'archive')
    const lastBlock = blocks[blocks.length - 1]
    if (lastBlock?.type === 'text') {
      blocks[blocks.length - 1] = { type: 'text', text: (lastBlock.text ?? '') + tail }
    } else {
      blocks.push({ type: 'text', text: tail })
    }
  }
  return blocks
}

/** Denser companion of `high` for the foveated middle. Same bill, tighter cell. */
function denseCompanion(high: Shape, api: SnapcompactWireApi | undefined): Shape {
  if (high.columns === 2 || high.font === 'silver') return high
  const family = billingFamily(api)
  const low = priceShape({ ...SHAPE_VARIANTS[FAMILY_VARIANT_LOW[family]], frameSize: high.frameSize }, family)
  return geometry(low).capacity > geometry(high).capacity ? low : high
}

interface PlanFrame {
  text: string
  shape: Shape
}

interface ArchiveLayout {
  frames: PlanFrame[]
  textHead: string
  textTail: string
  keptText: string
  truncatedChars: number
}

function planFrames(pages: readonly string[], shape: Shape): PlanFrame[] {
  return pages.map(text => ({ text, shape }))
}

/**
 * Text at both chronological edges, images in the middle. When the middle
 * overflows `maxFrames`, foveate it (HQ/LQ/HQ) and drop the oldest dense slice.
 */
function planArchive(text: string, high: Shape, low: Shape, maxFrames: number): ArchiveLayout {
  const capHi = geometry(high).capacity
  const edgeCap = TEXT_EDGE_PAGES * capHi
  if (text.length <= 2 * edgeCap) {
    return { frames: [], textHead: text, textTail: '', keptText: text, truncatedChars: 0 }
  }
  if (maxFrames < 1) {
    const textHead = text.slice(0, edgeCap)
    const textTail = text.slice(text.length - edgeCap)
    return {
      frames: [],
      textHead,
      textTail,
      keptText: textHead + textTail,
      truncatedChars: text.length - textHead.length - textTail.length,
    }
  }

  const textHead = text.slice(0, edgeCap)
  const textTail = text.slice(text.length - edgeCap)
  const imageText = text.slice(edgeCap, text.length - edgeCap)
  if (imageText.length === 0) {
    return { frames: [], textHead: text, textTail: '', keptText: text, truncatedChars: 0 }
  }

  if (high.columns === 2) {
    const pages = docPages(imageText, geometry(high), usesWideCells(high))
    let kept = pages
    let truncatedChars = 0
    if (pages.length > maxFrames) {
      const dropped = pages.slice(1, pages.length - (maxFrames - 1))
      truncatedChars = dropped.reduce((sum, page) => sum + page.length, 0)
      kept = [...pages.slice(0, 1), ...pages.slice(pages.length - (maxFrames - 1))]
    }
    const flat = kept.map(page => page.replaceAll('\n', ' ')).join(' ')
    return {
      frames: planFrames(kept, high),
      textHead,
      textTail,
      keptText: textHead + flat + textTail,
      truncatedChars,
    }
  }

  const hiPages = paginateCells(imageText, capHi, geometry(high).cols, usesWideCells(high))
  if (hiPages.length <= maxFrames) {
    return {
      frames: planFrames(hiPages, high),
      textHead,
      textTail,
      keptText: textHead + imageText + textTail,
      truncatedChars: 0,
    }
  }

  const capLo = geometry(low).capacity
  const imageEdgeFrames = Math.min(HQ_EDGE_FRAMES, Math.floor((maxFrames - 1) / 2))
  const headPages = hiPages.slice(0, imageEdgeFrames)
  const tailPages = imageEdgeFrames > 0 ? hiPages.slice(hiPages.length - imageEdgeFrames) : []
  const imageHead = headPages.join('')
  const imageTail = tailPages.join('')
  const middleSource = imageText.slice(imageHead.length, imageText.length - imageTail.length)
  let middlePages = paginateCells(middleSource, capLo, geometry(low).cols, usesWideCells(low))
  const middleBudget = maxFrames - 2 * imageEdgeFrames
  let truncatedChars = 0
  let middleText = middleSource
  if (middlePages.length > middleBudget) {
    const dropped = middlePages.slice(0, middlePages.length - middleBudget).join('')
    truncatedChars = dropped.length
    middleText = middleSource.slice(dropped.length)
    middlePages = middlePages.slice(middlePages.length - middleBudget)
  }
  return {
    frames: [...planFrames(headPages, high), ...planFrames(middlePages, low), ...planFrames(tailPages, high)],
    textHead,
    textTail,
    keptText: textHead + imageHead + middleText + imageTail + textTail,
    truncatedChars,
  }
}

/**
 * Drop `¶think:` sections from serialized archive source text. Only sections
 * that start with `¶think:` at a section boundary are removed.
 */
function stripThinkingSections(text: string): string {
  return text
    .split(NEWLINE_GLYPH)
    .map(segment =>
      segment
        .split(/\n\n(?=¶(?:user|think|ai|call):)/)
        .filter(section => !section.startsWith('¶think:'))
        .join('\n\n'),
    )
    .filter(segment => segment.length > 0)
    .join(NEWLINE_GLYPH)
}

type TemplateValue = string | number | boolean | undefined

/** Substitute `{{name}}` and `{{#if name}}...{{else}}...{{/if}}` in the summary template. */
function renderTemplate(template: string, vars: Record<string, TemplateValue>): string {
  const render = (src: string): string => {
    let out = ''
    let i = 0
    while (i < src.length) {
      const open = src.indexOf('{{', i)
      if (open < 0) {
        out += src.slice(i)
        break
      }
      out += src.slice(i, open)
      if (src.startsWith('{{#if ', open)) {
        const nameEnd = src.indexOf('}}', open)
        const name = src.slice(open + 6, nameEnd).trim()
        let depth = 1
        let j = nameEnd + 2
        let elseAt = -1
        let end = -1
        while (j < src.length) {
          const nextIf = src.indexOf('{{#if ', j)
          const nextElse = src.indexOf('{{else}}', j)
          const nextEnd = src.indexOf('{{/if}}', j)
          if (nextEnd < 0) break
          const ifFirst = nextIf >= 0 && nextIf < nextEnd && (nextElse < 0 || nextIf < nextElse)
          if (ifFirst) {
            depth++
            j = nextIf + 6
            continue
          }
          if (depth === 1 && nextElse >= 0 && nextElse < nextEnd) {
            elseAt = nextElse
            j = nextElse + 8
            continue
          }
          depth--
          if (depth === 0) {
            end = nextEnd
            break
          }
          j = nextEnd + 7
        }
        if (end < 0) {
          out += src.slice(open)
          break
        }
        const truthy = Boolean(vars[name])
        if (elseAt >= 0) {
          const inner = src.slice(nameEnd + 2, elseAt)
          const alt = src.slice(elseAt + 8, end)
          out += render(truthy ? inner : alt)
        } else if (truthy) {
          out += render(src.slice(nameEnd + 2, end))
        }
        i = end + '{{/if}}'.length
      } else {
        const nameEnd = src.indexOf('}}', open)
        const name = src.slice(open + 2, nameEnd).trim()
        const value = vars[name]
        out += value === undefined || typeof value === 'boolean' ? '' : String(value)
        i = nameEnd + 2
      }
    }
    return out
  }
  return render(template)
}

function formatFilePaths(filePaths: readonly string[]): string {
  return [...new Set(filePaths)].sort().join('\n')
}

/** Input to one local snapcompact pass. */
export interface SnapcompactRequest {
  readonly messages: readonly TranscriptMessage[]
  readonly previous?:
    | { readonly kind: 'soft'; readonly summary: string }
    | { readonly kind: 'snapcompact'; readonly sourceText: string }
  readonly model: SnapcompactModelTarget
  readonly includeThinking: boolean
  readonly maxFrames: number
  readonly filePaths: readonly string[]
  readonly raster?: SnapcompactRaster
}

/** Local archive of one discarded span. */
export interface SnapcompactResult {
  /** Reading-instructions text from the summary template. */
  readonly summary: string
  /** textHead, PNG frames, textTail, in that order. */
  readonly blocks: readonly SnapcompactHistoryBlock[]
  /** Kept source text for a later unfold. Not PNG bytes. */
  readonly sourceText: string
  readonly frames: readonly SnapcompactFrameRecord[]
  readonly truncatedChars: number
  readonly frameDataBytes: number
}

/**
 * Archive `request.messages` into plain-text edges and bitmap frames.
 * A previous snapcompact archive is unfolded from its source text and
 * re-rendered with the new span. A previous soft summary is prepended as text.
 * Rendered frames are all returned; the caller enforces the byte budget.
 * @param request - discarded messages, model, and optional previous archive.
 * @returns summary text, frames, and the source kept for a later unfold.
 */
export async function compactSnapcompact(request: SnapcompactRequest): Promise<SnapcompactResult> {
  const raster = request.raster ?? defaultRaster
  const serialized = serializeConversation(request.messages, request.includeThinking)
  const previousSource = request.previous?.kind === 'snapcompact' ? request.previous.sourceText : ''
  const previousSummary = request.previous?.kind === 'soft' ? request.previous.summary : undefined
  const previousTextHealed = elideDataUrls(previousSource, 'archive')
  const previousText =
    !request.includeThinking && previousTextHealed.length > 0
      ? stripThinkingSections(previousTextHealed)
      : previousTextHealed
  const hasPreviousText = previousText.length > 0
  const includedPreviousSummary = !hasPreviousText && !!previousSummary
  const shapeProbe = hasPreviousText
    ? `${previousText}${NEWLINE_GLYPH}${serialized}`
    : previousSummary
      ? `${previousSummary}${NEWLINE_GLYPH}${serialized}`
      : serialized
  const baseShape = resolveShapeForText(shapeProbe, request.model, raster)
  const high = baseShape
  const low = denseCompanion(high, request.model.api)
  const geo = geometry(high)
  const maxFrames = Math.max(1, Math.min(request.maxFrames, MAX_FRAMES_DEFAULT))

  let archiveText = normalize(serialized, { shape: high, raster })
  if (includedPreviousSummary && previousSummary) {
    const head = `[Summary of earlier history] ${normalize(previousSummary, { shape: high, raster })}`
    archiveText = archiveText.length > 0 ? `${head} [Recent conversation] ${archiveText}` : head
  }
  if (hasPreviousText) {
    archiveText = archiveText.length > 0 ? `${previousText}${NEWLINE_GLYPH}${archiveText}` : previousText
  }
  archiveText = elideDataUrls(archiveText)

  const layout = planArchive(archiveText, high, low, maxFrames)
  const truncatedChars = layout.truncatedChars

  let dimOpen = layout.textHead.lastIndexOf(DIM_ON) > layout.textHead.lastIndexOf(DIM_OFF)
  const pages: { text: string; shape: Shape }[] = []
  for (const planned of layout.frames) {
    let pageText = dimOpen ? DIM_ON + planned.text : planned.text
    dimOpen = pageText.lastIndexOf(DIM_ON) > pageText.lastIndexOf(DIM_OFF)
    if (planned.shape.stopwordDim) pageText = dimStopwords(pageText)
    pages.push({ text: pageText, shape: planned.shape })
  }
  const rendered = await Promise.all(pages.map(async (page) => {
    const frame = await render(page.text, page.shape, raster)
    return {
      pngBase64: frame.data,
      cols: frame.cols,
      rows: frame.rows,
      chars: frame.chars,
      font: page.shape.font,
      variant: page.shape.variant,
    } satisfies SnapcompactFrameRecord
  }))

  const textHead = layout.textHead
  const textTail = layout.textTail.length > 0 ? (dimOpen ? DIM_ON : '') + layout.textTail : ''
  const frames = rendered
  const frameCols: number[] = []
  for (const frame of frames) {
    if (!frameCols.includes(frame.cols)) frameCols.push(frame.cols)
  }
  const summaryCols = frameCols.length > 0 ? frameCols.join(' or ') : String(geo.cols)
  const files = formatFilePaths(request.filePaths)
  const stored: StoredArchive = {
    frames: frames.map(frame => ({
      data: frame.pngBase64,
      cols: frame.cols,
      rows: frame.rows,
      chars: frame.chars,
      font: frame.font,
      variant: frame.variant,
    })),
    textHead,
    textTail,
    truncatedChars,
  }
  const blocks = historyBlocks(stored)
  const sourceText =
    layout.keptText.length > 0 && layout.textTail.length > 0
      ? `${layout.keptText.slice(0, layout.keptText.length - layout.textTail.length)}${textTail}`
      : layout.keptText

  let summary: string
  if (frames.length === 0 && textHead.length === 0 && textTail.length === 0 && files.length === 0) {
    summary = 'No prior history.'
  } else {
    summary = renderTemplate(SUMMARY_TEMPLATE, {
      frameCount: frames.length,
      docColumns: high.columns === 2,
      cols: summaryCols,
      rows: geo.rows,
      sentenceInk: high.variant === 'sent',
      stopwordDimmed: high.stopwordDim === true,
      lineRepeated: high.lineRepeat > 1,
      truncatedChars,
      includedPreviousSummary,
      files: files.length > 0 ? files : undefined,
      includeThinking: request.includeThinking,
    })
  }

  const frameDataBytes = frames.reduce((sum, frame) => sum + frame.pngBase64.length, 0)
  return { summary, blocks, sourceText, frames, truncatedChars, frameDataBytes }
}
