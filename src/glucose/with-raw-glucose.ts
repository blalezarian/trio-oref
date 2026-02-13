// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum raw glucose value considered usable */
const DEFAULT_MAX_RAW_GLUCOSE = 200;
/** BG threshold (mg/dL) below which raw calibration data is used directly */
const RAW_BG_CALIBRATION_THRESHOLD = 40;
/** CGM noise level: low (raw data within max range) */
const NOISE_LEVEL_LOW_RAW = 2;
/** CGM noise level: high (raw data exceeds max range or no raw data) */
const NOISE_LEVEL_HIGH_RAW = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawGlucoseEntry {
    type?: string;
    glucose?: number;
    sgv?: number;
    unfiltered?: number | string;
    filtered?: number | string;
    raw?: number;
    noise?: number;
    fromRaw?: boolean;
    [key: string]: unknown;
}

interface RawGlucoseCal {
    scale: number | string;
    intercept: number | string;
    slope: number | string;
    [key: string]: unknown;
}

interface CleanCal {
    scale: number;
    intercept: number;
    slope: number;
    valid: boolean;
    filtered?: number;
    unfiltered?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse and validate a calibration record into numeric fields */
function cleanCal(cal: RawGlucoseCal): CleanCal {
    const scale = parseFloat(cal.scale as string) || 0;
    const intercept = parseFloat(cal.intercept as string) || 0;
    const slope = parseFloat(cal.slope as string) || 0;

    return {
        scale,
        intercept,
        slope,
        valid: !(slope === 0 || scale === 0),
    };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Enrich a glucose entry with raw calibration data and noise classification */
function withRawGlucose(
    entry: RawGlucoseEntry,
    cals: RawGlucoseCal[] | null | undefined,
    maxRaw?: number,
): RawGlucoseEntry {
    const effectiveMaxRaw = maxRaw || DEFAULT_MAX_RAW_GLUCOSE;
    if (entry.type === "mbg" || entry.type === "cal") {
        return entry;
    }

    const egv = entry.glucose || entry.sgv || 0;

    const unfilteredVal = parseInt(entry.unfiltered as string) || 0;
    const filteredVal = parseInt(entry.filtered as string) || 0;
    entry.unfiltered = unfilteredVal;
    entry.filtered = filteredVal;

    // TODO: add time check, but how recent should it be?
    // TODO: currently assuming the first is the best (and that there is probably just 1 cal)
    const cal = cals && cals.length > 0 && cleanCal(cals[0]);

    if (cal && cal.valid) {
        if (cal.filtered === 0 || egv < RAW_BG_CALIBRATION_THRESHOLD) {
            entry.raw = Math.round(cal.scale * (unfilteredVal - cal.intercept) / cal.slope);
        } else {
            const ratio = cal.scale * (filteredVal - cal.intercept) / cal.slope / egv;
            entry.raw = Math.round(cal.scale * (unfilteredVal - cal.intercept) / cal.slope / ratio);
        }

        if (egv < RAW_BG_CALIBRATION_THRESHOLD) {
            if (entry.raw) {
                entry.glucose = entry.raw;
                entry.fromRaw = true;
                entry.noise = entry.raw <= effectiveMaxRaw
                    ? NOISE_LEVEL_LOW_RAW
                    : NOISE_LEVEL_HIGH_RAW;
            } else {
                entry.noise = NOISE_LEVEL_HIGH_RAW;
            }
        } else if (!entry.noise) {
            entry.noise = 0;
        }
    }

    return entry;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default withRawGlucose;
export {
    withRawGlucose,
    // Helpers
    cleanCal,
};
export type { RawGlucoseEntry, RawGlucoseCal, CleanCal };
