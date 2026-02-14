import {
    MINUTES_PER_HOUR,
    PRED_INTERVAL_MINUTES,
} from '../../shared/constants';

import {
    PRED_HORIZON_MAX_MINUTES,
    MINUTES_ABOVE_MIN_BG_THRESHOLD,
    CARBS_REQ_WINDOW_MINUTES,
    COB_DISCOUNT_FRACTION,
    LOW_BG_SAFETY_THRESHOLD,
} from '../constants';

import { round } from '../../utils/rounding';
import { convertBG } from '../helpers';

import type { DosingContext, PhaseOutcome } from './types';

// ---------------------------------------------------------------------------
// Phase 1: initializeTelemetry
// ---------------------------------------------------------------------------

/** Sets initial result fields (COB, IOB, BGI, deviation, ISF, CR, target, reason). */
export function initializeTelemetry(ctx: DosingContext): PhaseOutcome {
    const {
        result,
        iobData,
        mealData,
        profile,
        bgImpact,
        deviation,
        adjustedSens,
        carbRatio,
        targetBG,
        isfreason,
        targetLog,
        tddReason,
        minPredBG,
        minGuardBG,
        lastIOBpredBG,
        lastCOBpredBG,
        lastUAMpredBG,
    } = ctx.inputs;

    result.COB = mealData.mealCOB;
    result.IOB = iobData.iob;
    result.BGI = convertBG(bgImpact, profile);
    result.deviation = convertBG(deviation, profile);
    result.ISF = convertBG(adjustedSens, profile);
    result.CR = round(carbRatio, 1);
    result.target_bg = convertBG(targetBG, profile);
    result.current_target = round(targetBG, 0);
    result.reason = `${isfreason}, COB: ${result.COB}, Dev: ${result.deviation}, BGI: ${result.BGI}, CR: ${result.CR}, Target: ${targetLog}, minPredBG ${convertBG(minPredBG, profile)}, minGuardBG ${convertBG(minGuardBG, profile)}, IOBpredBG ${convertBG(lastIOBpredBG, profile)}`;
    if (lastCOBpredBG > 0) {
        result.reason += `, COBpredBG ${convertBG(lastCOBpredBG, profile)}`;
    }
    if (lastUAMpredBG > 0) {
        result.reason += `, UAMpredBG ${convertBG(lastUAMpredBG, profile)}`;
    }
    result.reason += tddReason;

    result.reason += "; "; // reason.conclusion started

    return { done: false };
}

// ---------------------------------------------------------------------------
// Phase 2: calculateCarbsContext
// ---------------------------------------------------------------------------

/** Computes bgUndershoot, minutesAboveMinBG, and minutesAboveThreshold from prediction arrays. */
export function calculateCarbsContext(ctx: DosingContext): PhaseOutcome {
    const {
        mealData,
        carbImpact,
        remainingCIpeak,
        minBG,
        threshold,
        minGuardBG,
        IOBpredBGs,
        COBpredBGs,
    } = ctx.inputs;
    const naiveEventualBG = ctx.inputs.naiveEventualBG;

    // use naiveEventualBG if above 40, but switch to minGuardBG if both eventualBGs hit floor of 39
    let carbsReqBG = naiveEventualBG;
    if (carbsReqBG < LOW_BG_SAFETY_THRESHOLD) {
        carbsReqBG = Math.min(minGuardBG, carbsReqBG);
    }
    ctx.bgUndershoot = threshold - carbsReqBG;

    // Use COB predictions when carbs are active, otherwise fall back to IOB predictions
    const predBGs = (mealData.mealCOB > 0 && (carbImpact > 0 || remainingCIpeak > 0))
        ? COBpredBGs
        : IOBpredBGs;

    ctx.minutesAboveMinBG = findMinutesAbove(predBGs, minBG);
    ctx.minutesAboveThreshold = findMinutesAbove(predBGs, threshold);

    return { done: false };
}

// ---------------------------------------------------------------------------
// Phase 4: calculateCarbsRequired
// ---------------------------------------------------------------------------

