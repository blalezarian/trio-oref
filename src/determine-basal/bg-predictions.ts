import {
    MINUTES_PER_HOUR,
    PRED_BG_MAX_LENGTH,
    PRED_INTERVAL_MINUTES,
    DYNAMIC_ISF_LOG_DENOMINATOR,
    MIN_VALID_GLUCOSE_MGDL,
    MAX_VALID_GLUCOSE_MGDL,
    INSULIN_PEAK_WAIT_MINUTES,
} from '../shared/constants';

import type {
    IOBData,
    IOBEntry,
    MealData,
} from '../types/index';

import {
    UAM_DECAY_HOURS,
    MIN_PRED_TRIM_POINTS,
    MIN_ZT_TRIM_POINTS,
    COB_PRED_BG_CAP,
    PRED_BG_SENTINEL,
    LINEAR_DECAY_FACTOR,
} from './constants';

import type {
    PredBGs,
    BGPredictionResult,
    ClipAndTrimInputs,
    ClipAndTrimResult,
    MinGuardBGInputs,
    MinGuardBGResult,
} from './types';

import { round } from './helpers';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Generates predicted BG arrays (IOB, ZT, COB, UAM) and computes min/max prediction values for dosing decisions. */
export function generateBGPredictions(
    iobArray: IOBData[],
    eventualBG: number,
    bg: number,
    adjustedSens: number,
    carbImpact: number,
    carbImpactDuration: number,
    uamCarbImpact: number,
    remainingCATime: number,
    remainingCIpeak: number,
    slopeFromDeviations: number,
    dynISFenabled: boolean,
    enable_sigmoid: boolean,
    tdd: number,
    adjustmentFactor: number,
    insulinFactor: number,
    enableUAM: boolean | undefined,
    target_bg: number,
    threshold: number,
    meal_data: MealData,
): BGPredictionResult {
    // Prediction arrays (seeded with current BG)
    const IOBpredBGs: number[] = [bg];
    const ZTpredBGs: number[] = [bg];
    const COBpredBGs: number[] = [bg];
    const UAMpredBGs: number[] = [bg];

    // Min/max prediction tracking (sentinel = not yet calculated)
    let minIOBPredBG = PRED_BG_SENTINEL;
    let minCOBPredBG = PRED_BG_SENTINEL;
    let minUAMPredBG = PRED_BG_SENTINEL;
    let minIOBGuardBG = PRED_BG_SENTINEL;
    let minCOBGuardBG = PRED_BG_SENTINEL;
    let minUAMGuardBG = PRED_BG_SENTINEL;
    let minZTGuardBG = PRED_BG_SENTINEL;
    let maxIOBPredBG = bg;
    let maxCOBPredBG = bg;

    // Running loop state
    let IOBpredBG = eventualBG;
    let COBpredBG: number | undefined;
    let UAMpredBG: number | undefined;
    let UAMduration = 0;
    let remainingCItotal = 0;
    const predCIs: number[] = [];
    const remainingCIs: number[] = [];

    // Loop-invariant: dynamic ISF logarithmic path flag
    const useDynISFLog = dynISFenabled && !enable_sigmoid;

    // Loop-invariant: insulin peak timing for minPredBG calculations
    // look ahead 60m (regardless of insulin type) so as to be less aggressive on slower insulins
    // add 30m to allow for insulin delivery (SMBs or temps) = 90m total
    const insulinPeak5m = INSULIN_PEAK_WAIT_MINUTES / PRED_INTERVAL_MINUTES;

    try {
        iobArray.forEach((iobTick: IOBData) => {
            // --- IOB + ZT prediction step ---
            const iobZT = predictIOBandZT(
                iobTick, IOBpredBGs, ZTpredBGs, adjustedSens, carbImpact,
                useDynISFLog, tdd, adjustmentFactor, insulinFactor,
            );
            IOBpredBG = iobZT.IOBpredBG;
            const ZTpredBG = iobZT.ZTpredBG;
            const predBGI = iobZT.predBGI;
            const predDev = iobZT.predDev;

            // --- COB prediction step ---
            const cob = predictCOB(
                COBpredBGs, carbImpact, carbImpactDuration, remainingCATime, remainingCIpeak, predBGI, predDev,
            );
            COBpredBG = cob.COBpredBG;
            remainingCItotal += cob.predCI + cob.remainingCI;
            remainingCIs.push(round(cob.remainingCI, 0));
            predCIs.push(round(cob.predCI, 0));

            // --- UAM prediction step ---
            const uam = predictUAM(
                iobTick, UAMpredBGs, uamCarbImpact, slopeFromDeviations,
                predBGI, predDev, useDynISFLog, tdd, adjustmentFactor, insulinFactor,
            );
            UAMpredBG = uam.UAMpredBG;
            if (uam.predUCI > 0) {
                UAMduration = round((UAMpredBGs.length + 1) * PRED_INTERVAL_MINUTES / MINUTES_PER_HOUR, 1);
            }

            // --- Push to arrays (truncate at 4 hours) ---
            if (IOBpredBGs.length < PRED_BG_MAX_LENGTH) { IOBpredBGs.push(IOBpredBG); }
            if (COBpredBGs.length < PRED_BG_MAX_LENGTH) { COBpredBGs.push(COBpredBG); }
            if (UAMpredBGs.length < PRED_BG_MAX_LENGTH) { UAMpredBGs.push(UAMpredBG); }
            if (ZTpredBGs.length < PRED_BG_MAX_LENGTH) { ZTpredBGs.push(ZTpredBG); }

            // --- Update guard BGs (no wait — tracks minimum from the start) ---
            if (COBpredBG < minCOBGuardBG) { minCOBGuardBG = round(COBpredBG); }
            if (UAMpredBG < minUAMGuardBG) { minUAMGuardBG = round(UAMpredBG); }
            if (IOBpredBG < minIOBGuardBG) { minIOBGuardBG = round(IOBpredBG); }
            if (ZTpredBG < minZTGuardBG) { minZTGuardBG = round(ZTpredBG); }

            // --- Update min/max pred BGs (after insulin peak wait) ---
            if (IOBpredBGs.length > insulinPeak5m && (IOBpredBG < minIOBPredBG)) { minIOBPredBG = round(IOBpredBG); }
            if (IOBpredBG > maxIOBPredBG) { maxIOBPredBG = IOBpredBG; }
            if ((carbImpactDuration || remainingCIpeak > 0) && COBpredBGs.length > insulinPeak5m && (COBpredBG < minCOBPredBG)) { minCOBPredBG = round(COBpredBG); }
            if ((carbImpactDuration || remainingCIpeak > 0) && COBpredBG > maxIOBPredBG) { maxCOBPredBG = COBpredBG; }
            if (enableUAM && UAMpredBGs.length > MIN_PRED_TRIM_POINTS && (UAMpredBG < minUAMPredBG)) { minUAMPredBG = round(UAMpredBG); }
        });
        // set eventualBG to include effect of carbs
    } catch (e) {
        console.log("Problem with iobArray.  Optional feature Advanced Meal Assist disabled");
    }

    const clipResult = clipAndTrimPredictions({
        IOBpredBGs,
        ZTpredBGs,
        COBpredBGs,
        UAMpredBGs,
        eventualBG,
        target_bg,
        mealCOB: meal_data.mealCOB,
        carbImpact,
        remainingCIpeak,
        enableUAM,
        predCIs,
        remainingCIs,
    });
    eventualBG = clipResult.eventualBG;

    const minGuardResult = calculateMinAndGuardBGs({
        minIOBPredBG,
        minCOBPredBG,
        minUAMPredBG,
        minCOBGuardBG,
        minUAMGuardBG,
        minIOBGuardBG,
        minZTGuardBG,
        IOBpredBG,
        COBpredBG,
        UAMpredBG,
        bg,
        maxCOBPredBG,
        threshold,
        target_bg,
        mealCOB: meal_data.mealCOB,
        carbs: meal_data.carbs,
        carbImpactDuration,
        remainingCIpeak,
        enableUAM,
        uamCarbImpact,
        UAMduration,
    });

    return {
        eventualBG,
        minPredBG: minGuardResult.minPredBG,
        minGuardBG: minGuardResult.minGuardBG,
        lastIOBpredBG: clipResult.lastIOBpredBG,
        lastCOBpredBG: Number(clipResult.lastCOBpredBG),
        lastUAMpredBG: Number(clipResult.lastUAMpredBG),
        maxCOBPredBG,
        minIOBPredBG: minGuardResult.minIOBPredBG,
        IOBpredBGs,
        COBpredBGs,
        predBGs: clipResult.predBGs,
    };
}

