import type { GlucoseEntry, BucketedGlucose } from '../types/index';
import {
    MIN_VALID_GLUCOSE_MGDL,
    MS_PER_HOUR,
    MS_PER_MINUTE,
    MS_PER_5_MIN,
    PRED_INTERVAL_MINUTES,
    BUCKETING_MERGE_THRESHOLD_MIN,
} from '../constants';
import { resolveGlucoseTime } from '../utils/glucose-time';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Time window for CI-mode lookback (45 minutes in ms) */
const CI_LOOKBACK_MS = 45 * MS_PER_MINUTE;
/** Maximum interpolation gap cap (4 hours in minutes) */
const MAX_INTERPOLATION_GAP_MINUTES = 240;
/** Elapsed-minutes gap above which BG data is interpolated */
const BUCKETING_GAP_THRESHOLD_MIN = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the time for the most recent bucketed entry.
 * Tries the last bucket's display_time first, then falls back to
 * the original glucose data at lastValidIndex.
 */
function resolveLastBucketTime(
    bucketed_data: BucketedGlucose[],
    lastValidIndex: number,
    glucose_data: GlucoseEntry[],
): Date | undefined {
    // Buckets only carry display_time (not dateString), matching original behavior
    const lastBucket = bucketed_data[bucketed_data.length - 1];
    if (lastBucket.display_time) {
        return new Date(lastBucket.display_time.replace('T', ' '));
    }
    if (lastValidIndex >= 0) {
        return resolveGlucoseTime(glucose_data[lastValidIndex]);
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Bucket glucose data with 5-minute interpolation for gaps > 8 minutes */
export function bucketGlucoseWithInterpolation(
    glucose_data: GlucoseEntry[],
    mealTime: Date,
    carbImpactTime: Date,
    maxMealAbsorptionTime: number,
): BucketedGlucose[] {
    const bucketed_data: BucketedGlucose[] = [];
    bucketed_data[0] = glucose_data[0];
    let bucketIndex = 0;
    let foundPreMealBG = false;
    let lastValidIndex = 0;

    if (!glucose_data[0].glucose || glucose_data[0].glucose < MIN_VALID_GLUCOSE_MGDL) {
        lastValidIndex = -1;
    }

    let bgTime: Date | undefined;
    let lastBgTime: Date | undefined;

    for (let i = 1; i < glucose_data.length; ++i) {
        const resolvedTime = resolveGlucoseTime(glucose_data[i]);
        if (resolvedTime) {
            bgTime = resolvedTime;
        } else {
            console.error("Could not determine BG time");
        }

        // Skip entries with invalid glucose
        if (!glucose_data[i].glucose || (glucose_data[i].glucose ?? 0) < MIN_VALID_GLUCOSE_MGDL) {
            continue;
        }

        // Only consider BGs within maxMealAbsorptionTime hours after meal
        const hoursAfterMeal = (Number(bgTime) - Number(mealTime)) / MS_PER_HOUR;
        if (hoursAfterMeal > maxMealAbsorptionTime || foundPreMealBG) {
            continue;
        }
        if (hoursAfterMeal < 0) {
            foundPreMealBG = true;
        }

        // Only consider last ~45m of data in CI mode
        if (carbImpactTime !== undefined) {
            const hoursAgo = (Number(carbImpactTime) - Number(bgTime)) / CI_LOOKBACK_MS;
            if (hoursAgo > 1 || hoursAgo < 0) {
                continue;
            }
        }

        // Resolve time for the last bucketed/valid entry
        const resolvedLastTime = resolveLastBucketTime(bucketed_data, lastValidIndex, glucose_data);
        if (resolvedLastTime) {
            lastBgTime = resolvedLastTime;
        } else {
            console.error("Could not determine last BG time");
        }

        const elapsed_minutes = (Number(bgTime) - Number(lastBgTime)) / MS_PER_MINUTE;

        // --- Case 1: Large gap (> 8 min) → interpolate missing data points ---
        if (Math.abs(elapsed_minutes) > BUCKETING_GAP_THRESHOLD_MIN) {
            let lastBg = glucose_data[lastValidIndex].glucose ?? 0;
            const cappedMinutes = Math.min(MAX_INTERPOLATION_GAP_MINUTES, Math.abs(elapsed_minutes));
            let remaining = cappedMinutes;

            while (remaining > PRED_INTERVAL_MINUTES) {
                const previousBgTime = new Date(lastBgTime!.getTime() - MS_PER_5_MIN);
                bucketIndex++;
                bucketed_data[bucketIndex] = {} as BucketedGlucose;
                bucketed_data[bucketIndex].date = previousBgTime.getTime();
                const gapDelta = (glucose_data[i].glucose ?? 0) - lastBg;
                const previousBg = lastBg + (PRED_INTERVAL_MINUTES / remaining * gapDelta);
                bucketed_data[bucketIndex].glucose = Math.round(previousBg);

                remaining -= PRED_INTERVAL_MINUTES;
                lastBg = previousBg;
                lastBgTime = new Date(previousBgTime);
            }
        }
        // --- Case 2: Medium gap (> 2 min) → new bucket ---
        else if (Math.abs(elapsed_minutes) > BUCKETING_MERGE_THRESHOLD_MIN) {
            bucketIndex++;
            bucketed_data[bucketIndex] = glucose_data[i];
            bucketed_data[bucketIndex].date = bgTime!.getTime();
        }
        // --- Case 3: Small gap (≤ 2 min) → merge into current bucket ---
        else {
            bucketed_data[bucketIndex].glucose =
                ((bucketed_data[bucketIndex].glucose ?? 0) + (glucose_data[i].glucose ?? 0)) / 2;
        }

        lastValidIndex = i;
    }

    return bucketed_data;
}
