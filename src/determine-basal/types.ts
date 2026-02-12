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
    sensitivityRatio: number;
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
