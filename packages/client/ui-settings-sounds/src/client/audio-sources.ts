/** Shipped prompt sounds, keyed by id. The client bundle inlines each file as a data URL. */
import type { SoundId } from '../sound-choices.ts'
import alert_01 from './assets/alert-01.aac'
import alert_02 from './assets/alert-02.aac'
import alert_03 from './assets/alert-03.aac'
import alert_04 from './assets/alert-04.aac'
import alert_05 from './assets/alert-05.aac'
import alert_06 from './assets/alert-06.aac'
import alert_07 from './assets/alert-07.aac'
import alert_08 from './assets/alert-08.aac'
import alert_09 from './assets/alert-09.aac'
import alert_10 from './assets/alert-10.aac'
import bip_bop_01 from './assets/bip-bop-01.aac'
import bip_bop_02 from './assets/bip-bop-02.aac'
import bip_bop_03 from './assets/bip-bop-03.aac'
import bip_bop_04 from './assets/bip-bop-04.aac'
import bip_bop_05 from './assets/bip-bop-05.aac'
import bip_bop_06 from './assets/bip-bop-06.aac'
import bip_bop_07 from './assets/bip-bop-07.aac'
import bip_bop_08 from './assets/bip-bop-08.aac'
import bip_bop_09 from './assets/bip-bop-09.aac'
import bip_bop_10 from './assets/bip-bop-10.aac'
import staplebops_01 from './assets/staplebops-01.aac'
import staplebops_02 from './assets/staplebops-02.aac'
import staplebops_03 from './assets/staplebops-03.aac'
import staplebops_04 from './assets/staplebops-04.aac'
import staplebops_05 from './assets/staplebops-05.aac'
import staplebops_06 from './assets/staplebops-06.aac'
import staplebops_07 from './assets/staplebops-07.aac'
import nope_01 from './assets/nope-01.aac'
import nope_02 from './assets/nope-02.aac'
import nope_03 from './assets/nope-03.aac'
import nope_04 from './assets/nope-04.aac'
import nope_05 from './assets/nope-05.aac'
import nope_06 from './assets/nope-06.aac'
import nope_07 from './assets/nope-07.aac'
import nope_08 from './assets/nope-08.aac'
import nope_09 from './assets/nope-09.aac'
import nope_10 from './assets/nope-10.aac'
import nope_11 from './assets/nope-11.aac'
import nope_12 from './assets/nope-12.aac'
import yup_01 from './assets/yup-01.aac'
import yup_02 from './assets/yup-02.aac'
import yup_03 from './assets/yup-03.aac'
import yup_04 from './assets/yup-04.aac'
import yup_05 from './assets/yup-05.aac'
import yup_06 from './assets/yup-06.aac'
import jj_01 from './assets/jj-01.aac'
import jj_02 from './assets/jj-02.aac'
import jj_03 from './assets/jj-03.aac'

/** Data URL (bundle) or asset URL (tests) for every playable id. */
export const SOUND_SOURCES: Record<SoundId, string> = {
  'alert-01': alert_01,
  'alert-02': alert_02,
  'alert-03': alert_03,
  'alert-04': alert_04,
  'alert-05': alert_05,
  'alert-06': alert_06,
  'alert-07': alert_07,
  'alert-08': alert_08,
  'alert-09': alert_09,
  'alert-10': alert_10,
  'bip-bop-01': bip_bop_01,
  'bip-bop-02': bip_bop_02,
  'bip-bop-03': bip_bop_03,
  'bip-bop-04': bip_bop_04,
  'bip-bop-05': bip_bop_05,
  'bip-bop-06': bip_bop_06,
  'bip-bop-07': bip_bop_07,
  'bip-bop-08': bip_bop_08,
  'bip-bop-09': bip_bop_09,
  'bip-bop-10': bip_bop_10,
  'staplebops-01': staplebops_01,
  'staplebops-02': staplebops_02,
  'staplebops-03': staplebops_03,
  'staplebops-04': staplebops_04,
  'staplebops-05': staplebops_05,
  'staplebops-06': staplebops_06,
  'staplebops-07': staplebops_07,
  'nope-01': nope_01,
  'nope-02': nope_02,
  'nope-03': nope_03,
  'nope-04': nope_04,
  'nope-05': nope_05,
  'nope-06': nope_06,
  'nope-07': nope_07,
  'nope-08': nope_08,
  'nope-09': nope_09,
  'nope-10': nope_10,
  'nope-11': nope_11,
  'nope-12': nope_12,
  'yup-01': yup_01,
  'yup-02': yup_02,
  'yup-03': yup_03,
  'yup-04': yup_04,
  'yup-05': yup_05,
  'yup-06': yup_06,
  'jj-01': jj_01,
  'jj-02': jj_02,
  'jj-03': jj_03,
}

/**
 * Load one sound's source. A missing or failed load rejects; callers resolve that to silence.
 * @param id - playable sound id.
 * @returns the audio source string.
 */
export function soundSource(id: SoundId): Promise<string> {
  return Promise.resolve(SOUND_SOURCES[id])
}
