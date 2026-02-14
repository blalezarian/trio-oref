/**
 * Pipeline runner — wires all modules together in the same sequence
 * as Trio's Swift JavaScriptWorker.
 *
 * 1. profile.generate(pumpSettings) → profile
 * 2. glucose.getLastGlucose(glucoseData) → glucoseStatus
 * 3. iob.generate({ profile, history, clock }) → iobData[]
 * 4. meal.generate({ history, carbs, profile, clock, glucose, basalProfile }) → mealData
 * 5. determineBasal(glucoseStatus, currentTemp, iobData, profile, ...) → result
 */

import { generate as generateProfile } from '../../src/profile/index';
import { getLastGlucose } from '../../src/glucose/index';
import { generate as generateIob } from '../../src/iob/index';
import { generate as generateMeal } from '../../src/meal/index';
import { determineBasal } from '../../src/determineBasal/determineBasal';
import { tempBasalFunctions } from '../../src/setTempBasal/index';

import { resetISFCache } from '../../src/profile/isf';

import type { RawPipelineInputs } from './helpers/rawInputs';
import type {
    GlucoseStatus,
    DetermineBasalResult,
    MealData,
    TrioCustomVariables,
    Preferences,
} from '../../src/types/index';
import type { ProfileDefaults } from '../../src/profile/types';
import type { IobIndexEntry } from '../../src/iob/types';
import { FIXED_TIME } from './helpers/rawInputs';

// ---------------------------------------------------------------------------
// Pipeline result — exposes all intermediate + final results for assertion
// ---------------------------------------------------------------------------

export interface PipelineResult {
    /** Profile generated from pump settings */
    profile: ProfileDefaults;
    /** Glucose status computed from raw CGM data */
    glucoseStatus: GlucoseStatus;
    /** IOB array computed from pump history */
    iobData: IobIndexEntry[];
    /** Meal data computed from pump history + carbs */
    mealData: MealData;
    /** Final determine-basal dosing decision */
    determineBasalResult: DetermineBasalResult;
}

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

export function runFullPipeline(rawInputs: RawPipelineInputs): PipelineResult {
    const clock = rawInputs.clock ?? FIXED_TIME;

    // Reset ISF cache to avoid cross-test pollution from module-level state
    resetISFCache();

    // 1. Generate profile from pump settings
    const profileResult = generateProfile(rawInputs.profileInputs);
    if (profileResult === -1) {
        throw new Error('profile.generate() returned -1 (invalid settings)');
    }
    const profile = profileResult;

    // 2. Compute glucose status from raw CGM data
    const glucoseStatus = getLastGlucose(rawInputs.glucoseData);

    // 3. Compute IOB from pump history
    const iobProfile = {
        dia: profile.dia ?? 5,
        curve: profile.curve,
        basalprofile: profile.basalprofile ?? rawInputs.profileInputs.basals,
        current_basal: profile.current_basal ?? 0.9,
        max_daily_basal: profile.max_daily_basal,
        min_bg: profile.min_bg,
        max_bg: profile.max_bg,
        exercise_mode: profile.exercise_mode,
        temptargetSet: profile.temptargetSet,
        half_basal_exercise_target: profile.half_basal_exercise_target,
        suspend_zeros_iob: profile.suspend_zeros_iob,
        useCustomPeakTime: profile.useCustomPeakTime,
        insulinPeakTime: profile.insulinPeakTime,
        sens: profile.sens,
        carb_ratio: profile.carb_ratio,
        min_5m_carbimpact: profile.min_5m_carbimpact,
        maxMealAbsorptionTime: profile.maxMealAbsorptionTime,
        maxCOB: profile.maxCOB,
        autosens_min: profile.autosens_min,
        autosens_max: profile.autosens_max,
        rewind_resets_autosens: profile.rewind_resets_autosens,
        isfProfile: profile.isfProfile,
    };

    const iobData = generateIob({
        clock,
        history: rawInputs.pumpHistory,
        profile: iobProfile,
    });

    // 4. Compute meal data from pump history
    // Extract carb entries from pump history for the meal module
    const carbEntries = rawInputs.pumpHistory.filter(
        (e) => e._type === 'JournalEntryMealMarker'
            || e._type === 'BolusWizard'
            || e.carbs != null
            || e.carb_input != null,
    );

    const mealData = generateMeal({
        history: rawInputs.pumpHistory,
        carbs: carbEntries,
        profile: iobProfile,
        clock,
        glucose: rawInputs.glucoseData,
        basalProfile: rawInputs.profileInputs.basals,
    }) as MealData;

    // 5. Run determine-basal with all assembled inputs
    const autosensData = rawInputs.autosensData ?? { ratio: 1.0 };

    const preferences: Preferences = {
        useNewFormula: false,
        adjustmentFactor: 0.8,
        adjustmentFactorSigmoid: 0.5,
        sigmoid: false,
        curve: profile.curve,
        useCustomPeakTime: profile.useCustomPeakTime,
        ...rawInputs.preferences,
    };

    const trioCustomVariables: TrioCustomVariables = {
        useOverride: false,
        overrideTarget: 0,
        overridePercentage: 100,
        duration: 0,
        smbIsOff: false,
        smbIsScheduledOff: false,
        start: 0,
        end: 0,
        advancedSettings: false,
        isfAndCr: false,
        isf: false,
        cr: false,
        smbMinutes: 30,
        uamMinutes: 30,
        currentTDD: 40,
        weightedAverage: 40,
        average_total_data: 40,
        ...rawInputs.trioCustomVariables,
    };

    const determineBasalResult = determineBasal(
        glucoseStatus,
        rawInputs.currentTemp,
        iobData,
        profile,
        autosensData,
        mealData,
        tempBasalFunctions,
        rawInputs.microBolusAllowed ?? false,
        rawInputs.reservoirData ?? 100,
        clock,
        rawInputs.pumpHistory,
        preferences,
        rawInputs.profileInputs.basals,
        trioCustomVariables,
        undefined,
    );

    return {
        profile,
        glucoseStatus,
        iobData,
        mealData,
        determineBasalResult,
    };
}

// ---------------------------------------------------------------------------
// Output normalization (shared with characterization tests)
// ---------------------------------------------------------------------------

/**
 * Normalize pipeline output for stable snapshots.
 * - Replaces non-deterministic timestamps with placeholders
 * - Rounds floating-point values to avoid precision noise
 */
export function normalizeOutput(output: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...output };

    // Replace deliverAt with stable value
    if (normalized.deliverAt instanceof Date) {
        normalized.deliverAt = '[DELIVER_AT]';
    } else if (typeof normalized.deliverAt === 'string') {
        normalized.deliverAt = '[DELIVER_AT]';
    }

    // Round floating-point fields
    for (const key of Object.keys(normalized)) {
        const val = normalized[key];
        if (typeof val === 'number' && !Number.isInteger(val)) {
            normalized[key] = Math.round(val * 10000) / 10000;
        }
    }

    // Normalize predBGs arrays
    if (normalized.predBGs && typeof normalized.predBGs === 'object') {
        const predBGs = normalized.predBGs as Record<string, number[]>;
        for (const curve of Object.keys(predBGs)) {
            if (Array.isArray(predBGs[curve])) {
                predBGs[curve] = predBGs[curve].map((v: number) => Math.round(v));
            }
        }
        normalized.predBGs = predBGs;
    }

    return normalized;
}