// ---------------------------------------------------------------------------
// Extracted helpers
// ---------------------------------------------------------------------------

/** Calculates BG impact for a single prediction tick using the logarithmic dynamic ISF formula. */
export function calculateDynISFBGImpact(
    activity: number,
    lastPredBG: number,
    tdd: number,
    adjustmentFactor: number,
    insulinFactor: number,
): number {
    const dynamicSens = DYNAMIC_ISF_LOG_DENOMINATOR / (
        tdd * adjustmentFactor * Math.log(Math.max(lastPredBG, MIN_VALID_GLUCOSE_MGDL) / insulinFactor + 1)
    );
    return round(-activity * dynamicSens * PRED_INTERVAL_MINUTES, 2);
}

// ---------------------------------------------------------------------------
// Per-tick prediction helpers (called once per iobArray element)
// ---------------------------------------------------------------------------

/** Computes IOB and ZT predicted BG for a single tick, using either dynamic-ISF or standard formula. */
export function predictIOBandZT(
    iobTick: IOBData,
    IOBpredBGs: number[],
    ZTpredBGs: number[],
    adjustedSens: number,
    carbImpact: number,
    useDynISFLog: boolean,
    tdd: number,
    adjustmentFactor: number,
    insulinFactor: number,
): { IOBpredBG: number; ZTpredBG: number; predBGI: number; predDev: number } {
    const predBGI = round(-iobTick.activity * adjustedSens * PRED_INTERVAL_MINUTES, 2);
    const predZTBGI = round(-(iobTick.iobWithZeroTemp as IOBEntry).activity * adjustedSens * PRED_INTERVAL_MINUTES, 2);
    // predicted deviation impact drops linearly from current deviation down to zero over 60 minutes
    const predDev = carbImpact * (1 - Math.min(1, IOBpredBGs.length / (MINUTES_PER_HOUR / PRED_INTERVAL_MINUTES)));

    let IOBpredBG: number;
    let ZTpredBG: number;

    if (useDynISFLog) {
        const dynIOBBGI = calculateDynISFBGImpact(iobTick.activity, IOBpredBGs[IOBpredBGs.length - 1], tdd, adjustmentFactor, insulinFactor);
        const dynZTBGI = calculateDynISFBGImpact((iobTick.iobWithZeroTemp as IOBEntry).activity, ZTpredBGs[ZTpredBGs.length - 1], tdd, adjustmentFactor, insulinFactor);
        IOBpredBG = IOBpredBGs[IOBpredBGs.length - 1] + dynIOBBGI + predDev;
        ZTpredBG = ZTpredBGs[ZTpredBGs.length - 1] + dynZTBGI;
        console.log(`Dynamic ISF (Logarithmic Formula) adjusted predictions for IOB and ZT: IOBpredBG: ${round(IOBpredBG, 2)} , ZTpredBG: ${round(ZTpredBG, 2)}`);
    } else {
        IOBpredBG = IOBpredBGs[IOBpredBGs.length - 1] + predBGI + predDev;
        ZTpredBG = ZTpredBGs[ZTpredBGs.length - 1] + predZTBGI;
    }

    return { IOBpredBG, ZTpredBG, predBGI, predDev };
}

