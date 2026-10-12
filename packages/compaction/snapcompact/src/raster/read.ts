/**
 * Indexed reads for dense raster buffers.
 * A missing entry is a raster bug, not an absent pixel.
 */

/**
 * Read one numeric buffer entry.
 * @param values - dense numeric buffer.
 * @param index - in-range index.
 * @returns the entry.
 */
export function at(values: ArrayLike<number>, index: number): number {
  const value = values[index]
  if (value === undefined) throw new Error(`snapcompact: missing buffer index ${index}`)
  return value
}

/**
 * Read one list entry.
 * @param values - dense list.
 * @param index - in-range index.
 * @returns the entry.
 */
export function item<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) throw new Error(`snapcompact: missing list index ${index}`)
  return value
}

/**
 * First code point of one character yielded by a string iterator.
 * @param text - one iterator character.
 * @returns its code point.
 */
export function codePoint(text: string): number {
  const code = text.codePointAt(0)
  if (code === undefined) throw new Error('snapcompact: empty character')
  return code
}
