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
    Preferences,
} from '../types/index';

import {
    DYNISF_EXERCISE_THRESHOLD,
} from './constants';

import type { DynamicISFResult } from './types';

import { round } from '../utils/rounding';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Calculates dynamic ISF ratio and related TDD-based adjustments for insulin sensitivity. */
export function calculateDynamicISF(
    glucoseStatus: GlucoseStatus,
    profile: Profile,
    preferences: Preferences,
    autosensData: AutosensData,
    sensitivity: number,
    profileTarget: number,
    dynISFenabled: boolean,
    tdd: number,
    weightedAverage: number,
    averageTotalData: number,
    weightPercentage: number,
    middleWare: string | undefined
): DynamicISFResult {
    // In case the autosens.min/max limits are reversed:
    const minLimitChris = Math.min(profile.autosens_min, profile.autosens_max);
    const maxLimitChris = Math.max(profile.autosens_min, profile.autosens_max);

    // Turn off when autosens.min = autosens.max
    if (maxLimitChris == minLimitChris || maxLimitChris < 1 || minLimitChris > 1) {
        dynISFenabled = false;
        console.log("Dynamic ISF disabled due to current autosens settings");
    }

    // Dynamic ratios
    const bg = glucoseStatus.glucose;
    const adjustmentFactor = preferences.adjustmentFactor;
    const adjustmentFactorSigmoid = preferences.adjustmentFactorSigmoid;
    const enableSigmoid = preferences.sigmoid;
    const exerciseSetting = profile.high_temptarget_raises_sensitivity || profile.exercise_mode;

    const rawTDDRatio = averageTotalData > 0 ? weightedAverage / averageTotalData : 1;
    // respect autosens_max/min for tdd24hTo14dRatio, used to adjust basal similarly as autosens
    const tdd24hTo14dRatio = clampTDDRatio(rawTDDRatio, profile.autosens_min, profile.autosens_max);
    const basalRatioLog = `, Basal ratio: ${tdd24hTo14dRatio}`;

    // Turn off Chris' formula when using a temp target >= 118 (6.5 mol/l) and if an exercise setting is enabled.
    let log = "";
    if (profileTarget >= DYNISF_EXERCISE_THRESHOLD && exerciseSetting) {
        dynISFenabled = false;
        log = `Dynamic ISF temporarily off due to a high temp target/exercising. Current min target: ${profileTarget}`;
    }

    const startLog = ", Dynamic ratios log: ";
    const afLog = `, AF: ${enableSigmoid ? adjustmentFactorSigmoid : adjustmentFactor}`;
    const bgLog = `BG: ${bg} mg/dl (${(bg * MGDL_TO_MMOL).toPrecision(2)} mmol/l)`;
    let formula = "";
    let weightLog = "";

    // Insulin curve
    const insulinFactor = configureInsulinCurve(preferences.curve, profile.insulinPeakTime, preferences.useCustomPeakTime);

    // Use weighted TDD average
    const tddBefore: number = tdd;

    if (weightPercentage < 1 && weightedAverage > 1) {
        tdd = weightedAverage;
        console.log(`Using weighted TDD average: ${round(tdd, 2)} U, instead of past 24 h (${round(tddBefore, 2)} U), weight: ${weightPercentage}`);
        weightLog = `, Weighted TDD: ${round(tdd, 2)} U`;
    }

    // Modified Chris Wilson's formula with added adjustmentFactor for tuning and use of the autosens.ratio.
    // Uses logarithmic formula: newRatio = profile.sens * adjustmentFactor * tdd * ln((BG/insulinFactor) + 1) / 1800

    let sigmoidLog = "";
    let newRatio: number | undefined;

    // SAFETY GUARD: TDD=0 means no dosing history (new user, pump reset, or data gap).
    // The original JS has a bug where dynISFenabled stays true but the prediction loops
    // (IOBpredBG, UAMpredBG) compute `1800 / (tdd * adjustmentFactor * ...)`, which
    // divides by zero and produces Infinity/NaN that cascades into predBGs, insulinReq,
    // and the final rate — resulting in "setting NaN U/hr" output.
    //
    // Trio loosely mitigates this by not allowing dynamic ISF for the first 7 days, but
    // that doesn't protect against data gaps or pump resets after day 7.
    //
    // This guard disables dynamic ISF entirely when TDD=0, falling back to static ISF
    // which gives a valid, conservative dosing decision.
    if (dynISFenabled && tdd <= 0) {
        dynISFenabled = false;
        console.log(startLog + "Dynamic Settings disabled (TDD=0)");
    }

    if (dynISFenabled) {
        if (!enableSigmoid) {
            newRatio = calculateLogarithmicRatio(sensitivity, adjustmentFactor, tdd, bg, insulinFactor);
            formula = ", Logarithmic formula";
        } else {
            newRatio = calculateSigmoidRatio(bg, profileTarget, tdd24hTo14dRatio, adjustmentFactorSigmoid, minLimitChris, maxLimitChris);
            formula = ", Sigmoid function";
        }
    }

    let dynamicISFLog = "";
    let limitLog = "";

    if (dynISFenabled && tdd > 0) {
        dynamicISFLog = ", Dynamic ISF: On";

        // Respect autosens.max and autosens.min limits
        const limits = enforceAutosensLimits(Number(newRatio), minLimitChris, maxLimitChris);
        newRatio = limits.clampedRatio;
        log = limits.log;
        limitLog = limits.limitLog;

        const isf = sensitivity / Number(newRatio);

        // Set the new ratio
        autosensData.ratio = Number(newRatio);

        sigmoidLog = `. Using Sigmoid function, the autosens ratio has been adjusted with sigmoid factor to: ${round(autosensData.ratio, 2)}. New ISF = ${round(isf, 2)} mg/dl (${round(MGDL_TO_MMOL * isf, 2)} (mmol/l).`;

        if (!enableSigmoid) {
            log += `, Dynamic autosens.ratio set to ${round(Number(newRatio), 2)} with ISF: ${isf.toPrecision(3)} mg/dl/U (${(isf * MGDL_TO_MMOL).toPrecision(3)} mmol/l/U)`;
        } else {
            log += sigmoidLog;
        }

        console.log(startLog + bgLog + afLog + formula + log + dynamicISFLog + weightLog);
    } else {
        console.log(startLog + "Dynamic Settings disabled");
    }

    const tddReason = buildTDDReasonString(
        dynISFenabled,
        profile.tddAdjBasal,
        dynamicISFLog,
        formula,
        limitLog,
        afLog,
        basalRatioLog,
        profile.smb_delivery_ratio,
        middleWare,
    );

    return { dynISFenabled, tdd, tddReason, newRatio: Number(newRatio), insulinFactor, adjustmentFactor, enableSigmoid, tdd24hTo14dRatio };
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
    if (useCustomPeak) {
        const insulinFactor = INSULIN_FACTOR_CEILING - insulinPeakTime;
        console.log(`Custom insulinpeakTime set to :${insulinPeakTime}, insulinFactor: ${insulinFactor}`);
        return insulinFactor;
    }

    const insulinPA = curve === "ultra-rapid" ? ULTRA_RAPID_ACTIVITY_OFFSET : RAPID_ACTING_ACTIVITY_OFFSET;
    const insulinFactor = INSULIN_FACTOR_CEILING - insulinPA;
    console.log(`insulinFactor set to : ${insulinFactor}`);
    return insulinFactor;
}

