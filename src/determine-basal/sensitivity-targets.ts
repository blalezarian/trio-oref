import {
    EXERCISE_NORMAL_TARGET,
    MIN_BG_TARGET,
    MAX_BG_TARGET,
} from '../shared/constants';

import { roundBasal } from '../utils/rounding';

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

import { round, convertBG } from './helpers';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Configures sensitivity ratio, target BG, and threshold based on autosens, overrides, temp targets, and CGM noise. */
export function configureSensitivityAndTargets(
    glucoseStatus: GlucoseStatus,
    profile: Profile,
    autosensData: AutosensData,
    profileTarget: number,
    overrideTarget: number,
    bg: number,
    dynISFenabled: boolean,
    newRatio: number,
    tdd24hTo14dRatio: number,
    overrideFactor: number,
    profileCurrentBasal: number,
    tddBefore: number,
    weightedAverage: number,
    averageTotalData: number,
    weightPercentage: number,
    sensitivity: number,
    carbRatio: number,
    basal: number,
    cgmReason: string | undefined
): { earlyReturn: DetermineBasalResult } | SensitivityAndTargetsResult {
    // Resolve profile targets — early return if profileTarget is undefined
    const targetsResult = resolveProfileTargets(profileTarget, profile, cgmReason);
    if ('earlyReturn' in targetsResult) return targetsResult;
    let { targetBG, minBG, maxBG } = targetsResult;
    const { highBG } = targetsResult;

    const maxIOB = profile.max_iob; // maximum amount of non-bolus IOB OpenAPS will ever deliver

    // Calculate sensitivityRatio and apply override target
    const sensResult = resolveSensitivityRatio(targetBG, overrideTarget, bg, dynISFenabled, newRatio, profile, autosensData);
    targetBG = sensResult.targetBG;
    const sensitivityRatio = sensResult.sensitivityRatio;

    basal = adjustBasalBySensitivity(basal, sensitivityRatio, overrideFactor, dynISFenabled, profile, profileCurrentBasal);

    if (dynISFenabled && profile.tddAdjBasal) {
        basal = adjustBasalByTDD(basal, tdd24hTo14dRatio, overrideFactor, profile, profileCurrentBasal, tddBefore, weightedAverage, averageTotalData, weightPercentage);
    }

    // Adjust BG target based on autosens ratio if no temp target is running
    const targetAdjustment = adjustTargetByAutosens(Number(targetBG), Number(minBG), Number(maxBG), profile, autosensData);
    targetBG = targetAdjustment.targetBG;
    minBG = targetAdjustment.minBG;
    maxBG = targetAdjustment.maxBG;

    const targetLog = formatTargetLog(Number(targetBG), profileTarget, overrideTarget, profile);

    // Raise target for noisy / raw CGM data.
    const noisyTargets = adjustTargetsForNoisyCGM(Number(minBG), Number(targetBG), Number(maxBG), Number(glucoseStatus.noise), profile);
    if (noisyTargets.adjusted) {
        console.log(`Raising target_bg for noisy / raw CGM data, from ${convertBG(Number(targetAdjustment.newTargetBG), profile)} to ${convertBG(noisyTargets.targetBG, profile)}; `);
        minBG = noisyTargets.minBG;
        targetBG = noisyTargets.targetBG;
        maxBG = noisyTargets.maxBG;
    }

    const thresholdFinal = calculateLowGlucoseThreshold(Number(minBG), Number(profile.threshold_setting));
    console.log(`Threshold set to ${convertBG(thresholdFinal, profile)}`);

    // Adjust ISF based on sensitivityRatio
    const { adjustedSens, isfreason } = adjustISFBySensitivity(sensitivity, Number(sensitivityRatio), profile, autosensData);
    console.log(`CR:${carbRatio}`);

    return { maxIOB, targetBG: Number(targetBG), minBG: Number(minBG), maxBG: Number(maxBG), highBG: Number(highBG), sensitivityRatio, basal, threshold: thresholdFinal, adjustedSens, isfreason, targetLog };
}

// ---------------------------------------------------------------------------
// configureSensitivityAndTargets helpers
// ---------------------------------------------------------------------------

