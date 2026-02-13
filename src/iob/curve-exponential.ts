import type { Treatment, IOBContribution, InsulinCurve } from '../types/index';
import type { IobCalcProfile } from './types';
import {
    RAPID_ACTING_PEAK,
    ULTRA_RAPID_PEAK,
    RAPID_ACTING_MAX_PEAK,
    RAPID_ACTING_MIN_PEAK,
    ULTRA_RAPID_MAX_PEAK,
    ULTRA_RAPID_MIN_PEAK,
    MINUTES_PER_HOUR,
} from '../shared/constants';

/**
 * Calculate IOB and activity contributions using an exponential insulin action
 * curve. Supports rapid-acting and ultra-rapid curves with optional custom peak
 * time. Formula source: https://github.com/LoopKit/Loop/issues/388#issuecomment-317938473
 */
export function iobCalcExponential(treatment: Treatment, minsAgo: number, dia: number, peak: number, profile: IobCalcProfile): IOBContribution {

    // Use custom peak time (in minutes) if value is valid
    if ( profile.curve === "rapid-acting" ) {
        if (profile.useCustomPeakTime === true && profile.insulinPeakTime !== undefined) {
            if ( profile.insulinPeakTime > RAPID_ACTING_MAX_PEAK ) {
                console.log(`Setting maximum Insulin Peak Time of ${RAPID_ACTING_MAX_PEAK}m for ${profile.curve} insulin`);
                peak = RAPID_ACTING_MAX_PEAK;
            } else if ( profile.insulinPeakTime < RAPID_ACTING_MIN_PEAK ) {
                console.log(`Setting minimum Insulin Peak Time of ${RAPID_ACTING_MIN_PEAK}m for ${profile.curve} insulin`);
                peak = RAPID_ACTING_MIN_PEAK;
            } else {
                peak = profile.insulinPeakTime;
            }
        } else {
            peak = RAPID_ACTING_PEAK;
        }
    } else if ( profile.curve === "ultra-rapid" ) {
        if (profile.useCustomPeakTime === true && profile.insulinPeakTime !== undefined) {
            if ( profile.insulinPeakTime > ULTRA_RAPID_MAX_PEAK ) {
                console.log(`Setting maximum Insulin Peak Time of ${ULTRA_RAPID_MAX_PEAK}m for ${profile.curve} insulin`);
                peak = ULTRA_RAPID_MAX_PEAK;
            } else if ( profile.insulinPeakTime < ULTRA_RAPID_MIN_PEAK ) {
                console.log(`Setting minimum Insulin Peak Time of ${ULTRA_RAPID_MIN_PEAK}m for ${profile.curve} insulin`);
                peak = ULTRA_RAPID_MIN_PEAK;
            } else {
                peak = profile.insulinPeakTime;
            }
        } else {
            peak = ULTRA_RAPID_PEAK;
        }
    } else {
        console.log(`Curve of ${profile.curve} is not supported.`);
    }
    const end = dia * MINUTES_PER_HOUR;  // end of insulin activity, in minutes

    let activityContrib = 0;
    let iobContrib = 0;

    if (minsAgo < end) {

        // Formula source: https://github.com/LoopKit/Loop/issues/388#issuecomment-317938473
        // Mapping of original source variable names to those used here:
        //   td = end
        //   tp = peak
        //   t  = minsAgo
        const tau = peak * (1 - peak / end) / (1 - 2 * peak / end);  // time constant of exponential decay
        const a = 2 * tau / end;                                     // rise time factor
        const S = 1 / (1 - a + (1 + a) * Math.exp(-end / tau));      // auxiliary scale factor

        const insulin = treatment.insulin as number;
        activityContrib = insulin * (S / Math.pow(tau, 2)) * minsAgo * (1 - minsAgo / end) * Math.exp(-minsAgo / tau);
        iobContrib = insulin * (1 - S * (1 - a) * ((Math.pow(minsAgo, 2) / (tau * end * (1 - a)) - minsAgo / tau - 1) * Math.exp(-minsAgo / tau) + 1));
    }

    return { activityContrib, iobContrib };
}
