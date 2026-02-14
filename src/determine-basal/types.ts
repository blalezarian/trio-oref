import type {
    GlucoseStatus,
    CurrentTemp,
    IOBData,
    Profile,
    MealData,
    TempBasalFunctions,
    DetermineBasalResult,
    TrioCustomVariables,
} from '../types/index';

export interface DynamicISFResult {
    dynISFenabled: boolean;
    tdd: number;
    tddReason: string;
    newRatio: number;
    insulinFactor: number;
    adjustmentFactor: number;
    enable_sigmoid: boolean;
    tdd24h_14d_Ratio: number;
}

export interface CGMValidationResult {
    bg: number;
    noise: number | undefined;
    tick: number | string;
    minDelta: number;
    minAvgDelta: number;
    maxDelta: number;
    minAgo: number;
    bgTime: Date;
    deliverAt: Date;
    profile_current_basal: number;
    basal: number;
    reason: string | undefined;
}

export interface SensitivityAndTargetsResult {
    max_iob: number;
    target_bg: number;
    min_bg: number;
    max_bg: number;
    high_bg: number;
    sensitivityRatio: number | undefined;
    basal: number;
    threshold: number;
    adjustedSens: number;
    isfreason: string;
    targetLog: number | string;
}

export interface CarbAbsorptionResult {
    carbImpact: number;
    carbImpactDuration: number;
    uamCarbImpact: number;
    carbSensFactor: number;
    remainingCATime: number;
    remainingCIpeak: number;
    slopeFromDeviations: number;
}

/** Predicted BG arrays for each scenario. Keys are part of the external API consumed by the Trio iOS app. */
export interface PredBGs {
    /** Predicted BG based on insulin-on-board decay */
    IOB: number[];
    /** Zero Temp: predicted BG if all insulin delivery were suspended */
    ZT: number[];
    /** Predicted BG accounting for carbs-on-board absorption */
    COB?: number[];
    /** Unannounced Meal: predicted BG accounting for detected but unannounced carb absorption */
    UAM?: number[];
}

export interface BGPredictionResult {
    eventualBG: number;
    minPredBG: number;
    minGuardBG: number;
    lastIOBpredBG: number;
    lastCOBpredBG: number;
    lastUAMpredBG: number;
    maxCOBPredBG: number;
    minIOBPredBG: number;
    IOBpredBGs: number[];
    COBpredBGs: number[];
    predBGs: PredBGs;
}

// --- clipAndTrimPredictions ---

export interface ClipAndTrimInputs {
    // Prediction arrays from the loop
    IOBpredBGs: number[];
    ZTpredBGs: number[];
    COBpredBGs: number[];
    UAMpredBGs: number[];

    // BG context
    eventualBG: number;
    target_bg: number;

    // Meal / carb context
    mealCOB: number;
    carbImpact: number;
    remainingCIpeak: number;
    enableUAM: boolean | undefined;

    // Logging arrays
    predCIs: number[];
    remainingCIs: number[];
}

export interface ClipAndTrimResult {
    predBGs: PredBGs;
    lastIOBpredBG: number;
    lastCOBpredBG: number | undefined;
    lastUAMpredBG: number | undefined;
    eventualBG: number;
}

// --- calculateMinAndGuardBGs ---

export interface MinGuardBGInputs {
    // Min predictions from loop
    minIOBPredBG: number;
    minCOBPredBG: number;
    minUAMPredBG: number;

    // Guard BGs from loop
    minCOBGuardBG: number;
    minUAMGuardBG: number;
    minIOBGuardBG: number;
    minZTGuardBG: number;

    // Last predicted values
    IOBpredBG: number;
    COBpredBG: number | undefined;
    UAMpredBG: number | undefined;

    // BG context
    bg: number;
    maxCOBPredBG: number;
    threshold: number;
    target_bg: number;

    // Meal / carb context
    mealCOB: number;
    carbs: number;
    carbImpactDuration: number;
    remainingCIpeak: number;
    enableUAM: boolean | undefined;

    // Logging
    uamCarbImpact: number;
    UAMduration: number;
}

export interface MinGuardBGResult {
    minPredBG: number;
    minGuardBG: number;
    avgPredBG: number;
    minIOBPredBG: number;
}

// --- DosingDecisionInputs ---

export interface DosingDecisionInputs {
    result: DetermineBasalResult;
    iob_data: IOBData;
    meal_data: MealData;
    profile: Profile;
    glucose_status: GlucoseStatus;
    currenttemp: CurrentTemp;
    tempBasalFunctions: TempBasalFunctions;
    systemTime: Date;
    trio_custom_variables: TrioCustomVariables;
    bg: number;
    eventualBG: number;
    naive_eventualBG: number;
    threshold: number;
    target_bg: number;
    min_bg: number;
    max_bg: number;
    max_iob: number;
    basal: number;
    adjustedSens: number;
    carbRatio: number;
    overrideFactor: number;
    expectedDelta: number;
    minDelta: number;
    maxDelta: number;
    tick: number | string;
    bgImpact: number;
    deviation: number;
    carbImpact: number;
    remainingCIpeak: number;
    carbSensFactor: number;
    minPredBG: number;
    minGuardBG: number;
    lastIOBpredBG: number;
    lastCOBpredBG: number;
    lastUAMpredBG: number;
    minIOBPredBG: number;
    IOBpredBGs: number[];
    COBpredBGs: number[];
    enableSMB: boolean;
    microBolusAllowed: boolean;
    isfreason: string;
    targetLog: number | string;
    tddReason: string;
}
