/**
 * Raw input builders for integration tests.
 *
 * These construct realistic raw data as Trio's Swift app would provide it,
 * before any JS module processing. Each builder produces data that feeds
 * directly into the pipeline's first module call.
 */

import type {
    GlucoseEntry,
    PumpHistoryEvent,
    BasalEntry,
    CurrentTemp,
    AutosensData,
    TrioCustomVariables,
    Preferences,
    DetermineBasalResult,
} from '../../../src/types/index';
import type { ProfileInputs } from '../../../src/profile/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FIXED_TIME = '2025-01-15T12:00:00.000Z';
export const FIXED_DATE = new Date(FIXED_TIME).getTime();
const MS_PER_MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Glucose builders
// ---------------------------------------------------------------------------

export type BgTrajectory = 'flat' | 'rising' | 'falling' | 'spiking' | 'crashing';

interface GlucoseArraySpec {
    /** Starting BG value in mg/dL (most recent reading) */
    startBg: number;
    /** BG trajectory pattern */
    trajectory: BgTrajectory;
    /** Number of readings to generate (default: 12 = 1 hour at 5-min intervals) */
    count?: number;
    /** Magnitude of change per 5-min interval in mg/dL (default depends on trajectory) */
    rate?: number;
    /** Indices to omit from the array (simulates CGM gaps) */
    gaps?: number[];
    /** Noise level to set on entries (default: 1 = clean) */
    noise?: number;
    /** CGM device identifier (default: 'CGMBLEKit') */
    device?: string;
    /** Epoch ms of most recent reading (default: FIXED_DATE - 60_000) */
    latestDate?: number;
}

/**
 * Generate a time-series of GlucoseEntry[] with configurable trajectory.
 * Entry 0 is the most recent; entries go backwards in time at 5-min intervals.
 */
export function buildGlucoseArray(spec: GlucoseArraySpec): GlucoseEntry[] {
    const {
        startBg,
        trajectory,
        count = 12,
        noise = 1,
        device = 'CGMBLEKit',
        gaps = [],
        latestDate = FIXED_DATE - MS_PER_MINUTE,
    } = spec;

    const rate = spec.rate ?? defaultRateForTrajectory(trajectory);
    const entries: GlucoseEntry[] = [];

    for (let i = 0; i < count; i++) {
        if (gaps.includes(i)) continue;

        // BG value at this point in history (i readings ago)
        const bg = computeBgAtIndex(startBg, trajectory, rate, i);
        const date = latestDate - i * 5 * MS_PER_MINUTE;

        entries.push({
            glucose: Math.round(bg),
            date,
            dateString: new Date(date).toISOString(),
            device,
            noise,
            type: undefined,
        });
    }

    return entries;
}

function defaultRateForTrajectory(trajectory: BgTrajectory): number {
    switch (trajectory) {
        case 'flat': return 0;
        case 'rising': return 3;
        case 'falling': return -3;
        case 'spiking': return 8;
        case 'crashing': return -8;
    }
}

/**
 * Compute BG at a given index (readings ago).
 * Since index 0 is most recent, going back in time means subtracting
 * the per-interval rate for each step backwards.
 */
function computeBgAtIndex(
    startBg: number,
    trajectory: BgTrajectory,
    rate: number,
    index: number,
): number {
    // startBg is the current (most recent) reading.
    // Earlier readings had BG = startBg - (rate * index)
    // because rate is the 5-min change toward startBg.
    return startBg - rate * index;
}

// ---------------------------------------------------------------------------
// Pump history builders
// ---------------------------------------------------------------------------

interface TempBasalEvent {
    /** Minutes before FIXED_TIME this event occurred */
    minutesAgo: number;
    /** Temp basal rate in U/hr */
    rate: number;
    /** Duration in minutes */
    duration: number;
}

interface BolusEvent {
    /** Minutes before FIXED_TIME this bolus occurred */
    minutesAgo: number;
    /** Bolus amount in Units */
    amount: number;
}

interface CarbEvent {
    /** Minutes before FIXED_TIME this carb entry occurred */
    minutesAgo: number;
    /** Carbs in grams */
    carbs: number;
}

interface SuspendResumeEvent {
    /** Minutes before FIXED_TIME the suspend occurred */
    suspendMinutesAgo: number;
    /** Minutes before FIXED_TIME the resume occurred */
    resumeMinutesAgo: number;
}

