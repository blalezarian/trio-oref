import type { AutotuneBounds } from './types';
import { roundTo3dp } from '../utils/rounding';
import {
    AUTOTUNE_ADJUSTMENT_FRACTION,
    MAX_CARB_RATIO,
    MIN_CARB_RATIO,
} from '../shared/constants';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Tune carb ratio (CR) based on calculated total CR from meal data */
export function tuneCarbRatio(
    totalCR: number,
    currentCarbRatio: number,
    pumpCarbRatio: number | undefined,
    bounds: AutotuneBounds,
): number {
    let fullNewCR = totalCR === 0 ? currentCarbRatio : totalCR;

    // Compute bounds: pump CR * autosens range, capped by absolute min/max
    let maxCR = (pumpCarbRatio as number) * bounds.autotuneMax;
    if (maxCR > MAX_CARB_RATIO) { maxCR = MAX_CARB_RATIO; }
    let minCR = (pumpCarbRatio as number) * bounds.autotuneMin;
    if (minCR < MIN_CARB_RATIO) { minCR = MIN_CARB_RATIO; }

    // Safety cap fullNewCR before blending
    if (pumpCarbRatio !== undefined) {
        if (fullNewCR > maxCR) {
            console.log(`Limiting fullNewCR from ${fullNewCR} to ${maxCR.toFixed(2)} (which is ${bounds.autotuneMax} * pump CR of ${pumpCarbRatio})`);
            fullNewCR = maxCR;
        } else if (fullNewCR < minCR) {
            console.log(`Limiting fullNewCR from ${fullNewCR} to ${minCR.toFixed(2)} (which is ${bounds.autotuneMin} * pump CR of ${pumpCarbRatio})`);
            fullNewCR = minCR;
        }
    }

    // Blend 80% old + 20% new
    let newCR = (1 - AUTOTUNE_ADJUSTMENT_FRACTION) * currentCarbRatio
        + AUTOTUNE_ADJUSTMENT_FRACTION * fullNewCR;

    // Safety cap blended newCR
    if (pumpCarbRatio !== undefined) {
        if (newCR > maxCR) {
            console.log(`Limiting CR to ${maxCR.toFixed(2)} (which is ${bounds.autotuneMax} * pump CR of ${pumpCarbRatio})`);
            newCR = maxCR;
        } else if (newCR < minCR) {
            console.log(`Limiting CR to ${minCR.toFixed(2)} (which is ${bounds.autotuneMin} * pump CR of ${pumpCarbRatio})`);
            newCR = minCR;
        }
    }

    newCR = roundTo3dp(newCR);
    console.log(`oldCR: ${currentCarbRatio} fullNewCR: ${fullNewCR} newCR: ${newCR}`);

    return newCR;
}
