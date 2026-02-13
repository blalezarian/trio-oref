import type { GlucoseEntry, GlucoseStatus } from '../types/index';
import { MS_PER_MINUTE, PRED_INTERVAL_MINUTES, MIN_VALID_GLUCOSE_MGDL } from '../shared/constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lower bound (minutes ago) for averaging current BG reading */
const NOW_AVERAGING_MIN_MINUTES = -2;
/** Upper bound (minutes ago) for averaging current BG reading */
const NOW_AVERAGING_MAX_MINUTES = 2.5;
/** Upper bound (minutes ago) for short delta calculations (~5-15m) */
const SHORT_DELTA_MAX_MINUTES = 17.5;
/** Upper bound (minutes ago) for last delta calculations (~5m) */
const LAST_DELTA_MAX_MINUTES = 7.5;
/** Upper bound (minutes ago) for long delta calculations (~20-40m) */
const LONG_DELTA_MAX_MINUTES = 42.5;
/** Scale factor for rounding to 2 decimal places */
const ROUND_SCALE_2DP = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the timestamp (epoch ms) from whichever date field is present */
function getDateFromEntry(entry: GlucoseEntry): number {
    return entry.date
        || Date.parse(entry.display_time ?? '')
        || Date.parse(entry.dateString ?? '');
}

/** Filter entries with a glucose/sgv value and normalize sgv → glucose */
function filterValidGlucoseData(data: GlucoseEntry[]): GlucoseEntry[] {
    return data
        .filter((entry) => Boolean(entry.glucose || entry.sgv))
        .map((entry) => {
            entry.glucose = entry.glucose || entry.sgv;
            return entry;
        });
}

/** Average an array of numbers, returning 0 for empty arrays */
function average(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Round a number to 2 decimal places */
function roundTo2Dp(value: number): number {
    return Math.round(value * ROUND_SCALE_2DP) / ROUND_SCALE_2DP;
}

/** Compute the average delta (rate of BG change) in mg/dL per 5 minutes */
function computeAvgDelta(
    nowGlucose: number,
    thenGlucose: number,
    minutesAgo: number,
): number {
    return (nowGlucose - thenGlucose) / minutesAgo * PRED_INTERVAL_MINUTES;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Calculate glucose status (current BG, deltas, noise) from recent CGM data */
function getLastGlucose(data: GlucoseEntry[]): GlucoseStatus {
    const filtered = filterValidGlucoseData(data);

    const now = filtered[0];
    let nowDate = getDateFromEntry(now);
    const lastDeltas: number[] = [];
    const shortDeltas: number[] = [];
    const longDeltas: number[] = [];
    let lastCal = 0;

    for (let entryIdx = 1; entryIdx < filtered.length; entryIdx++) {
        const entry = filtered[entryIdx];

        // Stop processing at calibration records
        if (entry.type === 'cal') {
            lastCal = entryIdx;
            break;
        }

        // Only use entries from the same device with valid glucose
        if (entry.glucose == null || entry.glucose < MIN_VALID_GLUCOSE_MGDL || entry.device !== now.device) {
            continue;
        }

        const entryDate = getDateFromEntry(entry);
        if (!entryDate || !nowDate) {
            console.error("Error: date field not found: cannot calculate avgdelta");
            continue;
        }

        const minutesAgo = Math.round((nowDate - entryDate) / MS_PER_MINUTE);
        const avgDelta = computeAvgDelta(now.glucose ?? 0, entry.glucose, minutesAgo);

        // Average readings within 2.5 minutes into the current reading
        if (NOW_AVERAGING_MIN_MINUTES < minutesAgo && minutesAgo <= NOW_AVERAGING_MAX_MINUTES) {
            now.glucose = ((now.glucose ?? 0) + entry.glucose) / 2;
            nowDate = (nowDate + entryDate) / 2;
            continue;
        }

        // Short deltas: ~5-17.5 minutes ago
        if (NOW_AVERAGING_MAX_MINUTES < minutesAgo && minutesAgo <= SHORT_DELTA_MAX_MINUTES) {
            shortDeltas.push(avgDelta);
            // Last deltas: ~5-7.5 minutes ago (subset of short)
            if (minutesAgo < LAST_DELTA_MAX_MINUTES) {
                lastDeltas.push(avgDelta);
            }
            continue;
        }

        // Long deltas: ~17.5-42.5 minutes ago
        if (SHORT_DELTA_MAX_MINUTES < minutesAgo && minutesAgo < LONG_DELTA_MAX_MINUTES) {
            longDeltas.push(avgDelta);
        }
    }

    return {
        delta: roundTo2Dp(average(lastDeltas)),
        glucose: roundTo2Dp(now.glucose ?? 0),
        noise: Math.round(Number(now.noise)),
        short_avgdelta: roundTo2Dp(average(shortDeltas)),
        long_avgdelta: roundTo2Dp(average(longDeltas)),
        date: nowDate,
        last_cal: lastCal,
        device: now.device,
    };
}

export default getLastGlucose;
export {
    getLastGlucose,
    // Helpers
    getDateFromEntry,
    filterValidGlucoseData,
    average,
    roundTo2Dp,
    computeAvgDelta,
};
