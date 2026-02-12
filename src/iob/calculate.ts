import { Treatment, IOBContribution, InsulinCurve } from '../types/index';
import type { IobCalcProfile } from './types';
import {
    BILINEAR_DEFAULT_DIA_HOURS,
    BILINEAR_PEAK_MINUTES,
    BILINEAR_END_MINUTES,
    RAPID_ACTING_PEAK,
    ULTRA_RAPID_PEAK,
    RAPID_ACTING_MAX_PEAK,
    RAPID_ACTING_MIN_PEAK,
    ULTRA_RAPID_MAX_PEAK,
    ULTRA_RAPID_MIN_PEAK,
    MS_PER_MINUTE,
    SECONDS_PER_MINUTE,
} from '../constants';

export function iobCalc(treatment: Treatment, time: Date | undefined, curve: InsulinCurve, dia: number, peak: number, profile: IobCalcProfile): IOBContribution | Record<string, never> {
    // iobCalc returns two variables:
    //   activityContrib = units of treatment.insulin used in previous minute
    //   iobContrib = units of treatment.insulin still remaining at a given point in time
    // ("Contrib" is used because these are the amounts contributed from pontentially multiple treatment.insulin dosages -- totals are calculated in total.js)
    //
    // Variables can be calculated using either:
    //   A bilinear insulin action curve (which only takes duration of insulin activity (dia) as an input parameter) or
    //   An exponential insulin action curve (which takes both a dia and a peak parameter)
    // (which functional form to use is specified in the user's profile)

    if (treatment.insulin) {

        // Calc minutes since bolus (minsAgo)
        if (time === undefined) {
            time = new Date();
        }
        const bolusTime = new Date(treatment.date);
        const minsAgo = Math.round((time.getTime() - bolusTime.getTime()) / MS_PER_MINUTE);


        if (curve === 'bilinear') {
            return iobCalcBilinear(treatment, minsAgo, dia);  // no user-specified peak with this model
        } else {
            return iobCalcExponential(treatment, minsAgo, dia, peak, profile);
        }

    } else { // empty return if (treatment.insulin) == False
        return {};
    }
}


function iobCalcBilinear(treatment: Treatment, minsAgo: number, dia: number): IOBContribution {

    const default_dia = BILINEAR_DEFAULT_DIA_HOURS; // assumed duration of insulin activity, in hours
    const peak = BILINEAR_PEAK_MINUTES;            // assumed peak insulin activity, in minutes
    const end = BILINEAR_END_MINUTES;              // assumed end of insulin activity, in minutes

    // Scale minsAgo by the ratio of the default dia / the user's dia
    // so the calculations for activityContrib and iobContrib work for
    // other dia values (while using the constants specified above)
    const timeScalar = default_dia / dia;
    const scaled_minsAgo = timeScalar * minsAgo;


    let activityContrib = 0;
    let iobContrib = 0;

    // Calc percent of insulin activity at peak, and slopes up to and down from peak
    // Based on area of triangle, because area under the insulin action "curve" must sum to 1
    // (length * height) / 2 = area of triangle (1), therefore height (activityPeak) = 2 / length (which in this case is dia, in minutes)
    // activityPeak scales based on user's dia even though peak and end remain fixed
    const activityPeak = 2 / (dia * 60)
    const slopeUp = activityPeak / peak
    const slopeDown = -1 * (activityPeak / (end - peak))

    if (scaled_minsAgo < peak) {

        activityContrib = treatment.insulin! * (slopeUp * scaled_minsAgo);

        const x1 = (scaled_minsAgo / 5) + 1;  // scaled minutes since bolus, pre-peak; divided by 5 to work with coefficients estimated based on 5 minute increments
        iobContrib = treatment.insulin! * ( (-0.001852*x1*x1) + (0.001852*x1) + 1.000000 );

    } else if (scaled_minsAgo < end) {

        const minsPastPeak = scaled_minsAgo - peak
        activityContrib = treatment.insulin! * (activityPeak + (slopeDown * minsPastPeak));

        const x2 = ((scaled_minsAgo - peak) / 5);  // scaled minutes past peak; divided by 5 to work with coefficients estimated based on 5 minute increments
        iobContrib = treatment.insulin! * ( (0.001323*x2*x2) + (-0.054233*x2) + 0.555560 );
    }

    return {
        activityContrib: activityContrib,
        iobContrib: iobContrib
    };
}


function iobCalcExponential(treatment: Treatment, minsAgo: number, dia: number, peak: number, profile: IobCalcProfile): IOBContribution {

    // Use custom peak time (in minutes) if value is valid
    if ( profile.curve === "rapid-acting" ) {
        if (profile.useCustomPeakTime === true && profile.insulinPeakTime !== undefined) {
            if ( profile.insulinPeakTime > RAPID_ACTING_MAX_PEAK ) {
                console.error(`Setting maximum Insulin Peak Time of ${RAPID_ACTING_MAX_PEAK}m for`,profile.curve,'insulin');
                peak = RAPID_ACTING_MAX_PEAK;
            } else if ( profile.insulinPeakTime < RAPID_ACTING_MIN_PEAK ) {
                console.error(`Setting minimum Insulin Peak Time of ${RAPID_ACTING_MIN_PEAK}m for`,profile.curve,'insulin');
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
                console.error(`Setting maximum Insulin Peak Time of ${ULTRA_RAPID_MAX_PEAK}m for`,profile.curve,'insulin');
                peak = ULTRA_RAPID_MAX_PEAK;
            } else if ( profile.insulinPeakTime < ULTRA_RAPID_MIN_PEAK ) {
                console.error(`Setting minimum Insulin Peak Time of ${ULTRA_RAPID_MIN_PEAK}m for`,profile.curve,'insulin');
                peak = ULTRA_RAPID_MIN_PEAK;
            } else {
                peak = profile.insulinPeakTime;
            }
        } else {
            peak = ULTRA_RAPID_PEAK;
        }
    } else {
        console.error('Curve of',profile.curve,'is not supported.');
    }
    const end = dia * SECONDS_PER_MINUTE;  // end of insulin activity, in minutes


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

        activityContrib = treatment.insulin! * (S / Math.pow(tau, 2)) * minsAgo * (1 - minsAgo / end) * Math.exp(-minsAgo / tau);
        iobContrib = treatment.insulin! * (1 - S * (1 - a) * ((Math.pow(minsAgo, 2) / (tau * end * (1 - a)) - minsAgo / tau - 1) * Math.exp(-minsAgo / tau) + 1));
        //console.error(`DIA: ${dia} minsAgo: ${minsAgo} end: ${end} peak: ${peak} tau: ${tau} a: ${a} S: ${S} activityContrib: ${activityContrib} iobContrib: ${iobContrib}`);
    }

    return {
        activityContrib: activityContrib,
        iobContrib: iobContrib
    };
}


export default iobCalc;
export { iobCalc as calculate };