/** Resolves targetBG, minBG, maxBG, highBG from profile. Returns earlyReturn if profileTarget is undefined. */
function resolveProfileTargets(
    profileTarget: number | undefined,
    profile: Profile,
    cgmReason: string | undefined,
): { earlyReturn: DetermineBasalResult } | { targetBG: number; minBG: number; maxBG: number | undefined; highBG: number | undefined } {
    if (profileTarget === undefined) {
        const result = {} as DetermineBasalResult;
        if (cgmReason) {
            result.reason = cgmReason;
        }
        result.error ='Error: could not determine target_bg. ';
        return { earlyReturn: result };
    }

    return {
        targetBG: profileTarget,
        minBG: profileTarget,
        maxBG: profile.max_bg !== undefined ? profileTarget : undefined,
        highBG: profile.enableSMB_high_bg_target,
    };
}

/** Calculates sensitivity ratio from temp targets or autosens, applies override target, and boosts dynamic ratio for low targets. */
function resolveSensitivityRatio(
    targetBG: number,
    overrideTarget: number,
    bg: number,
    dynISFenabled: boolean,
    newRatio: number,
    profile: Profile,
    autosensData: AutosensData,
): { sensitivityRatio: number | undefined; targetBG: number } {
    const highTemptargetRaisesSensitivity = profile.exercise_mode || profile.high_temptarget_raises_sensitivity;
    const normalTarget = EXERCISE_NORMAL_TARGET;
    const halfBasalTarget = Number(profile.half_basal_exercise_target);

    let sensitivityRatio: number | undefined;

    // Temp target sensitivity adjustment
    if ( highTemptargetRaisesSensitivity && profile.temptargetSet && targetBG > normalTarget ||
        profile.low_temptarget_lowers_sensitivity && profile.temptargetSet && targetBG < normalTarget ) {
        sensitivityRatio = calculateTempTargetSensitivityRatio(targetBG, normalTarget, halfBasalTarget, profile.autosens_max);
        console.log(`Sensitivity ratio set to ${sensitivityRatio} based on temp target of ${targetBG}; `);
        return maybeBoostDynamicRatio(sensitivityRatio, targetBG, bg, normalTarget, dynISFenabled, newRatio, profile, autosensData);
    }

    // Autosens ratio
    if (autosensData !== undefined && autosensData) {
        sensitivityRatio = autosensData.ratio;

        // Override Profile.Target
        if (overrideTarget !== 0 && overrideTarget !== OVERRIDE_TARGET_SENTINEL && overrideTarget !== profile.min_bg && !profile.temptargetSet) {
            targetBG = overrideTarget;
            console.log(`Current Override Profile Target: ${convertBG(overrideTarget, profile)} ${profile.out_units}`);
        }
        console.log(`Autosens ratio: ${sensitivityRatio}; `);
    }

    return maybeBoostDynamicRatio(sensitivityRatio, targetBG, bg, normalTarget, dynISFenabled, newRatio, profile, autosensData);
}

/** Increases the dynamic ratio when using a low temp target. */
function maybeBoostDynamicRatio(
    sensitivityRatio: number | undefined,
    targetBG: number,
    bg: number,
    normalTarget: number,
    dynISFenabled: boolean,
    newRatio: number,
    profile: Profile,
    autosensData: AutosensData,
): { sensitivityRatio: number | undefined; targetBG: number } {
    if (!profile.temptargetSet || targetBG >= normalTarget || !dynISFenabled || bg < targetBG) {
        return { sensitivityRatio, targetBG };
    }
    if (Number(sensitivityRatio) >= newRatio) {
        return { sensitivityRatio, targetBG };
    }
    autosensData.ratio = newRatio * (normalTarget / targetBG);
    autosensData.ratio = Math.min(autosensData.ratio, profile.autosens_max);
    sensitivityRatio = round(autosensData.ratio, 2);
    console.log(`Dynamic ratio increased from ${round(newRatio, 2)} to ${round(autosensData.ratio, 2)} due to a low temp target (${targetBG}).`);
    return { sensitivityRatio, targetBG };
}

