/**
 * Shared test factories for unit tests.
 *
 * Provides minimal-but-valid default objects for the most commonly
 * used types. Every factory accepts Partial<T> overrides so individual
 * tests only specify the fields they care about.
 *
 * Naming convention: `make<TypeName>` (e.g. makeProfile, makeIobData).
 */

import { vi } from 'vitest';

import type {
    GlucoseStatus,
    CurrentTemp,
    IOBData,
    IOBEntry,
    MealData,
    Profile,
    TrioCustomVariables,
    TempBasalFunctions,
    DetermineBasalResult,
    Treatment,
    BasalProfileEntry,
} from '../../../src/types/index';

import type {
    IobProfile,
    IobCalcProfile,
    IobInputs,
    IobTreatment,
    TempEvent,
    SuspendEvent,
    SplitterEvent,
} from '../../../src/iob/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FIXED_TIME = '2025-01-15T12:00:00.000Z';
export const FIXED_DATE = new Date(FIXED_TIME);
export const FIXED_MS = FIXED_DATE.getTime();
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_5_MIN = 300_000;

// ---------------------------------------------------------------------------
// Core types (used across many modules)
// ---------------------------------------------------------------------------

/** Glucose status with no trend */
export function makeGlucoseStatus(
    overrides: Partial<GlucoseStatus> = {},
): GlucoseStatus {
    return {
        glucose: 120,
        delta: 2,
        short_avgdelta: 1.5,
        long_avgdelta: 1.0,
        date: FIXED_MS - MS_PER_MINUTE,
        ...overrides,
    } as GlucoseStatus;
}

/** No temp basal running */
export function makeCurrentTemp(
    overrides: Partial<CurrentTemp> = {},
): CurrentTemp {
    return {
        duration: 0,
        rate: 0,
        ...overrides,
    };
}

/** Active IOB with typical bolus/basal split */
export function makeIobData(
    overrides: Partial<IOBData> = {},
): IOBData {
    return {
        iob: 2.0,
        activity: 0.05,
        basaliob: 0.5,
        bolusiob: 1.5,
        netbasalinsulin: 0.5,
        bolusinsulin: 3.0,
        time: FIXED_DATE,
        lastBolusTime: FIXED_MS - 10 * MS_PER_MINUTE,
        iobWithZeroTemp: {
            iob: 0,
            activity: 0.02,
        } as IOBEntry,
        ...overrides,
    } as IOBData;
}

/** No recent meal — zero COB, zero carbs */
export function makeMealData(
    overrides: Partial<MealData> = {},
): MealData {
    return {
        carbs: 0,
        nsCarbs: 0,
        bwCarbs: 0,
        journalCarbs: 0,
        mealCOB: 0,
        currentDeviation: 0,
        maxDeviation: 0,
        minDeviation: 0,
        slopeFromMaxDeviation: 0,
        slopeFromMinDeviation: 0,
        allDeviations: [],
        bwFound: false,
        ...overrides,
    };
}

/** No overrides active */
export function makeTrioCustomVariables(
    overrides: Partial<TrioCustomVariables> = {},
): TrioCustomVariables {
    return {
        useOverride: false,
        overridePercentage: 100,
        overrideTarget: 0,
        advancedSettings: false,
        isfAndCr: false,
        isf: false,
        cr: false,
        smbIsOff: false,
        smbIsScheduledOff: false,
        start: 0,
        end: 0,
        smbMinutes: 30,
        uamMinutes: 30,
        currentTDD: 0,
        average_total_data: 0,
        weightedAverage: 0,
        duration: 0,
        ...overrides,
    };
}

/** Mock temp basal functions with vi.fn() */
export function makeTempBasalFunctions(): TempBasalFunctions {
    return {
        setTempBasal: vi.fn(
            (
                _rate: number,
                _duration: number,
                _profile: Profile,
                result: DetermineBasalResult,
            ) => result,
        ),
        getMaxSafeBasal: vi.fn(() => 4),
    } as unknown as TempBasalFunctions;
}

