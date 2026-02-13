import {
    EXERCISE_NORMAL_TARGET,
    MIN_BG_TARGET,
    MAX_BG_TARGET,
} from '../shared/constants';

import { round_basal } from '../utils/rounding';

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

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Configures sensitivity ratio, target BG, and threshold based on autosens, overrides, temp targets, and CGM noise. */
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
    // Resolve profile targets — early return if profileTarget is undefined
    const targetsResult = resolveProfileTargets(profileTarget, profile, cgmReason);
    if ('earlyReturn' in targetsResult) return targetsResult;
    let { target_bg, min_bg, max_bg } = targetsResult;
    const { high_bg } = targetsResult;

    const max_iob = profile.max_iob; // maximum amount of non-bolus IOB OpenAPS will ever deliver

    // Calculate sensitivityRatio and apply override target
    const sensResult = resolveSensitivityRatio(target_bg, overrideTarget, bg, dynISFenabled, newRatio, profile, autosens_data);
    target_bg = sensResult.target_bg;
    const sensitivityRatio = sensResult.sensitivityRatio;

    basal = adjustBasalBySensitivity(basal, sensitivityRatio, overrideFactor, dynISFenabled, profile, profile_current_basal);

    if (dynISFenabled && profile.tddAdjBasal) {
        basal = adjustBasalByTDD(basal, tdd24h_14d_Ratio, overrideFactor, profile, profile_current_basal, tdd_before, weightedAverage, average_total_data, weightPercentage);
    }

    // Adjust BG target based on autosens ratio if no temp target is running
    const targetAdjustment = adjustTargetByAutosens(target_bg as number, min_bg as number, max_bg as number, profile, autosens_data);
    target_bg = targetAdjustment.target_bg;
    min_bg = targetAdjustment.min_bg;
    max_bg = targetAdjustment.max_bg;

    const targetLog = formatTargetLog(target_bg as number, profileTarget, overrideTarget, profile);

    // Raise target for noisy / raw CGM data.
    const noisyTargets = adjustTargetsForNoisyCGM(min_bg as number, target_bg as number, max_bg as number, glucose_status.noise as number, profile);
    if (noisyTargets.adjusted) {
        console.log(`Raising target_bg for noisy / raw CGM data, from ${convert_bg(targetAdjustment.new_target_bg as number, profile)} to ${convert_bg(noisyTargets.target_bg, profile)}; `);
        min_bg = noisyTargets.min_bg;
        target_bg = noisyTargets.target_bg;
        max_bg = noisyTargets.max_bg;
    }

    const thresholdFinal = calculateLowGlucoseThreshold(min_bg as number, profile.threshold_setting as number);
    console.log(`Threshold set to ${convert_bg(thresholdFinal, profile)}`);

    // Adjust ISF based on sensitivityRatio
    const { adjustedSens, isfreason } = adjustISFBySensitivity(sensitivity, sensitivityRatio as number, profile, autosens_data);
    console.log(`CR:${carbRatio}`);

    return { max_iob, target_bg: target_bg as number, min_bg: min_bg as number, max_bg: max_bg as number, high_bg: high_bg as number, sensitivityRatio: sensitivityRatio as number, basal, threshold: thresholdFinal, adjustedSens, isfreason, targetLog };
}

// ---------------------------------------------------------------------------
// configureSensitivityAndTargets helpers
// ---------------------------------------------------------------------------

/** Resolves target_bg, min_bg, max_bg, high_bg from profile. Returns earlyReturn if profileTarget is undefined. */
function resolveProfileTargets(
    profileTarget: number | undefined,
    profile: Profile,
    cgmReason: string | undefined,
): { earlyReturn: DetermineBasalResult } | { target_bg: number; min_bg: number; max_bg: number | undefined; high_bg: number | undefined } {
    if (profileTarget === undefined) {
        const result = {} as DetermineBasalResult;
        if (cgmReason) {
            result.reason = cgmReason;
        }
        result.error ='Error: could not determine target_bg. ';
        return { earlyReturn: result };
    }

    return {
        target_bg: profileTarget,
        min_bg: profileTarget,
        max_bg: profile.max_bg !== undefined ? profileTarget : undefined,
        high_bg: profile.enableSMB_high_bg_target,
    };
}

