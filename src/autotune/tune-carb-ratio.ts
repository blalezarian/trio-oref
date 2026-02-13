
import type { AutotuneBounds } from './types';
import {
    AUTOTUNE_ADJUSTMENT_FRACTION,
    MAX_CARB_RATIO,
    MIN_CARB_RATIO,
} from '../constants';

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
            console.error("Limiting fullNewCR from", fullNewCR, "to", maxCR.toFixed(2), "(which is", bounds.autotuneMax, "* pump CR of", pumpCarbRatio, ")");
            fullNewCR = maxCR;
        } else if (fullNewCR < minCR) {
            console.error("Limiting fullNewCR from", fullNewCR, "to", minCR.toFixed(2), "(which is", bounds.autotuneMin, "* pump CR of", pumpCarbRatio, ")");
            fullNewCR = minCR;
        }
    }

    // Blend 80% old + 20% new
    let newCR = (1 - AUTOTUNE_ADJUSTMENT_FRACTION) * currentCarbRatio
        + AUTOTUNE_ADJUSTMENT_FRACTION * fullNewCR;

    // Safety cap blended newCR
    if (pumpCarbRatio !== undefined) {
        if (newCR > maxCR) {
            console.error("Limiting CR to", maxCR.toFixed(2), "(which is", bounds.autotuneMax, "* pump CR of", pumpCarbRatio, ")");
            newCR = maxCR;
        } else if (newCR < minCR) {
            console.error("Limiting CR to", minCR.toFixed(2), "(which is", bounds.autotuneMin, "* pump CR of", pumpCarbRatio, ")");
            newCR = minCR;
        }
    }

    newCR = Math.round(newCR * 1000) / 1000;
    console.error("oldCR:", currentCarbRatio, "fullNewCR:", fullNewCR, "newCR:", newCR);

    return newCR;
}
