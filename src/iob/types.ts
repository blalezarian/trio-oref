import type {
    PumpHistoryEvent,
    PumpHistoryEventType,
    Treatment,
    IOBContribution,
    InsulinCurve,
    EpochMillis,
    ISODateString,
} from '../types/index';

// ---------------------------------------------------------------------------
// Basal profile entry
// ---------------------------------------------------------------------------

/** Single entry in the basal schedule used by IOB history processing */
export interface HistoryBasalProfileEntry {
    i: number;
    start: string;
    rate: number;
    minutes: number;
}

// ---------------------------------------------------------------------------
// Profile shapes used across IOB sub-modules
// ---------------------------------------------------------------------------

/**
 * Unified IOB profile — superset of fields needed by history.ts and index.ts.
 * Fields that only index.ts uses (useCustomPeakTime, insulinPeakTime) are optional.
 */
export interface IobProfile {
    dia: number;
    curve?: InsulinCurve;
    basalprofile: HistoryBasalProfileEntry[];
    current_basal: number;
    max_daily_basal?: number;
    min_bg?: number;
    max_bg?: number;
    exercise_mode?: boolean;
    temptargetSet?: boolean;
    half_basal_exercise_target?: number;
    suspend_zeros_iob?: boolean;
    useCustomPeakTime?: boolean;
    insulinPeakTime?: number;

    // --- Fields used by autosens, cob, and meal modules ---
    sens?: number;
    carb_ratio?: number;
    min_5m_carbimpact?: number;
    maxMealAbsorptionTime?: number;
    maxCOB?: number;
    autosens_min?: number;
    autosens_max?: number;
    rewind_resets_autosens?: boolean;
    isfProfile?: { sensitivities: Array<{ offset: number; sensitivity: number }> };
    target_bg?: number;
    high_temptarget_raises_sensitivity?: boolean;
}

/** Narrower profile used by iob/calculate.ts and iob/total.ts */
export interface IobCalcProfile {
    dia: number;
    curve?: InsulinCurve;
    useCustomPeakTime?: boolean;
    insulinPeakTime?: number;
}

// ---------------------------------------------------------------------------
// Input bundles
// ---------------------------------------------------------------------------

/** Unified inputs for IOB history and index processing */
export interface IobInputs {
    clock: ISODateString;
    history: PumpHistoryEvent[];
    history24?: PumpHistoryEvent[];
    profile: IobProfile;
    autosens?: { ratio: number };
}

// ---------------------------------------------------------------------------
// Treatment / event types used during IOB history processing
// ---------------------------------------------------------------------------

/** Treatment record produced by history processing, consumed by IOB calculations */
export interface IobTreatment {
    insulin?: number;
    date: EpochMillis;
    created_at?: Date;
    started_at?: Date;
    timestamp?: ISODateString;
    rate?: number;
    duration?: number;
}

/** Intermediate temp basal / bolus event used during history splitting */
export interface TempEvent {
    _type?: PumpHistoryEventType | (string & {});
    rate?: number;
    duration?: number;
    date: EpochMillis;
    timestamp?: ISODateString;
    started_at?: Date;
    created_at?: Date;
    insulin?: number;
}

/** Basal schedule break-point used to split temp events at profile boundaries */
export interface SplitterEvent {
    type: 'recurring';
    minutes: number;
}

/** Pump suspend event with computed duration */
export interface SuspendEvent {
    timestamp?: ISODateString;
    started_at?: Date;
    date: EpochMillis;
    duration?: number;
}

/** Aggregated suspend/resume data extracted from pump history */
export interface SuspendResumeData {
    pumpSuspends: SuspendEvent[];
    suspendedPrior: boolean;
    firstResumeTime: ISODateString;
    lastSuspendTime: ISODateString;
    currentlySuspended: number | false;
}

/** Pair of temp basal history and bolus arrays extracted from pump history */
export interface TempBasalsAndBoluses {
    tempHistory: TempEvent[];
    tempBoluses: TempEvent[];
}

// ---------------------------------------------------------------------------
// IOB index (generate) types
// ---------------------------------------------------------------------------

/** Single IOB entry at a point in time, produced by iob/index.ts generate() */
export interface IobIndexEntry {
    iob: number;
    activity: number;
    basaliob: number;
    bolusiob: number;
    netbasalinsulin: number;
    bolusinsulin: number;
    time: Date;
    iobWithZeroTemp?: IobIndexEntry;
    lastBolusTime?: EpochMillis;
    lastTemp?: {
        date: EpochMillis;
        rate?: number;
        duration?: number;
        started_at?: Date | string;
    };
}

/** Options passed to iob/total.ts from iob/index.ts generate() */
export interface IobGenerateOpts {
    treatments: IobTreatment[];
    profile: IobProfile;
    calculate: typeof import('./calculate-single-iob').iobCalc;
    autosens?: { ratio: number };
}

// ---------------------------------------------------------------------------
// IOB total types
// ---------------------------------------------------------------------------

/** Options for iob/total.ts iobTotal() */
export interface IobTotalOpts {
    treatments: Treatment[] | null;
    profile: IobCalcProfile;
    calculate: (
        treatment: Treatment,
        time: Date,
        curve: InsulinCurve,
        dia: number,
        peak: number,
        profile: IobCalcProfile,
    ) => IOBContribution | Record<string, never>;
}

/** Result of iob/total.ts iobTotal() */
export interface IobTotalResult {
    // Index signature needed for pass-through to normalize() in characterization tests
    [key: string]: unknown;
    iob: number;
    activity: number;
    basaliob: number;
    bolusiob: number;
    netbasalinsulin: number;
    bolusinsulin: number;
    time: Date;
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases
// ---------------------------------------------------------------------------

/** @deprecated Use IobProfile — kept for downstream consumers (autosens, cob) */
export type HistoryProfile = IobProfile;
/** @deprecated Use IobInputs — kept for downstream consumers */
export type HistoryInputs = IobInputs;
/** @deprecated Use IobTreatment — kept for downstream consumers */
export type HistoryTreatment = IobTreatment;
