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
    let tddReason = "";

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
    if (tdd24h_14d_Ratio > 1) {
        tdd24h_14d_Ratio = Math.min(tdd24h_14d_Ratio, profile.autosens_max);
        tdd24h_14d_Ratio = round(tdd24h_14d_Ratio,2);
    }
    else if (tdd24h_14d_Ratio < 1) {
        tdd24h_14d_Ratio = Math.max(tdd24h_14d_Ratio, profile.autosens_min);
        tdd24h_14d_Ratio = round(tdd24h_14d_Ratio,2);
    }

    basal_ratio_log = ", Basal ratio: " + tdd24h_14d_Ratio;

    // One of two exercise settings (they share the same purpose)

    if (profile.high_temptarget_raises_sensitivity || profile.exercise_mode) {
    exerciseSetting = true;
    }

    // Turn off Chris' formula when using a temp target >= 118 (6.5 mol/l) and if an exercise setting is enabled.
    if (currentMinTarget >= DYNISF_EXERCISE_THRESHOLD && exerciseSetting) {
        dynISFenabled = false;
        log = "Dynamic ISF temporarily off due to a high temp target/exercising. Current min target: " + currentMinTarget;
    }

    const startLog = ", Dynamic ratios log: ";
    const afLog = ", AF: " + (enable_sigmoid ? adjustmentFactorSigmoid : adjustmentFactor);
    const bgLog = "BG: " + BG + " mg/dl (" + (BG * MGDL_TO_MMOL).toPrecision(2) + " mmol/l)";
    let formula = "";
    let weightLog = "";

    // Insulin curve
    const curve = preferences.curve;
    const ipt = profile.insulinPeakTime;
    const ucpk = preferences.useCustomPeakTime;
    let insulinFactor = INSULIN_FACTOR_CEILING - RAPID_ACTING_ACTIVITY_OFFSET; // default
    let insulinPA = RAPID_ACTING_ACTIVITY_OFFSET; // default (Novorapid/Novolog)

    switch (curve) {
        case "rapid-acting":
            insulinPA = RAPID_ACTING_ACTIVITY_OFFSET;
            break;
        case "ultra-rapid":
            insulinPA = ULTRA_RAPID_ACTIVITY_OFFSET;
            break;
    }

    if (ucpk) {
        insulinFactor = INSULIN_FACTOR_CEILING - ipt;
        console.log("Custom insulinpeakTime set to :" + ipt + ", insulinFactor: " + insulinFactor);
    } else {
        insulinFactor = INSULIN_FACTOR_CEILING - insulinPA;
        console.log("insulinFactor set to : " + insulinFactor);
    }

    // Use weighted TDD average
    const tdd_before: number = tdd;

    if (weightPercentage < 1 && weightedAverage > 1) {
        tdd = weightedAverage;
        console.log("Using weighted TDD average: " + round(tdd,2) + " U, instead of past 24 h (" + round(tdd_before,2) + " U), weight: " + weightPercentage);
        weightLog = ", Weighted TDD: " + round(tdd,2) + " U";
    }

    // Modified Chris Wilson's formula with added adjustmentFactor for tuning and use of the autosens.ratio.
    // Uses logarithmic formula: newRatio = profile.sens * adjustmentFactor * tdd * ln((BG/insulinFactor) + 1) / 1800

    let sigmoidLog = ""
    let newRatio: number = undefined!;

    if (dynISFenabled) {
        // Logarithmic
        if (!enable_sigmoid) {
            newRatio = sensitivity * adjustmentFactor * tdd * Math.log(BG/insulinFactor+1) / DYNAMIC_ISF_LOG_DENOMINATOR;
            formula = ", Logarithmic formula";
        }
        // Sigmoid
        else {
            const as_min = minLimitChris;
            const autosens_interval = maxLimitChris - as_min;
            //Blood glucose deviation from set target (the lower BG target) converted to mmol/l to fit current formula.
            const bg_dev = (BG - profileTarget) * MGDL_TO_MMOL;
            // Account for TDD of insulin. Compare last 2 hours with total data (up to 14 days)
            const tdd_factor = tdd24h_14d_Ratio; // weighted average TDD / total data average TDD
            let max_minus_one = maxLimitChris - 1;
            // Avoid division by 0
            if (maxLimitChris == 1) {
                max_minus_one = maxLimitChris + 0.01 - 1;
            }
            //Makes sigmoid factor(y) = 1 when BG deviation(x) = 0.
            const fix_offset = (Math.log10(1/max_minus_one-as_min/max_minus_one) / Math.log10(Math.E));
            //Exponent used in sigmoid formula
            const exponent = bg_dev * adjustmentFactorSigmoid * tdd_factor + fix_offset;
            // The sigmoid function
            const sigmoid_factor = autosens_interval / (1 + Math.exp(-exponent)) + as_min;
            newRatio = sigmoid_factor;
            formula = ", Sigmoid function";
        }
    }

    let dynamicISFLog = "";
    let limitLog = "";

    if (dynISFenabled && tdd > 0) {

        dynamicISFLog = ", Dynamic ISF: On";

        // Respect autosens.max and autosens.min limitLogs
        if (newRatio > maxLimitChris) {
            log = ", Dynamic ISF limited by autosens_max setting: " + maxLimitChris + " (" +  round(newRatio,2) + "), ";
            limitLog = ", Autosens/Dynamic Limit: " + maxLimitChris + " (" +  round(newRatio,2) + ")";
            newRatio = maxLimitChris;
        } else if (newRatio < minLimitChris) {
            log = ", Dynamic ISF limited by autosens_min setting: " + minLimitChris + " (" +  round(newRatio,2) + "). ";
            limitLog = ", Autosens/Dynamic Limit: " + minLimitChris + " (" +  round(newRatio,2) + ")";
            newRatio = minLimitChris;
        }

        const isf = sensitivity / newRatio;

         // Set the new ratio
         autosens_data.ratio = newRatio;

        sigmoidLog = ". Using Sigmoid function, the autosens ratio has been adjusted with sigmoid factor to: " + round(autosens_data.ratio, 2) + ". New ISF = " + round(isf, 2) + " mg/dl (" + round(MGDL_TO_MMOL * isf, 2) + " (mmol/l).";

        if (!enable_sigmoid) {
            log += ", Dynamic autosens.ratio set to " + round(newRatio,2) + " with ISF: " + isf.toPrecision(3) + " mg/dl/U (" + (isf * MGDL_TO_MMOL).toPrecision(3) + " mmol/l/U)";
        } else { log += sigmoidLog }


        logOutPut += startLog + bgLog + afLog + formula + log + dynamicISFLog + weightLog;

    } else { logOutPut += startLog + "Dynamic Settings disabled"; }

    console.log(logOutPut);

    if (!dynISFenabled) {
        tddReason += "";
    } else if (dynISFenabled && profile.tddAdjBasal) {
        tddReason += dynamicISFLog + formula + limitLog + afLog + basal_ratio_log;
    }
    else if (dynISFenabled && !profile.tddAdjBasal) { tddReason += dynamicISFLog + formula + limitLog + afLog; }

    if (DEFAULT_SMB_DELIVERY_RATIO !== profile.smb_delivery_ratio) {
        tddReason += ", SMB Ratio: " + Math.min(profile.smb_delivery_ratio!, 1);
    }

    // Not confident but something like this in iAPS v3.0.3
    if ((middleWare as unknown) !== "" && (middleWare as unknown) !== "Nothing changed"){
        tddReason += ", Middleware: " + middleWare;
    }

    return { dynISFenabled, tdd, tddReason, newRatio, insulinFactor, adjustmentFactor, enable_sigmoid, tdd24h_14d_Ratio };
}
