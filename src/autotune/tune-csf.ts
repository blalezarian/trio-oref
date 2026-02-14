import type {
    AutotuneGlucoseDatum,
    AutotuneBounds,
} from './types';
import { roundTo2dp, roundTo3dp } from '../utils/rounding';
import { AUTOTUNE_ADJUSTMENT_FRACTION } from '../shared/constants';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Tune carb sensitivity factor (CSF) based on meal deviation accumulation */
export function tuneCSF(
    csfGlucose: AutotuneGlucoseDatum[],
    currentCSF: number,
    min5mCarbimpact: number | undefined,
    pumpCSF: number | undefined,
    bounds: AutotuneBounds,
): number {
    const { totalMealCarbs, totalDeviations: rawTotalDeviations } =
        accumulateMealDeviations(csfGlucose, min5mCarbimpact);

    const fullNewCSF = totalMealCarbs === 0
        ? currentCSF
        : roundTo2dp(rawTotalDeviations / totalMealCarbs);

    // Blend 80% old + 20% new
    let newCSF = (1 - AUTOTUNE_ADJUSTMENT_FRACTION) * currentCSF
        + AUTOTUNE_ADJUSTMENT_FRACTION * fullNewCSF;

    // Safety cap to autosens bounds
    if (pumpCSF !== undefined) {
        const maxCSF = pumpCSF * bounds.autotuneMax;
        const minCSF = pumpCSF * bounds.autotuneMin;
        if (newCSF > maxCSF) {
            console.log(`Limiting CSF to ${maxCSF.toFixed(2)} (which is ${bounds.autotuneMax} * pump CSF of ${pumpCSF})`);
            newCSF = maxCSF;
        } else if (newCSF < minCSF) {
            console.log(`Limiting CSF to ${minCSF.toFixed(2)} (which is ${bounds.autotuneMin} * pump CSF of ${pumpCSF})`);
            newCSF = minCSF;
        }
    }

    const oldCSF = roundTo3dp(currentCSF);
    newCSF = roundTo3dp(newCSF);
    const totalDeviations = roundTo3dp(rawTotalDeviations);
    console.log(`totalMealCarbs: ${totalMealCarbs} totalDeviations: ${totalDeviations} oldCSF ${oldCSF} fullNewCSF: ${fullNewCSF} newCSF: ${newCSF}`);

    return newCSF;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Accumulate meal deviations from CSF glucose data, grouped by meal
 * absorption periods (start -> end).
 */
export function accumulateMealDeviations(
    csfGlucose: AutotuneGlucoseDatum[],
    min5mCarbimpact: number | undefined,
): { totalMealCarbs: number; totalDeviations: number } {
    let currentDeviations = 0;
    let currentMealCarbs = 0;
    let totalMealCarbs = 0;
    let totalDeviations = 0;

    for (const datum of csfGlucose) {
        if (datum.mealAbsorption === 'start') {
            currentDeviations = 0;
            currentMealCarbs = parseInt(String(datum.mealCarbs));
        } else if (datum.mealAbsorption === 'end') {
            currentDeviations += datum.deviation;
            totalMealCarbs += currentMealCarbs;
            totalDeviations += currentDeviations;
        } else {
            // Original: 0 * min_5m_carbimpact always yields 0; preserved for fidelity
            currentDeviations += Math.max(
                0 * (min5mCarbimpact as number),
                datum.deviation,
            );
            currentMealCarbs = Math.max(
                currentMealCarbs,
                parseInt(String(datum.mealCarbs)),
            );
        }
    }

    // Handle last meal not finishing absorption by midnight
    if (totalMealCarbs === 0) { totalMealCarbs += currentMealCarbs; }
    if (totalDeviations === 0) { totalDeviations += currentDeviations; }

    return { totalMealCarbs, totalDeviations };
}
