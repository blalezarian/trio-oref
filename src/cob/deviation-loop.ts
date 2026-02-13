import { getCurrentBasalRate } from '../profile/basal';
import get_iob from '../iob/index';
import { isfLookup } from '../profile/isf';
import { calculateBGImpact, calculateDeviation } from '../utils/glucose-math';
import type { BucketedGlucose } from '../types/index';
import type { IobProfile, HistoryBasalProfileEntry, IobInputs, IobTreatment } from '../iob/types';
import {
    MIN_VALID_GLUCOSE_MGDL,
    MS_PER_5_MIN,
} from '../shared/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CarbAbsorptionResult {
    carbsAbsorbed: number;
    currentDeviation: number;
    maxDeviation: number;
    minDeviation: number;
    slopeFromMaxDeviation: number;
    slopeFromMinDeviation: number;
    allDeviations: number[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rounding scale for 3 decimal places */
const ROUND_SCALE_3DP = 1000;
/** Rounding scale for 2 decimal places */
const ROUND_SCALE_2DP = 100;
/** Minimum trailing buckets required for delta calculations */
const TRAILING_BUCKETS_REQUIRED = 3;
/** Initial sentinel for min-deviation slope (large positive to be overwritten) */
const SLOPE_INITIAL_HIGH = 999;
/** Initial sentinel for min-deviation (large positive to be overwritten) */
const MIN_DEVIATION_INITIAL = 999;
/** Divisor for currentDeviation contribution to carbImpact */
const CURRENT_DEVIATION_DIVISOR = 2;

// ---------------------------------------------------------------------------
// Main analysis loop
// ---------------------------------------------------------------------------

/** Analyze glucose deviations and track carb absorption */
export function analyzeAbsorption(
    bucketed_data: BucketedGlucose[],
    iob_inputs: { profile: IobProfile; history: unknown[]; clock?: string | Date },
    basalprofile: HistoryBasalProfileEntry[],
    profile: IobProfile,
    treatments: IobTreatment[],
    mealTime: Date,
    carbImpactTime: Date,
): CarbAbsorptionResult {
    let carbsAbsorbed = 0;
    let currentDeviation: number | undefined;
    let slopeFromMaxDeviation = 0;
    let slopeFromMinDeviation = SLOPE_INITIAL_HIGH;
    let maxDeviation = 0;
    let minDeviation = MIN_DEVIATION_INITIAL;
    const allDeviations: number[] = [];

    const isfProfileData = profile.isfProfile as NonNullable<typeof profile.isfProfile>;

    for (let bucketIdx = 0; bucketIdx < bucketed_data.length - TRAILING_BUCKETS_REQUIRED; ++bucketIdx) {
        const bgTime = new Date(bucketed_data[bucketIdx].date as number);
        const sens = isfLookup(isfProfileData, bgTime);

        // Resolve glucose and deltas
        const glucoseDeltas = resolveGlucoseDeltas(bucketed_data, bucketIdx);
        if (glucoseDeltas === 'skip') continue;
        const { bg, delta, avgDelta } = glucoseDeltas;
        iob_inputs.clock = bgTime;
        iob_inputs.profile.current_basal = getCurrentBasalRate(basalprofile, bgTime) as number;
        const iob = get_iob(iob_inputs as IobInputs, true, treatments)[0];

        const bgImpact = calculateBGImpact(iob.activity, sens);
        const deviation = calculateDeviation(delta, bgImpact);

        // First entry: calculate current deviation
        if (bucketIdx === 0) {
            currentDeviation = Math.round((avgDelta - bgImpact) * ROUND_SCALE_3DP) / ROUND_SCALE_3DP;
            if (carbImpactTime > bgTime) {
                allDeviations.push(Math.round(currentDeviation));
            }
        } else if (carbImpactTime > bgTime) {
            // Subsequent entries within CI window: track deviation slope
            const avgDeviation = Math.round((avgDelta - bgImpact) * ROUND_SCALE_3DP) / ROUND_SCALE_3DP;
            const deviationSlope = (avgDeviation - (currentDeviation as number)) / (bgTime.getTime() - carbImpactTime.getTime()) * MS_PER_5_MIN;

            if (avgDeviation > maxDeviation) {
                slopeFromMaxDeviation = Math.min(0, deviationSlope);
                maxDeviation = avgDeviation;
            }
            if (avgDeviation < minDeviation) {
                slopeFromMinDeviation = Math.max(0, deviationSlope);
                minDeviation = avgDeviation;
            }

            allDeviations.push(Math.round(avgDeviation));
        }

        // After meal: estimate carb absorption from deviations
        if (bgTime > mealTime) {
            const carbImpact = Math.max(deviation, (currentDeviation as number) / CURRENT_DEVIATION_DIVISOR, profile.min_5m_carbimpact as number);
            const absorbed = carbImpact * (profile.carb_ratio as number) / sens;
            carbsAbsorbed += absorbed;
        }
    }

    return {
        carbsAbsorbed,
        currentDeviation: currentDeviation as number,
        maxDeviation,
        minDeviation,
        slopeFromMaxDeviation,
        slopeFromMinDeviation,
        allDeviations,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GlucoseDeltas {
    bg: number;
    delta: number;
    avgDelta: number;
}

/**
 * Resolves glucose value and deltas for a bucketed entry.
 * Returns 'skip' when glucose is invalid (< 39), or the NaN-fallthrough
 * result when glucose is undefined (preserving original behavior).
 */
export function resolveGlucoseDeltas(
    bucketed_data: BucketedGlucose[],
    bucketIdx: number,
): GlucoseDeltas | 'skip' {
    if (bucketed_data[bucketIdx].glucose === undefined) {
        console.log("Could not find glucose data");
        return { bg: undefined as unknown as number, delta: NaN, avgDelta: NaN };
    }

    const bg = bucketed_data[bucketIdx].glucose as number;
    const trailingBg = bucketed_data[bucketIdx + TRAILING_BUCKETS_REQUIRED].glucose ?? 0;

    if (bg < MIN_VALID_GLUCOSE_MGDL || trailingBg < MIN_VALID_GLUCOSE_MGDL) {
        console.log("!");
        return 'skip';
    }

    const avgDelta = Math.round(
        (bg - trailingBg) / TRAILING_BUCKETS_REQUIRED * ROUND_SCALE_2DP
    ) / ROUND_SCALE_2DP;
    const delta = bg - (bucketed_data[bucketIdx + 1].glucose ?? 0);

    return { bg, delta, avgDelta };
}
