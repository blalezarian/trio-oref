import { calcTempTreatments as find_insulin } from '../iob/extract-treatments';
import { normalizeGlucoseData } from '../utils/glucose-math';
import { bucketGlucoseWithInterpolation } from './bucket-glucose';
import { analyzeAbsorption } from './deviation-loop';
import type { GlucoseEntry, PumpHistoryEvent } from '../types/index';
import type { IobProfile, HistoryBasalProfileEntry, IobInputs } from '../iob/types';
import type { CarbAbsorptionResult } from './deviation-loop';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CarbAbsorptionInputs {
    glucose_data: GlucoseEntry[] | undefined;
    iob_inputs: {
        profile: IobProfile;
        history: PumpHistoryEvent[];
        clock?: string | Date;
    };
    basalprofile: HistoryBasalProfileEntry[];
    mealTime: number | string | Date;
    carbImpactTime?: number | string | Date;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Orchestrate COB detection: normalize glucose, bucket, and analyze absorption */
export function detectCarbAbsorption(inputs: CarbAbsorptionInputs): CarbAbsorptionResult {
    const profile = inputs.iob_inputs.profile;
    const glucose_data = normalizeGlucoseData(inputs.glucose_data as GlucoseEntry[]);
    const iob_inputs = inputs.iob_inputs;
    const basalprofile = inputs.basalprofile;
    const mealTime = new Date(inputs.mealTime as string | number);
    const carbImpactTime = new Date(inputs.carbImpactTime as string | number);

    // Extract treatments from pump history once (not every get_iob call)
    const treatments = find_insulin(inputs.iob_inputs as IobInputs);

    const bucketed_data = bucketGlucoseWithInterpolation(
        glucose_data,
        mealTime,
        carbImpactTime,
        profile.maxMealAbsorptionTime as number,
    );

    return analyzeAbsorption(
        bucketed_data,
        iob_inputs,
        basalprofile,
        profile,
        treatments,
        mealTime,
        carbImpactTime,
    );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type { CarbAbsorptionInputs };