/** Computes dynamic ISF ratio using the logarithmic (Chris Wilson) formula. */
export function calculateLogarithmicRatio(
    sensitivity: number,
    adjustmentFactor: number,
    tdd: number,
    bg: number,
    insulinFactor: number,
): number {
    return sensitivity * adjustmentFactor * tdd * Math.log(bg / insulinFactor + 1) / DYNAMIC_ISF_LOG_DENOMINATOR;
}

/** Computes dynamic ISF ratio using the sigmoid function. */
export function calculateSigmoidRatio(
    bg: number,
    profileTarget: number,
    tdd24hTo14dRatio: number,
    adjustmentFactorSigmoid: number,
    minLimit: number,
    maxLimit: number,
): number {
    const autosensInterval = maxLimit - minLimit;
    //Blood glucose deviation from set target (the lower BG target) converted to mmol/l to fit current formula.
    const bgDev = (bg - profileTarget) * MGDL_TO_MMOL;
    // Account for TDD of insulin. Compare last 2 hours with total data (up to 14 days)
    const tddFactor = tdd24hTo14dRatio; // weighted average TDD / total data average TDD
    // Avoid division by 0 when maxLimit == 1
    const maxMinusOne = maxLimit == 1 ? 0.01 : maxLimit - 1;
    //Makes sigmoid factor(y) = 1 when BG deviation(x) = 0.
    const fixOffset = (Math.log10(1/maxMinusOne-minLimit/maxMinusOne) / Math.log10(Math.E));
    //Exponent used in sigmoid formula
    const exponent = bgDev * adjustmentFactorSigmoid * tddFactor + fixOffset;
    // The sigmoid function
    const sigmoidFactor = autosensInterval / (1 + Math.exp(-exponent)) + minLimit;
    return sigmoidFactor;
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
    basalRatioLog: string,
    smb_delivery_ratio: number | undefined,
    middleWare: string | undefined,
): string {
    let tddReason = "";

    if (!dynISFenabled) {
        tddReason += "";
    } else if (dynISFenabled && tddAdjBasal) {
        tddReason += dynamicISFLog + formula + limitLog + afLog + basalRatioLog;
    }
    else if (dynISFenabled && !tddAdjBasal) { tddReason += dynamicISFLog + formula + limitLog + afLog; }

    if (DEFAULT_SMB_DELIVERY_RATIO !== smb_delivery_ratio) {
        tddReason += `, SMB Ratio: ${Math.min(Number(smb_delivery_ratio), 1)}`;
    }

    // Middleware is a user-extensibility hook: power users can inject custom JS that
    // mutates algorithm inputs before determine-basal runs (e.g. overriding max_iob).
    // The prepare wrapper (prepare/determine-basal.js) calls the middleware function and
    // passes its return value — a reason string like "Overrode max_iob to 5" — here as
    // middleWare. It's "" when no middleware is loaded, or "Nothing changed" when the
    // middleware ran but made no modifications. The typeof guard prevents appending
    // "Middleware: undefined" when callers bypass the prepare wrapper.
    if (typeof middleWare === 'string' && middleWare !== "" && middleWare !== "Nothing changed") {
        tddReason += `, Middleware: ${middleWare}`;
    }

    return tddReason;
}
