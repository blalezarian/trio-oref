import { EXERCISE_NORMAL_TARGET } from '../constants';

import { convert_bg } from './helpers';

import type {
    Profile,
    MealData,
    TrioCustomVariables,
} from '../types/index';

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
    if (trio_custom_variables.smbIsScheduledOff){
        /* Below logic is related to profile overrides which can disable SMBs or disable them for a scheduled window.
         * SMBs will be disabled from [start, end), such that if an SMB is scheduled to be disabled from 10 AM to 2 PM,
         * an SMB will not be allowed from 10:00:00 until 1:59:59.
         */
        const currentHour = time.getHours();
        const startTime = trio_custom_variables.start;
        const endTime = trio_custom_variables.end;

        if (startTime < endTime && (currentHour >= startTime && currentHour < endTime)) {
            console.error("SMB disabled: current time is in SMB disabled scheduled")
            return false
        } else if (startTime > endTime && (currentHour >= startTime || currentHour < endTime)) {
            console.error("SMB disabled: current time is in SMB disabled scheduled")
            return false
        } else if (startTime == 0 && endTime == 0) {
            console.error("SMB disabled: current time is in SMB disabled scheduled")
            return false;
        } else if (startTime == endTime && currentHour == startTime) {
            console.error("SMB disabled: current time is in SMB disabled scheduled")
            return false;
        }
    }
    // disable SMB when a high temptarget is set
    if (! microBolusAllowed) {
        console.error("SMB disabled (!microBolusAllowed)");
        return false;
    } else if (! profile.allowSMB_with_high_temptarget && profile.temptargetSet && target_bg > EXERCISE_NORMAL_TARGET) {
        console.error("SMB disabled due to high temptarget of " + target_bg);
        return false;
    } else if (meal_data.bwFound === true && profile.A52_risk_enable === false) {
        console.error("SMB disabled due to Bolus Wizard activity in the last 6 hours.");
        return false;
    }

    // enable SMB/UAM if always-on (unless previously disabled for high temptarget)
    if (profile.enableSMB_always === true) {
        if (meal_data.bwFound) {
            console.error("Warning: SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled due to enableSMB_always");
        }
        return true;
    }

    // enable SMB/UAM (if enabled in preferences) while we have COB
    if (profile.enableSMB_with_COB === true && meal_data.mealCOB) {
        if (meal_data.bwCarbs) {
            console.error("Warning: SMB enabled with Bolus Wizard carbs: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled for COB of " + meal_data.mealCOB);
        }
        return true;
    }

    // enable SMB/UAM (if enabled in preferences) for a full 6 hours after any carb entry
    // (6 hours is defined in carbWindow in src/meal/total.ts)
    if (profile.enableSMB_after_carbs === true && meal_data.carbs ) {
        if (meal_data.bwCarbs) {
            console.error("Warning: SMB enabled with Bolus Wizard carbs: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled for 6h after carb entry");
        }
        return true;
    }

    // enable SMB/UAM (if enabled in preferences) if a low temptarget is set
    if (profile.enableSMB_with_temptarget === true && (profile.temptargetSet && target_bg < EXERCISE_NORMAL_TARGET)) {
        if (meal_data.bwFound) {
            console.error("Warning: SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled for temptarget of " + convert_bg(target_bg, profile));
        }
        return true;
    }

    // enable SMB if high bg is found
    if (profile.enableSMB_high_bg === true && high_bg !== null && bg >= high_bg) {
        console.error("Checking BG to see if High for SMB enablement.");
        console.error("Current BG", bg, " | High BG ", high_bg);
        if (meal_data.bwFound) {
            console.error("Warning: High BG SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("High BG detected. Enabling SMB.");
        }
        return true;
    }

    console.error("SMB disabled (no enableSMB preferences active or no condition satisfied)");
    return false;
}
