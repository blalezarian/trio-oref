/**
 * Fixture generator for determine-basal characterization tests.
 *
 * Each fixture defines a clinically meaningful scenario by overriding
 * specific fields from the defaults. The fixture name and category make
 * it easy to understand what each test covers when reviewing diffs.
 */

import type { DetermineBasalInputs } from '../../types/index.js';
import {
  defaultGlucoseStatus,
  defaultCurrentTemp,
  defaultIOBData,
  defaultMealData,
  defaultProfile,
  defaultAutosensData,
  defaultTrioCustomVariables,
  defaultPreferences,
  defaultBasalProfile,
} from './defaults.js';

interface FixtureSpec {
  name: string;
  category: string;
  input: DetermineBasalInputs;
}

/**
 * Generate a realistic 48-entry iobArray for full AMA/SMB prediction coverage.
 * Each entry represents 5 minutes into the future, with IOB decaying linearly.
 */
function makeIobArray(
  currentIOB: number,
  activity: number,
  dia: number = 5,
  baseTime?: number,
): Record<string, unknown>[] {
  const now = baseTime ?? Date.now();
  const arr: Record<string, unknown>[] = [];
  for (let i = 0; i < 48; i++) {
    const t = i * 5; // minutes from now
    const fraction = Math.max(0, 1 - t / (dia * 60));
    arr.push({
      iob: Math.round(currentIOB * fraction * 1000) / 1000,
      activity: Math.round(activity * fraction * 100000) / 100000,
      basaliob: 0,
      bolusiob: 0,
      netbasalinsulin: 0,
      bolusinsulin: 0,
      time: new Date(now + t * 60000),
      iobWithZeroTemp: {
        iob: Math.round(currentIOB * fraction * 0.8 * 1000) / 1000,
        activity: Math.round(activity * fraction * 0.8 * 100000) / 100000,
        basaliob: 0,
        bolusiob: 0,
        netbasalinsulin: 0,
        bolusinsulin: 0,
        time: new Date(now + t * 60000),
      },
    });
  }
  return arr;
}

/** Build a fixture from selective overrides on defaults */
function fixture(
  name: string,
  category: string,
  overrides: {
    glucose_status?: Parameters<typeof defaultGlucoseStatus>[0];
    currenttemp?: Parameters<typeof defaultCurrentTemp>[0];
    iob_data?: Parameters<typeof defaultIOBData>[0];
    meal_data?: Parameters<typeof defaultMealData>[0];
    profile?: Parameters<typeof defaultProfile>[0];
    autosens_data?: Parameters<typeof defaultAutosensData>[0];
    trio_custom_variables?: Parameters<typeof defaultTrioCustomVariables>[0];
    preferences?: Parameters<typeof defaultPreferences>[0];
    microBolusAllowed?: boolean;
    currentTime?: string;
    middleWare?: unknown;
    reservoir_data?: number;
    // When set, iob_data is passed as a raw array (for full iobArray coverage)
    rawIobData?: unknown;
  } = {},
): FixtureSpec {
  return {
    name,
    category,
    input: {
      glucose_status: defaultGlucoseStatus(overrides.glucose_status),
      currenttemp: defaultCurrentTemp(overrides.currenttemp),
      iob_data: overrides.rawIobData != null
        ? overrides.rawIobData as any
        : defaultIOBData(overrides.iob_data),
      meal_data: defaultMealData(overrides.meal_data),
      profile: defaultProfile(overrides.profile),
      autosens_data: defaultAutosensData(overrides.autosens_data),
      trio_custom_variables: defaultTrioCustomVariables(overrides.trio_custom_variables),
      preferences: defaultPreferences(overrides.preferences),
      microBolusAllowed: overrides.microBolusAllowed ?? false,
      currentTime: overrides.currentTime ?? new Date().toISOString(),
      basalprofile: defaultBasalProfile(),
      reservoir_data: overrides.reservoir_data ?? 100,
      pumphistory: [],
      middleWare: overrides.middleWare,
    },
  };
}

// Use a fixed time for deterministic fixtures
const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const FIXED_DATE = new Date(FIXED_TIME).getTime();

