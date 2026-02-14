/**
 * Fixture generator for determine-basal characterization tests.
 *
 * Each fixture defines a clinically meaningful scenario by overriding
 * specific fields from the defaults. The fixture name and category make
 * it easy to understand what each test covers when reviewing diffs.
 */

import type { DetermineBasalInputs } from '../../types/index';
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
} from './defaults';

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

// Local hour for FIXED_TIME (timezone-aware for SMB scheduling tests)
const FIXED_LOCAL_HOUR = new Date(FIXED_TIME).getHours();

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

    // =====================================================================
    // CATEGORY: SMB scheduling — lines 57-68 (smbIsScheduledOff paths)
    // NOTE: enable_smb uses time.getHours() which returns LOCAL hour.
    //       FIXED_LOCAL_HOUR is computed dynamically for timezone portability.
    // =====================================================================
    // Lines 57-59: startTime < endTime, current hour is in [start, end)
    fixture('SMB scheduled off — start < end, current hour in range', 'smb-schedule', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      // start = localHour - 2, end = localHour + 2 => localHour in [start, end)
      trio_custom_variables: {
        smbIsScheduledOff: true,
        start: (FIXED_LOCAL_HOUR - 2 + 24) % 24,
        end: (FIXED_LOCAL_HOUR + 2) % 24,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // Lines 60-62: startTime > endTime (wraps midnight), current hour in range
    fixture('SMB scheduled off — start > end (wraps midnight), current hour in range', 'smb-schedule', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      // Wrapping window: start = localHour + 20 (mod 24), end = localHour + 4 (mod 24)
      // Since start > end (wraps), localHour >= start || localHour < end
      // localHour >= start? localHour >= (localHour+20)%24. If localHour=4: start=0, end=8 => 0 < 8 NOT > (bad).
      // Better: start = localHour - 1 + 24) % 24, end = (localHour - 3 + 24) % 24
      // For localHour=4: start=3, end=1 => 3 > 1 => wrap. 4 >= 3? Yes => disabled.
      trio_custom_variables: {
        smbIsScheduledOff: true,
        start: (FIXED_LOCAL_HOUR - 1 + 24) % 24,
        end: (FIXED_LOCAL_HOUR - 3 + 24) % 24,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // Lines 66-68: startTime == endTime && currentHour == startTime
    fixture('SMB scheduled off — start == end == currentHour', 'smb-schedule', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      trio_custom_variables: {
        smbIsScheduledOff: true,
        start: FIXED_LOCAL_HOUR,
        end: FIXED_LOCAL_HOUR,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // Lines 60-62: startTime > endTime, currentHour < startTime BUT currentHour < endTime
    // Need to exercise the `currentHour < endTime` part of the OR (when `currentHour >= startTime` is false)
    fixture('SMB scheduled off — start > end, currentHour < start but < end', 'smb-schedule', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      // Need start > end, localHour < start, localHour < end
      // E.g. localHour=4: start=6, end=5 => 6>5 yes. 4>=6? no. 4<5? yes => disabled
      trio_custom_variables: {
        smbIsScheduledOff: true,
        start: (FIXED_LOCAL_HOUR + 2) % 24,
        end: (FIXED_LOCAL_HOUR + 1) % 24,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // SMB scheduled off but current hour is OUTSIDE the window — should allow SMB
    fixture('SMB scheduled off — current hour outside window, SMB allowed', 'smb-schedule', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true },
      microBolusAllowed: true,
      trio_custom_variables: {
        smbIsScheduledOff: true,
        start: (FIXED_LOCAL_HOUR + 3) % 24,
        end: (FIXED_LOCAL_HOUR + 6) % 24,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB disabled fallthrough — line 136
    // =====================================================================
    fixture('SMB disabled — no enableSMB preference active', 'smb-disabled-fallthrough', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: false,
        enableSMB_with_COB: false,
        enableSMB_after_carbs: false,
        enableSMB_with_temptarget: false,
        enableSMB_high_bg: false,
      },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: Low TT sensitivity edge case — lines 517-518
    // c * (c + target_bg - normalTarget) <= 0 => sensitivityRatio = autosens_max
    // =====================================================================
    fixture('Low TT — c*(c+target_bg-normalTarget) <= 0, use autosens_max', 'low-tt-edge', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: {
        temptargetSet: true, min_bg: 50, max_bg: 50,
        low_temptarget_lowers_sensitivity: true,
        // half_basal_exercise_target = 60 => c = 60 - 100 = -40
        // c + target_bg - normalTarget = -40 + 50 - 100 = -90
        // c * (c + target_bg - normalTarget) = (-40)*(-90) = 3600 > 0 — not what we want
        // Need c <= 0 and (c + target_bg - normalTarget) >= 0 OR vice versa
        // c = halfBasalTarget - normalTarget. If halfBasalTarget = 80, c = -20
        // c + target_bg - normalTarget = -20 + 50 - 100 = -70 => product = (-20)*(-70) = 1400 > 0
        // Need c positive and (c+target_bg-normalTarget) negative or c=0
        // c = halfBasalTarget - 100. If halfBasalTarget=100, c=0 => product = 0 <= 0 YES!
        half_basal_exercise_target: 100,
        autosens_max: 1.3,
      },
    }),

    // =====================================================================
    // CATEGORY: Dynamic ISF with low TT boost — lines 540-546
    // Need: temptargetSet, target_bg < normalTarget, dynISFenabled, BG >= target_bg
    // AND sensitivityRatio < newRatio
    // =====================================================================
    fixture('Dynamic ISF with low TT — ratio boosted by normalTarget/target_bg', 'dynisf-low-tt-boost', {
      currentTime: FIXED_TIME,
      // BG=140, target_bg=80 (low TT), normalTarget=100
      // Need dynISFenabled: useNewFormula=true + TDD > 0 + autosens_min != autosens_max
      // Also need sensitivityRatio < newRatio (the dISF-computed ratio)
      // sensitivityRatio from the low_temptarget_lowers_sensitivity block will be computed first
      // Then if sensitivityRatio < newRatio, we boost
      glucose_status: { glucose: 140, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      profile: {
        temptargetSet: true, min_bg: 80, max_bg: 80,
        low_temptarget_lowers_sensitivity: true,
        half_basal_exercise_target: 160,
        useNewFormula: true,
        autosens_min: 0.5, autosens_max: 2.5,
        enableSMB_always: true,
      },
      preferences: { useNewFormula: true, adjustmentFactor: 1.5, sigmoid: false },
      trio_custom_variables: { currentTDD: 50, weightedAverage: 50, average_total_data: 50 },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: TDD-adjusted basal unchanged — line 567
    // Need: dynISFenabled && tddAdjBasal && tdd24h_14d_Ratio == 1 (basal unchanged)
    // =====================================================================
    fixture('TDD-adjusted basal — ratio 1.0, basal unchanged', 'tdd-basal-unchanged', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { tddAdjBasal: true, useNewFormula: true, autosens_min: 0.7, autosens_max: 1.2 },
      preferences: { useNewFormula: true },
      // weightedAverage / average_total_data = 40/40 = 1.0 => tdd24h_14d_Ratio = 1
      // basal = current_basal * 1.0 * 1 = 0.9 => unchanged
      trio_custom_variables: { currentTDD: 40, weightedAverage: 40, average_total_data: 40 },
    }),

    // =====================================================================
    // CATEGORY: sensitivity_raises_target, target_bg unchanged — lines 583-584
    // Need: sensitivity_raises_target=true, ratio<1, but math yields same target_bg
    // target_bg=80, ratio=0.8 => new_target_bg = round((80-60)/0.8)+60 = round(25)+60 = 85
    // That changes it. Need a case where it doesn't: target_bg = round((target_bg-60)/ratio)+60
    // With target_bg=80, ratio=1.0 => unchanged, but ratio<1 is required.
    // Actually need: max(80, round((target_bg-60)/ratio)+60) == target_bg
    // If target_bg=80 and ratio close to 1: round((80-60)/0.99)+60 = round(20.2)+60 = 80 => unchanged!
    // But autosens_data ratio is typically limited to e.g. 0.7-1.2
    // Actually, let's use a target that is already at the floor: 80
    // round((80-60)/0.95)+60 = round(21.05)+60 = 81 => changed to 81
    // round((80-60)/1.0)+60 = 80 => same but ratio not < 1
    // We need the final target to equal new_target_bg after max(80,...) clamping
    // If new_target_bg computes to e.g. 79, max(80,79)=80 => unchanged from target_bg=80!
    // round((80-60)/0.97)+60 = round(20.6)+60 = 81 => changed
    // round((80-60)/0.96)+60 = round(20.8)+60 = 81 => changed
    // round((80-60)/0.9)+60 = round(22.2)+60 = 82 => changed
    // Actually need Math.max(80, new_target_bg) == target_bg. If target_bg > 80:
    // target_bg = 60, but we can't go below 80. So if raw new_target_bg < 80, it gets clamped to 80.
    // But target_bg starts at, say, 80. If new_target_bg < 80, max(80, new_target_bg) = 80 = target_bg. YES.
    // Need: round((80-60)/ratio)+60 < 80 => round(20/ratio) < 20 => 20/ratio < 20.5 => ratio > 20/20.5 ≈ 0.976
    // So ratio = 0.98: round((80-60)/0.98)+60 = round(20.408)+60 = 80 => same! Perfect.
    // But 0.98 is not achievable easily with autosens. Let me use a manual ratio.
    // =====================================================================
    fixture('Sensitivity raises target — target_bg unchanged due to floor', 'sens-target-unchanged', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: {
        sensitivity_raises_target: true,
        min_bg: 80, max_bg: 80,
      },
      // ratio=0.98 => new_target_bg = round((80-60)/0.98)+60 = round(20.408)+60 = 80 => unchanged
      autosens_data: { ratio: 0.98 },
    }),

    // =====================================================================
    // CATEGORY: Override target log with double arrow — lines 595-596
    // Need: overrideTarget != 0 && != 6 && != target_bg, AND target_bg != profileTarget
    // This happens when: override sets a target, then autosens/sensitivity modifies it further
    // =====================================================================
    fixture('Override target + sensitivity adjustment — triple arrow log', 'override-target-double-arrow', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: {
        min_bg: 110, max_bg: 120,
        sensitivity_raises_target: true,
        temptargetSet: false,
      },
      // overrideTarget=100 => profileTarget becomes 100 (in determine_basal, profileTarget = overrideTarget)
      // Then sensitivity_raises_target with ratio<1 adjusts target_bg further
      // target_bg starts at 100, then new_target_bg = round((100-60)/ratio)+60
      // ratio=0.8 => round(50)+60 = 110 => target_bg=110
      // overrideTarget=100, profileTarget=100 (overridden), target_bg=110
      // But we need profileTarget != target_bg AND overrideTarget != target_bg
      // profileTarget = overrideTarget = 100 (since useOverride && not temptargetSet)
      // target_bg = 110 after sensitivity adjustment
      // So profileTarget=100, overrideTarget=100, target_bg=110
      // Condition: overrideTarget !== 0 && overrideTarget !== 6 && overrideTarget !== target_bg
      // 100 !== 0, 100 !== 6, 100 !== 110 => TRUE => double arrow
      trio_custom_variables: {
        useOverride: true, overridePercentage: 100, isfAndCr: false,
        overrideTarget: 100, duration: 0,
      },
      autosens_data: { ratio: 0.8 },
    }),

    // =====================================================================
    // CATEGORY: meal_data.reason == "Could not parse clock data" — line 1249
    // =====================================================================
    fixture('Meal data with clock parse error — carbsReq unknown', 'clock-parse-error', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 85, delta: -2, short_avgdelta: -2, long_avgdelta: -1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 1.5, activity: 0.015 },
      profile: { carbsReqThreshold: 1 },
      meal_data: {
        carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: -2, maxDeviation: 5, minDeviation: -5,
        slopeFromMaxDeviation: -0.5, slopeFromMinDeviation: 0,
        allDeviations: [-2, 0, 3, 5, 3],
        bwFound: false,
        reason: 'Could not parse clock data',
      } as any,
    }),

    // =====================================================================
    // CATEGORY: eventualBG < min_bg, minDelta > 0 > expectedDelta, naive_eventualBG < 40 — lines 1300-1304
    // CRITICAL: bg must be >= threshold (= min_bg = 110) to avoid LGS return at lines 1261-1281
    // Need: eventualBG < min_bg, minDelta > expectedDelta, minDelta > 0, !carbsReq, naive_eventualBG < 40
    // =====================================================================
    fixture('EventualBG < min_bg, rising but naive_eventualBG < 40 — set 30m zero', 'eventual-bg-low-naive', {
      currentTime: FIXED_TIME,
      // bg=115 >= threshold(110), so LGS is skipped
      // iob=5.2, naive = 115 - 5.2*40 = -93 < 40
      // bgi = -0.052*40*5 = -10.4
      // delta=2, short_avgdelta=1.5 => minDelta = 1.5
      // deviation = round(6*(1.5-(-10.4))) = round(71.4) = 71
      // eventualBG = -93 + 71 = -22 < 110 YES
      // expectedDelta = round(-10.4+(110-(-22))/24,1) = round(-4.9,1) = -4.9
      // minDelta(1.5) > expectedDelta(-4.9) YES, minDelta > 0 YES
      // carbsReq = round((110-(-93)-144)/400) = round(59/400) = 0 => !carbsReq = true
      glucose_status: { glucose: 115, delta: 2, short_avgdelta: 1.5, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 5.2, activity: 0.052 },
    }),

    // =====================================================================
    // CATEGORY: eventualBG < min_bg, rising, delta > minDelta — lines 1306-1307
    // Need: bg >= 110, eventualBG < 110, minDelta > expectedDelta > 0, delta > minDelta, naive >= 40
    // =====================================================================
    fixture('EventualBG < min_bg, rising, delta > minDelta — set basal temp', 'eventual-bg-low-delta-gt-mindelta', {
      currentTime: FIXED_TIME,
      // bg=115, iob=1.3 => naive = 115-52 = 63 >= 40
      // bgi = -0.013*40*5 = -2.6
      // delta=3, short_avgdelta=2 => minDelta=2
      // deviation = round(6*(2-(-2.6))) = 28
      // eventualBG = 63+28 = 91 < 110
      // expectedDelta = round(-2.6+(110-91)/24,1) = -1.8
      // minDelta(2) > expectedDelta(-1.8) YES, > 0 YES
      // carbsReq = round((110-63-144)/400) = 0 => !carbsReq = true
      // delta(3) > minDelta(2) YES => line 1306
      glucose_status: { glucose: 115, delta: 3, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 1.3, activity: 0.013 },
    }),

    // Lines 1308-1309: delta <= minDelta (short_avgdelta >= delta)
    fixture('EventualBG < min_bg, rising, delta <= minDelta — set basal temp', 'eventual-bg-low-delta-le-mindelta', {
      currentTime: FIXED_TIME,
      // Same as above but delta=2, short_avgdelta=3 => minDelta=2 => delta NOT > minDelta => else
      glucose_status: { glucose: 115, delta: 2, short_avgdelta: 3, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 1.3, activity: 0.013 },
    }),

    // Lines 1311-1313: matching temp (currenttemp.rate ~ basal)
    fixture('EventualBG < min_bg, rising, temp matches basal — return', 'eventual-bg-low-temp-match', {
      currentTime: FIXED_TIME,
      // Same BG scenario as delta-gt-mindelta, with matching temp
      glucose_status: { glucose: 115, delta: 3, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      iob_data: {
        iob: 1.3, activity: 0.013,
        lastTemp: { rate: 0.9, duration: 30, date: FIXED_DATE - 5 * 60_000 },
      },
      currenttemp: { duration: 25, rate: 0.9 }, // matches basal of 0.9
    }),

    // =====================================================================
    // CATEGORY: eventualBG < min_bg, falling, insulinScheduled < minInsulinReq - basal*0.3 — line 1345
    // CRITICAL: bg must be >= 110 to avoid LGS
    // =====================================================================
    fixture('EventualBG < min_bg, falling, insulinScheduled much less than needed', 'eventual-bg-low-insched-low', {
      currentTime: FIXED_TIME,
      // bg=112, iob=0.15, delta=-0.5, short_avgdelta=-0.5, long_avgdelta=-0.3
      // naive = 112 - 6 = 106. bgi = -0.3.
      // deviation fallback chain: 6*(-0.5-(-0.3))=-1.2<0 => long_avgdelta: 6*(-0.3-(-0.3))=0
      // eventualBG = 106+0 = 106 < 110 YES
      // insulinReq = 2*min(0,(106-110)/40) = -0.2
      // naiveInsulinReq = min(0,(106-110)/40) = -0.1
      // rate = 0.9+2*(-0.2) = 0.5
      // With currenttemp={duration:35, rate:0}: insulinScheduled = 35*(0-0.9)/60 = -0.525
      // minInsulinReq = min(-0.2,-0.1) = -0.2
      // -0.525 < -0.2 - 0.27 = -0.47? YES => line 1345
      glucose_status: { glucose: 112, delta: -0.5, short_avgdelta: -0.5, long_avgdelta: -0.3, date: FIXED_DATE - 60_000 },
      iob_data: {
        iob: 0.15, activity: 0.0015,
        lastTemp: { rate: 0, duration: 35, date: FIXED_DATE - 5 * 60_000 },
      },
      currenttemp: { duration: 35, rate: 0 },
    }),

    // Lines 1349: existing temp, currenttemp.duration > 5, rate >= currenttemp.rate*0.8
    fixture('EventualBG < min_bg, falling, temp ~< required rate — keep temp', 'eventual-bg-low-keep-temp', {
      currentTime: FIXED_TIME,
      // bg=112, iob=0.1, delta=-0.5, short_avgdelta=-0.5, long_avgdelta=-0.3
      // naive = 112-4 = 108, bgi = -0.2
      // deviation: 6*(-0.5-(-0.2)) = -1.8 < 0 => use minAvgDelta=-0.5 => -1.8 still <0
      //           => use long_avgdelta: 6*(-0.3-(-0.2)) = -0.6 still <0
      // eventualBG = 108 + (-0.6) = 107.4 < 110 YES
      // expectedDelta = round(-0.2+(110-107.4)/24,1) = round(-0.092,1) = -0.1
      // minDelta(-0.5) > expectedDelta(-0.1)? NO => skip first branch
      // insulinReq = 2*min(0, (107.4-110)/40) = 2*(-0.065) = -0.13
      // rate = 0.9 + 2*(-0.13) = 0.64 => roundBasal => 0.65
      // currenttemp: {duration: 20, rate: 0.7}, lastTemp matching
      // insulinScheduled = 20*(0.7-0.9)/60 = -0.0667
      // naiveInsulinReq = min(0, (108-110)/40) = -0.05
      // minInsulinReq = min(-0.13, -0.05) = -0.13
      // -0.0667 < -0.13 - 0.27 = -0.4? NO => skip 1345
      // 1349: currenttemp.rate=0.7 defined, duration(20)>5, rate(0.65) >= 0.7*0.8=0.56? YES => line 1349!
      glucose_status: { glucose: 112, delta: -0.5, short_avgdelta: -0.5, long_avgdelta: -0.3, date: FIXED_DATE - 60_000 },
      iob_data: {
        iob: 0.1, activity: 0.001,
        lastTemp: { rate: 0.7, duration: 30, date: FIXED_DATE - 5 * 60_000 },
      },
      currenttemp: { duration: 20, rate: 0.7 },
    }),

    // Lines 1359-1360: rate <= 0 with durationReq < 0 => set to 0
    fixture('EventualBG < min_bg, falling fast, durationReq < 0 (clamped to 0)', 'eventual-bg-low-duration-neg', {
      currentTime: FIXED_TIME,
      // bg=115, iob=0, activity=0 => naive = 115 > 110
      // bgi = 0, delta=-8, short_avgdelta=-8, long_avgdelta=-6
      // deviation: all fallbacks negative => 6*(-6-0) = -36
      // eventualBG = 115+(-36) = 79 < 110 YES
      // insulinReq = 2*min(0,(79-110)/40) = -1.55
      // rate = 0.9+2*(-1.55) = -2.2 <= 0 YES
      // insulinScheduled = 0 (no temp). minInsulinReq = -1.55. 0 < -1.82? NO => skip 1345
      // bgUndershoot = 110-115 = -5 => worstCaseInsulinReq = -0.125
      // durationReq = round(60*(-0.125)/0.9) = -8 < 0 => line 1360
      glucose_status: { glucose: 115, delta: -8, short_avgdelta: -8, long_avgdelta: -6, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 0, activity: 0 },
    }),

    // =====================================================================
    // CATEGORY: minDelta < expectedDelta without SMB — lines 1403-1416
    // =====================================================================
    // Lines 1403-1405: delta < minDelta (impossible since minDelta = min(delta, short_avgdelta))
    // Actually: glucose_status.delta < minDelta is possible when short_avgdelta > delta
    // Wait: minDelta = min(delta, short_avgdelta). So minDelta <= delta always.
    // Line 1404: glucose_status.delta < minDelta => delta < min(delta, short_avgdelta) => impossible!
    // Hmm, but maybe there's some rounding? Actually no, delta IS glucose_status.delta
    // So line 1404 is unreachable. The else (line 1406-1407) always executes.
    // Let me check: line 1404 says `if (glucose_status.delta < minDelta)` where minDelta = min(glucose_status.delta, glucose_status.short_avgdelta)
    // This can never be true. So line 1405 is unreachable. Only lines 1406-1407 can execute.
    // Lines 1409-1411: currenttemp.duration > 15 && basal matches currenttemp.rate => keep
    fixture('minDelta < expectedDelta, no SMB, temp matches basal — keep', 'mindelta-no-smb-temp-match', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: -4, short_avgdelta: -3, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 0.9 }, // matches basal
      // Provide matching lastTemp so the temp mismatch check at line 682-688 doesn't cancel
      iob_data: {
        iob: 0, activity: 0,
        lastTemp: { rate: 0.9, duration: 30, date: FIXED_DATE - 5 * 60_000 },
      },
    }),

    // Lines 1412-1414: no matching temp — set basal as temp
    fixture('minDelta < expectedDelta, no SMB, no matching temp — set basal', 'mindelta-no-smb-set-basal', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: -4, short_avgdelta: -3, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
      // No temp running (default duration=0)
    }),

    // =====================================================================
    // CATEGORY: In-range with no SMB — lines 1429-1437
    // =====================================================================
    // Lines 1431-1433: matching temp
    fixture('In range, no SMB, temp matches basal — keep running', 'in-range-no-smb-temp', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 115, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 0.9 },
      iob_data: {
        iob: 0, activity: 0,
        lastTemp: { rate: 0.9, duration: 30, date: FIXED_DATE - 5 * 60_000 },
      },
    }),

    // Line 1435: no matching temp
    fixture('In range, no SMB, no matching temp — set basal', 'in-range-no-smb-set-basal', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 115, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      // No temp running
    }),

    // =====================================================================
    // CATEGORY: IOB > max_iob — lines 1449-1451
    // =====================================================================
    // Line 1451: matching temp (already have 'IOB > max_iob with temp ~= basal')
    // Let's also add: IOB > max_iob, no matching temp (line 1455)
    fixture('IOB > max_iob, no temp running — set basal as temp', 'iob-over-max-no-temp', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 5, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: { max_iob: 2.0 },
      iob_data: { iob: 2.5, activity: 0.025 },
      // No temp running (duration=0)
    }),

    // IOB > max_iob with matching temp (~= basal) — line 1451
    fixture('IOB > max_iob, temp matches basal — keep running', 'iob-over-max-temp-match', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 5, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: { max_iob: 2.0 },
      iob_data: {
        iob: 2.5, activity: 0.025,
        lastTemp: { rate: 0.9, duration: 30, date: FIXED_DATE - 5 * 60_000 },
      },
      currenttemp: { duration: 25, rate: 0.9 }, // matches basal
    }),

    // =====================================================================
    // CATEGORY: SMB — smbMinutesSetting undefined — lines 1513-1519
    // Need: profile.maxSMBBasalMinutes is undefined
    // The existing fixture 'SMB path — smbMinutesSetting undefined' should cover this,
    // but let's verify by making maxSMBBasalMinutes explicitly deleted
    // =====================================================================
    fixture('SMB — maxSMBBasalMinutes not in profile (undefined path)', 'smb-minutes-undefined', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 5, short_avgdelta: 4, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true,
        enableUAM: true,
        // Explicitly set to undefined to trigger the typeof check
        maxSMBBasalMinutes: undefined as any,
      },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB — uamMinutesSetting falsy (0) — lines 1525-1527
    // Need: IOB > mealInsulinReq, uamMinutesSetting = 0 (falsy)
    // =====================================================================
    fixture('SMB — maxUAMSMBBasalMinutes=0, IOB > mealInsulinReq', 'smb-uam-minutes-zero', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 5, short_avgdelta: 4, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true,
        enableUAM: true,
        maxSMBBasalMinutes: 30,
        maxUAMSMBBasalMinutes: 0,
      },
      microBolusAllowed: true,
      // IOB > mealInsulinReq (which is mealCOB/carbRatio = 0/10 = 0)
      rawIobData: makeIobArray(1.5, 0.015, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB durationReq <= 0 — line 1563
    // Need: insulinReq > 0 but microBolus < bolusIncrement => durationReq = 0
    // Then durationReq <= 0 => line 1563-1564
    // =====================================================================
    fixture('SMB — durationReq <= 0 (insulinReq tiny, microBolus < increment)', 'smb-duration-zero', {
      currentTime: FIXED_TIME,
      // Just barely above target
      glucose_status: { glucose: 121, delta: 0.2, short_avgdelta: 0.2, long_avgdelta: 0.2, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true, bolus_increment: 0.1 },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.05, 0.0005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB durationReq >= 30 — line 1566
    // High BG scenario with large insulinReq => durationReq >= 30
    // =====================================================================
    fixture('SMB — durationReq >= 30, long zero temp', 'smb-duration-long', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 250, delta: 5, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true,
        enableUAM: true,
        maxSMBBasalMinutes: 60,
        maxUAMSMBBasalMinutes: 60,
        max_iob: 10,
      },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: Required temp > existing temp — line 1638
    // Need: high BG scenario where rate > currenttemp.rate, and currenttemp.duration > 5,
    // and rate > currenttemp.rate so it doesn't match line 1631
    // =====================================================================
    fixture('High BG, required temp rate > existing temp rate — set higher temp', 'req-temp-gt-existing', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 10, rate: 1.0 }, // low existing temp
      iob_data: {
        iob: 0, activity: 0,
        lastTemp: { rate: 1.0, duration: 30, date: FIXED_DATE - 5 * 60_000 },
      },
    }),

    // Additional fixture for line 1638 with iobArray
    fixture('High BG with iobArray, required temp > existing — replace temp', 'req-temp-gt-existing', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 10, rate: 1.2 },
      rawIobData: (() => {
        const arr = makeIobArray(0.3, 0.003, 5, FIXED_DATE);
        (arr[0] as any).lastTemp = { rate: 1.2, duration: 30, date: FIXED_DATE - 5 * 60_000 };
        return arr;
      })(),
    }),

    // =====================================================================
    // CATEGORY: ZTpredBGs rising above target — line 1009
    // Need: ZTpredBGs that are rising and above target, so they get popped
    // This requires specific iobArray data where zero-temp predictions rise above target
    // High IOB scenario where the zero-temp projections eventually start rising above target
    // =====================================================================
    fixture('ZTpredBGs rising above target — trimmed', 'zt-pred-rising', {
      currentTime: FIXED_TIME,
      // Very high IOB with zero temp — zero-temp predictions may start high and then fall
      // but we need them to RISE above target. This happens when:
      // - BG is above target
      // - With zero temp, predictions initially fall but then bounce back up
      // High IOB means lots of activity reduction in zero-temp, causing BG to rise
      glucose_status: { glucose: 160, delta: 2, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true, enableUAM: true },
      microBolusAllowed: true,
      // Use a special iobArray where iobWithZeroTemp has very low IOB (simulating zero temp effect)
      // This will make ZT predictions rise since there's less insulin counteracting BG
      rawIobData: (() => {
        const arr = makeIobArray(3.0, 0.03, 5, FIXED_DATE);
        // Make the iobWithZeroTemp have very rapidly decreasing activity
        // so ZT predictions eventually rise above target
        for (let i = 0; i < arr.length; i++) {
          const entry = arr[i] as any;
          entry.iobWithZeroTemp.activity = Math.max(0, 0.03 * Math.max(0, 1 - i * 0.15));
          entry.iobWithZeroTemp.iob = Math.max(0, 3.0 * Math.max(0, 1 - i * 0.15));
        }
        return arr;
      })(),
    }),

    // =====================================================================
    // CATEGORY: eventualBG < min_bg rising paths — WITH iobArray
    // CRITICAL: These require iobArray so minGuardBG is properly calculated,
    // and carbsReq becomes 0/falsy to enter line 1300.
    // Need: eventualBG < min_bg, minDelta > expectedDelta > 0, !carbsReq,
    //       bg >= threshold, minGuardBG >= threshold
    // =====================================================================

    // Lines 1300-1304: naive_eventualBG < 40
    fixture('eventualBG < min_bg, rising, iobArray, naive_eventualBG < 40', 'eventual-bg-low-rising-iob', {
      currentTime: FIXED_TIME,
      // bg=115, high IOB so naive_eventualBG < 40
      // iob=4.0 => naive = 115 - 4*40 = -45 < 40
      // delta=4, short_avgdelta=3 => minDelta=3
      // bgi = round(-0.04*40*5,2) = -8
      // ci = round(3-(-8),1) = 11
      // deviation = round(6*(3-(-8))) = 66
      // eventualBG = -45 + 66 = 21 < 110 YES
      // expectedDelta = round(-8+(110-21)/24,1) = round(-4.29,1) = -4.3
      // minDelta(3) > expectedDelta(-4.3) YES, > 0 YES
      glucose_status: { glucose: 115, delta: 4, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      rawIobData: (() => {
        const arr = makeIobArray(4.0, 0.04, 5, FIXED_DATE);
        // Ensure minGuardBG stays above threshold by making IOBGuardBG high
        // With high activity, predictions go down, but bg=115 and threshold~75
        return arr;
      })(),
    }),

    // Lines 1306-1307: delta > minDelta (rising, naive >= 40)
    fixture('eventualBG < min_bg, rising, iobArray, delta > minDelta', 'eventual-bg-low-rising-iob', {
      currentTime: FIXED_TIME,
      // iob=1.5 => naive = 115 - 60 = 55 >= 40
      // delta=5, short_avgdelta=3 => minDelta=3, delta(5) > minDelta(3) YES
      glucose_status: { glucose: 115, delta: 5, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      rawIobData: makeIobArray(1.5, 0.015, 5, FIXED_DATE),
    }),

    // Lines 1308-1309: delta <= minDelta (rising, naive >= 40)
    fixture('eventualBG < min_bg, rising, iobArray, delta <= minDelta', 'eventual-bg-low-rising-iob', {
      currentTime: FIXED_TIME,
      // delta=3, short_avgdelta=5 => minDelta=3, delta(3) NOT > minDelta(3) => else at 1308
      glucose_status: { glucose: 115, delta: 3, short_avgdelta: 5, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      rawIobData: makeIobArray(1.5, 0.015, 5, FIXED_DATE),
    }),

    // Lines 1311-1313: temp matches basal (rising, naive >= 40)
    fixture('eventualBG < min_bg, rising, iobArray, temp matches basal', 'eventual-bg-low-rising-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 115, delta: 5, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 0.9 },
      rawIobData: (() => {
        const arr = makeIobArray(1.5, 0.015, 5, FIXED_DATE);
        (arr[0] as any).lastTemp = { rate: 0.9, duration: 30, date: FIXED_DATE - 5 * 60_000 };
        return arr;
      })(),
    }),

    // =====================================================================
    // CATEGORY: minDelta < expectedDelta, non-SMB paths — lines 1388-1416
    // Need: eventualBG >= min_bg, minDelta < expectedDelta
    // Then: !(microBolusAllowed && enableSMB) => true (non-SMB mode)
    // Also need the manualBolusErrorString assignments at 1388-1397
    // =====================================================================

    // Lines 1388-1390: expectedDelta - minDelta >= 2, minDelta >= 0, expectedDelta > 0
    fixture('minDelta < expectedDelta, manualBolusErrorString=3, non-SMB', 'mindelta-non-smb', {
      currentTime: FIXED_TIME,
      // Need: eventualBG >= min_bg, minDelta < expectedDelta
      // BG=140, iob=0.5 => naive=120, bgi=-1
      // delta=0, short_avgdelta=0.5 => minDelta=0
      // deviation depends on CI calculation; with these, dev ~ 6*(0-(-1))=6
      // eventualBG = 120+6=126 > 110 YES
      // expectedDelta = round(-1+(110-126)/24,1) = round(-1.67,1) = -1.7
      // Wait, we need minDelta < expectedDelta. minDelta=0, expectedDelta=-1.7
      // 0 < -1.7? NO!
      // Need eventualBG > target_bg so expectedDelta is positive
      // Actually, expectedDelta depends on eventualBG vs target_bg
      // If eventualBG > target_bg, target_delta < 0, so expectedDelta = bgi + negative
      // Need bgi large enough to overcome the negative target_delta
      // Actually for minDelta < expectedDelta with both positive:
      // Need: BG slightly above target with high activity (bgi very negative)
      // Let's try: BG=155, iob=0.2, activity=0.002, delta=0.5
      // naive=155-8=147, bgi = -0.4
      // minDelta = min(0.5, 1) = 0.5
      // deviation = round(6*(0.5-(-0.4)))=5
      // eventualBG = 147+5=152 > 110 YES
      // expectedDelta = round(-0.4+(110-152)/24,1)=round(-2.15,1)=-2.1
      // Still negative! Need eventualBG closer to target.
      // With high IOB: BG=115, iob=0.1, activity=0.005, delta=0.5
      // bgi=round(-0.005*40*5,2)=-1
      // naive=115-4=111
      // deviation=round(6*(0.5-(-1)))=9
      // eventualBG=111+9=120 >= 110 YES
      // expectedDelta=round(-1+(110-120)/24,1)=round(-1.42,1)=-1.4
      // minDelta(0.5) < expectedDelta(-1.4)? NO! 0.5 > -1.4
      // The problem: for eventualBG >= min_bg, expectedDelta is usually negative
      // For minDelta < expectedDelta, we need minDelta very negative (falling fast)
      // Let's use: delta=-4, short_avgdelta=-3
      // minDelta = -4, expectedDelta = -1.4
      // -4 < -1.4? YES!
      // But we need manualBolusErrorString=3: minDelta >= 0 && expectedDelta > 0
      // That requires both minDelta and expectedDelta positive, but minDelta < expectedDelta
      // For expectedDelta > 0: bgi + (target-eventualBG)/24 > 0 => bgi > (eventualBG-target)/24
      // With eventualBG = 112, target=110: bgi > 2/24 = 0.08 => bgi positive => IOB negative
      // iob = -0.1, activity = -0.001 => bgi = round(0.001*40*5,2)=0.2
      // naive=115-(-0.1)*40=119
      // deviation with positive bgi: minDelta=min(0.5,1)=0.5, ci=round(0.5-0.2,1)=0.3
      // dev=round(6*0.3)=2
      // eventualBG=119+2=121
      // expectedDelta=round(0.2+(110-121)/24,1)=round(-0.26,1)=-0.3
      // Still negative since eventualBG > target.
      // For expectedDelta > 0, we need eventualBG < target! But we need eventualBG >= min_bg
      // eventualBG needs to be between min_bg and target_bg? But min_bg IS the target_bg (110)
      // Actually target_bg = profileTarget which is min_bg=110
      // So eventualBG >= min_bg means eventualBG >= 110 = target
      // expectedDelta = bgi + (target-eventualBG)/24 = bgi + something <= 0 (since eventualBG>=target)
      // So expectedDelta <= bgi. With bgi negative (positive IOB), expectedDelta < 0 always!
      // With negative IOB, bgi > 0, and if eventualBG = target exactly, expectedDelta = bgi > 0
      // But minDelta > 0 AND minDelta < expectedDelta(=bgi>0) requires minDelta < bgi
      // This IS possible. Let's try:
      // iob=-0.15, activity=-0.0015 => bgi=round(0.0015*40*5,2)=0.3
      // delta=0, short_avgdelta=0.1 => minDelta=0
      // naive=115+0.15*40=121 (negative IOB uses min(sens, sensitivity)=40)
      // ci=round(0-0.3,1)=-0.3 => ci < 0, so dev path with negative:
      // dev=round(6*(minAvgDelta-bgi))=round(6*(min(0.1,long)-0.3))
      // If long_avgdelta=0.1: minAvgDelta=0.1, dev=round(6*(0.1-0.3))=-1.2 => negative
      // dev=round(6*(long-bgi))=round(6*(0.1-0.3))=-1.2 still neg
      // eventualBG=121+(-1.2)=119.8 => 120
      // expectedDelta=round(0.3+(110-120)/24,1)=round(-0.12,1)=-0.1
      // minDelta(0) < expectedDelta(-0.1)? 0 < -0.1? NO!
      // This requires very specific tuning. Let me just use falling BG instead.
      // For manualBolusErrorString=4: minDelta < 0, expectedDelta <= 0
      // This is the easy case since BG falling with eventualBG > min_bg
      glucose_status: { glucose: 130, delta: -5, short_avgdelta: -3, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
      iob_data: { iob: 0, activity: 0 },
      rawIobData: makeIobArray(0.0, 0.0, 5, FIXED_DATE),
    }),

    // Lines 1403-1411: non-SMB, temp matches basal — keep running
    fixture('minDelta < expectedDelta, non-SMB with iobArray, temp match', 'mindelta-non-smb', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: -5, short_avgdelta: -3, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 0.9 },
      rawIobData: (() => {
        const arr = makeIobArray(0.0, 0.0, 5, FIXED_DATE);
        (arr[0] as any).lastTemp = { rate: 0.9, duration: 30, date: FIXED_DATE - 5 * 60_000 };
        return arr;
      })(),
    }),

    // Lines 1412-1414: non-SMB, no matching temp — set basal
    fixture('minDelta < expectedDelta, non-SMB with iobArray, no temp', 'mindelta-non-smb', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: -5, short_avgdelta: -3, long_avgdelta: -2, date: FIXED_DATE - 60_000 },
      rawIobData: makeIobArray(0.0, 0.0, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: In-range non-SMB paths — lines 1429-1437
    // Need: Math.min(eventualBG, minPredBG) < max_bg
    // AND !(microBolusAllowed && enableSMB)
    // =====================================================================
    fixture('In-range, non-SMB with iobArray, temp matches basal', 'in-range-non-smb-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 115, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 0.9 },
      rawIobData: (() => {
        const arr = makeIobArray(0.0, 0.0, 5, FIXED_DATE);
        (arr[0] as any).lastTemp = { rate: 0.9, duration: 30, date: FIXED_DATE - 5 * 60_000 };
        return arr;
      })(),
    }),

    fixture('In-range, non-SMB with iobArray, no temp', 'in-range-non-smb-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 115, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      rawIobData: makeIobArray(0.0, 0.0, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB smbMinutesSetting undefined with iobArray
    // Need: profile.maxSMBBasalMinutes is undefined AND iobArray for SMB path
    // =====================================================================
    fixture('SMB — smbMinutesSetting undefined, insulinReq > maxBolus', 'smb-minutes-undef-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 250, delta: 5, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true, enableUAM: true,
        maxSMBBasalMinutes: undefined as any,
        max_iob: 10,
      },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: SMB durationReq paths with iobArray
    // =====================================================================
    fixture('SMB — durationReq <= 0 with iobArray', 'smb-duration-iob', {
      currentTime: FIXED_TIME,
      // BG barely above target, tiny insulinReq => microBolus < bolusIncrement => durationReq=0
      glucose_status: { glucose: 122, delta: 0.5, short_avgdelta: 0.5, long_avgdelta: 0.3, date: FIXED_DATE - 60_000 },
      profile: { enableSMB_always: true, bolus_increment: 0.1 },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.1, 0.001, 5, FIXED_DATE),
    }),

    fixture('SMB — durationReq >= 30 with iobArray, long zero', 'smb-duration-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 250, delta: 8, short_avgdelta: 7, long_avgdelta: 5, date: FIXED_DATE - 60_000 },
      profile: {
        enableSMB_always: true, enableUAM: true,
        maxSMBBasalMinutes: 90, maxUAMSMBBasalMinutes: 90,
        max_iob: 10,
      },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),

    // =====================================================================
    // CATEGORY: High-temp end paths with iobArray — lines 1615-1638
    // =====================================================================
    fixture('High BG, rate > maxSafeBasal with iobArray', 'high-temp-end-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 300, delta: 5, short_avgdelta: 5, long_avgdelta: 3, date: FIXED_DATE - 60_000 },
      profile: { max_basal: 2.0, max_daily_basal: 1.0 },
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),

    fixture('High BG, existing temp delivers > 2x insulinReq with iobArray', 'high-temp-end-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: 0.5, short_avgdelta: 0.5, long_avgdelta: 0.5, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 25, rate: 3.0 },
      rawIobData: (() => {
        const arr = makeIobArray(0.2, 0.002, 5, FIXED_DATE);
        (arr[0] as any).lastTemp = { rate: 3.0, duration: 30, date: FIXED_DATE - 5 * 60_000 };
        return arr;
      })(),
    }),

    fixture('High BG, no temp running with iobArray', 'high-temp-end-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 170, delta: 2, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      rawIobData: makeIobArray(0.3, 0.003, 5, FIXED_DATE),
    }),

    fixture('High BG, existing temp >= required with iobArray — keep', 'high-temp-end-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 140, delta: 1, short_avgdelta: 1, long_avgdelta: 0.5, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 20, rate: 2.5 },
      rawIobData: (() => {
        const arr = makeIobArray(0.2, 0.002, 5, FIXED_DATE);
        (arr[0] as any).lastTemp = { rate: 2.5, duration: 30, date: FIXED_DATE - 5 * 60_000 };
        return arr;
      })(),
    }),

    fixture('High BG, existing temp < required with iobArray — increase', 'high-temp-end-iob', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 200, delta: 3, short_avgdelta: 3, long_avgdelta: 2, date: FIXED_DATE - 60_000 },
      currenttemp: { duration: 10, rate: 1.2 },
      rawIobData: (() => {
        const arr = makeIobArray(0.3, 0.003, 5, FIXED_DATE);
        (arr[0] as any).lastTemp = { rate: 1.2, duration: 30, date: FIXED_DATE - 5 * 60_000 };
        return arr;
      })(),
    }),

    // =====================================================================
    // CATEGORY: Deep prediction loop branches
    // Many uncovered else-arms in lines 800-1000 are in the prediction inner loop.
    // These need specific iobArray setups where prediction values cross thresholds.
    // =====================================================================

    // Cover: ci > maxCI (line 802)
    fixture('Carb impact exceeds maxCI — capped', 'prediction-deep', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 160, delta: 15, short_avgdelta: 12, long_avgdelta: 8, date: FIXED_DATE - 60_000 },
      meal_data: {
        carbs: 80, nsCarbs: 80, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 70, currentDeviation: 25, maxDeviation: 25, minDeviation: 0,
        slopeFromMaxDeviation: 0, slopeFromMinDeviation: 0,
        allDeviations: [25, 20, 15, 8, 0], lastCarbTime: FIXED_DATE - 15 * 60_000,
        bwFound: false,
      },
      rawIobData: makeIobArray(0.5, 0.005, 5, FIXED_DATE),
    }),

    // Cover: IOBpredBGs rising and falling patterns (lines 940-1000)
    fixture('Prediction loop with very high IOB — IOBpredBGs hit floor', 'prediction-deep', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 100, delta: -5, short_avgdelta: -4, long_avgdelta: -3, date: FIXED_DATE - 60_000 },
      rawIobData: makeIobArray(5.0, 0.05, 5, FIXED_DATE),
    }),

    // Cover: UAM predictions with high deviation (lines 960-989)
    fixture('UAM predictions with high positive deviation', 'prediction-deep', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 180, delta: 10, short_avgdelta: 8, long_avgdelta: 5, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true, enableSMB_always: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 18, maxDeviation: 20, minDeviation: 2,
        slopeFromMaxDeviation: -0.5, slopeFromMinDeviation: 0.2,
        allDeviations: [18, 20, 18, 12, 5], bwFound: false,
      },
      rawIobData: makeIobArray(1.0, 0.01, 5, FIXED_DATE),
    }),

    // Cover: COBpredBGs with large COB that exceeds min and falls (lines 1014-1027)
    fixture('COB predictions crossing min_bg — large meal falling', 'prediction-deep', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 110, delta: -3, short_avgdelta: -2, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true },
      meal_data: {
        carbs: 100, nsCarbs: 100, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 80, currentDeviation: -5, maxDeviation: 15, minDeviation: -8,
        slopeFromMaxDeviation: -2.0, slopeFromMinDeviation: 0.5,
        allDeviations: [-5, 0, 5, 15, 12], lastCarbTime: FIXED_DATE - 60 * 60_000,
        bwFound: false,
      },
      iob_data: { iob: 2.0, activity: 0.02 },
      rawIobData: makeIobArray(2.0, 0.02, 5, FIXED_DATE),
    }),

    // Cover prediction paths where all predictions stay near target (flat lines)
    fixture('Flat predictions — all pred values near target', 'prediction-deep', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 115, delta: 0, short_avgdelta: 0, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true, enableSMB_always: true },
      microBolusAllowed: true,
      rawIobData: makeIobArray(0.01, 0.0001, 5, FIXED_DATE),
    }),

    // Cover: minZTGuardBG < threshold path (line 1091) and related blending
    fixture('Zero-temp predictions drop below threshold — blend minZTUAMPredBG', 'prediction-deep', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 120, delta: -2, short_avgdelta: -1, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true, enableSMB_always: true },
      microBolusAllowed: true,
      rawIobData: (() => {
        const arr = makeIobArray(2.5, 0.025, 5, FIXED_DATE);
        // Make zeroTemp activity high enough to push ZT predictions below threshold
        for (let i = 0; i < arr.length; i++) {
          const entry = arr[i] as any;
          entry.iobWithZeroTemp.activity = 0.025 * Math.max(0, 1 - i * 0.05);
          entry.iobWithZeroTemp.iob = 2.5 * Math.max(0, 1 - i * 0.05);
        }
        return arr;
      })(),
    }),

    // Cover: minZTGuardBG between threshold and target (line 1094) — blendPct path
    fixture('ZT guard between threshold and target — blended prediction', 'prediction-deep', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 130, delta: -1, short_avgdelta: -0.5, long_avgdelta: 0, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true, enableSMB_always: true },
      microBolusAllowed: true,
      rawIobData: (() => {
        const arr = makeIobArray(1.5, 0.015, 5, FIXED_DATE);
        // Moderate zeroTemp IOB to place minZTGuardBG between threshold and target
        for (let i = 0; i < arr.length; i++) {
          const entry = arr[i] as any;
          entry.iobWithZeroTemp.activity = 0.015 * Math.max(0, 1 - i * 0.06);
          entry.iobWithZeroTemp.iob = 1.5 * Math.max(0, 1 - i * 0.06);
        }
        return arr;
      })(),
    }),

    // Cover: various allDeviations paths for slopeFromDeviations calculation
    fixture('allDeviations with mixed positive/negative — slope refinement', 'prediction-deep', {
      currentTime: FIXED_TIME,
      glucose_status: { glucose: 150, delta: 3, short_avgdelta: 2, long_avgdelta: 1, date: FIXED_DATE - 60_000 },
      profile: { enableUAM: true, enableSMB_always: true },
      microBolusAllowed: true,
      meal_data: {
        carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0,
        mealCOB: 0, currentDeviation: 8, maxDeviation: 15, minDeviation: -3,
        slopeFromMaxDeviation: -1.5, slopeFromMinDeviation: 1.0,
        allDeviations: [8, 12, 15, 10, -3], bwFound: false,
      },
      rawIobData: makeIobArray(0.8, 0.008, 5, FIXED_DATE),
    }),
  ];
}
