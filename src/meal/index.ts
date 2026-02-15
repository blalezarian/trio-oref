import { findMealInputs } from './history';
import { recentCarbs } from './total';
import type { PumpHistoryEvent, GlucoseEntry, BasalProfileEntry } from '../types/index';
import type { IobProfile } from '../iob/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MealGenerateInputs {
    history: PumpHistoryEvent[];
    carbs: PumpHistoryEvent[];
    profile: IobProfile;
    clock: string;
    glucose?: GlucoseEntry[];
    basalprofile: BasalProfileEntry[];
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Generate meal data by extracting treatments from history and computing carb totals */
function generate(inputs: MealGenerateInputs): ReturnType<typeof recentCarbs> {
    const treatments = findMealInputs(inputs);

    const opts = {
        treatments,
        profile: inputs.profile,
        pumphistory: inputs.history,
        glucose: inputs.glucose,
        basalprofile: inputs.basalprofile,
    };

    const clock = new Date(inputs.clock);

    return recentCarbs(opts, clock);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default generate;
export { generate };
export type { MealGenerateInputs };