export function generateAllFixtures(): FixtureSpec[] {
  return [
    // =====================================================================
    // CATEGORY: Steady State (in-range, minimal activity)
    // =====================================================================
    fixture('In range, no IOB, no temp running', 'steady-state', {
      currentTime: FIXED_TIME,
      glucose_status: { date: FIXED_DATE - 60_000 },
    }),

    fixture('In range, no IOB, high temp running — should cancel', 'steady-state', {
      currentTime: FIXED_TIME,
      glucose_status: { date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 30, rate: 1.5 },
    }),

    fixture('In range, no IOB, zero temp running', 'steady-state', {
      currentTime: FIXED_TIME,
      glucose_status: { date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 30, rate: 0 },
    }),

    fixture('In range, small positive IOB', 'steady-state', {
      currentTime: FIXED_TIME,
      glucose_status: { date: FIXED_DATE - 60_000 },
      iob_data: { iob: 0.5, activity: 0.005 },
    }),

    fixture('In range, small negative IOB', 'steady-state', {
      currentTime: FIXED_TIME,
      glucose_status: { date: FIXED_DATE - 60_000 },
      iob_data: { iob: -0.3, activity: -0.003 },
    }),

    // =====================================================================
    // CATEGORY: Low BG scenarios (safety-critical — should reduce/suspend)
    // =====================================================================
    fixture('Low BG, falling, no IOB — should zero temp', 'low-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 75, delta: -5, short_avgdelta: -5, long_avgdelta: -5, date: FIXED_DATE - 60_000 },
    }),

    fixture('Low BG, falling, with IOB — should zero temp', 'low-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 75, delta: -1, short_avgdelta: -1, long_avgdelta: -1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 1, activity: 0.01 },
    }),

    fixture('Low BG, rising, no IOB — should set current basal', 'low-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 75, delta: 6, short_avgdelta: 6, long_avgdelta: 6, date: FIXED_DATE - 60_000 },
    }),

    fixture('Low BG, rising slower than BGI — should zero temp', 'low-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 75, delta: 1, short_avgdelta: 1, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: -0.5, activity: -0.01 },
    }),

    fixture('Very low BG (55) — should zero temp', 'low-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 55, delta: -3, short_avgdelta: -3, long_avgdelta: -3, date: FIXED_DATE - 60_000 },
    }),

    fixture('Low BG with zero temp already running (not extending)', 'low-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 75, delta: -5, short_avgdelta: -5, long_avgdelta: -5, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 57, rate: 0 },
    }),

    fixture('BG at threshold (80), falling', 'low-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 80, delta: -3, short_avgdelta: -3, long_avgdelta: -3, date: FIXED_DATE - 60_000 },
    }),

    // =====================================================================
    // CATEGORY: High BG scenarios (should increase insulin)
    // =====================================================================
    fixture('High BG (180), no IOB — should high temp', 'high-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
    }),

    fixture('High BG (180), with IOB already covering', 'high-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 2.0, activity: 0.02 },
    }),

    fixture('High BG (200), rising fast', 'high-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 10, short_avgdelta: 10, long_avgdelta: 8, date: FIXED_DATE - 60_000 },
    }),

    fixture('High BG (250), no IOB', 'high-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 250, delta: 5, short_avgdelta: 5, long_avgdelta: 5, date: FIXED_DATE - 60_000 },
    }),

    fixture('Very high BG (350), no IOB', 'high-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 350, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
    }),

    fixture('Slightly above range (130), no IOB', 'high-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
    }),

    fixture('High BG, already has high temp running', 'high-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 2.5 },
    }),

    // =====================================================================
    // CATEGORY: Rising BG (various rates)
    // =====================================================================
    fixture('Slow rise (+2/5m) from in-range', 'rising-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 2, short_avgdelta: 2, long_avgdelta: 1.5, date: FIXED_DATE - 60_000 },
    }),

    fixture('Moderate rise (+5/5m) from in-range', 'rising-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 125, delta: 5, short_avgdelta: 5, long_avgdelta: 4, date: FIXED_DATE - 60_000 },
    }),

    fixture('Fast rise (+10/5m) from in-range', 'rising-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: 10, short_avgdelta: 9, long_avgdelta: 7, date: FIXED_DATE - 60_000 },
    }),

    fixture('Rise with existing IOB', 'rising-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: 5, short_avgdelta: 5, long_avgdelta: 4, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 1.5, activity: 0.015 },
    }),

    // =====================================================================
    // CATEGORY: Falling BG (various rates)
    // =====================================================================
    fixture('Slow fall (-2/5m) from in-range', 'falling-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 110, delta: -2, short_avgdelta: -2, long_avgdelta: -1.5, date: FIXED_DATE - 60_000 },
    }),

    fixture('Moderate fall (-5/5m) from in-range', 'falling-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 105, delta: -5, short_avgdelta: -5, long_avgdelta: -4, date: FIXED_DATE - 60_000 },
    }),

    fixture('Fast fall (-10/5m) from high', 'falling-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: -10, short_avgdelta: -9, long_avgdelta: -7, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 2.0, activity: 0.03 },
    }),

    fixture('Fall with negative IOB', 'falling-bg', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 100, delta: -3, short_avgdelta: -3, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
      iob_data: { iob: -0.5, activity: -0.005 },
    }),

    // =====================================================================
    // CATEGORY: Post-meal (COB active)
    // =====================================================================
    fixture('Early meal absorption — high COB, rising BG', 'post-meal', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 140, delta: 8, short_avgdelta: 7, long_avgdelta: 5, date: FIXED_DATE - 60_000 },
      meal_data: {
        carbs: 50, nsCarbs: 50, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 40, currentDeviation: 15, maxDeviation: 15, minDeviation: 0,
        slopeFromMaxDeviation: 0, slopeFromMinDeviation: 0,
        allDeviations: [15, 12, 8, 4, 0], lastCarbTime: FIXED_DATE - 30 * 60_000,
        bwFound: false,
      },
    }),

    fixture('Peak meal absorption — high COB, BG still rising', 'post-meal', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 170, delta: 5, short_avgdelta: 6, long_avgdelta: 8, date: FIXED_DATE - 60_000 },
      meal_data: {
        carbs: 50, nsCarbs: 50, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 25, currentDeviation: 10, maxDeviation: 20, minDeviation: 0,
        slopeFromMaxDeviation: -0.5, slopeFromMinDeviation: 0,
        allDeviations: [10, 15, 20, 18, 12], lastCarbTime: FIXED_DATE - 60 * 60_000,
        bwFound: false,
      },
    }),

    fixture('Late meal absorption — low COB, BG coming down', 'post-meal', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 145, delta: -2, short_avgdelta: -1, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      meal_data: {
        carbs: 50, nsCarbs: 50, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 8, currentDeviation: 3, maxDeviation: 20, minDeviation: 0,
        slopeFromMaxDeviation: -1.0, slopeFromMinDeviation: 0,
        allDeviations: [3, 8, 15, 20, 18], lastCarbTime: FIXED_DATE - 120 * 60_000,
        bwFound: false,
      },
    }),

    fixture('Large meal (90g) early absorption', 'post-meal', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 160, delta: 12, short_avgdelta: 10, long_avgdelta: 6, date: FIXED_DATE - 60_000 },
      meal_data: {
        carbs: 90, nsCarbs: 90, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 75, currentDeviation: 20, maxDeviation: 20, minDeviation: 0,
        slopeFromMaxDeviation: 0, slopeFromMinDeviation: 0,
        allDeviations: [20, 15, 8, 2, 0], lastCarbTime: FIXED_DATE - 20 * 60_000,
        bwFound: false,
      },
    }),

    // =====================================================================
    // CATEGORY: SMB scenarios (microBolusAllowed = true)
    // =====================================================================
    fixture('SMB enabled always, high BG, no IOB', 'smb', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 2, short_avgdelta: 2, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      iob_data: {
        iob: 0, activity: 0,
        lastBolusTime: FIXED_DATE - 10 * 60_000,
      },
    }),

    fixture('SMB with COB enabled, meal active', 'smb', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 160, delta: 5, short_avgdelta: 5, long_avgdelta: 4, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_with_COB: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 50, nsCarbs: 50, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 30, currentDeviation: 10, maxDeviation: 15, minDeviation: 0,
        slopeFromMaxDeviation: -0.3, slopeFromMinDeviation: 0,
        allDeviations: [10, 12, 15, 12, 8], lastCarbTime: FIXED_DATE - 45 * 60_000,
        bwFound: false,
      },
      iob_data: {
        iob: 0.5, activity: 0.005,
        lastBolusTime: FIXED_DATE - 10 * 60_000,
      },
    }),

    fixture('SMB with high BG target enabled', 'smb', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 160, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_high_bg: true, enableSMB_high_bg_target: 110 },
      microBolusAllowed: true,
      iob_data: {
        iob: 0, activity: 0,
        lastBolusTime: FIXED_DATE - 10 * 60_000,
      },
    }),

    fixture('SMB at max IOB — should not SMB', 'smb', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 5, short_avgdelta: 5, long_avgdelta: 5, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true, max_iob: 2.5 },
      microBolusAllowed: true,
      iob_data: {
        iob: 2.5, activity: 0.025,
        lastBolusTime: FIXED_DATE - 10 * 60_000,
      },
    }),

    fixture('SMB disabled (microBolusAllowed=false), high BG', 'smb', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 5, short_avgdelta: 5, long_avgdelta: 5, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: false,
    }),

    fixture('SMB with temp target — low TT enables SMB', 'smb', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: 2, short_avgdelta: 2, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_with_temptarget: true, temptargetSet: true, min_bg: 80, max_bg: 80 },
      microBolusAllowed: true,
      iob_data: {
        iob: 0, activity: 0,
        lastBolusTime: FIXED_DATE - 10 * 60_000,
      },
    }),

    fixture('SMB blocked by high temp target', 'smb', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: 2, short_avgdelta: 2, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true,
        allowSMB_with_high_temptarget: false,
        temptargetSet: true,
        min_bg: 120, max_bg: 120,
      },
      microBolusAllowed: true,
    }),

    // =====================================================================
    // CATEGORY: UAM (Unannounced Meal)
    // =====================================================================
    fixture('UAM — rising BG with no carbs entered', 'uam', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 8, short_avgdelta: 7, long_avgdelta: 4, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true, enableSMB_always: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 15, maxDeviation: 15, minDeviation: 0,
        slopeFromMaxDeviation: 0, slopeFromMinDeviation: 0,
        allDeviations: [15, 12, 8, 4, 0], bwFound: false,
      },
      iob_data: {
        iob: 0, activity: 0,
        lastBolusTime: FIXED_DATE - 10 * 60_000,
      },
    }),

    fixture('UAM — BG rising fast, already has IOB', 'uam', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 170, delta: 12, short_avgdelta: 10, long_avgdelta: 6, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true, enableSMB_always: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 20, maxDeviation: 20, minDeviation: 0,
        slopeFromMaxDeviation: 0, slopeFromMinDeviation: 0,
        allDeviations: [20, 15, 8, 0, 0], bwFound: false,
      },
      iob_data: {
        iob: 1.5, activity: 0.015,
        lastBolusTime: FIXED_DATE - 5 * 60_000,
      },
    }),

    // =====================================================================
    // CATEGORY: Zero temp / suspend
    // =====================================================================
    fixture('BG predicted to go low — should zero temp', 'zero-temp', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 100, delta: -3, short_avgdelta: -3, long_avgdelta: -3, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 2.0, activity: 0.025 },
    }),

    fixture('Eventual BG well below target with high IOB', 'zero-temp', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 110, delta: -1, short_avgdelta: -1, long_avgdelta: -1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 3.0, activity: 0.03 },
    }),

    // =====================================================================
    // CATEGORY: CGM error / edge cases
    // =====================================================================
    fixture('CGM calibrating (BG=5)', 'cgm-error', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 5, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000, noise: 1 },
    }),

    fixture('CGM error state (BG=38)', 'cgm-error', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 38, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000, noise: 1 },
    }),

    fixture('High CGM noise (noise=3)', 'cgm-error', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000, noise: 3 },
      currenttemp: { duration: 25, rate: 2.0 },
    }),

    fixture('Stale CGM data (15 min old)', 'cgm-error', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 15 * 60_000, noise: 1 },
    }),

    fixture('CGM data unchanged (flat deltas)', 'cgm-error', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000, noise: 1 },
    }),

    // =====================================================================
    // CATEGORY: Autosens adjustments
    // =====================================================================
    fixture('High sensitivity (ratio=0.8) — less insulin needed', 'autosens', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      autosens_data: { ratio: 0.8 },
    }),

    fixture('Insulin resistance (ratio=1.2) — more insulin needed', 'autosens', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      autosens_data: { ratio: 1.2 },
    }),

    // =====================================================================
    // CATEGORY: Temp targets
    // =====================================================================
    fixture('Low temp target (80) — exercise mode', 'temp-target', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: {
        temptargetSet: true, min_bg: 80, max_bg: 80,
        exercise_mode: true, half_basal_exercise_target: 160,
      },
    }),

    fixture('High temp target (150) — exercise raises sensitivity', 'temp-target', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: {
        temptargetSet: true, min_bg: 150, max_bg: 150,
        high_temptarget_raises_sensitivity: true, half_basal_exercise_target: 160,
      },
    }),

    // =====================================================================
    // CATEGORY: Dynamic ISF (Trio-specific)
    // =====================================================================
    fixture('Dynamic ISF logarithmic — high BG', 'dynamic-isf', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      preferences: { useNewFormula: true, adjustmentFactor: 0.8, sigmoid: false },
      profile: { useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2 },
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 40 },
    }),

    fixture('Dynamic ISF logarithmic — in-range BG', 'dynamic-isf', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 110, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      preferences: { useNewFormula: true, adjustmentFactor: 0.8, sigmoid: false },
      profile: { useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2 },
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 40 },
    }),

    fixture('Dynamic ISF sigmoid — high BG', 'dynamic-isf', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      preferences: { useNewFormula: true, adjustmentFactorSigmoid: 0.5, sigmoid: true },
      profile: { useNewFormula: true, sigmoid: true, autosens_min: 0.7, autosens_max: 1.2 },
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 40 },
    }),

    fixture('Dynamic ISF disabled by equal autosens min/max', 'dynamic-isf', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      preferences: { useNewFormula: true },
      profile: { useNewFormula: true, autosens_min: 1.0, autosens_max: 1.0 },
    }),

    // =====================================================================
    // CATEGORY: Trio overrides
    // =====================================================================
    fixture('Override active — 120% (more aggressive)', 'trio-override', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      trio_custom_variables: {
        useOverride: true, overridePercentage: 120, isfAndCr: true,
        overrideTarget: 0, duration: 0,
      },
    }),

    fixture('Override active — 80% (less aggressive)', 'trio-override', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      trio_custom_variables: {
        useOverride: true, overridePercentage: 80, isfAndCr: true,
        overrideTarget: 0, duration: 0,
      },
    }),

    fixture('Override with custom target (100)', 'trio-override', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      trio_custom_variables: {
        useOverride: true, overridePercentage: 100,
        overrideTarget: 100, duration: 60, isfAndCr: false,
      },
    }),

    fixture('SMBs disabled by override', 'trio-override', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 5, short_avgdelta: 5, long_avgdelta: 5, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      trio_custom_variables: { smbIsOff: true },
      iob_data: {
        iob: 0, activity: 0,
        lastBolusTime: FIXED_DATE - 10 * 60_000,
      },
    }),

    // =====================================================================
    // CATEGORY: TDD-adjusted basal
    // =====================================================================
    fixture('TDD-adjusted basal — higher recent TDD', 'tdd-basal', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { tddAdjBasal: true, useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2 },
      preferences: { useNewFormula: true },
      trio_custom_variables: { currentTDD: 50, weightedAverage: 50, average_total_data: 40 },
    }),

    fixture('TDD-adjusted basal — lower recent TDD', 'tdd-basal', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { tddAdjBasal: true, useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2 },
      preferences: { useNewFormula: true },
      trio_custom_variables: { currentTDD: 30, weightedAverage: 30, average_total_data: 40 },
    }),

    // =====================================================================
    // CATEGORY: Full iobArray prediction paths (AMA/SMB coverage)
    // =====================================================================
    fixture('Full iobArray — high BG with SMB always, prediction loop', 'iob-array-predictions', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 2, short_avgdelta: 2, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true, enableUAM: true },
      microBolusAllowed: true,
      rawIobData: makeIobArray(1.0, 0.01, 5, FIXED_DATE),
    }),

    fixture('Full iobArray — low BG, high IOB, should zero temp', 'iob-array-predictions', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 85, delta: -3, short_avgdelta: -3, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
      rawIobData: makeIobArray(2.5, 0.025, 5, FIXED_DATE),
    }),

    fixture('Full iobArray — with COB, UAM enabled, meal rising', 'iob-array-predictions', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 155, delta: 6, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true, enableSMB_always: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 60, nsCarbs: 60, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 45, currentDeviation: 12, maxDeviation: 15, minDeviation: 0,
        slopeFromMaxDeviation: -0.2, slopeFromMinDeviation: 0,
        allDeviations: [12, 14, 15, 13, 8], lastCarbTime: FIXED_DATE - 30 * 60_000,
        bwFound: false,
      },
      rawIobData: makeIobArray(0.8, 0.008, 5, FIXED_DATE),
    }),

    fixture('Full iobArray — in range, no deviation, full prediction curves', 'iob-array-predictions', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 115, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    fixture('Full iobArray — dynamic ISF logarithmic predictions', 'iob-array-predictions', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 190, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      preferences: { useNewFormula: true, adjustmentFactor: 0.8, sigmoid: false },
      profile: { useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2, enableSMB_always: true, enableUAM: true },
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 40 },
      microBolusAllowed: true,
      rawIobData: makeIobArray(1.2, 0.012, 5, FIXED_DATE),
    }),

    fixture('Full iobArray — UAM with negative deviation slope', 'iob-array-predictions', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 160, delta: 5, short_avgdelta: 4, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true, enableSMB_always: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 10, maxDeviation: 20, minDeviation: -2,
        slopeFromMaxDeviation: -1.0, slopeFromMinDeviation: 0.5,
        allDeviations: [10, 15, 20, 18, 12], bwFound: false,
      },
      rawIobData: makeIobArray(0.6, 0.006, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB full calculation path (with iobArray for complete SMB logic)
    // =====================================================================
    fixture('SMB full path — UAM minutes override, high IOB > mealInsulinReq', 'smb-full-path', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 5, short_avgdelta: 4, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true, enableUAM: true,
        maxSMBBasalMinutes: 60, maxUAMSMBBasalMinutes: 45,
      },
      microBolusAllowed: true,
      rawIobData: makeIobArray(2.0, 0.02, 5, FIXED_DATE),
    }),

    fixture('SMB full path — with COB, IOB less than mealInsulinReq', 'smb-full-path', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 170, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_with_COB: true, enableUAM: true,
        maxSMBBasalMinutes: 30, maxUAMSMBBasalMinutes: 30,
      },
      microBolusAllowed: true,
      meal_data: {
        carbs: 80, nsCarbs: 80, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 60, currentDeviation: 8, maxDeviation: 12, minDeviation: 0,
        slopeFromMaxDeviation: -0.3, slopeFromMinDeviation: 0,
        allDeviations: [8, 10, 12, 10, 6], lastCarbTime: FIXED_DATE - 40 * 60_000,
        bwFound: false,
      },
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),

    fixture('SMB full path — custom delivery ratio (0.3)', 'smb-full-path', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 190, delta: 2, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true, smb_delivery_ratio: 0.3,
        maxSMBBasalMinutes: 30,
      },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    fixture('SMB full path — recent bolus, should wait for SMBInterval', 'smb-full-path', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 2, short_avgdelta: 2, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true, SMBInterval: 5 },
      microBolusAllowed: true,
      rawIobData: (() => {
        const arr = makeIobArray(0.8, 0.008, 5, FIXED_DATE);
        // Set lastBolusTime to 2 min ago (less than SMBInterval of 5)
        (arr[0] as any).lastBolusTime = FIXED_DATE - 2 * 60_000;
        (arr[0] as any).lastTemp = { rate: 0, duration: 0, date: 0 };
        return arr;
      })(),
    }),

    fixture('SMB full path — maxBolus limited by insulinReq', 'smb-full-path', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 250, delta: 8, short_avgdelta: 7, long_avgdelta: 5, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true, enableUAM: true,
        maxSMBBasalMinutes: 120, maxUAMSMBBasalMinutes: 120,
        max_iob: 10,
      },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.2, 0.002, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: CGM error extended paths
    // =====================================================================
    fixture('Noise=3 with high temp running — should replace with neutral', 'cgm-error-extended', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 5, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000, noise: 3 },
      currenttemp: { duration: 25, rate: 2.5 },
    }),

    fixture('Noise=3 with long zero temp — should shorten to 30m', 'cgm-error-extended', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000, noise: 3 },
      currenttemp: { duration: 60, rate: 0 },
    }),

    fixture('Noise=3 with low temp — should do nothing', 'cgm-error-extended', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000, noise: 3 },
      currenttemp: { duration: 25, rate: 0.5 },
    }),

    fixture('BG=38 (xDrip error) with high temp — replace neutral', 'cgm-error-extended', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 38, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000, noise: 1 },
      currenttemp: { duration: 30, rate: 2.0 },
    }),

    fixture('Stale CGM data with high temp running', 'cgm-error-extended', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 15 * 60_000, noise: 1 },
      currenttemp: { duration: 25, rate: 2.0 },
    }),

    fixture('Future CGM data (date 10min ahead)', 'cgm-error-extended', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE + 10 * 60_000, noise: 1 },
    }),

    fixture('CGM just calibrated (last_cal=2)', 'cgm-error-extended', {
      currentTime: FIXED_TIME,
      glucose_status: {
        glucose: 120, delta: 0, short_avgdelta: 0, long_avgdelta: 0,
        date: FIXED_DATE - 60_000, noise: 1, last_cal: 2,
      },
    }),

    // =====================================================================
    // CATEGORY: Sensitivity/Resistance target adjustment
    // =====================================================================
    fixture('Sensitivity raises target (ratio=0.8, sensitivity_raises_target on)', 'sens-target-adjust', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { sensitivity_raises_target: true },
      autosens_data: { ratio: 0.8 },
    }),

    fixture('Resistance lowers target (ratio=1.2, resistance_lowers_target on)', 'sens-target-adjust', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { resistance_lowers_target: true },
      autosens_data: { ratio: 1.2 },
    }),

    // =====================================================================
    // CATEGORY: Override individual ISF/CR paths
    // =====================================================================
    fixture('Override ISF only (not CR)', 'override-isf-cr', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 160, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      trio_custom_variables: {
        useOverride: true, overridePercentage: 120, isfAndCr: false,
        isf: true, cr: false, duration: 30,
      },
    }),

    fixture('Override CR only (not ISF)', 'override-isf-cr', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 160, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      trio_custom_variables: {
        useOverride: true, overridePercentage: 80, isfAndCr: false,
        isf: false, cr: true, duration: 30,
      },
    }),

    fixture('Override both ISF and CR separately', 'override-isf-cr', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 160, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      trio_custom_variables: {
        useOverride: true, overridePercentage: 110, isfAndCr: false,
        isf: true, cr: true, duration: 0,
      },
    }),

    // =====================================================================
    // CATEGORY: Insulin curve variants
    // =====================================================================
    fixture('Ultra-rapid insulin curve', 'insulin-curve', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 170, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      preferences: { curve: 'ultra-rapid' },
      profile: { curve: 'ultra-rapid' },
    }),

    fixture('Custom peak time enabled', 'insulin-curve', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 170, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      preferences: { useCustomPeakTime: true },
      profile: { useCustomPeakTime: true, insulinPeakTime: 55 },
    }),

    // =====================================================================
    // CATEGORY: mmol/L output units
    // =====================================================================
    fixture('Output in mmol/L units', 'mmol-units', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 170, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { out_units: 'mmol/L' },
    }),

    // =====================================================================
    // CATEGORY: Temp target with low TT lowers sensitivity
    // =====================================================================
    fixture('Low TT lowers sensitivity — active temp target below 100', 'low-tt-sensitivity', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: {
        temptargetSet: true, min_bg: 80, max_bg: 80,
        low_temptarget_lowers_sensitivity: true,
        half_basal_exercise_target: 160,
      },
    }),

    fixture('Low TT with dynamic ISF — ratio should increase', 'low-tt-sensitivity', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 140, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: {
        temptargetSet: true, min_bg: 80, max_bg: 80,
        low_temptarget_lowers_sensitivity: true,
        half_basal_exercise_target: 160,
        useNewFormula: true, autosens_min: 0.7, autosens_max: 1.4,
      },
      preferences: { useNewFormula: true, adjustmentFactor: 0.8, sigmoid: false },
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 40 },
    }),

    // =====================================================================
    // CATEGORY: Dynamic ISF — high exercise temp target disables dISF
    // =====================================================================
    fixture('Dynamic ISF disabled by high TT with exercise', 'dynamic-isf-exercise', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: {
        temptargetSet: true, min_bg: 120, max_bg: 120,
        exercise_mode: true, half_basal_exercise_target: 160,
        useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2,
      },
      preferences: { useNewFormula: true, adjustmentFactor: 0.8, sigmoid: false },
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 40 },
    }),

    // =====================================================================
    // CATEGORY: Dynamic ISF limits (autosens_max/min capping)
    // =====================================================================
    fixture('Dynamic ISF logarithmic — capped by autosens_max', 'dynamic-isf-limits', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 300, delta: 5, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      preferences: { useNewFormula: true, adjustmentFactor: 1.5, sigmoid: false },
      profile: { useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2 },
      trio_custom_variables: { currentTDD: 60, weightedAverage: 60, average_total_data: 40 },
    }),

    fixture('Dynamic ISF sigmoid — capped by autosens_min', 'dynamic-isf-limits', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 80, delta: -2, short_avgdelta: -2, long_avgdelta: -1, date: FIXED_DATE - 60_000 },
      preferences: { useNewFormula: true, adjustmentFactorSigmoid: 0.5, sigmoid: true },
      profile: { useNewFormula: true, sigmoid: true, autosens_min: 0.7, autosens_max: 1.2 },
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 40 },
    }),

    fixture('Dynamic ISF — maxLimitChris equals 1 (edge case)', 'dynamic-isf-limits', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      preferences: { useNewFormula: true, adjustmentFactorSigmoid: 0.5, sigmoid: true },
      profile: { useNewFormula: true, sigmoid: true, autosens_min: 0.7, autosens_max: 1.0 },
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 40 },
    }),

    // =====================================================================
    // CATEGORY: Weighted TDD / zero TDD
    // =====================================================================
    fixture('Weighted TDD average used when weightPercentage < 1', 'tdd-weighted', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { weightPercentage: 0.5 },
      trio_custom_variables: { currentTDD: 30, weightedAverage: 45, average_total_data: 40 },
    }),

    fixture('TDD = 0 — dynamic ISF disabled', 'tdd-weighted', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      preferences: { useNewFormula: true, adjustmentFactor: 0.8, sigmoid: false },
      profile: { useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2 },
      trio_custom_variables: { currentTDD: 0, weightedAverage: 0, average_total_data: 40 },
    }),

    fixture('average_total_data = 0 — no TDD ratio', 'tdd-weighted', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      preferences: { useNewFormula: true, adjustmentFactor: 0.8, sigmoid: false },
      profile: { useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2 },
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 0 },
    }),

    // =====================================================================
    // CATEGORY: SMB delivery ratio / SMB_delivery_ratio != 0.5
    // =====================================================================
    fixture('Non-default SMB delivery ratio (0.7)', 'smb-delivery-ratio', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true, smb_delivery_ratio: 0.7 },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: Middleware
    // =====================================================================
    fixture('Middleware active with change text', 'middleware', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      middleWare: 'Custom middleware adjustment applied',
    }),

    fixture('Middleware set to empty string', 'middleware', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      middleWare: '',
    }),

    fixture('Middleware set to Nothing changed', 'middleware', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      middleWare: 'Nothing changed',
    }),

    // =====================================================================
    // CATEGORY: eventualBG below min_bg with various conditions
    // =====================================================================
    fixture('EventualBG below min_bg, delta > expectedDelta, naive_eventualBG < 40', 'eventual-bg-low', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 70, delta: 5, short_avgdelta: 4, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 3.0, activity: 0.03 },
    }),

    fixture('EventualBG below min_bg, minDelta barely falling, newinsulinReq calculation', 'eventual-bg-low', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 95, delta: -1, short_avgdelta: -1, long_avgdelta: -0.5, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 1.5, activity: 0.015 },
    }),

    fixture('EventualBG below min_bg, delta > expectedDelta, temp ~= basal', 'eventual-bg-low', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 85, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 2.0, activity: 0.02 },
      currenttemp: { duration: 25, rate: 0.9 },
    }),

    fixture('EventualBG below min_bg, rate <= 0, long zero temp needed', 'eventual-bg-low', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 90, delta: -4, short_avgdelta: -4, long_avgdelta: -3, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 2.5, activity: 0.025 },
    }),

    // =====================================================================
    // CATEGORY: minDelta < expectedDelta paths (BG falling faster than expected)
    // =====================================================================
    fixture('Eventual BG above min_bg, minDelta < expectedDelta, temp exists', 'mindelta-paths', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: -3, short_avgdelta: -4, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 0.9 },
    }),

    fixture('Eventual BG above min_bg, minDelta < expectedDelta, no temp', 'mindelta-paths', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: -3, short_avgdelta: -4, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
    }),

    fixture('Eventual BG above min_bg, Delta < minDelta', 'mindelta-paths', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: -5, short_avgdelta: -3, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
    }),

    fixture('minDelta < expectedDelta with SMB enabled (do not cancel zero temp)', 'mindelta-paths', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 140, delta: -3, short_avgdelta: -4, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: eventualBG/minPredBG in range with SMB enabled
    // =====================================================================
    fixture('In range with SMB enabled — do not cancel zero temp', 'in-range-smb', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 115, delta: 1, short_avgdelta: 1, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),

    fixture('In range, minPredBG < min_bg but eventualBG > min_bg', 'in-range-smb', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 115, delta: -1, short_avgdelta: -1, long_avgdelta: -1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 1.0, activity: 0.01 },
    }),

    // =====================================================================
    // CATEGORY: IOB > max_iob (should just set current basal)
    // =====================================================================
    fixture('IOB > max_iob, eventualBG high, should set basal as temp', 'iob-over-max', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 5, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: { max_iob: 2.0 },
      iob_data: { iob: 2.5, activity: 0.025 },
    }),

    fixture('IOB > max_iob with existing temp ~= basal', 'iob-over-max', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 5, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: { max_iob: 2.0 },
      iob_data: { iob: 2.5, activity: 0.025 },
      currenttemp: { duration: 25, rate: 0.9 },
    }),

    // =====================================================================
    // CATEGORY: Max safe basal clamping
    // =====================================================================
    fixture('Rate exceeds max safe basal — should clamp', 'max-safe-basal', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 300, delta: 10, short_avgdelta: 10, long_avgdelta: 8, date: FIXED_DATE - 60_000 },
      profile: { max_basal: 2.0, max_daily_basal: 1.0 },
    }),

    // =====================================================================
    // CATEGORY: High temp already running — various comparison paths
    // =====================================================================
    fixture('Required temp > existing temp — should increase', 'temp-comparison', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 15, rate: 1.5 },
    }),

    fixture('Existing temp delivers > 2x insulinReq — should lower', 'temp-comparison', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 135, delta: 1, short_avgdelta: 1, long_avgdelta: 0.5, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 3.0 },
    }),

    fixture('Existing temp ~>= required rate — keep running', 'temp-comparison', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 160, delta: 2, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 20, rate: 2.5 },
    }),

    fixture('No temp running, eventualBG above target — should set high temp', 'temp-comparison', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 170, delta: 2, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
    }),

    // =====================================================================
    // CATEGORY: Noisy CGM target raising
    // =====================================================================
    fixture('CGM noise=2 — target raised for noisy data', 'noisy-cgm', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000, noise: 2 },
    }),

    // =====================================================================
    // CATEGORY: SMB after_carbs path
    // =====================================================================
    fixture('SMB enabled after carbs — carbs entered, no COB remaining', 'smb-after-carbs', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 160, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_after_carbs: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 40, nsCarbs: 40, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 5, maxDeviation: 10, minDeviation: 0,
        slopeFromMaxDeviation: -0.5, slopeFromMinDeviation: 0,
        allDeviations: [5, 8, 10, 8, 4], lastCarbTime: FIXED_DATE - 90 * 60_000,
        bwFound: false,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: Bolus Wizard warnings
    // =====================================================================
    fixture('SMB with bwFound — A52_risk_enable off, should disable SMB', 'bolus-wizard', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true, A52_risk_enable: false },
      microBolusAllowed: true,
      meal_data: {
        carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 5, maxDeviation: 10, minDeviation: 0,
        slopeFromMaxDeviation: 0, slopeFromMinDeviation: 0,
        allDeviations: [5, 3, 1, 0, 0],
        bwFound: true,
      },
    }),

    fixture('SMB always with bwFound — A52_risk_enable on, should warn but allow', 'bolus-wizard', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true, A52_risk_enable: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 5, maxDeviation: 10, minDeviation: 0,
        slopeFromMaxDeviation: 0, slopeFromMinDeviation: 0,
        allDeviations: [5, 3, 1, 0, 0],
        bwFound: true,
      },
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB override advanced settings (smbMinutes/uamMinutes)
    // =====================================================================
    fixture('Override advanced SMB minutes', 'smb-override-minutes', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 5, short_avgdelta: 4, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true, enableUAM: true,
        maxSMBBasalMinutes: 30, maxUAMSMBBasalMinutes: 30,
      },
      microBolusAllowed: true,
      trio_custom_variables: {
        useOverride: true, overridePercentage: 100,
        advancedSettings: true, smbMinutes: 60, uamMinutes: 45,
        isfAndCr: false, duration: 0,
      },
      rawIobData: makeIobArray(1.5, 0.015, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: minGuardBG < threshold disables SMB
    // =====================================================================
    fixture('minGuardBG below threshold — SMB disabled', 'smb-guard', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 110, delta: -2, short_avgdelta: -2, long_avgdelta: -1, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      rawIobData: makeIobArray(2.0, 0.02, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: maxDelta disables SMB
    // =====================================================================
    fixture('maxDelta > threshold % of BG — SMB disabled', 'smb-maxdelta', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 30, short_avgdelta: 25, long_avgdelta: 20, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true, maxDelta_bg_threshold: 0.2 },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: skip_neutral_temps
    // =====================================================================
    fixture('Skip neutral temps near hour (at :55)', 'skip-neutral-temps', {
      // Set time to XX:55 to trigger skip_neutral_temps
      currentTime: '2025-01-15T12:55:00.000Z',
      glucose_status: { glucose: 130, delta: 1, short_avgdelta: 1, long_avgdelta: 1, date: new Date('2025-01-15T12:54:00.000Z').getTime() },
      profile: { skip_neutral_temps: true },
    }),

    fixture('Skip neutral temps near hour but SMB enabled — not skipping', 'skip-neutral-temps', {
      currentTime: '2025-01-15T12:55:00.000Z',
      glucose_status: { glucose: 170, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: new Date('2025-01-15T12:54:00.000Z').getTime() },
      profile: { skip_neutral_temps: true, enableSMB_always: true },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.5, 0.005, 5, new Date('2025-01-15T12:55:00.000Z').getTime()),
    }),

    // =====================================================================
    // CATEGORY: BG below threshold with super negative IOB and rising
    // =====================================================================
    fixture('BG below threshold, super negative IOB, rising fast — special case', 'low-bg-neg-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 65, delta: 5, short_avgdelta: 4, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      iob_data: { iob: -1.0, activity: -0.01 },
    }),

    // =====================================================================
    // CATEGORY: carbsReq threshold
    // =====================================================================
    fixture('carbsReq >= threshold within 45min — should recommend carbs', 'carbs-req', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 85, delta: -2, short_avgdelta: -2, long_avgdelta: -1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 1.5, activity: 0.015 },
      profile: { carbsReqThreshold: 1 },
    }),

    // =====================================================================
    // CATEGORY: Temp/lastTemp mismatch detection
    // =====================================================================
    fixture('currenttemp rate != lastTemp rate, old lastTemp — cancel temp', 'temp-mismatch', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      currenttemp: { duration: 25, rate: 1.5 },
      iob_data: {
        iob: 0.5, activity: 0.005,
        lastBolusTime: FIXED_DATE - 10 * 60_000,
        lastTemp: { rate: 0.9, duration: 30, date: FIXED_DATE - 15 * 60_000 },
      },
    }),

    fixture('currenttemp running but lastTemp ended long ago — cancel temp', 'temp-mismatch', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 1.5 },
      iob_data: {
        iob: 0.5, activity: 0.005,
        lastTemp: { rate: 1.5, duration: 5, date: FIXED_DATE - 20 * 60_000 },
      },
    }),

    // =====================================================================
    // CATEGORY: Deviation refinement paths
    // =====================================================================
    fixture('Negative deviation, minAvgDelta also negative — use long_avgdelta', 'deviation-refinement', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: -5, short_avgdelta: -4, long_avgdelta: -1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 0.3, activity: 0.003 },
    }),

    fixture('Negative deviation from minDelta, but minAvgDelta positive', 'deviation-refinement', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: -3, short_avgdelta: -2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 0.3, activity: 0.003 },
    }),

    // =====================================================================
    // CATEGORY: TDD-adjusted basal with dynamic ISF
    // =====================================================================
    fixture('TDD-adjusted basal with zero average_total_data', 'tdd-basal-edge', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { tddAdjBasal: true, useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2 },
      preferences: { useNewFormula: true },
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 0 },
    }),

    fixture('DynISF on but tddAdjBasal off — no basal ratio adjustment', 'tdd-basal-edge', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { tddAdjBasal: false, useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2 },
      preferences: { useNewFormula: true },
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 40 },
    }),

    // =====================================================================
    // CATEGORY: SMB scheduled off
    // =====================================================================
    fixture('SMB scheduled off — start=0, end=0 (all day)', 'smb-scheduled-off', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      trio_custom_variables: { smbIsScheduledOff: true, start: 0, end: 0 },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: EventualBG >= max_bg paths (high temp calculation)
    // =====================================================================
    fixture('EventualBG above max_bg, insulinReq limited by max_iob', 'eventual-bg-high', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 5, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: { max_iob: 3.0 },
      iob_data: { iob: 2.0, activity: 0.02 },
    }),

    fixture('EventualBG equals max_bg exactly', 'eventual-bg-high', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
    }),

    // =====================================================================
    // CATEGORY: eventualBG < min_bg with iobArray — sub-paths
    // =====================================================================
    fixture('eventualBG < min_bg, minDelta > 0 > expectedDelta, delta > minDelta — set basal', 'eventual-bg-low-iob', {
      currentTime: FIXED_TIME,
      // BG=90, rising, but IOB high enough that eventualBG < min_bg
      // Need: minDelta > expectedDelta, minDelta > 0, !carbsReq
      // delta > minDelta (short_avgdelta < delta)
      glucose_status: { glucose: 90, delta: 5, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 2.0, activity: 0.02 },
      currenttemp: { duration: 25, rate: 0.9 },
    }),

    fixture('eventualBG < min_bg, minDelta > 0 > expectedDelta, delta <= minDelta — set basal', 'eventual-bg-low-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 90, delta: 3, short_avgdelta: 5, long_avgdelta: 4, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 2.0, activity: 0.02 },
    }),

    fixture('eventualBG < min_bg, rate <= 0 with durationReq > 0 — set zero temp', 'eventual-bg-low-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 95, delta: -3, short_avgdelta: -3, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 2.0, activity: 0.02 },
      rawIobData: makeIobArray(2.0, 0.02, 5, FIXED_DATE),
    }),

    fixture('eventualBG < min_bg, insulinScheduled < minInsulinReq - 0.3*basal', 'eventual-bg-low-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 100, delta: -2, short_avgdelta: -2, long_avgdelta: -1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 1.5, activity: 0.015 },
      currenttemp: { duration: 25, rate: 2.0 },
    }),

    fixture('eventualBG < min_bg, existing temp ~< required rate — keep temp', 'eventual-bg-low-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 100, delta: -1, short_avgdelta: -1, long_avgdelta: -0.5, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 1.0, activity: 0.01 },
      currenttemp: { duration: 20, rate: 0.5 },
    }),

    // =====================================================================
    // CATEGORY: minDelta < expectedDelta with various sub-conditions
    // =====================================================================
    fixture('minDelta < expectedDelta, delta < minDelta, existing basal temp', 'mindelta-detail', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 140, delta: -6, short_avgdelta: -3, long_avgdelta: -1, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 0.9 },
    }),

    fixture('minDelta < expectedDelta, manualBolusErrorString=3 (minDelta>=0, expectedDelta>0)', 'mindelta-detail', {
      currentTime: FIXED_TIME,
      // Need: eventualBG >= min_bg, minDelta < expectedDelta
      // Need: expectedDelta - minDelta >= 2, minDelta >= 0, expectedDelta > 0
      // BG high enough eventualBG > min_bg, but falling slower than expected
      glucose_status: { glucose: 155, delta: 0, short_avgdelta: 0.5, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 0.2, activity: 0.002 },
    }),

    fixture('minDelta < expectedDelta, manualBolusErrorString=4 (minDelta<0, expectedDelta<=0)', 'mindelta-detail', {
      currentTime: FIXED_TIME,
      // Both minDelta and expectedDelta negative, minDelta more negative
      glucose_status: { glucose: 130, delta: -4, short_avgdelta: -5, long_avgdelta: -3, date: FIXED_DATE - 60_000 },
    }),

    // =====================================================================
    // CATEGORY: In-range with temp ~= basal or SMB enabled
    // =====================================================================
    fixture('In range, no SMB, existing temp ~= basal — keep running', 'in-range-temp', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 115, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 0.9 },
    }),

    fixture('In range with SMB enabled, eventualBG < max_bg — skip return', 'in-range-temp', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 115, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.2, 0.002, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: IOB > max_iob with existing temp ~= basal
    // =====================================================================
    fixture('IOB > max_iob with temp ~= basal — just return', 'iob-max-temp', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { max_iob: 1.5 },
      iob_data: { iob: 2.0, activity: 0.02 },
      currenttemp: { duration: 25, rate: 0.9 },
    }),

    // =====================================================================
    // CATEGORY: High temp computation — existing temp comparisons
    // =====================================================================
    fixture('High BG, no temp, eventualBG >= max_bg — should set new temp', 'high-temp-calc', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 2, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    fixture('High BG, existing temp rate > required — keep running', 'high-temp-calc', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 140, delta: 1, short_avgdelta: 1, long_avgdelta: 0.5, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 20, rate: 2.0 },
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),

    fixture('High BG, existing temp delivers > 2x insulinReq — lower rate', 'high-temp-calc', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: 0.5, short_avgdelta: 0.5, long_avgdelta: 0.5, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 3.0 },
      rawIobData: makeIobArray(0.2, 0.002, 5, FIXED_DATE),
    }),

    fixture('High BG, rate exceeds maxSafeBasal — clamped', 'high-temp-calc', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 300, delta: 5, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: { max_basal: 2.0, max_daily_basal: 1.0 },
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),

    fixture('High BG, required temp > existing — set higher', 'high-temp-calc', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 15, rate: 1.2 },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB — various SMB sub-paths with iobArray
    // =====================================================================
    fixture('SMB path — smbMinutesSetting undefined', 'smb-subpath', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 5, short_avgdelta: 4, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true,
        // Omitting maxSMBBasalMinutes to test the undefined case
      },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    fixture('SMB path — durationReq short (< 30m), sets nonzero low temp', 'smb-subpath', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 2, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),

    fixture('SMB path — microBolus >= maxBolus (capped by maxBolus)', 'smb-subpath', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 250, delta: 5, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true,
        maxSMBBasalMinutes: 15, // very small: 0.9 * 15/60 = 0.225
        max_iob: 10,
      },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.2, 0.002, 5, FIXED_DATE),
    }),

    fixture('SMB path — insulinReq > 0 but microBolus < bolusIncrement', 'smb-subpath', {
      currentTime: FIXED_TIME,
      // Very slightly above target to produce tiny insulinReq
      glucose_status: { glucose: 122, delta: 0.5, short_avgdelta: 0.5, long_avgdelta: 0.5, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true, bolus_increment: 0.1 },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.1, 0.001, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: COB predictions with iobArray — minCOBPredBG paths
    // =====================================================================
    fixture('COB with iobArray and UAM — blended minPredBG', 'cob-predictions', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 140, delta: 3, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true },
      meal_data: {
        carbs: 50, nsCarbs: 50, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 30, currentDeviation: 8, maxDeviation: 12, minDeviation: 0,
        slopeFromMaxDeviation: -0.3, slopeFromMinDeviation: 0,
        allDeviations: [8, 10, 12, 10, 6], lastCarbTime: FIXED_DATE - 30 * 60_000,
        bwFound: false,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    fixture('COB with iobArray, UAM disabled — average IOB and COB minPredBGs', 'cob-predictions', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 140, delta: 3, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: false },
      meal_data: {
        carbs: 50, nsCarbs: 50, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 30, currentDeviation: 8, maxDeviation: 12, minDeviation: 0,
        slopeFromMaxDeviation: -0.3, slopeFromMinDeviation: 0,
        allDeviations: [8, 10, 12, 10, 6], lastCarbTime: FIXED_DATE - 30 * 60_000,
        bwFound: false,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    fixture('Carbs entered but COB exhausted, UAM enabled — use minZTUAMPredBG', 'cob-predictions', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 140, delta: 3, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true },
      meal_data: {
        carbs: 30, nsCarbs: 30, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 5, maxDeviation: 10, minDeviation: 0,
        slopeFromMaxDeviation: -0.5, slopeFromMinDeviation: 0,
        allDeviations: [5, 8, 10, 8, 4], lastCarbTime: FIXED_DATE - 120 * 60_000,
        bwFound: false,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    fixture('Carbs entered, COB exhausted, UAM disabled — use minGuardBG', 'cob-predictions', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 140, delta: 3, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: false },
      meal_data: {
        carbs: 30, nsCarbs: 30, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 5, maxDeviation: 10, minDeviation: 0,
        slopeFromMaxDeviation: -0.5, slopeFromMinDeviation: 0,
        allDeviations: [5, 8, 10, 8, 4], lastCarbTime: FIXED_DATE - 120 * 60_000,
        bwFound: false,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: COB with minutesAboveThreshold < 45 (carbsReq with COB)
    // =====================================================================
    fixture('COB predBGs drop below threshold — carbsReq with COB', 'cob-carbs-req', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 100, delta: -2, short_avgdelta: -2, long_avgdelta: -1, date: FIXED_DATE - 60_000 },
      meal_data: {
        carbs: 30, nsCarbs: 30, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 10, currentDeviation: -2, maxDeviation: 5, minDeviation: -5,
        slopeFromMaxDeviation: -1.0, slopeFromMinDeviation: 0.3,
        allDeviations: [-2, 0, 3, 5, 3], lastCarbTime: FIXED_DATE - 90 * 60_000,
        bwFound: false,
      },
      iob_data: { iob: 1.5, activity: 0.015 },
      rawIobData: makeIobArray(1.5, 0.015, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB with COB — bwCarbs warning path
    // =====================================================================
    fixture('SMB with COB enabled and bwCarbs present — warning', 'smb-bwcarbs', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 170, delta: 5, short_avgdelta: 4, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_with_COB: true, A52_risk_enable: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 40, nsCarbs: 40, bwCarbs: 20, journalCarbs: 0,
        mealCOB: 25, currentDeviation: 8, maxDeviation: 12, minDeviation: 0,
        slopeFromMaxDeviation: -0.2, slopeFromMinDeviation: 0,
        allDeviations: [8, 10, 12, 10, 6], lastCarbTime: FIXED_DATE - 30 * 60_000,
        bwFound: false,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB high_bg with bwFound — warning path
    // =====================================================================
    fixture('SMB high BG with bwFound — warning', 'smb-highbg-bw', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_high_bg: true, enableSMB_high_bg_target: 150, A52_risk_enable: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 5, maxDeviation: 8, minDeviation: 0,
        slopeFromMaxDeviation: 0, slopeFromMinDeviation: 0,
        allDeviations: [5, 3, 1, 0, 0],
        bwFound: true,
      },
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB after_carbs with bwCarbs path
    // =====================================================================
    fixture('SMB after carbs with bwCarbs — warning', 'smb-aftercarbs-bw', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 160, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_after_carbs: true, A52_risk_enable: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 40, nsCarbs: 40, bwCarbs: 15, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 5, maxDeviation: 10, minDeviation: 0,
        slopeFromMaxDeviation: -0.5, slopeFromMinDeviation: 0,
        allDeviations: [5, 8, 10, 8, 4], lastCarbTime: FIXED_DATE - 60 * 60_000,
        bwFound: false,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB temp target with bwFound warning path
    // =====================================================================
    fixture('SMB with low temp target and bwFound — warning', 'smb-tt-bw', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 140, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_with_temptarget: true, temptargetSet: true,
        min_bg: 80, max_bg: 80, A52_risk_enable: true,
      },
      microBolusAllowed: true,
      meal_data: {
        carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 5, maxDeviation: 8, minDeviation: 0,
        slopeFromMaxDeviation: 0, slopeFromMinDeviation: 0,
        allDeviations: [5, 3, 1, 0, 0],
        bwFound: true,
      },
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),
  ];
}
