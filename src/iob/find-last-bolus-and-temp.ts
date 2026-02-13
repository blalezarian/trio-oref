import type { EpochMillis } from '../types/index';
import type { IobTreatment } from './types';
import { roundTo2dp } from '../utils/rounding';

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
                lastTemp.duration = roundTo2dp(lastTemp.duration as number);
            }
        }
    });
    return { lastBolusTime, lastTemp };
}
