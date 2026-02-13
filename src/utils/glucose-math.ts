import type { GlucoseEntry } from '../types/index';
import { PRED_INTERVAL_MINUTES } from '../constants';

/** Rounding scale for 2 decimal places */
const ROUND_SCALE_2DP = 100;

/**
 * Normalize sgv -> glucose field on glucose entries.
 * Mutates objects in-place, returns a new array of the same references
 * (preserving the original .map() semantics from the source JS).
 */
export function normalizeGlucoseData(glucoseEntries: GlucoseEntry[]): GlucoseEntry[] {
    return glucoseEntries.map((glucoseEntry: GlucoseEntry) => {
        //Support the NS sgv field to avoid having to convert in a custom way
        glucoseEntry.glucose = glucoseEntry.glucose || glucoseEntry.sgv;
        return glucoseEntry;
    });
}

/** Calculate insulin's predicted BG impact over 5 minutes */
export function calculateBGImpact(
    iobActivity: number,
    isf: number
): number {
    return Math.round((-iobActivity * isf * PRED_INTERVAL_MINUTES) * ROUND_SCALE_2DP) / ROUND_SCALE_2DP;
}

/**
 * Calculate deviation (actual BG change minus predicted insulin effect).
 * When bg and minBGTarget are provided, floors positive deviations to zero
 * when BG is below minBGTarget.
 */
export function calculateDeviation(
    delta: number,
    bgImpact: number,
    bg?: number,
    minBGTarget?: number
): number {
    let deviation = delta - bgImpact;
    // set positive deviations to zero if BG is below target
    if (bg !== undefined && minBGTarget !== undefined && bg < minBGTarget && deviation > 0) {
        deviation = 0;
    }
    return Math.round(deviation * ROUND_SCALE_2DP) / ROUND_SCALE_2DP;
}
