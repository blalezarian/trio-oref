import { percentile } from '../utils/percentile';

/** Deviations per hour (60 / 5) */
const DEVIATIONS_PER_HOUR = 12;
/** Rounding scale for 2 decimal places */
const ROUND_SCALE_2DP = 100;
/** Percentage multiplier */
const PERCENT = 100;

export interface AutosensResult {
    ratio: number;
    newisf: number;
}

// ---------------------------------------------------------------------------
// Deviation padding
// ---------------------------------------------------------------------------

/**
 * Pad sparse deviation data with zeros to dampen sensitivity swings.
 * When we have less than targetLength deviations, add up to maxPadding
 * zero entries proportional to data sparseness. Mutates in-place.
 */
export function padDeviations(
    deviations: number[],
    targetLength: number,
    maxPadding: number
): void {
    if (deviations.length < targetLength) {
        const pad = Math.round((1 - deviations.length/targetLength) * maxPadding);
        console.error("Adding",pad,"more zero deviations");
        for (let d=0; d<pad; d++) {
            //process.stderr.write(".");
            deviations.push(0);
        }
    }
}

// ---------------------------------------------------------------------------
// Percentile analysis
// ---------------------------------------------------------------------------

/** Analyze deviation percentiles to detect sensitivity/resistance patterns */
export function analyzePercentiles(
    deviations: number[],
    avgDeltas: number[],
    bgis: number[]
): { pSensitive: number; pResistant: number } {
    avgDeltas.sort((a: number, b: number) => {return a-b});
    bgis.sort((a: number, b: number) => {return a-b});
    deviations.sort((a: number, b: number) => {return a-b});
    for (let i=0.9; i > 0.1; i = i - 0.01) {
        //console.error(`p=${i.toFixed(2)}: ${percentile(avgDeltas, i).toFixed(2)}, ${percentile(bgis, i).toFixed(2)}, ${percentile(deviations, i).toFixed(2)}`);
        if ( percentile(deviations, (i+0.01)) >= 0 && percentile(deviations, i) < 0 ) {
            //console.error(`p=${i.toFixed(2)}: ${percentile(avgDeltas, i).toFixed(2)}, ${percentile(bgis, i).toFixed(2)}, ${percentile(deviations, i).toFixed(2)}`);
            const lessThanZero = Math.round(PERCENT*i);
            console.error(`${lessThanZero}% of non-meal deviations negative (>50% = sensitivity)`);
        }
        if ( percentile(deviations, (i+0.01)) > 0 && percentile(deviations, i) <= 0 ) {
            //console.error(`p=${i.toFixed(2)}: ${percentile(avgDeltas, i).toFixed(2)}, ${percentile(bgis, i).toFixed(2)}, ${percentile(deviations, i).toFixed(2)}`);
            const greaterThanZero = PERCENT-Math.round(PERCENT*i);
            console.error(`${greaterThanZero}% of non-meal deviations positive (>50% = resistance)`);
        }
    }
    const pSensitive = percentile(deviations, 0.50);
    const pResistant = percentile(deviations, 0.50);

    return { pSensitive, pResistant };
}

// ---------------------------------------------------------------------------
// Ratio calculation
// ---------------------------------------------------------------------------

interface AutosensProfile {
    sens: number;
    max_daily_basal: number;
    autosens_min: number;
    autosens_max: number;
}

/** Calculate final autosens ratio and adjusted ISF */
export function calculateAutosensRatio(
    deviations: number[],
    deviationSum: number,
    pSensitive: number,
    pResistant: number,
    profile: AutosensProfile
): AutosensResult {
    const average = deviationSum / deviations.length;
    //console.error(`Mean deviation: ${average.toFixed(2)}`);

    const squareDeviations = deviations.reduce((acc: number, dev: number) => acc + dev * dev, 0);
    const rmsDev = Math.sqrt(squareDeviations / deviations.length);
    console.error(`RMS deviation: ${rmsDev.toFixed(2)}`);

    let basalOff = 0;

    if(pSensitive < 0) { // sensitive
        basalOff = pSensitive * DEVIATIONS_PER_HOUR / profile.sens;
        process.stderr.write("Insulin sensitivity detected: ");
    } else if (pResistant > 0) { // resistant
        basalOff = pResistant * DEVIATIONS_PER_HOUR / profile.sens;
        process.stderr.write("Insulin resistance detected: ");
    } else {
        console.error("Sensitivity normal.");
    }
    let ratio: number;
    ratio = 1 + (basalOff / profile.max_daily_basal);
    //console.error(basalOff, profile.max_daily_basal, ratio);

    // don't adjust more than 1.2x by default (set in preferences.json)
    const rawRatio = ratio;
    ratio = Math.max(ratio, profile.autosens_min);
    ratio = Math.min(ratio, profile.autosens_max);

    if (ratio !== rawRatio) {
      console.error(`Ratio limited from ${rawRatio} to ${ratio}`);
    }

    ratio = Math.round(ratio*ROUND_SCALE_2DP)/ROUND_SCALE_2DP;
    let newisf: number;
    newisf = Math.round(profile.sens / ratio);
    //console.error(profile, newisf, ratio);
    console.error(`ISF adjusted from ${profile.sens} to ${newisf}`);
    //console.error(`Basal adjustment ${basalOff.toFixed(2)}U/hr`);
    //console.error(`Ratio: ${ratio*100}%: new ISF: ${newisf.toFixed(1)}mg/dL/U`);
    return {
        "ratio": ratio,
        "newisf": newisf
    }
}