/** Calculates sensitivity ratio from temp targets or autosens, applies override target, and boosts dynamic ratio for low targets. */
function resolveSensitivityRatio(
    target_bg: number,
    overrideTarget: number,
    bg: number,
    dynISFenabled: boolean,
    newRatio: number,
    profile: Profile,
    autosens_data: AutosensData,
): { sensitivityRatio: number | undefined; target_bg: number } {
    const high_temptarget_raises_sensitivity = profile.exercise_mode || profile.high_temptarget_raises_sensitivity;
    const normalTarget = EXERCISE_NORMAL_TARGET;
    const halfBasalTarget = profile.half_basal_exercise_target as number;

    let sensitivityRatio: number | undefined;

    // Temp target sensitivity adjustment
    if ( high_temptarget_raises_sensitivity && profile.temptargetSet && target_bg > normalTarget ||
        profile.low_temptarget_lowers_sensitivity && profile.temptargetSet && target_bg < normalTarget ) {
        sensitivityRatio = calculateTempTargetSensitivityRatio(target_bg, normalTarget, halfBasalTarget, profile.autosens_max);
        console.log(`Sensitivity ratio set to ${sensitivityRatio} based on temp target of ${target_bg}; `);
        return maybeBoostDynamicRatio(sensitivityRatio, target_bg, bg, normalTarget, dynISFenabled, newRatio, profile, autosens_data);
    }

    // Autosens ratio
    if (autosens_data !== undefined && autosens_data) {
        sensitivityRatio = autosens_data.ratio;

        // Override Profile.Target
        if (overrideTarget !== 0 && overrideTarget !== OVERRIDE_TARGET_SENTINEL && overrideTarget !== profile.min_bg && !profile.temptargetSet) {
            target_bg = overrideTarget;
            console.log(`Current Override Profile Target: ${convert_bg(overrideTarget, profile)} ${profile.out_units}`);
        }
        console.log(`Autosens ratio: ${sensitivityRatio}; `);
    }

    return maybeBoostDynamicRatio(sensitivityRatio, target_bg, bg, normalTarget, dynISFenabled, newRatio, profile, autosens_data);
}

/** Increases the dynamic ratio when using a low temp target. */
function maybeBoostDynamicRatio(
    sensitivityRatio: number | undefined,
    target_bg: number,
    bg: number,
    normalTarget: number,
    dynISFenabled: boolean,
    newRatio: number,
    profile: Profile,
    autosens_data: AutosensData,
): { sensitivityRatio: number | undefined; target_bg: number } {
    if (!profile.temptargetSet || target_bg >= normalTarget || !dynISFenabled || bg < target_bg) {
        return { sensitivityRatio, target_bg };
    }
    if ((sensitivityRatio as number) >= newRatio) {
        return { sensitivityRatio, target_bg };
    }
    autosens_data.ratio = newRatio * (normalTarget / target_bg);
    autosens_data.ratio = Math.min(autosens_data.ratio, profile.autosens_max);
    sensitivityRatio = round(autosens_data.ratio, 2);
    console.log(`Dynamic ratio increased from ${round(newRatio, 2)} to ${round(autosens_data.ratio, 2)} due to a low temp target (${target_bg}).`);
    return { sensitivityRatio, target_bg };
}

/** Formats the target log string showing target transitions. */
function formatTargetLog(
    target_bg: number,
    profileTarget: number,
    overrideTarget: number,
    profile: Profile,
): number | string {
    if (target_bg == profileTarget) {
        return convert_bg(target_bg, profile);
    }
    if (overrideTarget !== 0 && overrideTarget !== OVERRIDE_TARGET_SENTINEL && overrideTarget !== target_bg) {
        return `${convert_bg(profileTarget, profile)}\u2192${convert_bg(overrideTarget, profile)}\u2192${convert_bg(target_bg, profile)}`;
    }
    return `${convert_bg(profileTarget, profile)}\u2192${convert_bg(target_bg, profile)}`;
}

// ---------------------------------------------------------------------------
// Extracted pure helpers
// ---------------------------------------------------------------------------