/** Computes COB predicted BG for a single tick, including linear-decay carb impact and remaining-CI bilinear curve. */
export function predictCOB(
    COBpredBGs: number[],
    carbImpact: number,
    carbImpactDuration: number,
    remainingCATime: number,
    remainingCIpeak: number,
    predBGI: number,
    predDev: number,
): { COBpredBG: number; predCI: number; remainingCI: number } {
    // predicted carb impact drops linearly from current carb impact down to zero
    // eventually accounting for all carbs (if they can be absorbed over DIA)
    const predCI = Math.max(0, Math.max(0, carbImpact) * (1 - COBpredBGs.length / Math.max(carbImpactDuration * LINEAR_DECAY_FACTOR, 1)));
    // if any carbs aren't absorbed after remainingCATime hours, assume they'll absorb in a /\ shaped
    // bilinear curve peaking at remainingCIpeak at remainingCATime/2 hours
    // and ending at remainingCATime h
    const intervals = Math.min(COBpredBGs.length, (remainingCATime * (MINUTES_PER_HOUR / PRED_INTERVAL_MINUTES)) - COBpredBGs.length);
    const remainingCI = Math.max(0, intervals / (remainingCATime / LINEAR_DECAY_FACTOR * (MINUTES_PER_HOUR / PRED_INTERVAL_MINUTES)) * remainingCIpeak);
    const COBpredBG = COBpredBGs[COBpredBGs.length - 1] + predBGI + Math.min(0, predDev) + predCI + remainingCI;

    return { COBpredBG, predCI, remainingCI };
}