/** Formats the target log string showing target transitions. */
function formatTargetLog(
    targetBG: number,
    profileTarget: number,
    overrideTarget: number,
    profile: Profile,
): number | string {
    if (targetBG == profileTarget) {
        return convertBG(targetBG, profile);
    }
    if (overrideTarget !== 0 && overrideTarget !== OVERRIDE_TARGET_SENTINEL && overrideTarget !== targetBG) {
        return `${convertBG(profileTarget, profile)}\u2192${convertBG(overrideTarget, profile)}\u2192${convertBG(targetBG, profile)}`;
    }
    return `${convertBG(profileTarget, profile)}\u2192${convertBG(targetBG, profile)}`;
}

// ---------------------------------------------------------------------------
// Extracted pure helpers
// ---------------------------------------------------------------------------

/** Calculates sensitivity ratio based on temp target distance from normal target. */
export function calculateTempTargetSensitivityRatio(
    targetBG: number,
    normalTarget: number,
    halfBasalTarget: number,
    autosens_max: number,
): number {
    // w/ target 100, temp target 110 = .89, 120 = 0.8, 140 = 0.67, 160 = .57, and 200 = .44
    // e.g.: Sensitivity ratio set to 0.8 based on temp target of 120; Adjusting basal from 1.65 to 1.35; ISF from 58.9 to 73.6
    const c = halfBasalTarget - normalTarget;
    // getting multiplication <= 0 means very low target with very low halfBasalTarget
    // use multiplication instead of division to avoid "division by zero error"
    const rawRatio = c * (c + targetBG - normalTarget) <= 0.0
        ? autosens_max
        : c / (c + targetBG - normalTarget);
    // limit sensitivityRatio to profile.autosens_max (1.2x by default)
    return round(Math.min(rawRatio, autosens_max), 2);
}

/** Adjusts basal rate by sensitivity ratio (non-dynamic ISF path). */
export function adjustBasalBySensitivity(
    basal: number,
    sensitivityRatio: number | undefined,
    overrideFactor: number,
    dynISFenabled: boolean,
    profile: Profile,
    profileCurrentBasal: number,
): number {
    if (sensitivityRatio && !dynISFenabled) { // Only enable adjustment of basal by sensitivityRatio when not using dISF
        basal = profile.current_basal * overrideFactor * sensitivityRatio;
        basal = roundBasal(basal, profile);
        if (basal !== profileCurrentBasal) {
            console.log(`Adjusting basal from ${profileCurrentBasal} to ${basal}; `);
        } else {
            console.log(`Basal unchanged: ${basal}; `);
        }
    }
    return basal;
}

/** Adjusts basal rate by TDD ratio (dynamic ISF with tddAdjBasal path). */
export function adjustBasalByTDD(
    basal: number,
    tdd24hTo14dRatio: number,
    overrideFactor: number,
    profile: Profile,
    profileCurrentBasal: number,
    tddBefore: number,
    weightedAverage: number,
    averageTotalData: number,
    weightPercentage: number,
): number {
    basal = profile.current_basal * tdd24hTo14dRatio * overrideFactor;
    basal = roundBasal(basal, profile);
    if (averageTotalData > 0) {
        console.log(`TDD-adjustment of basals activated, using tdd24h_14d_Ratio ${round(tdd24hTo14dRatio, 2)}, TDD 24h = ${round(tddBefore, 2)}U, Weighted average TDD = ${round(weightedAverage, 2)}U, (Weight percentage = ${weightPercentage}), Total data of TDDs (up to 14 days) average = ${round(averageTotalData, 2)}U. `);
        if (basal !== profileCurrentBasal * overrideFactor) {
            console.log(`Adjusting basal from ${profileCurrentBasal * overrideFactor} U/h to ${basal} U/h; `);
        } else { console.log(`Basal unchanged: ${basal} U/h; `); }
    }
    return basal;
}