/** Calculates sensitivity ratio based on temp target distance from normal target. */
export function calculateTempTargetSensitivityRatio(
    target_bg: number,
    normalTarget: number,
    halfBasalTarget: number,
    autosens_max: number,
): number {
    // w/ target 100, temp target 110 = .89, 120 = 0.8, 140 = 0.67, 160 = .57, and 200 = .44
    // e.g.: Sensitivity ratio set to 0.8 based on temp target of 120; Adjusting basal from 1.65 to 1.35; ISF from 58.9 to 73.6
    //sensitivityRatio = 2/(2+(target_bg-normalTarget)/40);
    const c = halfBasalTarget - normalTarget;
    // getting multiplication less or equal to 0 means that we have a really low target with a really low halfBasalTarget
    // with low TT and lowTTlowersSensitivity we need autosens_max as a value
    // we use multiplication instead of the division to avoid "division by zero error"
    let sensitivityRatio: number;
    if (c * (c + target_bg-normalTarget) <= 0.0) {
      sensitivityRatio = autosens_max;
    }
    else {
      sensitivityRatio = c/(c+target_bg-normalTarget);
    }
    // limit sensitivityRatio to profile.autosens_max (1.2x by default)
    sensitivityRatio = Math.min(sensitivityRatio, autosens_max);
    sensitivityRatio = round(sensitivityRatio,2);
    return sensitivityRatio;
}

/** Adjusts basal rate by sensitivity ratio (non-dynamic ISF path). */
export function adjustBasalBySensitivity(
    basal: number,
    sensitivityRatio: number | undefined,
    overrideFactor: number,
    dynISFenabled: boolean,
    profile: Profile,
    profile_current_basal: number,
): number {
    if (sensitivityRatio && !dynISFenabled) { // Only enable adjustment of basal by sensitivityRatio when not using dISF
        basal = profile.current_basal * overrideFactor * sensitivityRatio;
        basal = round_basal(basal, profile);
        if (basal !== profile_current_basal) {
            console.log(`Adjusting basal from ${profile_current_basal} to ${basal}; `);
        } else {
            console.log(`Basal unchanged: ${basal}; `);
        }
    }
    return basal;
}

/** Adjusts basal rate by TDD ratio (dynamic ISF with tddAdjBasal path). */
export function adjustBasalByTDD(
    basal: number,
    tdd24h_14d_Ratio: number,
    overrideFactor: number,
    profile: Profile,
    profile_current_basal: number,
    tdd_before: number,
    weightedAverage: number,
    average_total_data: number,
    weightPercentage: number,
): number {
    basal = profile.current_basal * tdd24h_14d_Ratio * overrideFactor;
    basal = round_basal(basal, profile);
    if (average_total_data > 0) {
        console.log(`TDD-adjustment of basals activated, using tdd24h_14d_Ratio ${round(tdd24h_14d_Ratio, 2)}, TDD 24h = ${round(tdd_before, 2)}U, Weighted average TDD = ${round(weightedAverage, 2)}U, (Weight percentage = ${weightPercentage}), Total data of TDDs (up to 14 days) average = ${round(average_total_data, 2)}U. `);
        if (basal !== profile_current_basal * overrideFactor) {
            console.log(`Adjusting basal from ${profile_current_basal * overrideFactor} U/h to ${basal} U/h; `);
        } else { console.log(`Basal unchanged: ${basal} U/h; `); }
    }
    return basal;
}

