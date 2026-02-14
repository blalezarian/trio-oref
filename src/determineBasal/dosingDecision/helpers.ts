import {
    MINUTES_PER_HOUR,
    TEMP_BASAL_DURATION_MINUTES,
    MAX_TEMP_BASAL_DURATION_MINUTES,
    DEFAULT_MAX_SMB_BASAL_MINUTES,
} from '../../shared/constants';

import { roundBasal } from '../../utils/rounding';

import {
    TEMP_ACTIVE_DURATION_MINUTES,
    SMB_MAX_ZERO_TEMP_MINUTES,
} from '../constants';

import { round } from '../../utils/rounding';

import type { DosingContext, PhaseOutcome } from './types';

/**
 * Keeps the existing temp if it matches basal, or sets a new basal-rate temp.
 * This pattern recurs in handleLowBG, handleFallingDelta, handleInRange, and checkIOBLimit.
 */
export function keepOrSetBasalTemp(ctx: DosingContext): PhaseOutcome {
    const { profile, currenttemp, tempBasalFunctions, basal } = ctx.inputs;
    const { result } = ctx;

    if (currenttemp.duration > TEMP_ACTIVE_DURATION_MINUTES &&
        roundBasal(basal, profile) === roundBasal(currenttemp.rate, profile)) {
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
    currentBasal: number,
    overrideFactor: number,
    minDuration: number = 0,
): number {
    const worstCaseInsulinReq = bgUndershoot / adjustedSens;
    let durationReq = round(MINUTES_PER_HOUR * worstCaseInsulinReq / currentBasal * overrideFactor);
    if (durationReq < 0) {
        return minDuration;
    }
    durationReq = round(durationReq / TEMP_BASAL_DURATION_MINUTES) * TEMP_BASAL_DURATION_MINUTES;
    return Math.min(MAX_TEMP_BASAL_DURATION_MINUTES, Math.max(minDuration, durationReq));
}

/**
 * Determines the maximum SMB bolus based on SMB/UAM minutes settings and IOB vs meal insulin.
 * 3-branch logic: undefined setting → fallback 30m; IOB > mealInsulinReq → UAM minutes; else → SMB minutes.
 */
export function determineSMBMaxBolus(
    insulinReq: number,
    iob: number,
    mealCOB: number,
    mealInsulinReq: number,
    effectiveBasal: number,
    smbMinutesSetting: number | undefined,
    uamMinutesSetting: number | undefined,
): number {
    let maxBolus = 0;
    if (smbMinutesSetting === undefined) {
        maxBolus = round(effectiveBasal * DEFAULT_MAX_SMB_BASAL_MINUTES / MINUTES_PER_HOUR, 1);
        console.log("smbMinutesSetting undefined: defaulting to 30m");

        if (insulinReq > maxBolus) {
            console.log(`SMB limited by maxBolus: ${maxBolus} ( ${insulinReq} U)`);
        }
    } else if (iob > mealInsulinReq && iob > 0) {
        console.log(`IOB${iob}> COB${mealCOB}; mealInsulinReq =${mealInsulinReq}`);
        if (uamMinutesSetting) {
            console.log(`maxUAMSMBBasalMinutes: ${uamMinutesSetting}, profile.current_basal: ${effectiveBasal}`);
            maxBolus = round(effectiveBasal * uamMinutesSetting / MINUTES_PER_HOUR, 1);
        } else {
            console.log("maxUAMSMBBasalMinutes undefined: defaulting to 30m");
            maxBolus = round(effectiveBasal * DEFAULT_MAX_SMB_BASAL_MINUTES / MINUTES_PER_HOUR, 1);
        }
        if (insulinReq > maxBolus) {
            console.log(`SMB limited by maxUAMSMBBasalMinutes [ ${uamMinutesSetting}m ]: ${maxBolus}U ( ${insulinReq}U )`);
        } else { console.log(`SMB is not limited by maxUAMSMBBasalMinutes. ( insulinReq: ${insulinReq}U )`); }
    } else {
        console.log(`.maxSMBBasalMinutes: ${smbMinutesSetting}, profile.current_basal: ${effectiveBasal}`);
        maxBolus = round(effectiveBasal * smbMinutesSetting / MINUTES_PER_HOUR, 1);
        if (insulinReq > maxBolus) {
            console.log(`SMB limited by maxSMBBasalMinutes: ${smbMinutesSetting}m ]: ${maxBolus}U ( insulinReq: ${insulinReq}U )`);
        } else { console.log(`SMB is not limited by maxSMBBasalMinutes. ( insulinReq: ${insulinReq}U )`); }
    }
    return maxBolus;
}

export interface SMBZeroTempResult {
    durationReq: number;
    smbLowTempReq: number;
}

/**
 * Calculates SMB zero-temp duration and low-temp rate.
 * 3 branches: ≤0 → zero; ≥30m → round to 30m increments (cap 60m); <30m → nonzero low temp.
 */
export function calculateSMBZeroTemp(
    insulinReq: number,
    microBolus: number,
    bolusIncrement: number,
    worstCaseInsulinReq: number,
    currentBasal: number,
    overrideFactor: number,
    basal: number,
): SMBZeroTempResult {
    let durationReq = round(MINUTES_PER_HOUR * worstCaseInsulinReq / currentBasal * overrideFactor);

    // if insulinReq > 0 but not enough for a microBolus, don't set an SMB zero temp
    if (insulinReq > 0 && microBolus < bolusIncrement) {
        durationReq = 0;
    }

    let smbLowTempReq = 0;
    if (durationReq <= 0) {
        durationReq = 0;
    // don't set an SMB zero temp longer than 60 minutes
    } else if (durationReq >= TEMP_BASAL_DURATION_MINUTES) {
        durationReq = round(durationReq / TEMP_BASAL_DURATION_MINUTES) * TEMP_BASAL_DURATION_MINUTES;
        durationReq = Math.min(SMB_MAX_ZERO_TEMP_MINUTES, Math.max(0, durationReq));
    } else {
        // if SMB durationReq is less than 30m, set a nonzero low temp
        smbLowTempReq = round(basal * durationReq / TEMP_BASAL_DURATION_MINUTES, 2);
        durationReq = TEMP_BASAL_DURATION_MINUTES;
    }
    return { durationReq, smbLowTempReq };
}
