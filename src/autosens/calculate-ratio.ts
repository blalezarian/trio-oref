import { percentile } from '../utils/percentile';
import { roundTo2dp } from '../utils/rounding';
import { MEDIAN_PERCENTILE } from '../shared/constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Deviations per hour (60 min / 5 min intervals) */
const DEVIATIONS_PER_HOUR = 12;
/** Multiplier to convert fraction to percentage */
const PERCENT_MULTIPLIER = 100;
/** Upper bound for percentile scan loop */
const PERCENTILE_SCAN_HIGH = 0.9;
/** Lower bound for percentile scan loop */
const PERCENTILE_SCAN_LOW = 0.1;
/** Step size for percentile scan loop */
const PERCENTILE_SCAN_STEP = 0.01;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutosensResult {
    ratio: number;
    newisf: number;
}

interface AutosensProfile {
    sens: number;
    max_daily_basal: number;
    autosens_min: number;
    autosens_max: number;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Calculate final autosens ratio and adjusted ISF */
export function calculateAutosensRatio(
    deviations: number[],
    pSensitive: number,
    pResistant: number,
    profile: AutosensProfile,
): AutosensResult {
    const squareDeviations = deviations.reduce(
        (acc, deviation) => acc + deviation * deviation,
        0,
    );
    const rmsDev = Math.sqrt(squareDeviations / deviations.length);
    console.log(`RMS deviation: ${rmsDev.toFixed(2)}`);

    let basalOff = 0;

    if (pSensitive < 0) {
        basalOff = pSensitive * DEVIATIONS_PER_HOUR / profile.sens;
        console.log("Insulin sensitivity detected: ");
    } else if (pResistant > 0) {
        basalOff = pResistant * DEVIATIONS_PER_HOUR / profile.sens;
        console.log("Insulin resistance detected: ");
    } else {
        console.log("Sensitivity normal.");
    }

    let ratio = 1 + (basalOff / profile.max_daily_basal);

    const rawRatio = ratio;
    ratio = Math.max(ratio, profile.autosens_min);
    ratio = Math.min(ratio, profile.autosens_max);

    if (ratio !== rawRatio) {
        console.log(`Ratio limited from ${rawRatio} to ${ratio}`);
    }

    ratio = roundTo2dp(ratio);
    const newisf = Math.round(profile.sens / ratio);
    console.log(`ISF adjusted from ${profile.sens} to ${newisf}`);

    return { ratio, newisf };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pad sparse deviation data with zeros to dampen sensitivity swings.
 * When we have less than targetLength deviations, add up to maxPadding
 * zero entries proportional to data sparseness. Mutates in-place.
 */
export function padDeviations(
    deviations: number[],
    targetLength: number,
    maxPadding: number,
): void {
    if (deviations.length < targetLength) {
        const pad = Math.round((1 - deviations.length / targetLength) * maxPadding);
        console.log(`Adding ${pad} more zero deviations`);
        deviations.push(...Array(pad).fill(0));
    }
}

/** Analyze deviation percentiles to detect sensitivity/resistance patterns */
export function analyzePercentiles(
    deviations: number[],
    avgDeltas: number[],
    bgis: number[],
): { pSensitive: number; pResistant: number } {
    // Mutates input arrays, matching original behavior
    avgDeltas.sort((a, b) => a - b);
    bgis.sort((a, b) => a - b);
    deviations.sort((a, b) => a - b);

    for (let threshold = PERCENTILE_SCAN_HIGH; threshold > PERCENTILE_SCAN_LOW; threshold -= PERCENTILE_SCAN_STEP) {
        if (percentile(deviations, threshold + PERCENTILE_SCAN_STEP) >= 0
            && percentile(deviations, threshold) < 0) {
            const lessThanZero = Math.round(PERCENT_MULTIPLIER * threshold);
            console.log(`${lessThanZero}% of non-meal deviations negative (>50% = sensitivity)`);
        }
        if (percentile(deviations, threshold + PERCENTILE_SCAN_STEP) > 0
            && percentile(deviations, threshold) <= 0) {
            const greaterThanZero = PERCENT_MULTIPLIER - Math.round(PERCENT_MULTIPLIER * threshold);
            console.log(`${greaterThanZero}% of non-meal deviations positive (>50% = resistance)`);
        }
    }

    const pSensitive = percentile(deviations, MEDIAN_PERCENTILE);
    const pResistant = percentile(deviations, MEDIAN_PERCENTILE);

    return { pSensitive, pResistant };
}