/** Computes carbs required to prevent a hypo, using bgUndershoot and minutesAboveThreshold from context. */
export function calculateCarbsRequired(ctx: DosingContext): PhaseOutcome {
    const {
        mealData,
        profile,
        minBG,
        threshold,
        adjustedSens,
        overrideFactor,
        carbSensFactor,
        naiveEventualBG,
    } = ctx.inputs;
    const { result } = ctx;

    console.log(`BG projected to remain above ${convertBG(minBG, profile)} for ${ctx.minutesAboveMinBG}minutes`);
    if (ctx.minutesAboveThreshold < PRED_HORIZON_MAX_MINUTES || ctx.minutesAboveMinBG < MINUTES_ABOVE_MIN_BG_THRESHOLD) {
        console.log(`BG projected to remain above ${convertBG(threshold, profile)} for ${ctx.minutesAboveThreshold}minutes`);
    }

    const { zeroTempEffect, carbsReq } = calculateZeroTempEffectAndCarbsReq(
        ctx.minutesAboveThreshold, ctx.bgUndershoot,
        profile.current_basal, overrideFactor, adjustedSens, carbSensFactor,
        mealData.mealCOB, mealData.carbs,
    );
    ctx.carbsReq = carbsReq;
    console.log(`naive_eventualBG: ${naiveEventualBG} bgUndershoot: ${ctx.bgUndershoot} zeroTempDuration: ${ctx.minutesAboveThreshold} zeroTempEffect: ${zeroTempEffect} carbsReq: ${ctx.carbsReq}`);

    if (mealData.reason == "Could not parse clock data") {
        console.log("carbsReq unknown: Could not parse clock data");
        return { done: false };
    }

    if (ctx.carbsReq >= Number(profile.carbsReqThreshold) && ctx.minutesAboveThreshold <= CARBS_REQ_WINDOW_MINUTES) {
        result.carbsReq = ctx.carbsReq;
        result.reason += `${ctx.carbsReq} add'l carbs req w/in ${ctx.minutesAboveThreshold}m; `;
    }

    return { done: false };
}

// ---------------------------------------------------------------------------
// calculateCarbsRequired helpers
// ---------------------------------------------------------------------------

/** Calculates zero-temp BG effect and carbs required from bgUndershoot and prediction data. */
function calculateZeroTempEffectAndCarbsReq(
    minutesAboveThreshold: number,
    bgUndershoot: number,
    currentBasal: number,
    overrideFactor: number,
    adjustedSens: number,
    carbSensFactor: number,
    mealCOB: number,
    carbs: number,
): { zeroTempEffect: number; carbsReq: number } {
    // include at least minutesAboveThreshold worth of zero temps in calculating carbsReq
    // always include at least 30m worth of zero temp (carbs to 80, low temp up to target)
    const zeroTempDuration = minutesAboveThreshold;
    // BG undershoot, minus effect of zero temps until hitting min_bg, converted to grams, minus COB
    const rawZeroTempEffect = currentBasal * overrideFactor * adjustedSens * zeroTempDuration / MINUTES_PER_HOUR;
    // don't count the last 25% of COB against carbsReq
    const cobForCarbsReq = Math.max(0, mealCOB - COB_DISCOUNT_FRACTION * carbs);
    const rawCarbsReq = (bgUndershoot - rawZeroTempEffect) / carbSensFactor - cobForCarbsReq;
    return { zeroTempEffect: round(rawZeroTempEffect), carbsReq: round(rawCarbsReq) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns minutes until predictions drop below the given level, or PRED_HORIZON_MAX_MINUTES if they never do. */
export function findMinutesAbove(
    predBGs: number[],
    level: number,
): number {
    for (let predIdx = 0; predIdx < predBGs.length; predIdx++) {
        if (predBGs[predIdx] < level) {
            return PRED_INTERVAL_MINUTES * predIdx;
        }
    }
    return PRED_HORIZON_MAX_MINUTES;
}
