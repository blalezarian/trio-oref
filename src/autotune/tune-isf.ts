
import { percentile } from '../utils/percentile';
import type {
    AutotuneGlucoseDatum,
    AutotuneBounds,
} from './types';
import { AUTOTUNE_ADJUSTMENT_FRACTION } from '../shared/constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_ISF_DATA_POINTS = 10;
const DEFAULT_ISF_ADJUSTMENT_FRACTION = 1.0;
const MEDIAN_PERCENTILE = 0.50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TuneISFResult {
    // Tuned value
    newISF: number;
    // Intermediate values for orchestrator's combined log
    oldISF: number;
    p50deviation: number;
    p50BGI: number;
    p50ratios: number;
    fullNewISF: number;
    adjustedISF: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect and sort deviations, BGIs, avgDeltas, and ratios from ISF glucose data */
export function collectISFStatistics(
    isfGlucose: AutotuneGlucoseDatum[],
): {
    deviations: number[];
    BGIs: number[];
    avgDeltas: number[];
    ratios: number[];
} {
    const deviations: number[] = [];
    const BGIs: number[] = [];
    const avgDeltas: number[] = [];
    const ratios: number[] = [];

    for (const datum of isfGlucose) {
        const deviation = parseFloat(datum.deviation);
        deviations.push(deviation);

        const bgi = parseFloat(String(datum.BGI));
        BGIs.push(bgi);

        const avgDelta = parseFloat(datum.avgDelta);
        avgDeltas.push(avgDelta);

        const ratio = 1 + deviation / bgi;
        ratios.push(ratio);
    }

    // Sort all arrays for percentile calculation
    avgDeltas.sort((a, b) => a - b);
    BGIs.sort((a, b) => a - b);
    deviations.sort((a, b) => a - b);
    ratios.sort((a, b) => a - b);

    return { deviations, BGIs, avgDeltas, ratios };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Tune insulin sensitivity factor (ISF) based on median deviation ratios */
export function tuneISF(
    isfGlucose: AutotuneGlucoseDatum[],
    currentISF: number,
    pumpISF: number | undefined,
    bounds: AutotuneBounds,
    isfAdjustmentFraction: number | undefined,
): TuneISFResult {
    const { deviations, BGIs, ratios } = collectISFStatistics(isfGlucose);

    const p50deviation = Math.round(percentile(deviations, MEDIAN_PERCENTILE) * 1000) / 1000;
    const p50BGI = Math.round(percentile(BGIs, MEDIAN_PERCENTILE) * 1000) / 1000;
    const p50ratios = Math.round(percentile(ratios, MEDIAN_PERCENTILE) * 1000) / 1000;

    let fullNewISF = currentISF;
    if (isfGlucose.length < MIN_ISF_DATA_POINTS) {
        console.error("Only found", isfGlucose.length, "ISF data points, leaving ISF unchanged at", currentISF);
    } else {
        fullNewISF = currentISF * p50ratios;
    }
    fullNewISF = Math.round(fullNewISF * 1000) / 1000;

    const adjustmentFraction = isfAdjustmentFraction ?? DEFAULT_ISF_ADJUSTMENT_FRACTION;

    // low autosens ratio = high ISF
    const maxISF = (pumpISF as number) / bounds.autotuneMin;
    // high autosens ratio = low ISF
    const minISF = (pumpISF as number) / bounds.autotuneMax;

    let adjustedISF: number | undefined;
    let newISF: number | undefined;

    if (pumpISF !== undefined) {
        if (fullNewISF < 0) {
            adjustedISF = currentISF;
        } else {
            adjustedISF = adjustmentFraction * fullNewISF + (1 - adjustmentFraction) * pumpISF;
        }

        // Cap adjustedISF before applying adjustment fraction blend
        if (adjustedISF > maxISF) {
            console.error("Limiting adjusted ISF of", adjustedISF.toFixed(2), "to", maxISF.toFixed(2), "(which is pump ISF of", pumpISF, "/", bounds.autotuneMin, ")");
            adjustedISF = maxISF;
        } else if (adjustedISF < minISF) {
            console.error("Limiting adjusted ISF of", adjustedISF.toFixed(2), "to", minISF.toFixed(2), "(which is pump ISF of", pumpISF, "/", bounds.autotuneMax, ")");
            adjustedISF = minISF;
        }

        // Blend 80% old + 20% adjusted
        newISF = (1 - AUTOTUNE_ADJUSTMENT_FRACTION) * currentISF
            + AUTOTUNE_ADJUSTMENT_FRACTION * adjustedISF;

        if (newISF > maxISF) {
            console.error("Limiting ISF of", newISF.toFixed(2), "to", maxISF.toFixed(2), "(which is pump ISF of", pumpISF, "/", bounds.autotuneMin, ")");
            newISF = maxISF;
        } else if (newISF < minISF) {
            console.error("Limiting ISF of", newISF.toFixed(2), "to", minISF.toFixed(2), "(which is pump ISF of", pumpISF, "/", bounds.autotuneMax, ")");
            newISF = minISF;
        }
    }

    const roundedNewISF = Math.round((newISF as number) * 1000) / 1000;
    const roundedAdjustedISF = Math.round((adjustedISF as number) * 1000) / 1000;

    return {
        newISF: roundedNewISF,
        oldISF: currentISF,
        p50deviation,
        p50BGI,
        p50ratios,
        fullNewISF,
        adjustedISF: roundedAdjustedISF,
    };
}
