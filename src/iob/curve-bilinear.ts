import type { Treatment, IOBContribution } from '../types/index';
import {
    BILINEAR_DEFAULT_DIA_HOURS,
    BILINEAR_PEAK_MINUTES,
    BILINEAR_END_MINUTES,
} from '../shared/constants';

export function iobCalcBilinear(treatment: Treatment, minsAgo: number, dia: number): IOBContribution {

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