/** Empty result accumulator */
export function makeDetermineBasalResult(
    overrides: Partial<DetermineBasalResult> = {},
): DetermineBasalResult {
    return {
        reason: '',
        ...overrides,
    } as DetermineBasalResult;
}

// ---------------------------------------------------------------------------
// Full determine-basal Profile
// ---------------------------------------------------------------------------

/** Moderate-settings Profile for determine-basal tests */
export function makeProfile(
    overrides: Partial<Profile> = {},
): Profile {
    return {
        current_basal: 1.0,
        out_units: 'mg/dL',
        max_basal: 4.0,
        maxSMBBasalMinutes: 30,
        maxUAMSMBBasalMinutes: 30,
        bolus_increment: 0.1,
        smb_delivery_ratio: 0.5,
        max_iob: 10,
        max_daily_safety_multiplier: 3,
        current_basal_safety_multiplier: 4,
        autosens_max: 1.2,
        autosens_min: 0.7,
        dia: 5,
        curve: 'rapid-acting',
        useCustomPeakTime: false,
        insulinPeakTime: 75,
        max_daily_basal: 2.0,
        min_bg: 80,
        max_bg: 120,
        sens: 50,
        carb_ratio: 10,
        ...overrides,
    } as Profile;
}

// ---------------------------------------------------------------------------
// IOB module types
// ---------------------------------------------------------------------------

/** Standard IOB profile with flat basal schedule */
export function makeIobProfile(
    overrides: Partial<IobProfile> = {},
): IobProfile {
    return {
        dia: 6,
        current_basal: 1.0,
        basalprofile: [
            { i: 0, start: '00:00:00', rate: 1.0, minutes: 0 },
        ] as BasalProfileEntry[],
        ...overrides,
    };
}

/** Narrow profile for iob/calculate and iob/total */
export function makeIobCalcProfile(
    overrides: Partial<IobCalcProfile> = {},
): IobCalcProfile {
    return {
        dia: 6,
        curve: 'rapid-acting',
        ...overrides,
    };
}

/** Standard IOB inputs bundle */
export function makeIobInputs(
    overrides: Partial<IobInputs> = {},
): IobInputs {
    return {
        clock: FIXED_TIME,
        history: [],
        profile: makeIobProfile(),
        ...overrides,
    };
}

/** Single basal schedule entry (flat rate) */
export function makeBasalProfileEntry(
    overrides: Partial<BasalProfileEntry> = {},
): BasalProfileEntry[] {
    return [
        {
            i: 0,
            start: '00:00:00',
            rate: 1.0,
            minutes: 0,
            ...overrides,
        } as BasalProfileEntry,
    ];
}

/** Treatment with date 1 hour ago by default */
export function makeTreatment(
    overrides: Partial<Treatment> = {},
): Treatment {
    return {
        date: FIXED_MS - MS_PER_HOUR,
        ...overrides,
    } as Treatment;
}

/** Temp basal event */
export function makeTempEvent(
    overrides: Partial<TempEvent> = {},
): TempEvent {
    return {
        date: FIXED_MS,
        timestamp: FIXED_TIME,
        rate: 2.0,
        duration: 5,
        ...overrides,
    };
}

/** Bolus/temp treatment for IOB processing */
export function makeIobTreatment(
    offsetMin: number,
    overrides: Partial<IobTreatment> = {},
): IobTreatment {
    const date = FIXED_MS + offsetMin * MS_PER_MINUTE;
    return {
        date,
        started_at: new Date(date),
        ...overrides,
    };
}

/** Pump suspend event */
export function makeSuspendEvent(
    offsetMin: number,
    durationMin: number,
): SuspendEvent {
    const date = FIXED_MS + offsetMin * MS_PER_MINUTE;
    return {
        date,
        duration: durationMin,
        started_at: new Date(date),
        timestamp: new Date(date).toISOString(),
    };
}

/** Basal schedule splitter */
export function makeSplitter(minutes: number): SplitterEvent {
    return { type: 'recurring', minutes };
}