interface NightscoutBolusEvent {
    /** Minutes before FIXED_TIME this bolus occurred */
    minutesAgo: number;
    /** Insulin amount in Units */
    insulin: number;
    /** Nightscout event type */
    eventType: 'Meal Bolus' | 'Correction Bolus' | 'Snack Bolus' | 'Bolus Wizard';
    /** Carbs in grams (optional, for meal boluses) */
    carbs?: number;
}

interface PumpHistorySpec {
    /** Temp basal events to include (Medtronic format) */
    tempBasals?: TempBasalEvent[];
    /** Bolus events to include (Medtronic format) */
    boluses?: BolusEvent[];
    /** Carb entries to include (Medtronic format) */
    carbEntries?: CarbEvent[];
    /** Pump suspend/resume pairs */
    suspendResumes?: SuspendResumeEvent[];
    /** Nightscout Care Portal bolus events */
    nightscoutBoluses?: NightscoutBolusEvent[];
}

/**
 * Generate PumpHistoryEvent[] from specified events.
 * Returns events in reverse-chronological order (most recent first).
 */
export function buildPumpHistory(spec: PumpHistorySpec): PumpHistoryEvent[] {
    const events: PumpHistoryEvent[] = [];

    for (const tb of spec.tempBasals ?? []) {
        const timestamp = new Date(FIXED_DATE - tb.minutesAgo * MS_PER_MINUTE).toISOString();
        // TempBasalDuration event
        events.push({
            _type: 'TempBasalDuration',
            'duration (min)': tb.duration,
            timestamp,
        });
        // TempBasal event
        events.push({
            _type: 'TempBasal',
            rate: tb.rate,
            temp: 'absolute',
            timestamp,
        });
    }

    for (const bolus of spec.boluses ?? []) {
        const timestamp = new Date(FIXED_DATE - bolus.minutesAgo * MS_PER_MINUTE).toISOString();
        events.push({
            _type: 'Bolus',
            amount: bolus.amount,
            programmed: bolus.amount,
            timestamp,
            duration: 0,
        });
    }

    for (const carb of spec.carbEntries ?? []) {
        const timestamp = new Date(FIXED_DATE - carb.minutesAgo * MS_PER_MINUTE).toISOString();
        events.push({
            _type: 'JournalEntryMealMarker',
            carb_input: carb.carbs,
            timestamp,
        });
    }

    for (const sr of spec.suspendResumes ?? []) {
        const suspendTime = new Date(FIXED_DATE - sr.suspendMinutesAgo * MS_PER_MINUTE).toISOString();
        const resumeTime = new Date(FIXED_DATE - sr.resumeMinutesAgo * MS_PER_MINUTE).toISOString();
        events.push({
            _type: 'PumpSuspend',
            timestamp: suspendTime,
        });
        events.push({
            _type: 'PumpResume',
            timestamp: resumeTime,
        });
    }

    for (const ns of spec.nightscoutBoluses ?? []) {
        const created_at = new Date(FIXED_DATE - ns.minutesAgo * MS_PER_MINUTE).toISOString();
        events.push({
            eventType: ns.eventType,
            created_at,
            insulin: ns.insulin,
            carbs: ns.carbs,
        });
    }

    // Sort reverse-chronological (most recent first)
    events.sort((a, b) => {
        const dateA = new Date(a.timestamp ?? '').getTime();
        const dateB = new Date(b.timestamp ?? '').getTime();
        return dateB - dateA;
    });

    return events;
}

// ---------------------------------------------------------------------------
// Pump settings / profile input builders
// ---------------------------------------------------------------------------

interface PumpSettingsOverrides {
    /** Insulin action curve / DIA in hours (default: 5) */
    dia?: number;
    /** Max basal rate in U/hr (default: 3.5) */
    maxBasal?: number;
    /** Basal schedule entries (default: flat 0.9 U/hr) */
    basals?: BasalEntry[];
    /** BG target entries (default: 110-120 mg/dL) */
    bgTargets?: Array<{
        offset: number;
        low: number;
        high: number;
        min_bg?: number;
        max_bg?: number;
    }>;
    /** ISF entries (default: 40 mg/dL/U) */
    isfSensitivities?: Array<{ offset: number; sensitivity: number }>;
    /** Carb ratio schedule (default: 10 g/U) */
    carbRatioSchedule?: Array<{ offset: number; ratio: number }>;
    /** Additional profile-level overrides passed through to generate() */
    profileOverrides?: Record<string, unknown>;
}