/** Computes UAM predicted BG for a single tick, using slope-based or linear-decay carb impact. */
export function predictUAM(
    iobTick: IOBData,
    UAMpredBGs: number[],
    uamCarbImpact: number,
    slopeFromDeviations: number,
    predBGI: number,
    predDev: number,
    useDynISFLog: boolean,
    tdd: number,
    adjustmentFactor: number,
    insulinFactor: number,
): { UAMpredBG: number; predUCI: number } {
    // predicted CI from UAM based on slopeFromDeviations
    const predUCIslope = Math.max(0, uamCarbImpact + (UAMpredBGs.length * slopeFromDeviations));
    // if slopeFromDeviations is too flat, predicted deviation impact drops linearly from
    // current deviation down to zero over 3h
    const predUCImax = Math.max(0, uamCarbImpact * (1 - UAMpredBGs.length / Math.max(UAM_DECAY_HOURS * MINUTES_PER_HOUR / PRED_INTERVAL_MINUTES, 1)));
    // predicted CI from UAM is the lesser of CI based on deviationSlope or DIA
    const predUCI = Math.min(predUCIslope, predUCImax);

    let UAMpredBG: number;
    if (useDynISFLog) {
        const dynUAMBGI = calculateDynISFBGImpact(iobTick.activity, UAMpredBGs[UAMpredBGs.length - 1], tdd, adjustmentFactor, insulinFactor);
        UAMpredBG = UAMpredBGs[UAMpredBGs.length - 1] + dynUAMBGI + Math.min(0, predDev) + predUCI;
        console.log(`Dynamic ISF (Logarithmic Formula) adjusted prediction for UAM: UAMpredBG: ${round(Number(UAMpredBG), 2)}`);
    } else {
        UAMpredBG = UAMpredBGs[UAMpredBGs.length - 1] + predBGI + Math.min(0, predDev) + predUCI;
    }

    return { UAMpredBG, predUCI };
}

