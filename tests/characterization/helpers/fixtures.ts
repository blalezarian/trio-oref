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
  } = {},
): FixtureSpec {
  return {
    name,
    category,
    input: {
      glucose_status: defaultGlucoseStatus(overrides.glucose_status),
      currenttemp: defaultCurrentTemp(overrides.currenttemp),
      iob_data: defaultIOBData(overrides.iob_data),
      meal_data: defaultMealData(overrides.meal_data),
      profile: defaultProfile(overrides.profile),
      autosens_data: defaultAutosensData(overrides.autosens_data),
      trio_custom_variables: defaultTrioCustomVariables(overrides.trio_custom_variables),
      preferences: defaultPreferences(overrides.preferences),
      microBolusAllowed: overrides.microBolusAllowed ?? false,
      currentTime: overrides.currentTime ?? new Date().toISOString(),
      basalprofile: defaultBasalProfile(),
      reservoir_data: 100,
      pumphistory: [],
      middleWare: undefined,
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
  ];
}