/**
 * Build a ProfileInputs object for profile.generate().
 * Matches the shape Trio's Swift app constructs before calling the JS profile module.
 */
export function buildProfileInputs(overrides?: PumpSettingsOverrides): ProfileInputs {
    const dia = overrides?.dia ?? 5;
    const maxBasal = overrides?.maxBasal ?? 3.5;
    const basals = overrides?.basals ?? [{ minutes: 0, rate: 0.9 }];
    const bgTargets = overrides?.bgTargets ?? [
        { offset: 0, low: 110, high: 120, min_bg: 110, max_bg: 120 },
    ];
    const isfSensitivities = overrides?.isfSensitivities ?? [
        { offset: 0, sensitivity: 40 },
    ];
    const carbRatioSchedule = overrides?.carbRatioSchedule ?? [
        { offset: 0, ratio: 10 },
    ];

    return {
        settings: {
            insulin_action_curve: dia,
            maxBasal,
        },
        basals,
        targets: {
            user_preferred_units: 'mg/dL',
            targets: bgTargets,
        },
        isf: {
            sensitivities: isfSensitivities,
        },
        carbratio: {
            units: 'grams',
            schedule: carbRatioSchedule,
        },
        temptargets: [],
        // Safety & algorithm settings (pass through to profile.generate)
        max_iob: 2.5,
        max_daily_safety_multiplier: 3,
        current_basal_safety_multiplier: 4,
        autosens_max: 1.2,
        autosens_min: 0.7,
        dia,
        curve: 'rapid-acting',
        useCustomPeakTime: false,
        insulinPeakTime: 75,
        maxCOB: 120,
        maxMealAbsorptionTime: 6,
        min_5m_carbimpact: 8,
        enableSMB_with_COB: false,
        enableSMB_always: false,
        enableSMB_with_temptarget: false,
        enableSMB_after_carbs: false,
        enableSMB_high_bg: false,
        enableSMB_high_bg_target: 110,
        allowSMB_with_high_temptarget: false,
        maxSMBBasalMinutes: 30,
        maxUAMSMBBasalMinutes: 30,
        SMBInterval: 3,
        bolus_increment: 0.1,
        enableUAM: false,
        A52_risk_enable: false,
        exercise_mode: false,
        high_temptarget_raises_sensitivity: false,
        low_temptarget_lowers_sensitivity: false,
        half_basal_exercise_target: 160,
        skip_neutral_temps: false,
        smb_delivery_ratio: 0.5,
        maxDelta_bg_threshold: 0.2,
        noisyCGMTargetMultiplier: 1.3,
        suspend_zeros_iob: true,
        rewind_resets_autosens: true,
        sensitivity_raises_target: false,
        resistance_lowers_target: false,
        remainingCarbsFraction: 1.0,
        remainingCarbsCap: 90,
        carbsReqThreshold: 1,
        unsuspend_if_no_temp: false,
        adjustmentFactor: 0.8,
        adjustmentFactorSigmoid: 0.5,
        useNewFormula: false,
        sigmoid: false,
        weightPercentage: 0.65,
        tddAdjBasal: false,
        threshold_setting: 60,
        ...overrides?.profileOverrides,
    };
}

// ---------------------------------------------------------------------------
// Full raw pipeline inputs bundle
// ---------------------------------------------------------------------------

export interface RawPipelineInputs {
    /** Raw glucose readings from CGM */
    glucoseData: GlucoseEntry[];
    /** Raw pump history events */
    pumpHistory: PumpHistoryEvent[];
    /** Profile inputs (pump settings) for profile.generate() */
    profileInputs: ProfileInputs;
    /** Current temp basal state */
    currentTemp: CurrentTemp;
    /** Autosens data (default: ratio 1.0 = neutral) */
    autosensData?: AutosensData;
    /** Whether microboluses are allowed */
    microBolusAllowed?: boolean;
    /** Reservoir level in Units */
    reservoirData?: number;
    /** Clock time for the pipeline (default: FIXED_TIME) */
    clock?: string;
    /** Trio custom variable overrides */
    trioCustomVariables?: Partial<TrioCustomVariables>;
    /** Preferences overrides */
    preferences?: Partial<Preferences>;
    /** Optional middleware reason string (the return value of the middleware plugin) */
    middleWare?: string;
}