/** Adjusts target BG values based on autosens ratio when no temp target is running. */
export function adjustTargetByAutosens(
    target_bg: number,
    min_bg: number,
    max_bg: number,
    profile: Profile,
    autosens_data: AutosensData,
): {
    target_bg: number;
    min_bg: number;
    max_bg: number;
    new_target_bg: number | undefined;
} {
    let new_target_bg: number | undefined;
    // adjust min, max, and target BG for sensitivity, such that 50% increase in ISF raises target from 100 to 120
    if (profile.temptargetSet) {
    } else if (autosens_data !== undefined && autosens_data) {
        if ( profile.sensitivity_raises_target && autosens_data.ratio < 1 || profile.resistance_lowers_target && autosens_data.ratio > 1 ) {
            // with a target of 100, default 0.7-1.2 autosens min/max range would allow a 93-117 target range
            min_bg = round((min_bg - TARGET_BG_PIVOT) / autosens_data.ratio) + TARGET_BG_PIVOT;
            max_bg = round((max_bg - TARGET_BG_PIVOT) / autosens_data.ratio) + TARGET_BG_PIVOT;
            new_target_bg = round((target_bg - TARGET_BG_PIVOT) / autosens_data.ratio) + TARGET_BG_PIVOT;
            // don't allow target_bg below 80
            new_target_bg = Math.max(MIN_BG_TARGET, new_target_bg);
            if (target_bg === new_target_bg) {
                console.log(`target_bg unchanged: ${convert_bg(new_target_bg as number, profile)}; `);
            } else {
                console.log(`target_bg from ${convert_bg(new_target_bg as number, profile)} to ${convert_bg(new_target_bg as number, profile)}; `);
            }
            target_bg = new_target_bg;
        }
    }
    return { target_bg, min_bg, max_bg, new_target_bg };
}

/** Raises target BG values for noisy or raw CGM data. Returns adjusted values and whether adjustment was applied. */
export function adjustTargetsForNoisyCGM(
    min_bg: number,
    target_bg: number,
    max_bg: number,
    noise: number,
    profile: Profile,
): {
    min_bg: number;
    target_bg: number;
    max_bg: number;
    adjusted: boolean;
} {
    if (noise >= CGM_NOISE_LEVEL_NOISY) {
        // increase target at least 10% (default 30%) for raw / noisy data
        const noisyCGMTargetMultiplier = Math.max( MIN_NOISY_TARGET_MULTIPLIER, profile.noisyCGMTargetMultiplier as number );
        // don't allow maxRaw above 250
        const maxRaw = Math.min( MAX_RAW_BG, profile.maxRaw as number );
        const adjustedMinBG = round(Math.min(MAX_BG_TARGET, min_bg * noisyCGMTargetMultiplier ));
        const adjustedTargetBG = round(Math.min(MAX_BG_TARGET, target_bg * noisyCGMTargetMultiplier ));
        const adjustedMaxBG = round(Math.min(MAX_BG_TARGET, max_bg * noisyCGMTargetMultiplier ));
        return { min_bg: adjustedMinBG, target_bg: adjustedTargetBG, max_bg: adjustedMaxBG, adjusted: true };
    }
    return { min_bg, target_bg, max_bg, adjusted: false };
}

/** Calculates the low glucose threshold from min_bg and user threshold setting. */
export function calculateLowGlucoseThreshold(
    min_bg: number,
    threshold_setting: number,
): number {
    // min_bg thresholds: 80->60, 90->65, 100->70, 110->75, 120->80
    const threshold = min_bg - THRESHOLD_FACTOR*(min_bg-THRESHOLD_BG_OFFSET);
    // Set threshold to the user's setting, as long as it's between 60-120 and above the default calculated threshold
    return Math.min(Math.max(threshold_setting, threshold, MIN_THRESHOLD_BG), MAX_THRESHOLD_BG);
}

/** Adjusts ISF based on sensitivity ratio. Returns adjusted sensitivity and ISF reason string. */
export function adjustISFBySensitivity(
    sensitivity: number,
    sensitivityRatio: number,
    profile: Profile,
    autosens_data: AutosensData,
): {
    adjustedSens: number;
    isfreason: string;
} {
    let isfreason = "";
    const profile_sens = round(sensitivity, 1);
    let adjustedSens = sensitivity;
    if (autosens_data !== undefined && autosens_data) {
        adjustedSens = sensitivity / sensitivityRatio;
        adjustedSens = round(adjustedSens, 1);
        if (adjustedSens !== sensitivity) {
            console.log(`ISF from ${convert_bg(sensitivity, profile)} to ${convert_bg(adjustedSens, profile)}`);
        } else {
            console.log(`ISF unchanged: ${convert_bg(adjustedSens, profile)}`);
        }
        isfreason += `Autosens ratio: ${round(sensitivityRatio, 2)}, ISF: ${convert_bg(sensitivity, profile)}\u2192${convert_bg(adjustedSens, profile)}`;

    }
    return { adjustedSens, isfreason };
}