/** Clips prediction arrays to valid BG range, trims flat tails, and builds the PredBGs result object. */
export function clipAndTrimPredictions(inputs: ClipAndTrimInputs): ClipAndTrimResult {
    const {
        IOBpredBGs,
        ZTpredBGs,
        COBpredBGs,
        UAMpredBGs,
        target_bg,
        mealCOB,
        carbImpact,
        remainingCIpeak,
        enableUAM,
        predCIs,
        remainingCIs,
    } = inputs;
    let eventualBG = inputs.eventualBG;
    let lastCOBpredBG: number | undefined;
    let lastUAMpredBG: number | undefined;

    if (mealCOB) {
        console.log(`predCIs (mg/dL/5m):${predCIs.join(" ")}`);
        console.log(`remainingCIs:      ${remainingCIs.join(" ")}`);
    }

    const predBGs: PredBGs = {} as PredBGs;

    // IOB: clip to [39, 401], trim flat tail
    clipAndTrimFlatTail(IOBpredBGs, MIN_VALID_GLUCOSE_MGDL, MAX_VALID_GLUCOSE_MGDL + 1, MIN_PRED_TRIM_POINTS);
    predBGs.IOB = IOBpredBGs;
    const lastIOBpredBG = round(IOBpredBGs[IOBpredBGs.length - 1]);

    // ZT: clip to [39, 401], trim rising-above-target tail
    clipArray(ZTpredBGs, MIN_VALID_GLUCOSE_MGDL, MAX_VALID_GLUCOSE_MGDL + 1);
    trimRisingAboveTarget(ZTpredBGs, target_bg, MIN_ZT_TRIM_POINTS);
    predBGs.ZT = ZTpredBGs;

    // COB: clip to [39, 1500], trim flat tail (only if mealCOB and carb impact present)
    if (mealCOB > 0 && ( carbImpact > 0 || remainingCIpeak > 0 )) {
        clipAndTrimFlatTail(COBpredBGs, MIN_VALID_GLUCOSE_MGDL, COB_PRED_BG_CAP, MIN_PRED_TRIM_POINTS);
        predBGs.COB = COBpredBGs;
        lastCOBpredBG = round(COBpredBGs[COBpredBGs.length - 1]);
        eventualBG = Math.max(eventualBG, round(COBpredBGs[COBpredBGs.length-1]));
        console.log(`COBpredBG: ${round(COBpredBGs[COBpredBGs.length - 1])}`);
    }

    // UAM: clip to [39, 401], trim flat tail (only if carb impact present and UAM enabled)
    if ((carbImpact > 0 || remainingCIpeak > 0) && enableUAM) {
        clipAndTrimFlatTail(UAMpredBGs, MIN_VALID_GLUCOSE_MGDL, MAX_VALID_GLUCOSE_MGDL + 1, MIN_PRED_TRIM_POINTS);
        predBGs.UAM = UAMpredBGs;
        lastUAMpredBG = round(UAMpredBGs[UAMpredBGs.length - 1]);
        if (UAMpredBGs[UAMpredBGs.length-1]) {
            eventualBG = Math.max(eventualBG, round(UAMpredBGs[UAMpredBGs.length-1]) );
        }
    }

    return { predBGs, lastIOBpredBG, lastCOBpredBG, lastUAMpredBG, eventualBG };
}

// ---------------------------------------------------------------------------
// clipAndTrimPredictions helpers
// ---------------------------------------------------------------------------

/** Clips all values in arr in-place to [min, max], rounding each. */
function clipArray(arr: number[], min: number, max: number): void {
    for (let idx = 0; idx < arr.length; idx++) {
        arr[idx] = round(Math.min(max, Math.max(min, arr[idx])));
    }
}

/** Clips values to [min, max] and trims flat (unchanged) tail values from the end. */
function clipAndTrimFlatTail(arr: number[], min: number, max: number, minPoints: number): void {
    clipArray(arr, min, max);
    for (let idx = arr.length - 1; idx > minPoints; idx--) {
        if (arr[idx - 1] !== arr[idx]) break;
        arr.pop();
    }
}

/** Trims tail values from ZT predictions that are rising and above target. */
function trimRisingAboveTarget(arr: number[], target_bg: number, minPoints: number): void {
    for (let idx = arr.length - 1; idx > minPoints; idx--) {
        // stop displaying ZTpredBGs once they're rising and above target
        if (arr[idx - 1] >= arr[idx] || arr[idx] <= target_bg) break;
        arr.pop();
    }
}

