import type { Treatment, IOBContribution } from '../types/index';
import {
    BILINEAR_DEFAULT_DIA_HOURS,
    BILINEAR_PEAK_MINUTES,
    BILINEAR_END_MINUTES,
    MINUTES_PER_HOUR,
    PRED_INTERVAL_MINUTES,
} from '../shared/constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Triangle area = 1, so height = 2 / base (area formula: base * height / 2 = 1) */
const TRIANGLE_AREA_NUMERATOR = 2;

// Pre-peak polynomial coefficients (fitted to 5-minute intervals)
const PRE_PEAK_COEFF_A = -0.001852;
const PRE_PEAK_COEFF_B = 0.001852;
const PRE_PEAK_COEFF_C = 1.0;

// Post-peak polynomial coefficients (fitted to 5-minute intervals)
const POST_PEAK_COEFF_A = 0.001323;
const POST_PEAK_COEFF_B = -0.054233;
const POST_PEAK_COEFF_C = 0.555560;

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Calculate IOB and activity contributions using a bilinear (triangular)
 * insulin action curve. Only takes duration of insulin activity (DIA) as input;
 * peak is fixed at 75 minutes, end at 180 minutes, and minsAgo is scaled by
 * the ratio of default DIA (3h) to the user's DIA.
 */
export function iobCalcBilinear(treatment: Treatment, minsAgo: number, dia: number): IOBContribution {
    const defaultDia = BILINEAR_DEFAULT_DIA_HOURS;
    const peak = BILINEAR_PEAK_MINUTES;
    const end = BILINEAR_END_MINUTES;

    // Scale minsAgo by the ratio of the default dia / the user's dia
    // so the calculations for activityContrib and iobContrib work for
    // other dia values (while using the constants specified above)
    const timeScalar = defaultDia / dia;
    const scaledMinsAgo = timeScalar * minsAgo;

    let activityContrib = 0;
    let iobContrib = 0;

    // Calc percent of insulin activity at peak, and slopes up to and down from peak
    // Based on area of triangle, because area under the insulin action "curve" must sum to 1
    // (length * height) / 2 = area of triangle (1), therefore height (activityPeak) = 2 / length (dia in minutes)
    // activityPeak scales based on user's dia even though peak and end remain fixed
    const activityPeak = TRIANGLE_AREA_NUMERATOR / (dia * MINUTES_PER_HOUR);
    const slopeUp = activityPeak / peak;
    const slopeDown = -activityPeak / (end - peak);

    const insulin = Number(treatment.insulin);

    if (scaledMinsAgo < peak) {
        activityContrib = insulin * (slopeUp * scaledMinsAgo);

        // Scaled minutes since bolus, pre-peak; divided by interval to work with fitted coefficients
        const x1 = (scaledMinsAgo / PRED_INTERVAL_MINUTES) + 1;
        iobContrib = insulin * (PRE_PEAK_COEFF_A * x1 * x1 + PRE_PEAK_COEFF_B * x1 + PRE_PEAK_COEFF_C);

    } else if (scaledMinsAgo < end) {
        const minsPastPeak = scaledMinsAgo - peak;
        activityContrib = insulin * (activityPeak + (slopeDown * minsPastPeak));

        // Scaled minutes past peak; divided by interval to work with fitted coefficients
        const x2 = (scaledMinsAgo - peak) / PRED_INTERVAL_MINUTES;
        iobContrib = insulin * (POST_PEAK_COEFF_A * x2 * x2 + POST_PEAK_COEFF_B * x2 + POST_PEAK_COEFF_C);
    }

    return { activityContrib, iobContrib };
}
