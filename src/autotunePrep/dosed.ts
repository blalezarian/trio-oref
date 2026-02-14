// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DosedOpts {
    start: Date;
    end: Date;
    treatments: DosedTreatment[] | undefined;
    profile: Record<string, unknown>;
}

export interface DosedTreatment {
    insulin?: number | null;
    date: number;
}

export interface DosedResult {
    insulin: number;
}

import { roundTo3dp } from '../utils/rounding';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Sum insulin dosed between start and end timestamps */
export function insulinDosed(opts: DosedOpts): { insulin?: number } {
    const start = opts.start.getTime();
    const end = opts.end.getTime();
    const treatments = opts.treatments;

    if (!treatments) {
        console.log("No treatments to process.");
        return {};
    }

    let total = 0;
    for (const treatment of treatments) {
        if (treatment.insulin && treatment.date > start && treatment.date <= end) {
            total += treatment.insulin;
        }
    }

    return {
        insulin: roundTo3dp(total),
    };
}

