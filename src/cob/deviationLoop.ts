import { getCurrentBasalRate } from '../profile/basal';
import { generate as get_iob } from '../iob/index';
import { isfLookup } from '../profile/isf';
import { calculateBGImpact, calculateDeviation } from '../utils/glucoseMath';
import type { BucketedGlucose, ISODateString } from '../types/index';
import type { IobProfile, HistoryBasalProfileEntry, IobInputs, IobTreatment } from '../iob/types';
import {
    MIN_VALID_GLUCOSE_MGDL,
    MS_PER_5_MIN,
    TRAILING_BUCKETS_FOR_DELTA,
} from '../shared/constants';
import { roundTo2dp, roundTo3dp } from '../utils/rounding';
import { resolveGlucoseTime } from '../utils/time';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviationAbsorptionResult {
    carbsAbsorbed: number;
    currentDeviation: number | undefined;
    maxDeviation: number;
    minDeviation: number;
    slopeFromMaxDeviation: number;
    slopeFromMinDeviation: number;
    allDeviations: number[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
    bucketedData: BucketedGlucose[],
    iobInputs: { profile: IobProfile; history: unknown[]; clock?: ISODateString },
    basalprofile: HistoryBasalProfileEntry[],
    profile: IobProfile,
    treatments: IobTreatment[],
    mealTime: Date,
    carbImpactTime: Date,
): DeviationAbsorptionResult {
    let carbsAbsorbed = 0;
    let currentDeviation: number | undefined;
    let slopeFromMaxDeviation = 0;
    let slopeFromMinDeviation = SLOPE_INITIAL_HIGH;
    let maxDeviation = 0;
    let minDeviation = MIN_DEVIATION_INITIAL;
    const allDeviations: number[] = [];

    const isfProfileData = profile.isfProfile as NonNullable<typeof profile.isfProfile>;

    for (let bucketIdx = 0; bucketIdx < bucketedData.length - TRAILING_BUCKETS_FOR_DELTA; ++bucketIdx) {
        const entry = bucketedData[bucketIdx];
        const bgTime = entry.date != null
            ? new Date(entry.date)
            : (resolveGlucoseTime(entry) ?? new Date(NaN));
        const sens = isfLookup(isfProfileData, bgTime);

        // Resolve glucose and deltas
        const glucoseDeltas = resolveGlucoseDeltas(bucketedData, bucketIdx);
        if (glucoseDeltas === 'skip') continue;
        const { bg, delta, avgDelta } = glucoseDeltas;
        iobInputs.clock = bgTime.toISOString();
        iobInputs.profile.current_basal = Number(getCurrentBasalRate(basalprofile, bgTime));
        const iob = get_iob(iobInputs as IobInputs, true, treatments)[0];

        const bgImpact = calculateBGImpact(iob.activity, sens);
        const deviation = calculateDeviation(delta, bgImpact);

        // First entry: calculate current deviation
        if (bucketIdx === 0) {
            currentDeviation = roundTo3dp(avgDelta - bgImpact);
            if (carbImpactTime > bgTime) {
                allDeviations.push(Math.round(currentDeviation));
            }
        } else if (carbImpactTime > bgTime) {
            // Subsequent entries within CI window: track deviation slope
            const avgDeviation = roundTo3dp(avgDelta - bgImpact);
            const deviationSlope = (avgDeviation - Number(currentDeviation)) / (bgTime.getTime() - carbImpactTime.getTime()) * MS_PER_5_MIN;

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
            const carbImpact = Math.max(deviation, Number(currentDeviation) / CURRENT_DEVIATION_DIVISOR, Number(profile.min_5m_carbimpact));
            const absorbed = carbImpact * Number(profile.carb_ratio) / sens;
            carbsAbsorbed += absorbed;
        }
    }

    return {
        carbsAbsorbed,
        currentDeviation,
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
    bucketedData: BucketedGlucose[],
    bucketIdx: number,
): GlucoseDeltas | 'skip' {
    if (bucketedData[bucketIdx].glucose === undefined) {
        console.log("Could not find glucose data");
        return { bg: NaN, delta: NaN, avgDelta: NaN };
    }

    const bg = Number(bucketedData[bucketIdx].glucose);
    const trailingBg = bucketedData[bucketIdx + TRAILING_BUCKETS_FOR_DELTA].glucose ?? 0;

    if (bg < MIN_VALID_GLUCOSE_MGDL || trailingBg < MIN_VALID_GLUCOSE_MGDL) {
        console.log("!");
        return 'skip';
    }

    const avgDelta = roundTo2dp((bg - trailingBg) / TRAILING_BUCKETS_FOR_DELTA);
    const delta = bg - (bucketedData[bucketIdx + 1].glucose ?? 0);

    return { bg, delta, avgDelta };
}
