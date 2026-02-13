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
    let slopeFromMinDeviation = 999;
    let maxDeviation = 0;
    let minDeviation = 999;
    const allDeviations: number[] = [];

    const isfProfileData = profile.isfProfile as NonNullable<typeof profile.isfProfile>;

    for (let i = 0; i < bucketed_data.length - TRAILING_BUCKETS_REQUIRED; ++i) {
        const bgTime = new Date(bucketed_data[i].date as number);
        const sens = isfLookup(isfProfileData, bgTime);

        // Resolve glucose and deltas (if glucose undefined, values stay undefined/NaN)
        let bg: number;
        let avgDelta = NaN;
        let delta = NaN;
        if (bucketed_data[i].glucose !== undefined) {
            bg = bucketed_data[i].glucose as number;
            if (bg < MIN_VALID_GLUCOSE_MGDL || (bucketed_data[i + TRAILING_BUCKETS_REQUIRED].glucose ?? 0) < MIN_VALID_GLUCOSE_MGDL) {
                process.stderr.write("!");
                continue;
            }
            avgDelta = (bg - (bucketed_data[i + TRAILING_BUCKETS_REQUIRED].glucose ?? 0)) / TRAILING_BUCKETS_REQUIRED;
            delta = bg - (bucketed_data[i + 1].glucose ?? 0);
        } else {
            console.error("Could not find glucose data");
        }

        avgDelta = Math.round(avgDelta * ROUND_SCALE_2DP) / ROUND_SCALE_2DP;
        iob_inputs.clock = bgTime;
        iob_inputs.profile.current_basal = getCurrentBasalRate(basalprofile, bgTime) as number;
        const iob = get_iob(iob_inputs as IobInputs, true, treatments)[0];

        const bgImpact = calculateBGImpact(iob.activity, sens);
        const deviation = calculateDeviation(delta, bgImpact);

        // First entry: calculate current deviation
        if (i === 0) {
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
            const carbImpact = Math.max(deviation, (currentDeviation as number) / 2, profile.min_5m_carbimpact as number);
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
