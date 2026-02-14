import { BASAL_SCALE_DEFAULT, BASAL_SCALE_MEDTRONIC } from '../shared/constants';

// ---------------------------------------------------------------------------
// General-purpose rounding
// ---------------------------------------------------------------------------

/** Round a number to a given number of decimal places (default: 0) */
export function round(value: number, digits: number = 0): number {
    const scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}

/** Round to 2 decimal places (scale factor 100) */
export function roundTo2dp(value: number): number {
    return Math.round(value * 100) / 100;
}

/** Round to 3 decimal places (scale factor 1000) */
export function roundTo3dp(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/** Round to 4 decimal places (scale factor 10000) */
export function roundTo4dp(value: number): number {
    return Math.round(value * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Basal rate rounding (pump-model-specific)
// ---------------------------------------------------------------------------

/** Basal rate (U/hr) below which lowest_rate_scale is used */
const BASAL_RATE_LOW_THRESHOLD = 1;
/** Basal rate (U/hr) below which mid-range scale (0.05 increments) is used */
const BASAL_RATE_MID_THRESHOLD = 10;
/** Rounding scale for mid-range basal rates (0.05 U increments) */
const BASAL_SCALE_MID_RANGE = 20;
/** Rounding scale for high basal rates (0.1 U increments) */
const BASAL_SCALE_HIGH_RANGE = 10;

interface RoundBasalProfile {
    model?: string;
}

/** Round a basal rate to the pump's supported increment based on pump model and rate magnitude */
export const roundBasal = (basal: number, profile?: RoundBasalProfile): number => {
    /* x23 and x54 pumps change basal increment depending on how much basal is being delivered:
            0.025u for 0.025 < x < 0.975
            0.05u for 1 < x < 9.95
            0.1u for 10 < x
      To round numbers nicely for the pump, use a scale factor of (1 / increment). */

    let lowestRateScale = BASAL_SCALE_DEFAULT;

    if (profile && typeof profile.model === 'string') {
        if (profile.model.endsWith("54") || profile.model.endsWith("23")) {
            lowestRateScale = BASAL_SCALE_MEDTRONIC;
        }
    }

    if (basal < BASAL_RATE_LOW_THRESHOLD) {
        return Math.round(basal * lowestRateScale) / lowestRateScale;
    }
    if (basal < BASAL_RATE_MID_THRESHOLD) {
        return Math.round(basal * BASAL_SCALE_MID_RANGE) / BASAL_SCALE_MID_RANGE;
    }
    return Math.round(basal * BASAL_SCALE_HIGH_RANGE) / BASAL_SCALE_HIGH_RANGE;
};
