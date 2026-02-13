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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rounding scale for 3 decimal places */
const ROUND_SCALE_3DP = 1000;

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
        insulin: Math.round(total * ROUND_SCALE_3DP) / ROUND_SCALE_3DP,
    };
}

