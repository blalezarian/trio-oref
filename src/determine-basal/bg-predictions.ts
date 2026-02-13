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
    naive_eventualBG: number,
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
// Initialize and calculate variables used for predicting BGs
    const COBpredBGs: number[] = [];
    const IOBpredBGs: number[] = [];
    const UAMpredBGs: number[] = [];
    const ZTpredBGs: number[] = [];
    COBpredBGs.push(bg);
    IOBpredBGs.push(bg);
    ZTpredBGs.push(bg);
    UAMpredBGs.push(bg);

    let minIOBPredBG = PRED_BG_SENTINEL;
    let minCOBPredBG = PRED_BG_SENTINEL;
    let minUAMPredBG = PRED_BG_SENTINEL;
    let minCOBGuardBG = PRED_BG_SENTINEL;
    let minUAMGuardBG = PRED_BG_SENTINEL;
    let minIOBGuardBG = PRED_BG_SENTINEL;
    let minZTGuardBG = PRED_BG_SENTINEL;
    let IOBpredBG = eventualBG;
    let maxIOBPredBG = bg;
    let maxCOBPredBG = bg;
    let UAMduration = 0;
    let remainingCItotal = 0;
    const remainingCIs: number[] = [];
    const predCIs: number[] = [];
    let COBpredBG: number | undefined;
    let UAMpredBG: number | undefined;
    try {
        iobArray.forEach((iobTick: IOBData) => {
            const predBGI = round(( -iobTick.activity * adjustedSens * PRED_INTERVAL_MINUTES ), 2);
            const predZTBGI = round(( -(iobTick.iobWithZeroTemp as IOBEntry).activity * adjustedSens * PRED_INTERVAL_MINUTES ), 2);
            let ZTpredBG = naive_eventualBG;
            // for IOBpredBGs, predicted deviation impact drops linearly from current deviation down to zero
            // over 60 minutes (data points every 5m)
            const predDev = carbImpact * ( 1 - Math.min(1,IOBpredBGs.length/(MINUTES_PER_HOUR/PRED_INTERVAL_MINUTES)) );

            // Adding dynamic ISF in predictions for ZT and IOB. Modification from Tim Street's AAPS but with default as off:
            switch(true) {
                case dynISFenabled && !enable_sigmoid:
                    IOBpredBG = IOBpredBGs[IOBpredBGs.length-1] + (round(( -iobTick.activity * (DYNAMIC_ISF_LOG_DENOMINATOR / ( tdd * adjustmentFactor * (Math.log((Math.max( IOBpredBGs[IOBpredBGs.length-1],MIN_VALID_GLUCOSE_MGDL) / insulinFactor ) + 1 ) ) )) * PRED_INTERVAL_MINUTES ),2)) + predDev;
                    ZTpredBG = ZTpredBGs[ZTpredBGs.length-1] + (round(( -(iobTick.iobWithZeroTemp as IOBEntry).activity * (DYNAMIC_ISF_LOG_DENOMINATOR / ( tdd * adjustmentFactor * (Math.log(( Math.max(ZTpredBGs[ZTpredBGs.length-1],MIN_VALID_GLUCOSE_MGDL) / insulinFactor ) + 1 ) ) )) * PRED_INTERVAL_MINUTES ), 2));
                    console.log(`Dynamic ISF (Logarithmic Formula) adjusted predictions for IOB and ZT: IOBpredBG: ${round(IOBpredBG, 2)} , ZTpredBG: ${round(ZTpredBG, 2)}`);
                    break;
                default:
                    IOBpredBG = IOBpredBGs[IOBpredBGs.length-1] + predBGI + predDev;
                    // calculate predBGs with long zero temp without deviations
                    ZTpredBG = ZTpredBGs[ZTpredBGs.length-1] + predZTBGI;
            }

            // for COBpredBGs, predicted carb impact drops linearly from current carb impact down to zero
            // eventually accounting for all carbs (if they can be absorbed over DIA)
            const predCI = Math.max(0, Math.max(0,carbImpact) * ( 1 - COBpredBGs.length/Math.max(carbImpactDuration*LINEAR_DECAY_FACTOR,1) ) );
            // if any carbs aren't absorbed after remainingCATime hours, assume they'll absorb in a /\ shaped
            // bilinear curve peaking at remainingCIpeak at remainingCATime/2 hours (remainingCATime/2*12 * 5m)
            // and ending at remainingCATime h (remainingCATime*12 * 5m intervals)
            const intervals = Math.min( COBpredBGs.length, (remainingCATime*(MINUTES_PER_HOUR/PRED_INTERVAL_MINUTES))-COBpredBGs.length );
            const remainingCI = Math.max(0, intervals / (remainingCATime/LINEAR_DECAY_FACTOR*(MINUTES_PER_HOUR/PRED_INTERVAL_MINUTES)) * remainingCIpeak );
            remainingCItotal += predCI+remainingCI;
            remainingCIs.push(round(remainingCI,0));
            predCIs.push(round(predCI,0));
            COBpredBG = COBpredBGs[COBpredBGs.length-1] + predBGI + Math.min(0,predDev) + predCI + remainingCI;
            // for UAMpredBGs, predicted carb impact drops at slopeFromDeviations
            // calculate predicted CI from UAM based on slopeFromDeviations
            const predUCIslope = Math.max(0, uamCarbImpact + ( UAMpredBGs.length*slopeFromDeviations ) );
            // if slopeFromDeviations is too flat, predicted deviation impact drops linearly from
            // current deviation down to zero over 3h (data points every 5m)
            const predUCImax = Math.max(0, uamCarbImpact * ( 1 - UAMpredBGs.length/Math.max(UAM_DECAY_HOURS*MINUTES_PER_HOUR/PRED_INTERVAL_MINUTES,1) ) );
            // predicted CI from UAM is the lesser of CI based on deviationSlope or DIA
            const predUCI = Math.min(predUCIslope, predUCImax);
            if(predUCI>0) {
                UAMduration=round((UAMpredBGs.length+1)*PRED_INTERVAL_MINUTES/MINUTES_PER_HOUR,1);
            }

            // Adding dynamic ISF in predictions for UAM. Modification from Tim Street's AAPS but with default as off:
            switch(true) {
                case dynISFenabled && !enable_sigmoid:
                    UAMpredBG = UAMpredBGs[UAMpredBGs.length-1] + (round(( -iobTick.activity * (DYNAMIC_ISF_LOG_DENOMINATOR / ( tdd * adjustmentFactor * (Math.log(( Math.max(UAMpredBGs[UAMpredBGs.length-1],MIN_VALID_GLUCOSE_MGDL) / insulinFactor ) + 1 ) ) )) * PRED_INTERVAL_MINUTES ),2)) + Math.min(0, predDev) + predUCI;
                    console.log(`Dynamic ISF (Logarithmic Formula) adjusted prediction for UAM: UAMpredBG: ${round(UAMpredBG as number, 2)}`);
                    break;
                default:
                    UAMpredBG = UAMpredBGs[UAMpredBGs.length-1] + predBGI + Math.min(0, predDev) + predUCI;
            }
            // truncate all BG predictions at 4 hours
            if ( IOBpredBGs.length < PRED_BG_MAX_LENGTH ) { IOBpredBGs.push(IOBpredBG); }
            if ( COBpredBGs.length < PRED_BG_MAX_LENGTH ) { COBpredBGs.push(COBpredBG); }
            if ( UAMpredBGs.length < PRED_BG_MAX_LENGTH ) { UAMpredBGs.push(UAMpredBG); }
            if ( ZTpredBGs.length < PRED_BG_MAX_LENGTH ) { ZTpredBGs.push(ZTpredBG); }
            // calculate minGuardBGs without a wait from COB, UAM, IOB predBGs
            if ( COBpredBG < minCOBGuardBG ) { minCOBGuardBG = round(COBpredBG); }
            if ( UAMpredBG < minUAMGuardBG ) { minUAMGuardBG = round(UAMpredBG); }
            if ( IOBpredBG < minIOBGuardBG ) { minIOBGuardBG = round(IOBpredBG); }
            if ( ZTpredBG < minZTGuardBG ) { minZTGuardBG = round(ZTpredBG); }

            // set minPredBGs starting when currently-dosed insulin activity will peak
            // look ahead 60m (regardless of insulin type) so as to be less aggressive on slower insulins
            // add 30m to allow for insulin delivery (SMBs or temps)
            const insulinPeakTime = INSULIN_PEAK_WAIT_MINUTES;
            const insulinPeak5m = insulinPeakTime/PRED_INTERVAL_MINUTES;
            // wait 90m before setting minIOBPredBG
            if ( IOBpredBGs.length > insulinPeak5m && (IOBpredBG < minIOBPredBG) ) { minIOBPredBG = round(IOBpredBG); }
            if ( IOBpredBG > maxIOBPredBG ) { maxIOBPredBG = IOBpredBG; }
            // wait 85-105m before setting COB and 60m for UAM minPredBGs
            if ( (carbImpactDuration || remainingCIpeak > 0) && COBpredBGs.length > insulinPeak5m && (COBpredBG < minCOBPredBG) ) { minCOBPredBG = round(COBpredBG); }
            if ( (carbImpactDuration || remainingCIpeak > 0) && COBpredBG > maxIOBPredBG ) { maxCOBPredBG = COBpredBG; }
            if ( enableUAM && UAMpredBGs.length > MIN_PRED_TRIM_POINTS && (UAMpredBG < minUAMPredBG) ) { minUAMPredBG = round(UAMpredBG); }
        });
        // set eventualBG to include effect of carbs
    } catch (e) {
        console.error("Problem with iobArray.  Optional feature Advanced Meal Assist disabled");
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
        lastCOBpredBG: clipResult.lastCOBpredBG as number,
        lastUAMpredBG: clipResult.lastUAMpredBG as number,
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
        console.error(`predCIs (mg/dL/5m):${predCIs.join(" ")}`);
        console.error(`remainingCIs:      ${remainingCIs.join(" ")}`);
    }

    const predBGs: PredBGs = {} as PredBGs;

    // IOB: clip to [39, 401], trim flat tail
    IOBpredBGs.forEach((p: number, iobIdx: number, theArray: number[]) => {
        theArray[iobIdx] = round(Math.min(MAX_VALID_GLUCOSE_MGDL + 1, Math.max(MIN_VALID_GLUCOSE_MGDL, p)));
    });
    for (let iobTrimIdx = IOBpredBGs.length - 1; iobTrimIdx > MIN_PRED_TRIM_POINTS; iobTrimIdx--) {
        if (IOBpredBGs[iobTrimIdx - 1] !== IOBpredBGs[iobTrimIdx]) { break; }
        else { IOBpredBGs.pop(); }
    }
    predBGs.IOB = IOBpredBGs;
    const lastIOBpredBG = round(IOBpredBGs[IOBpredBGs.length - 1]);

    // ZT: clip to [39, 401], trim rising-above-target tail
    ZTpredBGs.forEach((p: number, ztIdx: number, theArray: number[]) => {
        theArray[ztIdx] = round(Math.min(MAX_VALID_GLUCOSE_MGDL + 1, Math.max(MIN_VALID_GLUCOSE_MGDL, p)));
    });
    for (let ztTrimIdx = ZTpredBGs.length - 1; ztTrimIdx > MIN_ZT_TRIM_POINTS; ztTrimIdx--) {
        // stop displaying ZTpredBGs once they're rising and above target
        if (ZTpredBGs[ztTrimIdx - 1] >= ZTpredBGs[ztTrimIdx] || ZTpredBGs[ztTrimIdx] <= target_bg) { break; }
        else { ZTpredBGs.pop(); }
    }
    predBGs.ZT = ZTpredBGs;

    // COB: clip to [39, 1500], trim flat tail (only if mealCOB and carb impact present)
    if (mealCOB > 0 && ( carbImpact > 0 || remainingCIpeak > 0 )) {
        COBpredBGs.forEach((p: number, cobIdx: number, theArray: number[]) => {
            theArray[cobIdx] = round(Math.min(COB_PRED_BG_CAP, Math.max(MIN_VALID_GLUCOSE_MGDL, p)));
        });
        for (let cobTrimIdx = COBpredBGs.length - 1; cobTrimIdx > MIN_PRED_TRIM_POINTS; cobTrimIdx--) {
            if (COBpredBGs[cobTrimIdx - 1] !== COBpredBGs[cobTrimIdx]) { break; }
            else { COBpredBGs.pop(); }
        }
        predBGs.COB = COBpredBGs;
        lastCOBpredBG = round(COBpredBGs[COBpredBGs.length - 1]);
        eventualBG = Math.max(eventualBG, round(COBpredBGs[COBpredBGs.length-1]));
        console.error(`COBpredBG: ${round(COBpredBGs[COBpredBGs.length - 1])}`);
    }

    // UAM: clip to [39, 401], trim flat tail (only if carb impact present and UAM enabled)
    if (carbImpact > 0 || remainingCIpeak > 0) {
        if (enableUAM) {
            UAMpredBGs.forEach((p: number, uamIdx: number, theArray: number[]) => {
                theArray[uamIdx] = round(Math.min(MAX_VALID_GLUCOSE_MGDL + 1, Math.max(MIN_VALID_GLUCOSE_MGDL, p)));
            });
            for (let uamTrimIdx = UAMpredBGs.length - 1; uamTrimIdx > MIN_PRED_TRIM_POINTS; uamTrimIdx--) {
                if (UAMpredBGs[uamTrimIdx - 1] !== UAMpredBGs[uamTrimIdx]) { break; }
                else { UAMpredBGs.pop(); }
            }
            predBGs.UAM = UAMpredBGs;
            lastUAMpredBG = round(UAMpredBGs[UAMpredBGs.length - 1]);
            if (UAMpredBGs[UAMpredBGs.length-1]) {
                eventualBG = Math.max(eventualBG, round(UAMpredBGs[UAMpredBGs.length-1]) );
            }
        }

        // set eventualBG based on COB or UAM predBGs
    }

    return { predBGs, lastIOBpredBG, lastCOBpredBG, lastUAMpredBG, eventualBG };
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

    console.error(`UAM Impact:${uamCarbImpact}mg/dL per 5m; UAM Duration:${UAMduration}hours`);

    minIOBPredBG = Math.max(MIN_VALID_GLUCOSE_MGDL,minIOBPredBG);
    minCOBPredBG = Math.max(MIN_VALID_GLUCOSE_MGDL,minCOBPredBG);
    minUAMPredBG = Math.max(MIN_VALID_GLUCOSE_MGDL,minUAMPredBG);
    let minPredBG: number = round(minIOBPredBG);

    const fractionCarbsLeft = mealCOB/carbs;
    // if we have COB and UAM is enabled, average both
    let avgPredBG: number;
    if ( minUAMPredBG < PRED_BG_SENTINEL && minCOBPredBG < PRED_BG_SENTINEL ) {
        // weight COBpredBG vs. UAMpredBG based on how many carbs remain as COB
        avgPredBG = round( (1-fractionCarbsLeft)*(UAMpredBG as number) + fractionCarbsLeft*(COBpredBG as number) );
        // if UAM is disabled, average IOB and COB
    } else if ( minCOBPredBG < PRED_BG_SENTINEL ) {
        avgPredBG = round( (IOBpredBG + (COBpredBG as number))/2 );
        // if we have UAM but no COB, average IOB and UAM
    } else if ( minUAMPredBG < PRED_BG_SENTINEL ) {
        avgPredBG = round( (IOBpredBG + (UAMpredBG as number))/2 );
    } else {
        avgPredBG = round( IOBpredBG );
    }
    // if avgPredBG is below minZTGuardBG, bring it up to that level
    if ( minZTGuardBG > avgPredBG ) {
        avgPredBG = minZTGuardBG;
    }

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

// Print summary variables based on predBGs etc.

    process.stderr.write(`minPredBG: ${minPredBG} minIOBPredBG: ${minIOBPredBG} minZTGuardBG: ${minZTGuardBG}`);
    if (minCOBPredBG < PRED_BG_SENTINEL) {
        process.stderr.write(` minCOBPredBG: ${minCOBPredBG}`);
    }
    if (minUAMPredBG < PRED_BG_SENTINEL) {
        process.stderr.write(` minUAMPredBG: ${minUAMPredBG}`);
    }
    console.error(` avgPredBG:${avgPredBG} COB/Carbs:${mealCOB}/${carbs}`);
    // But if the COB line falls off a cliff, don't trust UAM too much:
    // use maxCOBPredBG if it's been set and lower than minPredBG
    if ( maxCOBPredBG > bg ) {
        minPredBG = Math.min(minPredBG, maxCOBPredBG);
    }

    return { minPredBG, minGuardBG, avgPredBG, minIOBPredBG };
}
