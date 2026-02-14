import { calcTempTreatments as findInsulin } from '../iob/extractTreatments';
import { normalizeGlucoseData } from '../utils/glucoseMath';
import { bucketGlucoseWithInterpolation } from './bucketGlucose';
import { analyzeAbsorption } from './deviationLoop';
import type { GlucoseEntry, PumpHistoryEvent, ISODateString, EpochMillis } from '../types/index';
import type { IobProfile, HistoryBasalProfileEntry, IobInputs } from '../iob/types';
import type { CarbAbsorptionResult } from './deviationLoop';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CarbAbsorptionInputs {
    glucose_data: GlucoseEntry[] | undefined;
    iob_inputs: {
        profile: IobProfile;
        history: PumpHistoryEvent[];
        clock?: ISODateString;
    };
    basalprofile: HistoryBasalProfileEntry[];
    mealTime: EpochMillis | ISODateString | Date;
    carbImpactTime?: EpochMillis | ISODateString | Date;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Orchestrate COB detection: normalize glucose, bucket, and analyze absorption */
export function detectCarbAbsorption(inputs: CarbAbsorptionInputs): CarbAbsorptionResult {
    const profile = inputs.iob_inputs.profile;
    const glucoseData = normalizeGlucoseData(inputs.glucose_data as GlucoseEntry[]);
    const iobInputs = inputs.iob_inputs;
    const basalprofile = inputs.basalprofile;
    const mealTime = new Date(inputs.mealTime as string | number);
    const carbImpactTime = new Date(inputs.carbImpactTime as string | number);

    // Extract treatments from pump history once (not every get_iob call)
    const treatments = findInsulin(inputs.iob_inputs as IobInputs);

    const bucketedData = bucketGlucoseWithInterpolation(
        glucoseData,
        mealTime,
        carbImpactTime,
        Number(profile.maxMealAbsorptionTime),
    );

    return analyzeAbsorption(
        bucketedData,
        iobInputs,
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