/** Selects min predicted BG, guard BG, and average predicted BG from all prediction scenarios. */
export function calculateMinAndGuardBGs(inputs: MinGuardBGInputs): MinGuardBGResult {
    let {
        minIOBPredBG,
        minCOBPredBG,
        minUAMPredBG,
    } = inputs;
    const {
        minCOBGuardBG,
        minUAMGuardBG,
        minIOBGuardBG,
        minZTGuardBG,
        IOBpredBG,
        COBpredBG,
        UAMpredBG,
        bg,
        maxCOBPredBG,
        threshold,
        target_bg,
        mealCOB,
        carbs,
        carbImpactDuration,
        remainingCIpeak,
        enableUAM,
        uamCarbImpact,
        UAMduration,
    } = inputs;

    console.log(`UAM Impact:${uamCarbImpact}mg/dL per 5m; UAM Duration:${UAMduration}hours`);

    minIOBPredBG = Math.max(MIN_VALID_GLUCOSE_MGDL,minIOBPredBG);
    minCOBPredBG = Math.max(MIN_VALID_GLUCOSE_MGDL,minCOBPredBG);
    minUAMPredBG = Math.max(MIN_VALID_GLUCOSE_MGDL,minUAMPredBG);
    const fractionCarbsLeft = mealCOB / carbs;

    const avgPredBG = calculateAvgPredBG(
        fractionCarbsLeft, minUAMPredBG, minCOBPredBG, minZTGuardBG,
        IOBpredBG, COBpredBG, UAMpredBG,
    );

    const { minGuardBG, minZTUAMPredBG } = blendMinGuardBG(
        fractionCarbsLeft, minCOBGuardBG, minUAMGuardBG, minIOBGuardBG, minZTGuardBG,
        minUAMPredBG, carbImpactDuration, remainingCIpeak, enableUAM,
        threshold, target_bg,
    );

    let minPredBG = selectMinPredBG(
        fractionCarbsLeft, minIOBPredBG, minCOBPredBG, minZTUAMPredBG,
        minGuardBG, avgPredBG, enableUAM, carbs,
    );

// Print summary variables based on predBGs etc.

    let predSummary = `minPredBG: ${minPredBG} minIOBPredBG: ${minIOBPredBG} minZTGuardBG: ${minZTGuardBG}`;
    if (minCOBPredBG < PRED_BG_SENTINEL) {
        predSummary += ` minCOBPredBG: ${minCOBPredBG}`;
    }
    if (minUAMPredBG < PRED_BG_SENTINEL) {
        predSummary += ` minUAMPredBG: ${minUAMPredBG}`;
    }
    console.log(`${predSummary} avgPredBG:${avgPredBG} COB/Carbs:${mealCOB}/${carbs}`);
    // But if the COB line falls off a cliff, don't trust UAM too much:
    // use maxCOBPredBG if it's been set and lower than minPredBG
    if ( maxCOBPredBG > bg ) {
        minPredBG = Math.min(minPredBG, maxCOBPredBG);
    }

    return { minPredBG, minGuardBG, avgPredBG, minIOBPredBG };
}

// ---------------------------------------------------------------------------
// calculateMinAndGuardBGs helpers
// ---------------------------------------------------------------------------

/** Computes weighted average predicted BG from IOB, COB, and UAM prediction scenarios. */
export function calculateAvgPredBG(
    fractionCarbsLeft: number,
    minUAMPredBG: number,
    minCOBPredBG: number,
    minZTGuardBG: number,
    IOBpredBG: number,
    COBpredBG: number | undefined,
    UAMpredBG: number | undefined,
): number {
    // if we have COB and UAM is enabled, average both
    let avgPredBG: number;
    if ( minUAMPredBG < PRED_BG_SENTINEL && minCOBPredBG < PRED_BG_SENTINEL ) {
        // weight COBpredBG vs. UAMpredBG based on how many carbs remain as COB
        avgPredBG = round( (1-fractionCarbsLeft)*Number(UAMpredBG) + fractionCarbsLeft*Number(COBpredBG) );
        // if UAM is disabled, average IOB and COB
    } else if ( minCOBPredBG < PRED_BG_SENTINEL ) {
        avgPredBG = round( (IOBpredBG + Number(COBpredBG))/2 );
        // if we have UAM but no COB, average IOB and UAM
    } else if ( minUAMPredBG < PRED_BG_SENTINEL ) {
        avgPredBG = round( (IOBpredBG + Number(UAMpredBG))/2 );
    } else {
        avgPredBG = round( IOBpredBG );
    }
    // if avgPredBG is below minZTGuardBG, bring it up to that level
    if ( minZTGuardBG > avgPredBG ) {
        avgPredBG = minZTGuardBG;
    }
    return avgPredBG;
}

