import {
    MGDL_TO_MMOL,
    DEFAULT_SMB_DELIVERY_RATIO,
    DYNAMIC_ISF_LOG_DENOMINATOR,
    INSULIN_FACTOR_CEILING,
    RAPID_ACTING_ACTIVITY_OFFSET,
    ULTRA_RAPID_ACTIVITY_OFFSET,
} from '../shared/constants';

import type {
    GlucoseStatus,
    Profile,
    AutosensData,
    DetermineBasalResult,
    Preferences,
} from '../types/index';

import {
    DYNISF_EXERCISE_THRESHOLD,
} from './constants';

import type { DynamicISFResult } from './types';

import { round } from './helpers';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Calculates dynamic ISF ratio and related TDD-based adjustments for insulin sensitivity. */
export function calculateDynamicISF(
    glucose_status: GlucoseStatus,
    profile: Profile,
    preferences: Preferences,
    autosens_data: AutosensData,
    sensitivity: number,
    profileTarget: number,
    dynISFenabled: boolean,
    tdd: number,
    weightedAverage: number,
    average_total_data: number,
    weightPercentage: number,
    middleWare: ((arg: DetermineBasalResult) => DetermineBasalResult) | undefined
): DynamicISFResult {
    let logOutPut = "";

    // In case the autosens.min/max limits are reversed:
    const minLimitChris = Math.min(profile.autosens_min, profile.autosens_max);
    const maxLimitChris = Math.max(profile.autosens_min, profile.autosens_max);

    // Turn off when autosens.min = autosens.max
    if (maxLimitChris == minLimitChris || maxLimitChris < 1 || minLimitChris > 1) {
        dynISFenabled = false;
        console.log("Dynamic ISF disabled due to current autosens settings");
    }

    // Dynamic ratios
    const BG = glucose_status.glucose;
    const adjustmentFactor = preferences.adjustmentFactor;
    const adjustmentFactorSigmoid = preferences.adjustmentFactorSigmoid;
    const enable_sigmoid = preferences.sigmoid;
    const currentMinTarget = profileTarget;
    let exerciseSetting = false;
    let log = "";
    let tdd24h_14d_Ratio = 1;
    let basal_ratio_log = "";

    if (average_total_data > 0) {
        tdd24h_14d_Ratio = weightedAverage / average_total_data;
    }

    // respect autosens_max/min for tdd24h_14d_Ratio, used to adjust basal similarly as autosens
    tdd24h_14d_Ratio = clampTDDRatio(tdd24h_14d_Ratio, profile.autosens_min, profile.autosens_max);

    basal_ratio_log = `, Basal ratio: ${tdd24h_14d_Ratio}`;

    // One of two exercise settings (they share the same purpose)

    if (profile.high_temptarget_raises_sensitivity || profile.exercise_mode) {
    exerciseSetting = true;
    }

    // Turn off Chris' formula when using a temp target >= 118 (6.5 mol/l) and if an exercise setting is enabled.
    if (currentMinTarget >= DYNISF_EXERCISE_THRESHOLD && exerciseSetting) {
        dynISFenabled = false;
        log = `Dynamic ISF temporarily off due to a high temp target/exercising. Current min target: ${currentMinTarget}`;
    }

    const startLog = ", Dynamic ratios log: ";
    const afLog = `, AF: ${enable_sigmoid ? adjustmentFactorSigmoid : adjustmentFactor}`;
    const bgLog = `BG: ${BG} mg/dl (${(BG * MGDL_TO_MMOL).toPrecision(2)} mmol/l)`;
    let formula = "";
    let weightLog = "";

    // Insulin curve
    const insulinFactor = configureInsulinCurve(preferences.curve, profile.insulinPeakTime, preferences.useCustomPeakTime);

    // Use weighted TDD average
    const tdd_before: number = tdd;

    if (weightPercentage < 1 && weightedAverage > 1) {
        tdd = weightedAverage;
        console.log(`Using weighted TDD average: ${round(tdd, 2)} U, instead of past 24 h (${round(tdd_before, 2)} U), weight: ${weightPercentage}`);
        weightLog = `, Weighted TDD: ${round(tdd, 2)} U`;
    }

    // Modified Chris Wilson's formula with added adjustmentFactor for tuning and use of the autosens.ratio.
    // Uses logarithmic formula: newRatio = profile.sens * adjustmentFactor * tdd * ln((BG/insulinFactor) + 1) / 1800

    let sigmoidLog = "";
    let newRatio: number | undefined;

    if (dynISFenabled) {
        // Logarithmic
        if (!enable_sigmoid) {
            newRatio = calculateLogarithmicRatio(sensitivity, adjustmentFactor, tdd, BG, insulinFactor);
            formula = ", Logarithmic formula";
        }
        // Sigmoid
        else {
            newRatio = calculateSigmoidRatio(BG, profileTarget, tdd24h_14d_Ratio, adjustmentFactorSigmoid, minLimitChris, maxLimitChris);
            formula = ", Sigmoid function";
        }
    }

    let dynamicISFLog = "";
    let limitLog = "";

    if (dynISFenabled && tdd > 0) {

        dynamicISFLog = ", Dynamic ISF: On";

        // Respect autosens.max and autosens.min limits
        const limits = enforceAutosensLimits(newRatio as number, minLimitChris, maxLimitChris);
        newRatio = limits.clampedRatio;
        log = limits.log;
        limitLog = limits.limitLog;

        const isf = sensitivity / (newRatio as number);

         // Set the new ratio
         autosens_data.ratio = newRatio as number;

        sigmoidLog = `. Using Sigmoid function, the autosens ratio has been adjusted with sigmoid factor to: ${round(autosens_data.ratio, 2)}. New ISF = ${round(isf, 2)} mg/dl (${round(MGDL_TO_MMOL * isf, 2)} (mmol/l).`;

        if (!enable_sigmoid) {
            log += `, Dynamic autosens.ratio set to ${round(newRatio as number, 2)} with ISF: ${isf.toPrecision(3)} mg/dl/U (${(isf * MGDL_TO_MMOL).toPrecision(3)} mmol/l/U)`;
        } else { log += sigmoidLog; }

        logOutPut += startLog + bgLog + afLog + formula + log + dynamicISFLog + weightLog;

    } else { logOutPut += startLog + "Dynamic Settings disabled"; }

    console.log(logOutPut);

    const tddReason = buildTDDReasonString(
        dynISFenabled,
        profile.tddAdjBasal,
        dynamicISFLog,
        formula,
        limitLog,
        afLog,
        basal_ratio_log,
        profile.smb_delivery_ratio,
        middleWare,
    );

    return { dynISFenabled, tdd, tddReason, newRatio: newRatio as number, insulinFactor, adjustmentFactor, enable_sigmoid, tdd24h_14d_Ratio };
}

