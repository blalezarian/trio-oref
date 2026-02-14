import type { InsulinCurve, MealAbsorptionPhase, BasalProfileEntry } from '../types/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// --- Basal profile entry ---

export interface AutotuneBasalProfileEntry extends BasalProfileEntry {
    untuned?: number;
}

// --- ISF profile ---

export interface AutotuneISFProfile {
    sensitivities: Array<{
        offset: number;
        sensitivity: number;
        endOffset: number;
    }>;
}

// --- Previous autotune profile (output of prior run) ---

export interface AutotunePreviousProfile {
    basalprofile: AutotuneBasalProfileEntry[];
    isfProfile: AutotuneISFProfile;
    sens?: number;
    carb_ratio: number;
    csf?: number;
    dia: number;
    curve?: Exclude<InsulinCurve, 'bilinear'>;
    useCustomPeakTime?: boolean;
    insulinPeakTime?: number;
    min_5m_carbimpact?: number;
    [key: string]: unknown;
}

// --- Pump profile ---

export interface AutotunePumpProfile {
    basalprofile: AutotuneBasalProfileEntry[];
    isfProfile?: AutotuneISFProfile;
    carb_ratio?: number;
    autosens_min?: number;
    autosens_max?: number;
    autotune_isf_adjustmentFraction?: number;
    [key: string]: unknown;
}

// --- Glucose datum from categorize ---

export interface AutotuneGlucoseDatum {
    glucose?: number;
    date?: number;
    displayTime?: string;
    dateString?: string;
    deviation: number;
    BGI: number;
    avgDelta: number;
    mealAbsorption?: MealAbsorptionPhase;
    mealCarbs?: number;
}

// --- Carb ratio datum ---

export interface AutotuneCRDatum {
    CRInitialIOB: number;
    CRInitialBG: number;
    CRInitialCarbTime: Date;
    CREndIOB: number;
    CREndBG: number;
    CREndTime: Date;
    CRCarbs: number;
    CRInsulin: number;
    CRInsulinTotal?: number;
}

// --- Deviation entries for DIA/peak tuning ---

export interface AutotuneDiaDeviation {
    dia: number;
    meanDeviation: number;
    SMRDeviation: number;
    RMSDeviation: number;
}

export interface AutotunePeakDeviation {
    peak: number;
    meanDeviation: number;
    SMRDeviation: number;
    RMSDeviation: number;
}

// --- Prepped glucose data (output of autotune-prep) ---

export interface AutotunePreppedGlucose {
    CRData: AutotuneCRDatum[];
    CSFGlucoseData: AutotuneGlucoseDatum[];
    ISFGlucoseData: AutotuneGlucoseDatum[];
    basalGlucoseData: AutotuneGlucoseDatum[];
    diaDeviations?: AutotuneDiaDeviation[];
    peakDeviations?: AutotunePeakDeviation[];
}

// --- Top-level inputs ---

export interface AutotuneInputs {
    previousAutotune: AutotunePreviousProfile;
    pumpProfile: AutotunePumpProfile;
    preppedGlucose: AutotunePreppedGlucose;
}

// --- Autosens bounds (computed once, shared across tuning steps) ---

export interface AutotuneBounds {
    autotuneMax: number;
    autotuneMin: number;
}
