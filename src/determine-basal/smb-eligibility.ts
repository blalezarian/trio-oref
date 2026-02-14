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
export function enable_smb(
    profile: Profile,
    microBolusAllowed: boolean,
    meal_data: MealData,
    bg: number,
    target_bg: number,
    high_bg: number,
    trio_custom_variables: TrioCustomVariables,
    time: Date,
): boolean {
    // --- Disable gates (any one blocks SMB) ---

    if (trio_custom_variables.smbIsScheduledOff
        && isTimeInSMBDisabledWindow(time.getHours(), trio_custom_variables.start, trio_custom_variables.end)) {
        console.log("SMB disabled: current time is in SMB disabled scheduled");
        return false;
    }

    if (!microBolusAllowed) {
        console.log("SMB disabled (!microBolusAllowed)");
        return false;
    }

    if (!profile.allowSMB_with_high_temptarget && profile.temptargetSet && target_bg > EXERCISE_NORMAL_TARGET) {
        console.log(`SMB disabled due to high temptarget of ${target_bg}`);
        return false;
    }

    if (meal_data.bwFound === true && profile.A52_risk_enable === false) {
        console.log("SMB disabled due to Bolus Wizard activity in the last 6 hours.");
        return false;
    }

    // --- Enable checks (first match wins) ---

    if (profile.enableSMB_always === true) {
        logBWWarningIfFound(meal_data, 'SMB enabled due to enableSMB_always');
        return true;
    }

    if (profile.enableSMB_with_COB === true && meal_data.mealCOB) {
        logBWWarningIfCarbs(meal_data, `SMB enabled for COB of ${meal_data.mealCOB}`);
        return true;
    }

    if (profile.enableSMB_after_carbs === true && meal_data.carbs) {
        logBWWarningIfCarbs(meal_data, 'SMB enabled for 6h after carb entry');
        return true;
    }

    if (profile.enableSMB_with_temptarget === true && profile.temptargetSet && target_bg < EXERCISE_NORMAL_TARGET) {
        logBWWarningIfFound(meal_data, `SMB enabled for temptarget of ${convertBG(target_bg, profile)}`);
        return true;
    }

    if (profile.enableSMB_high_bg === true && high_bg !== null && bg >= high_bg) {
        console.log("Checking BG to see if High for SMB enablement.");
        console.log(`Current BG ${bg} | High BG ${high_bg}`);
        logBWWarningIfFound(meal_data, 'High BG detected. Enabling SMB.',
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
    meal_data: MealData,
    reason: string,
    warningOverride?: string,
): void {
    if (meal_data.bwFound) {
        console.log(warningOverride ?? 'Warning: SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard');
    } else {
        console.log(reason);
    }
}

/** Log BW warning (checking bwCarbs) or the given reason. */
export function logBWWarningIfCarbs(meal_data: MealData, reason: string): void {
    if (meal_data.bwCarbs) {
        console.log('Warning: SMB enabled with Bolus Wizard carbs: be sure to easy bolus 30s before using Bolus Wizard');
    } else {
        console.log(reason);
    }
}
