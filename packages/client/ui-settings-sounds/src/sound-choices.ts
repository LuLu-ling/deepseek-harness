/** Closed set of prompt-sound ids, in menu order. `none` is silence. */

export const SOUND_IDS = [
  'alert-01',
  'alert-02',
  'alert-03',
  'alert-04',
  'alert-05',
  'alert-06',
  'alert-07',
  'alert-08',
  'alert-09',
  'alert-10',
  'bip-bop-01',
  'bip-bop-02',
  'bip-bop-03',
  'bip-bop-04',
  'bip-bop-05',
  'bip-bop-06',
  'bip-bop-07',
  'bip-bop-08',
  'bip-bop-09',
  'bip-bop-10',
  'staplebops-01',
  'staplebops-02',
  'staplebops-03',
  'staplebops-04',
  'staplebops-05',
  'staplebops-06',
  'staplebops-07',
  'nope-01',
  'nope-02',
  'nope-03',
  'nope-04',
  'nope-05',
  'nope-06',
  'nope-07',
  'nope-08',
  'nope-09',
  'nope-10',
  'nope-11',
  'nope-12',
  'yup-01',
  'yup-02',
  'yup-03',
  'yup-04',
  'yup-05',
  'yup-06',
  'jj-01',
  'jj-02',
  'jj-03',
] as const

/** One playable prompt sound, without the silence value. */
export type SoundId = (typeof SOUND_IDS)[number]

/** Silence plus every playable id, menu order. */
export const SOUND_CHOICES = [
  'none',
  'alert-01',
  'alert-02',
  'alert-03',
  'alert-04',
  'alert-05',
  'alert-06',
  'alert-07',
  'alert-08',
  'alert-09',
  'alert-10',
  'bip-bop-01',
  'bip-bop-02',
  'bip-bop-03',
  'bip-bop-04',
  'bip-bop-05',
  'bip-bop-06',
  'bip-bop-07',
  'bip-bop-08',
  'bip-bop-09',
  'bip-bop-10',
  'staplebops-01',
  'staplebops-02',
  'staplebops-03',
  'staplebops-04',
  'staplebops-05',
  'staplebops-06',
  'staplebops-07',
  'nope-01',
  'nope-02',
  'nope-03',
  'nope-04',
  'nope-05',
  'nope-06',
  'nope-07',
  'nope-08',
  'nope-09',
  'nope-10',
  'nope-11',
  'nope-12',
  'yup-01',
  'yup-02',
  'yup-03',
  'yup-04',
  'yup-05',
  'yup-06',
  'jj-01',
  'jj-02',
  'jj-03',
] as const

/** A saved prompt-sound field: silence or one playable id. */
export type SoundChoice = (typeof SOUND_CHOICES)[number]

/**
 * Whether a string is a shipped playable id.
 * @param value - candidate id.
 * @returns true when the id names a shipped file.
 */
export function isSoundId(value: string): value is SoundId {
  return (SOUND_IDS as readonly string[]).includes(value)
}

/**
 * Whether a string is silence or a playable id.
 * @param value - candidate field value.
 * @returns true when the schema accepts it.
 */
export function isSoundChoice(value: string): value is SoundChoice {
  return value === 'none' || (SOUND_IDS as readonly string[]).includes(value)
}
