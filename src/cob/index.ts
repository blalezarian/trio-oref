import find_insulin from '../iob/history';
import { normalizeGlucoseData } from '../utils/glucose-math';
import { bucketGlucoseWithInterpolation } from './bucket-glucose';
import { analyzeAbsorption } from './deviation-loop';
import type { GlucoseEntry, PumpHistoryEvent } from '../types/index';
import type { IobProfile, HistoryBasalProfileEntry, IobInputs } from '../iob/types';
import type { CarbAbsorptionResult } from './deviation-loop';

interface CarbAbsorptionInputs {
  glucose_data: GlucoseEntry[] | undefined;
  iob_inputs: {
    profile: IobProfile;
    history: PumpHistoryEvent[];
    clock?: string | Date;
  };
  basalprofile: HistoryBasalProfileEntry[];
  mealTime: number | string | Date;
  ciTime?: number | string | Date;
}

export function detectCarbAbsorption(inputs: CarbAbsorptionInputs): CarbAbsorptionResult {

    let profile: IobProfile;
    const glucose_data = normalizeGlucoseData(inputs.glucose_data!);
    const iob_inputs = inputs.iob_inputs;
    const basalprofile = inputs.basalprofile;
    /* TODO why does declaring profile break tests-command-behavior.tests.sh? */
    profile = inputs.iob_inputs.profile;
    const mealTime = new Date(inputs.mealTime as string | number);
    const ciTime = new Date(inputs.ciTime as string | number);

    //console.error(mealTime, ciTime);

    // get treatments from pumphistory once, not every time we get_iob()
    const treatments = find_insulin(inputs.iob_inputs as IobInputs);

    const bucketed_data = bucketGlucoseWithInterpolation(
        glucose_data,
        mealTime,
        ciTime,
        profile.maxMealAbsorptionTime!
    );

    return analyzeAbsorption(
        bucketed_data,
        iob_inputs,
        basalprofile,
        profile,
        treatments,
        mealTime,
        ciTime
    );
}
