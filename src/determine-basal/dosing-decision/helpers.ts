import {
    MINUTES_PER_HOUR,
    TEMP_BASAL_DURATION_MINUTES,
    MAX_TEMP_BASAL_DURATION_MINUTES,
} from '../../shared/constants';

import { round_basal } from '../../utils/round-basal';

import { TEMP_ACTIVE_DURATION_MINUTES } from '../constants';

import { round } from '../helpers';

import type { DosingContext, PhaseOutcome } from './types';

/**
 * Keeps the existing temp if it matches basal, or sets a new basal-rate temp.
 * This pattern recurs in handleLowBG, handleFallingDelta, handleInRange, and checkIOBLimit.
 */
export function keepOrSetBasalTemp(ctx: DosingContext): PhaseOutcome {
    const { profile, currenttemp, tempBasalFunctions, basal } = ctx.inputs;
    const { result } = ctx;

    if (currenttemp.duration > TEMP_ACTIVE_DURATION_MINUTES &&
        round_basal(basal, profile) === round_basal(currenttemp.rate, profile)) {
        result.reason += `, temp ${currenttemp.rate} ~ req ${basal}U/hr. `;
        return { done: true, result };
    }
    result.reason += `; setting current basal of ${basal} as temp. `;
    return { done: true, result: tempBasalFunctions.setTempBasal(basal, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp) };
}

/**
 * Calculates zero-temp duration from a BG undershoot, clamped to [0, MAX_TEMP_BASAL_DURATION_MINUTES]
 * and rounded to TEMP_BASAL_DURATION_MINUTES increments.
 * Used by checkPredictiveLGS and handleLowBG.
 */
export function calculateZeroTempDuration(
    bgUndershoot: number,
    adjustedSens: number,
    current_basal: number,
    overrideFactor: number,
    minDuration: number = 0,
): number {
    const worstCaseInsulinReq = bgUndershoot / adjustedSens;
    let durationReq = round(MINUTES_PER_HOUR * worstCaseInsulinReq / current_basal * overrideFactor);
    if (durationReq < 0) {
        return minDuration;
    }
    durationReq = round(durationReq / TEMP_BASAL_DURATION_MINUTES) * TEMP_BASAL_DURATION_MINUTES;
    return Math.min(MAX_TEMP_BASAL_DURATION_MINUTES, Math.max(minDuration, durationReq));
}
