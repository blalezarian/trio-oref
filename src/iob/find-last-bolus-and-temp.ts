import type { EpochMillis } from '../types/index';
import type { IobTreatment } from './types';

/** Rounding scale for 2 decimal places */
const ROUND_SCALE_2DP = 100;

export interface LastBolusAndTemp {
    lastBolusTime: EpochMillis;
    lastTemp: IobTreatment;
}

/**
 * Scan treatments to find the most recent bolus time and the most recent
 * temp basal. Used by generate() to annotate the first IOB array entry.
 */
export function findLastBolusAndTemp(treatments: IobTreatment[]): LastBolusAndTemp {
    let lastBolusTime: EpochMillis = 0;
    let lastTemp: IobTreatment = { date: 0 } as IobTreatment;
    treatments.forEach((treatment: IobTreatment) => {
        if (treatment.insulin && treatment.started_at) {
            lastBolusTime = Math.max(lastBolusTime, treatment.started_at.getTime());
        } else if (typeof(treatment.rate) === 'number' && treatment.duration ) {
            if ( treatment.date > lastTemp.date ) {
                lastTemp = treatment;
                lastTemp.duration = Math.round((lastTemp.duration as number)*ROUND_SCALE_2DP)/ROUND_SCALE_2DP;
            }
        }
    });
    return { lastBolusTime, lastTemp };
}