// ---------------------------------------------------------------------------
// Extracted pure helpers
// ---------------------------------------------------------------------------

/** Clamps the TDD 24h/14d ratio within autosens min/max bounds. Values equal to 1 pass through unchanged. */
export function clampTDDRatio(
    ratio: number,
    minLimit: number,
    maxLimit: number,
): number {
    if (ratio > 1) {
        return round(Math.min(ratio, maxLimit), 2);
    } else if (ratio < 1) {
        return round(Math.max(ratio, minLimit), 2);
    }
    return ratio;
}

/** Determines insulinFactor based on insulin curve type and optional custom peak time. */
export function configureInsulinCurve(
    curve: string,
    insulinPeakTime: number,
    useCustomPeak: boolean,
): number {
    let insulinPA = RAPID_ACTING_ACTIVITY_OFFSET;

    switch (curve) {
        case "rapid-acting":
            insulinPA = RAPID_ACTING_ACTIVITY_OFFSET;
            break;
        case "ultra-rapid":
            insulinPA = ULTRA_RAPID_ACTIVITY_OFFSET;
            break;
    }

    if (useCustomPeak) {
        const insulinFactor = INSULIN_FACTOR_CEILING - insulinPeakTime;
        console.log(`Custom insulinpeakTime set to :${insulinPeakTime}, insulinFactor: ${insulinFactor}`);
        return insulinFactor;
    } else {
        const insulinFactor = INSULIN_FACTOR_CEILING - insulinPA;
        console.log(`insulinFactor set to : ${insulinFactor}`);
        return insulinFactor;
    }
}

