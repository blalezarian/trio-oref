import endsWith from 'lodash/endsWith';
import { BASAL_SCALE_DEFAULT, BASAL_SCALE_MEDTRONIC } from './constants';

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

var round_basal = function round_basal(basal: number, profile?: RoundBasalProfile): number {

    /* x23 and x54 pumps change basal increment depending on how much basal is being delivered:
            0.025u for 0.025 < x < 0.975
            0.05u for 1 < x < 9.95
            0.1u for 10 < x
      To round numbers nicely for the pump, use a scale factor of (1 / increment). */

    var lowest_rate_scale = BASAL_SCALE_DEFAULT;

    // Has profile even been passed in?
    if (typeof profile !== 'undefined')
    {
        // Make sure optional model has been set
        if (typeof profile.model === 'string')
        {
            if (endsWith(profile.model, "54") || endsWith(profile.model, "23"))
            {
                lowest_rate_scale = BASAL_SCALE_MEDTRONIC;
            }
        }
    }

    var rounded_basal = basal;
    // Shouldn't need to check against 0 as pumps can't deliver negative basal anyway?
    if (basal < BASAL_RATE_LOW_THRESHOLD)
    {
        rounded_basal = Math.round(basal * lowest_rate_scale) / lowest_rate_scale;
    }
    else if (basal < BASAL_RATE_MID_THRESHOLD)
    {
        rounded_basal = Math.round(basal * BASAL_SCALE_MID_RANGE) / BASAL_SCALE_MID_RANGE;
    }
    else
    {
        rounded_basal = Math.round(basal * BASAL_SCALE_HIGH_RANGE) / BASAL_SCALE_HIGH_RANGE;
    }

    return rounded_basal;
}

export default round_basal;
