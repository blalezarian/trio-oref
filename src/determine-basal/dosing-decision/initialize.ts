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

import { round, convert_bg } from '../helpers';

import type { DosingContext, PhaseOutcome } from './types';

// ---------------------------------------------------------------------------
// Phase 1: initializeTelemetry
// ---------------------------------------------------------------------------

/** Sets initial result fields (COB, IOB, BGI, deviation, ISF, CR, target, reason). */
export function initializeTelemetry(ctx: DosingContext): PhaseOutcome {
    const {
        result,
        iob_data,
        meal_data,
        profile,
        bgImpact,
        deviation,
        adjustedSens,
        carbRatio,
        target_bg,
        isfreason,
        targetLog,
        tddReason,
        minPredBG,
        minGuardBG,
        lastIOBpredBG,
        lastCOBpredBG,
        lastUAMpredBG,
    } = ctx.inputs;

    result.COB = meal_data.mealCOB;
    result.IOB = iob_data.iob;
    result.BGI = convert_bg(bgImpact, profile);
    result.deviation = convert_bg(deviation, profile);
    result.ISF = convert_bg(adjustedSens, profile);
    result.CR = round(carbRatio, 1);
    result.target_bg = convert_bg(target_bg, profile);
    result.current_target = round(target_bg, 0);
    result.reason = `${isfreason}, COB: ${result.COB}, Dev: ${result.deviation}, BGI: ${result.BGI}, CR: ${result.CR}, Target: ${targetLog}, minPredBG ${convert_bg(minPredBG, profile)}, minGuardBG ${convert_bg(minGuardBG, profile)}, IOBpredBG ${convert_bg(lastIOBpredBG, profile)}`;
    if (lastCOBpredBG > 0) {
        result.reason += `, COBpredBG ${convert_bg(lastCOBpredBG, profile)}`;
    }
    if (lastUAMpredBG > 0) {
        result.reason += `, UAMpredBG ${convert_bg(lastUAMpredBG, profile)}`;
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
        meal_data,
        carbImpact,
        remainingCIpeak,
        min_bg,
        threshold,
        minGuardBG,
        IOBpredBGs,
        COBpredBGs,
    } = ctx.inputs;
    const naive_eventualBG = ctx.inputs.naive_eventualBG;

    // use naive_eventualBG if above 40, but switch to minGuardBG if both eventualBGs hit floor of 39
    let carbsReqBG = naive_eventualBG;
    if (carbsReqBG < LOW_BG_SAFETY_THRESHOLD) {
        carbsReqBG = Math.min(minGuardBG, carbsReqBG);
    }
    ctx.bgUndershoot = threshold - carbsReqBG;

    // Use COB predictions when carbs are active, otherwise fall back to IOB predictions
    const predBGs = (meal_data.mealCOB > 0 && (carbImpact > 0 || remainingCIpeak > 0))
        ? COBpredBGs
        : IOBpredBGs;

    ctx.minutesAboveMinBG = findMinutesAbove(predBGs, min_bg);
    ctx.minutesAboveThreshold = findMinutesAbove(predBGs, threshold);

    return { done: false };
}

// ---------------------------------------------------------------------------
// Phase 4: calculateCarbsRequired
// ---------------------------------------------------------------------------

/** Computes carbs required to prevent a hypo, using bgUndershoot and minutesAboveThreshold from context. */
export function calculateCarbsRequired(ctx: DosingContext): PhaseOutcome {
    const {
        meal_data,
        profile,
        min_bg,
        threshold,
        adjustedSens,
        overrideFactor,
        carbSensFactor,
        naive_eventualBG,
    } = ctx.inputs;
    const { result } = ctx;

    console.log(`BG projected to remain above ${convert_bg(min_bg, profile)} for ${ctx.minutesAboveMinBG}minutes`);
    if (ctx.minutesAboveThreshold < PRED_HORIZON_MAX_MINUTES || ctx.minutesAboveMinBG < MINUTES_ABOVE_MIN_BG_THRESHOLD) {
        console.log(`BG projected to remain above ${convert_bg(threshold, profile)} for ${ctx.minutesAboveThreshold}minutes`);
    }

    const { zeroTempEffect, carbsReq } = calculateZeroTempEffectAndCarbsReq(
        ctx.minutesAboveThreshold, ctx.bgUndershoot,
        profile.current_basal, overrideFactor, adjustedSens, carbSensFactor,
        meal_data.mealCOB, meal_data.carbs,
    );
    ctx.carbsReq = carbsReq;
    console.log(`naive_eventualBG: ${naive_eventualBG} bgUndershoot: ${ctx.bgUndershoot} zeroTempDuration: ${ctx.minutesAboveThreshold} zeroTempEffect: ${zeroTempEffect} carbsReq: ${ctx.carbsReq}`);

    if (meal_data.reason == "Could not parse clock data") {
        console.log("carbsReq unknown: Could not parse clock data");
        return { done: false };
    }

    if (ctx.carbsReq >= (profile.carbsReqThreshold as number) && ctx.minutesAboveThreshold <= CARBS_REQ_WINDOW_MINUTES) {
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
    current_basal: number,
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
    const rawZeroTempEffect = current_basal * overrideFactor * adjustedSens * zeroTempDuration / MINUTES_PER_HOUR;
    // don't count the last 25% of COB against carbsReq
    const COBforCarbsReq = Math.max(0, mealCOB - COB_DISCOUNT_FRACTION * carbs);
    const rawCarbsReq = (bgUndershoot - rawZeroTempEffect) / carbSensFactor - COBforCarbsReq;
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
    for (let i = 0; i < predBGs.length; i++) {
        if (predBGs[i] < level) {
            return PRED_INTERVAL_MINUTES * i;
        }
    }
    return PRED_HORIZON_MAX_MINUTES;
}
