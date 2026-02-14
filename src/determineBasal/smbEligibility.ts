import { EXERCISE_NORMAL_TARGET } from '../shared/constants';

import { convertBG } from './helpers';

import type {
    Profile,
    MealData,
    TrioCustomVariables,
} from '../types/index';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Determines whether SMB (Super Micro Bolus) should be enabled based on profile settings, meal data, and current BG. */
export function enableSMB(
    profile: Profile,
    microBolusAllowed: boolean,
    mealData: MealData,
    bg: number,
    targetBG: number,
    highBG: number,
    trioCustomVariables: TrioCustomVariables,
    time: Date,
): boolean {
    // --- Disable gates (any one blocks SMB) ---

    if (trioCustomVariables.smbIsScheduledOff
        && isTimeInSMBDisabledWindow(time.getHours(), trioCustomVariables.start, trioCustomVariables.end)) {
        console.log("SMB disabled: current time is in SMB disabled scheduled");
        return false;
    }

    if (!microBolusAllowed) {
        console.log("SMB disabled (!microBolusAllowed)");
        return false;
    }

    if (!profile.allowSMB_with_high_temptarget && profile.temptargetSet && targetBG > EXERCISE_NORMAL_TARGET) {
        console.log(`SMB disabled due to high temptarget of ${targetBG}`);
        return false;
    }

    if (mealData.bwFound === true && profile.A52_risk_enable === false) {
        console.log("SMB disabled due to Bolus Wizard activity in the last 6 hours.");
        return false;
    }

    // --- Enable checks (first match wins) ---

    if (profile.enableSMB_always === true) {
        logBWWarningIfFound(mealData, 'SMB enabled due to enableSMB_always');
        return true;
    }

    if (profile.enableSMB_with_COB === true && mealData.mealCOB) {
        logBWWarningIfCarbs(mealData, `SMB enabled for COB of ${mealData.mealCOB}`);
        return true;
    }

    if (profile.enableSMB_after_carbs === true && mealData.carbs) {
        logBWWarningIfCarbs(mealData, 'SMB enabled for 6h after carb entry');
        return true;
    }

    if (profile.enableSMB_with_temptarget === true && profile.temptargetSet && targetBG < EXERCISE_NORMAL_TARGET) {
        logBWWarningIfFound(mealData, `SMB enabled for temptarget of ${convertBG(targetBG, profile)}`);
        return true;
    }

    if (profile.enableSMB_high_bg === true && highBG !== null && bg >= highBG) {
        console.log("Checking BG to see if High for SMB enablement.");
        console.log(`Current BG ${bg} | High BG ${highBG}`);
        logBWWarningIfFound(mealData, 'High BG detected. Enabling SMB.',
            'Warning: High BG SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard');
        return true;
    }

    console.log("SMB disabled (no enableSMB preferences active or no condition satisfied)");
    return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the current hour falls within an SMB-disabled schedule window.
 * The window is [start, end) — start is inclusive, end is exclusive.
 */
export function isTimeInSMBDisabledWindow(
    currentHour: number,
    startTime: number,
    endTime: number,
): boolean {
    // All day: both zero
    if (startTime === 0 && endTime === 0) return true;
    // Single hour: start equals end
    if (startTime === endTime) return currentHour === startTime;
    // Normal range: e.g. 10-14
    if (startTime < endTime) return currentHour >= startTime && currentHour < endTime;
    // Overnight range: e.g. 22-6 (wraps past midnight)
    return currentHour >= startTime || currentHour < endTime;
}

/** Log BW warning (checking bwFound) or the given reason. */
export function logBWWarningIfFound(
    mealData: MealData,
    reason: string,
    warningOverride?: string,
): void {
    if (mealData.bwFound) {
        console.log(warningOverride ?? 'Warning: SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard');
    } else {
        console.log(reason);
    }
}

/** Log BW warning (checking bwCarbs) or the given reason. */
export function logBWWarningIfCarbs(mealData: MealData, reason: string): void {
    if (mealData.bwCarbs) {
        console.log('Warning: SMB enabled with Bolus Wizard carbs: be sure to easy bolus 30s before using Bolus Wizard');
    } else {
        console.log(reason);
    }
}
