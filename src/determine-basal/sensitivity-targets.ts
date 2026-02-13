import {
    EXERCISE_NORMAL_TARGET,
    EXERCISE_HALF_BASAL_TARGET,
    MIN_BG_TARGET,
    MAX_BG_TARGET,
} from '../shared/constants';

import { round_basal } from '../utils/round-basal';

import type {
    GlucoseStatus,
    Profile,
    AutosensData,
    DetermineBasalResult,
} from '../types/index';

import {
    TARGET_BG_PIVOT,
    MIN_NOISY_TARGET_MULTIPLIER,
    MAX_RAW_BG,
    THRESHOLD_FACTOR,
    THRESHOLD_BG_OFFSET,
    MIN_THRESHOLD_BG,
    MAX_THRESHOLD_BG,
    CGM_NOISE_LEVEL_NOISY,
    OVERRIDE_TARGET_SENTINEL,
} from './constants';

import type { SensitivityAndTargetsResult } from './types';

import { round, convert_bg } from './helpers';


export function configureSensitivityAndTargets(
    glucose_status: GlucoseStatus,
    profile: Profile,
    autosens_data: AutosensData,
    profileTarget: number,
    overrideTarget: number,
    bg: number,
    dynISFenabled: boolean,
    newRatio: number,
    tdd24h_14d_Ratio: number,
    overrideFactor: number,
    profile_current_basal: number,
    tdd_before: number,
    weightedAverage: number,
    average_total_data: number,
    weightPercentage: number,
    sensitivity: number,
    carbRatio: number,
    basal: number,
    cgmReason: string | undefined
): { earlyReturn: DetermineBasalResult } | SensitivityAndTargetsResult {
// Get configured target, and return if unable to do so.
// This should occur after checking that we're not in one of the CGM-data-related error conditions handled above,
// and before using target_bg to adjust sensitivityRatio below.
    const max_iob = profile.max_iob; // maximum amount of non-bolus IOB OpenAPS will ever deliver

    // if min and max are set, then set target to their average
    let target_bg: number = undefined!;
    let min_bg: number = undefined!;
    let max_bg: number = undefined!;
    let new_target_bg: number = undefined!;
    let high_bg: number = undefined!;

    if (profileTarget !== undefined) {
            min_bg = profileTarget;
    }
    if (profile.max_bg !== undefined) {
            max_bg = profileTarget;
    }
    if (profile.enableSMB_high_bg_target !== undefined) {
        high_bg = profile.enableSMB_high_bg_target;
    }
    if (profileTarget !== undefined) {
        target_bg = profileTarget;

    } else {
        const result = {} as DetermineBasalResult;
        if (cgmReason) {
            result.reason = cgmReason;
        }
        result.error ='Error: could not determine target_bg. ';
        return { earlyReturn: result };
    }


// Calculate sensitivityRatio based on temp targets, if applicable, or using the value calculated by autosens
    const high_temptarget_raises_sensitivity = profile.exercise_mode || profile.high_temptarget_raises_sensitivity;
    const normalTarget = EXERCISE_NORMAL_TARGET; // evaluate high/low temptarget against 100, not scheduled target (which might change)
    let halfBasalTarget = EXERCISE_HALF_BASAL_TARGET;  // when temptarget is 160 mg/dL, run 50% basal (120 = 75%; 140 = 60%)
    // 80 mg/dL with low_temptarget_lowers_sensitivity would give 1.5x basal, but is limitLoged to autosens_max (1.2x by default)
    //if ( profile.half_basal_exercise_target ) {
    halfBasalTarget = profile.half_basal_exercise_target!;
    //}

    let sensitivityRatio: number = undefined!;
    if ( high_temptarget_raises_sensitivity && profile.temptargetSet && target_bg > normalTarget ||
        profile.low_temptarget_lowers_sensitivity && profile.temptargetSet && target_bg < normalTarget ) {
        // w/ target 100, temp target 110 = .89, 120 = 0.8, 140 = 0.67, 160 = .57, and 200 = .44
        // e.g.: Sensitivity ratio set to 0.8 based on temp target of 120; Adjusting basal from 1.65 to 1.35; ISF from 58.9 to 73.6
        //sensitivityRatio = 2/(2+(target_bg-normalTarget)/40);
        const c = halfBasalTarget - normalTarget;
        // getting multiplication less or equal to 0 means that we have a really low target with a really low halfBasalTarget
        // with low TT and lowTTlowersSensitivity we need autosens_max as a value
        // we use multiplication instead of the division to avoid "division by zero error"
        if (c * (c + target_bg-normalTarget) <= 0.0) {
          sensitivityRatio = profile.autosens_max;
        }
        else {
          sensitivityRatio = c/(c+target_bg-normalTarget);
        }
        // limit sensitivityRatio to profile.autosens_max (1.2x by default)
        sensitivityRatio = Math.min(sensitivityRatio, profile.autosens_max);
        sensitivityRatio = round(sensitivityRatio,2);
        process.stderr.write("Sensitivity ratio set to "+sensitivityRatio+" based on temp target of "+target_bg+"; ");
    }
    else if (autosens_data !== undefined && autosens_data) {
        sensitivityRatio = autosens_data.ratio;

        // Override Profile.Target
    if (overrideTarget !== 0 && overrideTarget !== OVERRIDE_TARGET_SENTINEL && overrideTarget !== profile.min_bg && !profile.temptargetSet) {
        target_bg = overrideTarget;
        console.log("Current Override Profile Target: " + convert_bg(overrideTarget, profile) + " " + profile.out_units);
    }
        process.stderr.write("Autosens ratio: "+sensitivityRatio+"; ");
    }

    // Increase the dynamic ratio when using a low temp target
    if (profile.temptargetSet && target_bg < normalTarget && dynISFenabled && bg >= target_bg) {
        if (sensitivityRatio < newRatio) {
            autosens_data.ratio = newRatio * (normalTarget/target_bg);
            //Use autosesns.max limit
            autosens_data.ratio = Math.min(autosens_data.ratio, profile.autosens_max);
            sensitivityRatio = round(autosens_data.ratio, 2);
            console.log("Dynamic ratio increased from " + round(newRatio, 2) + " to " + round(autosens_data.ratio,2) + " due to a low temp target (" + target_bg + ").");
        }
    }

    if (sensitivityRatio && !dynISFenabled) { // Only enable adjustment of basal by sensitivityRatio when not using dISF
        basal = profile.current_basal * overrideFactor * sensitivityRatio;
        basal = round_basal(basal, profile);
        if (basal !== profile_current_basal) {
            process.stderr.write("Adjusting basal from "+profile_current_basal+" to "+basal+"; ");
        } else {
            process.stderr.write("Basal unchanged: "+basal+"; ");
        }
    }

    else if (dynISFenabled && profile.tddAdjBasal) {
        basal = profile.current_basal * tdd24h_14d_Ratio * overrideFactor;
        basal = round_basal(basal, profile);
        if (average_total_data > 0) {
            process.stderr.write("TDD-adjustment of basals activated, using tdd24h_14d_Ratio " + round(tdd24h_14d_Ratio,2) + ", TDD 24h = " + round(tdd_before,2) + "U, Weighted average TDD = " + round(weightedAverage,2) + "U, (Weight percentage = " + weightPercentage + "), Total data of TDDs (up to 14 days) average = " + round(average_total_data,2) + "U. " );
            if (basal !== profile_current_basal * overrideFactor) {
                process.stderr.write("Adjusting basal from " + profile_current_basal * overrideFactor + " U/h to " + basal + " U/h; ");
            } else { process.stderr.write("Basal unchanged: " + basal + " U/h; "); }
        }
    }

// Conversely, adjust BG target based on autosens ratio if no temp target is running
    // adjust min, max, and target BG for sensitivity, such that 50% increase in ISF raises target from 100 to 120
    if (profile.temptargetSet) {
        //process.stderr.write("Temp Target set, not adjusting with autosens; ");
    } else if (autosens_data !== undefined && autosens_data) {
        if ( profile.sensitivity_raises_target && autosens_data.ratio < 1 || profile.resistance_lowers_target && autosens_data.ratio > 1 ) {
            // with a target of 100, default 0.7-1.2 autosens min/max range would allow a 93-117 target range
            min_bg = round((min_bg - TARGET_BG_PIVOT) / autosens_data.ratio) + TARGET_BG_PIVOT;
            max_bg = round((max_bg - TARGET_BG_PIVOT) / autosens_data.ratio) + TARGET_BG_PIVOT;
            new_target_bg = round((target_bg - TARGET_BG_PIVOT) / autosens_data.ratio) + TARGET_BG_PIVOT;
            // don't allow target_bg below 80
            new_target_bg = Math.max(MIN_BG_TARGET, new_target_bg);
            if (target_bg === new_target_bg) {
                process.stderr.write("target_bg unchanged: " + convert_bg(new_target_bg, profile) + "; ");
            } else {
                process.stderr.write("target_bg from "+ convert_bg(new_target_bg, profile) + " to " + convert_bg(new_target_bg, profile) + "; ");
            }
            target_bg = new_target_bg;
        }
    }

    // Display if differing in enacted box
    let targetLog: number | string = convert_bg(target_bg, profile);
    if  (target_bg != profileTarget) {
        if (overrideTarget !== 0 && overrideTarget !== OVERRIDE_TARGET_SENTINEL && overrideTarget !== target_bg) {
            targetLog = convert_bg(profileTarget, profile) + "\u2192" + convert_bg(overrideTarget, profile) + "\u2192" + convert_bg(target_bg, profile);
        } else {
            targetLog = convert_bg(profileTarget, profile) + "\u2192" + convert_bg(target_bg, profile);
        }
    }

    // Raise target for noisy / raw CGM data.
    let adjustedMinBG = MAX_BG_TARGET;
    let adjustedTargetBG = MAX_BG_TARGET;
    let adjustedMaxBG = MAX_BG_TARGET;
    if (glucose_status.noise! >= CGM_NOISE_LEVEL_NOISY) {
        // increase target at least 10% (default 30%) for raw / noisy data
        const noisyCGMTargetMultiplier = Math.max( MIN_NOISY_TARGET_MULTIPLIER, profile.noisyCGMTargetMultiplier! );
        // don't allow maxRaw above 250
        const maxRaw = Math.min( MAX_RAW_BG, profile.maxRaw! );
        adjustedMinBG = round(Math.min(MAX_BG_TARGET, min_bg * noisyCGMTargetMultiplier ));
        adjustedTargetBG = round(Math.min(MAX_BG_TARGET, target_bg * noisyCGMTargetMultiplier ));
        adjustedMaxBG = round(Math.min(MAX_BG_TARGET, max_bg * noisyCGMTargetMultiplier ));
        process.stderr.write("Raising target_bg for noisy / raw CGM data, from " + convert_bg(new_target_bg, profile) + " to " + convert_bg(adjustedTargetBG, profile) + "; ");
        min_bg = adjustedMinBG;
        target_bg = adjustedTargetBG;
        max_bg = adjustedMaxBG;
    }

    // min_bg thresholds: 80->60, 90->65, 100->70, 110->75, 120->80
    const threshold = min_bg - THRESHOLD_FACTOR*(min_bg-THRESHOLD_BG_OFFSET);
    // Set threshold to the user's setting, as long as it's between 60-120 and above the default calculated threshold
    const thresholdFinal = Math.min(Math.max(profile.threshold_setting!, threshold, MIN_THRESHOLD_BG), MAX_THRESHOLD_BG);
    console.error(`Threshold set to ${convert_bg(thresholdFinal, profile)}`);

// Adjust ISF based on sensitivityRatio
    let isfreason = ""
    const profile_sens = round(sensitivity,1);
    let adjustedSens = sensitivity;
    if (autosens_data !== undefined && autosens_data) {
        adjustedSens = sensitivity / sensitivityRatio;
        adjustedSens = round(adjustedSens, 1);
        if (adjustedSens !== sensitivity) {
            process.stderr.write("ISF from "+ convert_bg(sensitivity,profile) +" to " + convert_bg(adjustedSens,profile));
        } else {
            process.stderr.write("ISF unchanged: "+ convert_bg(adjustedSens,profile));
        }
        //process.stderr.write(" (autosens ratio "+sensitivityRatio+")");
        isfreason += "Autosens ratio: " + round(sensitivityRatio, 2) + ", ISF: " + convert_bg(sensitivity,profile) + "\u2192" + convert_bg(adjustedSens,profile);

    }
    console.error("CR:" + carbRatio);

    return { max_iob, target_bg, min_bg, max_bg, high_bg, sensitivityRatio, basal, threshold: thresholdFinal, adjustedSens, isfreason, targetLog };
}