/** Adjusts target BG values based on autosens ratio when no temp target is running. */
export function adjustTargetByAutosens(
    targetBG: number,
    minBG: number,
    maxBG: number,
    profile: Profile,
    autosensData: AutosensData,
): {
    targetBG: number;
    minBG: number;
    maxBG: number;
    newTargetBG: number | undefined;
} {
    let newTargetBG: number | undefined;
    // adjust min, max, and target BG for sensitivity, such that 50% increase in ISF raises target from 100 to 120
    if (profile.temptargetSet) {
    } else if (autosensData !== undefined && autosensData) {
        if ( profile.sensitivity_raises_target && autosensData.ratio < 1 || profile.resistance_lowers_target && autosensData.ratio > 1 ) {
            // with a target of 100, default 0.7-1.2 autosens min/max range would allow a 93-117 target range
            minBG = round((minBG - TARGET_BG_PIVOT) / autosensData.ratio) + TARGET_BG_PIVOT;
            maxBG = round((maxBG - TARGET_BG_PIVOT) / autosensData.ratio) + TARGET_BG_PIVOT;
            newTargetBG = round((targetBG - TARGET_BG_PIVOT) / autosensData.ratio) + TARGET_BG_PIVOT;
            // don't allow target_bg below 80
            newTargetBG = Math.max(MIN_BG_TARGET, newTargetBG);
            if (targetBG === newTargetBG) {
                console.log(`target_bg unchanged: ${convertBG(Number(newTargetBG), profile)}; `);
            } else {
                console.log(`target_bg from ${convertBG(Number(newTargetBG), profile)} to ${convertBG(Number(newTargetBG), profile)}; `);
            }
            targetBG = newTargetBG;
        }
    }
    return { targetBG, minBG, maxBG, newTargetBG };
}

/** Raises target BG values for noisy or raw CGM data. Returns adjusted values and whether adjustment was applied. */
export function adjustTargetsForNoisyCGM(
    minBG: number,
    targetBG: number,
    maxBG: number,
    noise: number,
    profile: Profile,
): {
    minBG: number;
    targetBG: number;
    maxBG: number;
    adjusted: boolean;
} {
    if (noise >= CGM_NOISE_LEVEL_NOISY) {
        // increase target at least 10% (default 30%) for raw / noisy data
        const noisyCGMTargetMultiplier = Math.max( MIN_NOISY_TARGET_MULTIPLIER, Number(profile.noisyCGMTargetMultiplier) );
        // don't allow maxRaw above 250
        const maxRaw = Math.min( MAX_RAW_BG, Number(profile.maxRaw) );
        const adjustedMinBG = round(Math.min(MAX_BG_TARGET, minBG * noisyCGMTargetMultiplier ));
        const adjustedTargetBG = round(Math.min(MAX_BG_TARGET, targetBG * noisyCGMTargetMultiplier ));
        const adjustedMaxBG = round(Math.min(MAX_BG_TARGET, maxBG * noisyCGMTargetMultiplier ));
        return { minBG: adjustedMinBG, targetBG: adjustedTargetBG, maxBG: adjustedMaxBG, adjusted: true };
    }
    return { minBG, targetBG, maxBG, adjusted: false };
}

/** Calculates the low glucose threshold from minBG and user threshold setting. */
export function calculateLowGlucoseThreshold(
    minBG: number,
    thresholdSetting: number,
): number {
    // minBG thresholds: 80->60, 90->65, 100->70, 110->75, 120->80
    const threshold = minBG - THRESHOLD_FACTOR*(minBG-THRESHOLD_BG_OFFSET);
    // Set threshold to the user's setting, as long as it's between 60-120 and above the default calculated threshold
    return Math.min(Math.max(thresholdSetting, threshold, MIN_THRESHOLD_BG), MAX_THRESHOLD_BG);
}

/** Adjusts ISF based on sensitivity ratio. Returns adjusted sensitivity and ISF reason string. */
export function adjustISFBySensitivity(
    sensitivity: number,
    sensitivityRatio: number,
    profile: Profile,
    autosensData: AutosensData,
): {
    adjustedSens: number;
    isfreason: string;
} {
    if (!autosensData) {
        return { adjustedSens: sensitivity, isfreason: '' };
    }

    const adjustedSens = round(sensitivity / sensitivityRatio, 1);
    if (adjustedSens !== sensitivity) {
        console.log(`ISF from ${convertBG(sensitivity, profile)} to ${convertBG(adjustedSens, profile)}`);
    } else {
        console.log(`ISF unchanged: ${convertBG(adjustedSens, profile)}`);
    }
    const isfreason = `Autosens ratio: ${round(sensitivityRatio, 2)}, ISF: ${convertBG(sensitivity, profile)}\u2192${convertBG(adjustedSens, profile)}`;

    return { adjustedSens, isfreason };
}