/** Blends minGuardBG from COB/UAM/IOB guard BGs and computes minZTUAMPredBG safety blend. */
export function blendMinGuardBG(
    fractionCarbsLeft: number,
    minCOBGuardBG: number,
    minUAMGuardBG: number,
    minIOBGuardBG: number,
    minZTGuardBG: number,
    minUAMPredBG: number,
    carbImpactDuration: number,
    remainingCIpeak: number,
    enableUAM: boolean | undefined,
    threshold: number,
    target_bg: number,
): { minGuardBG: number; minZTUAMPredBG: number } {
    // if we have both minCOBGuardBG and minUAMGuardBG, blend according to fractionCarbsLeft
    let minGuardBG: number;
    if ( (carbImpactDuration || remainingCIpeak > 0) ) {
        if ( enableUAM ) {
            minGuardBG = fractionCarbsLeft*minCOBGuardBG + (1-fractionCarbsLeft)*minUAMGuardBG;
        } else {
            minGuardBG = minCOBGuardBG;
        }
    } else if ( enableUAM ) {
        minGuardBG = minUAMGuardBG;
    } else {
        minGuardBG = minIOBGuardBG;
    }
    minGuardBG = round(minGuardBG);
    let minZTUAMPredBG = minUAMPredBG;
    // if minZTGuardBG is below threshold, bring down any super-high minUAMPredBG by averaging
    // this helps prevent UAM from giving too much insulin in case absorption falls off suddenly
    if ( minZTGuardBG < threshold ) {
        minZTUAMPredBG = (minUAMPredBG + minZTGuardBG) / 2;
    // if minZTGuardBG is between threshold and target, blend in the averaging
    } else if ( minZTGuardBG < target_bg ) {
        // target 100, threshold 70, minZTGuardBG 85 gives 50%: (85-70) / (100-70)
        const blendPct = (minZTGuardBG-threshold) / (target_bg-threshold);
        const blendedMinZTGuardBG = minUAMPredBG*blendPct + minZTGuardBG*(1-blendPct);
        minZTUAMPredBG = (minUAMPredBG + blendedMinZTGuardBG) / 2;
    // if minUAMPredBG is below minZTGuardBG, bring minUAMPredBG up by averaging
    // this allows more insulin if lastUAMPredBG is below target, but minZTGuardBG is still high
    } else if ( minZTGuardBG > minUAMPredBG ) {
        minZTUAMPredBG = (minUAMPredBG + minZTGuardBG) / 2;
    }
    minZTUAMPredBG = round(minZTUAMPredBG);
    return { minGuardBG, minZTUAMPredBG };
}

/** Selects the final minPredBG from carb, UAM, and IOB prediction scenarios. */
export function selectMinPredBG(
    fractionCarbsLeft: number,
    minIOBPredBG: number,
    minCOBPredBG: number,
    minZTUAMPredBG: number,
    minGuardBG: number,
    avgPredBG: number,
    enableUAM: boolean | undefined,
    carbs: number,
): number {
    let minPredBG: number = round(minIOBPredBG);
    // if any carbs have been entered recently
    if (carbs) {

        // if UAM is disabled, use max of minIOBPredBG, minCOBPredBG
        if ( ! enableUAM && minCOBPredBG < PRED_BG_SENTINEL ) {
            minPredBG = round(Math.max(minIOBPredBG, minCOBPredBG));
        // if we have COB, use minCOBPredBG, or blendedMinPredBG if it's higher
        } else if ( minCOBPredBG < PRED_BG_SENTINEL ) {
            // calculate blendedMinPredBG based on how many carbs remain as COB
            const blendedMinPredBG = fractionCarbsLeft*minCOBPredBG + (1-fractionCarbsLeft)*minZTUAMPredBG;
            // if blendedMinPredBG > minCOBPredBG, use that instead
            minPredBG = round(Math.max(minIOBPredBG, minCOBPredBG, blendedMinPredBG));
        // if carbs have been entered, but have expired, use minUAMPredBG
        } else if ( enableUAM ) {
            minPredBG = minZTUAMPredBG;
        } else {
            minPredBG = minGuardBG;
        }
    // in pure UAM mode, use the higher of minIOBPredBG,minUAMPredBG
    } else if ( enableUAM ) {
        minPredBG = round(Math.max(minIOBPredBG,minZTUAMPredBG));
    }

    // make sure minPredBG isn't higher than avgPredBG
    minPredBG = Math.min( minPredBG, avgPredBG );

    return minPredBG;
}