/** Computes dynamic ISF ratio using the logarithmic (Chris Wilson) formula. */
export function calculateLogarithmicRatio(
    sensitivity: number,
    adjustmentFactor: number,
    tdd: number,
    BG: number,
    insulinFactor: number,
): number {
    return sensitivity * adjustmentFactor * tdd * Math.log(BG/insulinFactor+1) / DYNAMIC_ISF_LOG_DENOMINATOR;
}

/** Computes dynamic ISF ratio using the sigmoid function. */
export function calculateSigmoidRatio(
    BG: number,
    profileTarget: number,
    tdd24h_14d_Ratio: number,
    adjustmentFactorSigmoid: number,
    minLimit: number,
    maxLimit: number,
): number {
    const autosens_interval = maxLimit - minLimit;
    //Blood glucose deviation from set target (the lower BG target) converted to mmol/l to fit current formula.
    const bg_dev = (BG - profileTarget) * MGDL_TO_MMOL;
    // Account for TDD of insulin. Compare last 2 hours with total data (up to 14 days)
    const tdd_factor = tdd24h_14d_Ratio; // weighted average TDD / total data average TDD
    let max_minus_one = maxLimit - 1;
    // Avoid division by 0
    if (maxLimit == 1) {
        max_minus_one = maxLimit + 0.01 - 1;
    }
    //Makes sigmoid factor(y) = 1 when BG deviation(x) = 0.
    const fix_offset = (Math.log10(1/max_minus_one-minLimit/max_minus_one) / Math.log10(Math.E));
    //Exponent used in sigmoid formula
    const exponent = bg_dev * adjustmentFactorSigmoid * tdd_factor + fix_offset;
    // The sigmoid function
    const sigmoid_factor = autosens_interval / (1 + Math.exp(-exponent)) + minLimit;
    return sigmoid_factor;
}

/** Clamps newRatio to autosens min/max limits. Returns clamped ratio and log strings. */
export function enforceAutosensLimits(
    newRatio: number,
    minLimit: number,
    maxLimit: number,
): {
    clampedRatio: number;
    log: string;
    limitLog: string;
} {
    let log = "";
    let limitLog = "";
    let clampedRatio = newRatio;

    if (newRatio > maxLimit) {
        log = `, Dynamic ISF limited by autosens_max setting: ${maxLimit} (${round(newRatio, 2)}), `;
        limitLog = `, Autosens/Dynamic Limit: ${maxLimit} (${round(newRatio, 2)})`;
        clampedRatio = maxLimit;
    } else if (newRatio < minLimit) {
        log = `, Dynamic ISF limited by autosens_min setting: ${minLimit} (${round(newRatio, 2)}). `;
        limitLog = `, Autosens/Dynamic Limit: ${minLimit} (${round(newRatio, 2)})`;
        clampedRatio = minLimit;
    }

    return { clampedRatio, log, limitLog };
}

/** Builds the TDD reason string for display in the enacted result. */
export function buildTDDReasonString(
    dynISFenabled: boolean,
    tddAdjBasal: boolean | undefined,
    dynamicISFLog: string,
    formula: string,
    limitLog: string,
    afLog: string,
    basal_ratio_log: string,
    smb_delivery_ratio: number | undefined,
    middleWare: ((arg: DetermineBasalResult) => DetermineBasalResult) | undefined,
): string {
    let tddReason = "";

    if (!dynISFenabled) {
        tddReason += "";
    } else if (dynISFenabled && tddAdjBasal) {
        tddReason += dynamicISFLog + formula + limitLog + afLog + basal_ratio_log;
    }
    else if (dynISFenabled && !tddAdjBasal) { tddReason += dynamicISFLog + formula + limitLog + afLog; }

    if (DEFAULT_SMB_DELIVERY_RATIO !== smb_delivery_ratio) {
        tddReason += `, SMB Ratio: ${Math.min(smb_delivery_ratio as number, 1)}`;
    }

    // Not confident but something like this in iAPS v3.0.3
    if ((middleWare as unknown) !== "" && (middleWare as unknown) !== "Nothing changed"){
        tddReason += `, Middleware: ${middleWare}`;
    }

    return tddReason;
}
