// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DosedOpts {
    start: Date;
    end: Date;
    treatments: DosedTreatment[] | undefined;
    profile: Record<string, unknown>;
}

interface DosedTreatment {
    insulin?: number | null;
    date: number;
}

interface DosedResult {
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
function insulinDosed(opts: DosedOpts): DosedResult | Record<string, never> {
    const start = opts.start.getTime();
    const end = opts.end.getTime();
    const treatments = opts.treatments;

    if (!treatments) {
        console.error("No treatments to process.");
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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default insulinDosed;
export { insulinDosed };
export type { DosedOpts, DosedTreatment, DosedResult };
