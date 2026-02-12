/**
 * Characterization tests for determine-basal.
 *
 * These tests capture the EXACT current behavior of the JS algorithm.
 * Any change that alters the algorithm's output will cause a snapshot
 * mismatch, forcing explicit review before acceptance.
 *
 * SAFETY: This is the primary safety net for the TypeScript refactor.
 * Do not update snapshots without understanding why they changed.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { generateAllFixtures } from '../helpers/fixtures.js';
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
} from '../helpers/defaults.js';

// Use createRequire to load the JS modules in CJS mode.
// The original JS uses implicit globals (e.g. `tdd_before = tdd`) which
// only work in CJS sloppy mode — ESM import would run them in strict mode
// and throw ReferenceError.
const require = createRequire(import.meta.url);
const determine_basal = require('../../../lib/determine-basal/determine-basal');
const tempBasalFunctions = require('../../../lib/basal-set-temp');

/**
 * Normalize the output for stable snapshots:
 * - Dates are converted to ISO strings
 * - Numbers are rounded to avoid floating point noise
 * - The 'deliverAt' timestamp is replaced with a stable placeholder
 */
function normalizeOutput(output: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...output };

  // Replace deliverAt with stable value (it's always "now" which varies per run)
  if (normalized.deliverAt instanceof Date) {
    normalized.deliverAt = '[DELIVER_AT]';
  } else if (typeof normalized.deliverAt === 'string') {
    normalized.deliverAt = '[DELIVER_AT]';
  }

  // Round floating-point fields to avoid platform-specific precision issues
  for (const key of Object.keys(normalized)) {
    const val = normalized[key];
    if (typeof val === 'number' && !Number.isInteger(val)) {
      normalized[key] = Math.round(val * 10000) / 10000;
    }
  }

  // Normalize predBGs arrays (round each value)
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

// Generate all fixtures
const fixtures = generateAllFixtures();

// Group fixtures by category for organized test output
const categories = new Map<string, typeof fixtures>();
for (const f of fixtures) {
  const group = categories.get(f.category) ?? [];
  group.push(f);
  categories.set(f.category, group);
}

describe('determine-basal characterization tests', () => {
  for (const [category, categoryFixtures] of categories) {
    describe(category, () => {
      for (const f of categoryFixtures) {
        it(f.name, () => {
          const {
            glucose_status,
            currenttemp,
            iob_data,
            profile,
            autosens_data,
            meal_data,
            microBolusAllowed,
            reservoir_data,
            currentTime,
            pumphistory,
            preferences,
            basalprofile,
            trio_custom_variables,
            middleWare,
          } = f.input;

          const output = determine_basal(
            glucose_status,
            currenttemp,
            iob_data,
            profile,
            autosens_data,
            meal_data,
            tempBasalFunctions,
            microBolusAllowed,
            reservoir_data,
            currentTime,
            pumphistory,
            preferences,
            basalprofile,
            trio_custom_variables,
            middleWare,
          );

          const normalized = normalizeOutput(output);
          expect(normalized).toMatchSnapshot();
        });
      }
    });
  }
});

// =========================================================================
// ERROR PATH TESTS — called directly (not through fixtures) because these
// require undefined/missing inputs that fixtures can't represent.
// These cover lines: 381-382, 489-494, 648-649, 660, 718-719
// =========================================================================

/** Helper to build a minimal valid call with selective overrides.
 * Fields explicitly set to `undefined` via `_raw_*` keys bypass the null-coalescing defaults. */
function callDetermineBasal(overrides: {
  glucose_status?: any;
  currenttemp?: any;
  iob_data?: any;
  /** When true, pass iob_data as-is (even if undefined) instead of falling back to defaults */
  iob_data_raw?: boolean;
  profile?: any;
  /** When true, pass profile as-is (even if undefined) */
  profile_raw?: boolean;
  autosens_data?: any;
  /** When true, pass autosens_data as-is (even if undefined) */
  autosens_data_raw?: boolean;
  meal_data?: any;
  microBolusAllowed?: boolean;
  reservoir_data?: number;
  currentTime?: string | null;
  /** When true, pass currentTime as-is (even if undefined/null) */
  currentTime_raw?: boolean;
  preferences?: any;
  trio_custom_variables?: any;
  middleWare?: any;
}) {
  const FIXED_TIME = '2025-01-15T12:00:00.000Z';
  const FIXED_DATE = new Date(FIXED_TIME).getTime();

  return determine_basal(
    overrides.glucose_status ?? defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
    overrides.currenttemp ?? defaultCurrentTemp(),
    overrides.iob_data_raw ? overrides.iob_data : (overrides.iob_data ?? defaultIOBData()),
    overrides.profile_raw ? overrides.profile : (overrides.profile ?? defaultProfile()),
    overrides.autosens_data_raw ? overrides.autosens_data : (overrides.autosens_data ?? defaultAutosensData()),
    overrides.meal_data ?? defaultMealData(),
    tempBasalFunctions,
    overrides.microBolusAllowed ?? false,
    overrides.reservoir_data ?? 100,
    overrides.currentTime_raw ? overrides.currentTime : (overrides.currentTime ?? FIXED_TIME),
    [],
    overrides.preferences ?? defaultPreferences(),
    defaultBasalProfile(),
    overrides.trio_custom_variables ?? defaultTrioCustomVariables(),
    overrides.middleWare,
  );
}

describe('determine-basal error path tests', () => {
  // Lines 155-157: undefined profile — early guard returns error before reaching
  // the dynamic ratios section (previously crashed at line 143 before the guard
  // at line 395 could handle it).
  it('returns error when profile is undefined', () => {
    const output = callDetermineBasal({ profile: undefined, profile_raw: true });
    expect(output).toEqual({ error: 'Error: could not get current basal rate' });
  });

  // Lines 381-382: profile without current_basal
  it('returns error when profile.current_basal is undefined', () => {
    const profile = defaultProfile();
    delete (profile as any).current_basal;
    const output = callDetermineBasal({ profile });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 648-649: iob_data undefined
  it('returns error when iob_data is undefined', () => {
    const FIXED_TIME = '2025-01-15T12:00:00.000Z';
    const FIXED_DATE = new Date(FIXED_TIME).getTime();
    const output = callDetermineBasal({
      iob_data: undefined,
      iob_data_raw: true,
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 660: iob_data missing activity property
  it('returns error when iob_data.activity is undefined', () => {
    const FIXED_TIME = '2025-01-15T12:00:00.000Z';
    const FIXED_DATE = new Date(FIXED_TIME).getTime();
    const iobData = { iob: 1.0 }; // missing activity
    const output = callDetermineBasal({
      iob_data: iobData,
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 660: iob_data missing iob property
  it('returns error when iob_data.iob is undefined', () => {
    const FIXED_TIME = '2025-01-15T12:00:00.000Z';
    const FIXED_DATE = new Date(FIXED_TIME).getTime();
    const iobData = { activity: 0.01 }; // missing iob
    const output = callDetermineBasal({
      iob_data: iobData,
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 489-494: profileTarget undefined (profile.min_bg undefined)
  it('returns error when profile.min_bg is undefined (profileTarget undefined)', () => {
    const FIXED_TIME = '2025-01-15T12:00:00.000Z';
    const FIXED_DATE = new Date(FIXED_TIME).getTime();
    const profile = defaultProfile();
    delete (profile as any).min_bg;
    const output = callDetermineBasal({
      profile,
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 718-719: eventualBG is NaN (glucose_status with NaN delta)
  it('returns error when eventualBG is NaN due to NaN delta', () => {
    const FIXED_TIME = '2025-01-15T12:00:00.000Z';
    const FIXED_DATE = new Date(FIXED_TIME).getTime();
    const output = callDetermineBasal({
      glucose_status: {
        glucose: 120,
        delta: NaN,
        short_avgdelta: NaN,
        long_avgdelta: NaN,
        date: FIXED_DATE - 60_000,
        noise: 1,
        device: 'fakecgm',
      },
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });
});

// =========================================================================
// BRANCH COVERAGE TESTS — target specific uncovered false/else branches
// by passing edge-case inputs that the fixture system cannot represent.
// =========================================================================

describe('determine-basal branch coverage tests', () => {
  const FIXED_TIME = '2025-01-15T12:00:00.000Z';
  const FIXED_DATE = new Date(FIXED_TIME).getTime();

  // Line 167: if (currentTime) — false branch: pass undefined currentTime
  it('uses system time when currentTime is undefined', () => {
    const output = callDetermineBasal({
      currentTime: undefined as any,
      currentTime_raw: true,
      glucose_status: defaultGlucoseStatus({ date: Date.now() - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 167: if (currentTime) — false branch: pass null currentTime
  it('uses system time when currentTime is null', () => {
    const output = callDetermineBasal({
      currentTime: null,
      currentTime_raw: true,
      glucose_status: defaultGlucoseStatus({ date: Date.now() - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 528/634: if (typeof autosens_data !== 'undefined' && autosens_data) — false
  it('handles undefined autosens_data', () => {
    const output = callDetermineBasal({
      autosens_data: undefined,
      autosens_data_raw: true,
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 528/634: autosens_data is null
  it('handles null autosens_data', () => {
    const output = callDetermineBasal({
      autosens_data: null,
      autosens_data_raw: true,
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 425: if (glucose_status.device == "fakecgm") — false: non-fakecgm device
  // Need BG > 60, delta=0, short_avgdelta and long_avgdelta near 0 to enter line 424
  it('handles unchanged CGM data with non-fakecgm device', () => {
    const output = callDetermineBasal({
      glucose_status: {
        glucose: 115,
        delta: 0,
        short_avgdelta: 0,
        long_avgdelta: 0,
        date: FIXED_DATE - 60_000,
        noise: 1,
        device: 'G6',
      },
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 291: if (dynISFenabled) — false: dynISF disabled when entering this block
  // This is already covered when useNewFormula=false. The false branch means
  // the code after the if is skipped. Already covered by most tests.

  // Line 362: if (dynISFenabled && !profile.tddAdjBasal) — false branch
  // Need dynISFenabled=true but profile.tddAdjBasal=true
  // This is already covered by the tdd-basal fixtures, but ensure the false branch:
  it('dynISF enabled with tddAdjBasal true — skips line 362', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 150, date: FIXED_DATE - 60_000 }),
      profile: defaultProfile({
        useNewFormula: true,
        tddAdjBasal: true,
        autosens_min: 0.7,
        autosens_max: 1.2,
      }),
      preferences: defaultPreferences({ useNewFormula: true }),
      trio_custom_variables: defaultTrioCustomVariables({
        currentTDD: 40,
        weightedAverage: 40,
        average_total_data: 40,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 483/486: typeof profile.max_bg/enableSMB_high_bg_target undefined
  // Already tested with min_bg undefined. Add max_bg undefined:
  it('handles undefined profile.max_bg', () => {
    const profile = defaultProfile();
    delete (profile as any).max_bg;
    const output = callDetermineBasal({
      profile,
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 486: typeof profile.enableSMB_high_bg_target undefined
  it('handles undefined profile.enableSMB_high_bg_target', () => {
    const profile = defaultProfile();
    delete (profile as any).enableSMB_high_bg_target;
    const output = callDetermineBasal({
      profile,
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 389: if (trio_custom_variables.useOverride) — false
  // Already covered by most tests. The false branch just skips the override log.

  // Line 421: if (bg <= 10 || bg === 38 || noise >= 3) — false
  // Need bg > 10, bg !== 38, noise < 3. Already covered by normal tests.

  // Lines 685/700/703: prediction loop conditions
  // Line 685: if (typeof iob_data.lastTemp !== 'undefined') — false branch:
  // iob_data without lastTemp
  it('handles iob_data without lastTemp', () => {
    const iobData = defaultIOBData();
    delete (iobData as any).lastTemp;
    const output = callDetermineBasal({
      iob_data: iobData,
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 700: if (deviation < 0) with deviation going through all three fallback chains
  // Need: initial deviation < 0, then minAvgDelta-bgi also < 0, then long_avgdelta-bgi also < 0
  it('deviation falls through all three negative fallback chains', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 115,
        delta: -2,
        short_avgdelta: -3,
        long_avgdelta: -4,
        date: FIXED_DATE - 60_000,
      }),
      iob_data: defaultIOBData({ iob: -0.5, activity: -0.005 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 802: if (ci > maxCI) — false branch: ci <= maxCI (most tests already do this)
  // Line 808: if (sensitivityRatio) — false branch: sensitivityRatio is falsy
  // This would need sensitivityRatio = 0, which happens when autosens_data.ratio is somehow 0

  // Line 815: if (meal_data.carbs) — false branch: no carbs (already covered by default)

  // Lines 837/838: remainingCarbsCap/remainingCarbsFraction conditions
  // false branches: profile.remainingCarbsCap and profile.remainingCarbsFraction are 0/falsy
  it('handles falsy remainingCarbsCap and remainingCarbsFraction', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
      profile: defaultProfile({
        remainingCarbsCap: 0,
        remainingCarbsFraction: 0,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 940: inner prediction loop — IOBpredBG checks
  // Line 960: UAMpredBG checks
  // Line 965/977: UAM duration/prediction floor checks
  // These are deep inner loop conditions that need specific iobArray data.
  // Most require the prediction value to go below threshold or min_bg.

  // Line 1014: if (meal_data.mealCOB > 0 && (ci > 0 || remainingCIpeak > 0)) — false
  // Need: mealCOB = 0 OR (ci <= 0 AND remainingCIpeak <= 0). Already covered by no-meal tests.

  // Lines 1069/1102/1126/1139/1145/1161/1170: always true due to iobArray predictions
  // These are: if (minZTGuardBG > avgPredBG), if (minZTGuardBG > minUAMPredBG), etc.
  // The false branches mean these conditions don't hold for some specific data.

  // Line 1221: if (typeof profile.maxDelta_bg_threshold === 'undefined') — false
  // Already covered by most tests since profile has this value.

  // Line 1224: if (typeof profile.maxDelta_bg_threshold !== 'undefined') — false
  // Would need profile.maxDelta_bg_threshold undefined. Test:
  it('handles undefined maxDelta_bg_threshold', () => {
    const profile = defaultProfile();
    delete (profile as any).maxDelta_bg_threshold;
    const output = callDetermineBasal({
      profile,
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 532: if (overrideTarget !== 0 && overrideTarget !== 6 && overrideTarget !== profile.min_bg && !profile.temptargetSet)
  // false branch: overrideTarget == 0 or == 6 or == profile.min_bg or temptargetSet
  // Test overrideTarget = 6 (excluded value):
  it('override target of 6 is excluded from override target setting', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
      trio_custom_variables: defaultTrioCustomVariables({
        useOverride: true,
        overridePercentage: 100,
        overrideTarget: 6,
        isfAndCr: false,
        duration: 0,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 541: if (sensitivityRatio < newRatio) — false: sensitivityRatio >= newRatio
  // Need dynISF with low TT where sensitivityRatio >= newRatio
  it('dynISF with low TT, sensitivityRatio >= newRatio — no boost', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 140,
        delta: 0,
        short_avgdelta: 0,
        long_avgdelta: 0,
        date: FIXED_DATE - 60_000,
      }),
      profile: defaultProfile({
        temptargetSet: true,
        min_bg: 80,
        max_bg: 80,
        low_temptarget_lowers_sensitivity: true,
        half_basal_exercise_target: 160,
        useNewFormula: true,
        autosens_min: 0.5,
        autosens_max: 1.2, // low max so newRatio gets capped low
      }),
      preferences: defaultPreferences({
        useNewFormula: true,
        adjustmentFactor: 0.3, // very low so newRatio is small
        sigmoid: false,
      }),
      trio_custom_variables: defaultTrioCustomVariables({
        currentTDD: 40,
        weightedAverage: 40,
        average_total_data: 40,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 560: if (dynISFenabled && profile.tddAdjBasal) — false when dynISF on but tddAdjBasal off
  // Already covered. The false branch enters line 560 itself.

  // Line 563: if (average_total_data > 0) — false: average_total_data = 0
  // Already tested by 'TDD-adjusted basal with zero average_total_data'

  // Line 606: if (glucose_status.noise >= 2) — false: noise < 2
  // Already covered by most tests (noise=1 by default)

  // Lines 1235/1251: carbsReq-related conditions
  // Line 1235: if (minutesAboveThreshold < 240 || minutesAboveMinBG < 60) — false
  // Both conditions must be false: all predictions stay above min_bg for 60min+
  // and above threshold for 240min. Already covered by stable tests.

  // Lines 1297/1300: The core eventualBG < min_bg path
  // These are very hard to trigger with carbsReq=0. Skipping for now.

  // Lines 1382: if (minDelta < expectedDelta) — false
  // This is the main flow after eventualBG >= min_bg with minDelta >= expectedDelta.
  // Already covered by in-range and high-bg tests.

  // Lines 1419: if (Math.min(eventualBG, minPredBG) < max_bg) — false
  // Need both eventualBG and minPredBG >= max_bg. This enters the eventualBG >= max_bg path.
  // Already covered by high-bg tests.

  // Lines 1443: if (eventualBG >= max_bg) — false
  // Need eventualBG < max_bg. Already covered by in-range tests.

  // Line 982: if (minPredBG < min_bg) within prediction loop
  // Need prediction to stay above min_bg at all times

  // Line 307: if (maxLimitChris == 1) — false: maxLimitChris != 1
  // Already covered by most dynISF tests.

  // Line 333: if (newRatio < minLimitChris) — false: newRatio >= minLimitChris
  // Already covered by most dynISF tests.

  // Line 183: if (cr_) — false: cr_ is false
  it('override with isfAndCr false, cr false, isf true — CR not divided', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 160, date: FIXED_DATE - 60_000 }),
      trio_custom_variables: defaultTrioCustomVariables({
        useOverride: true,
        overridePercentage: 120,
        isfAndCr: false,
        isf: true,
        cr: false,
        duration: 30,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 184: if (isf) — false: isf is false
  it('override with isfAndCr false, cr true, isf false — ISF not divided', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 160, date: FIXED_DATE - 60_000 }),
      trio_custom_variables: defaultTrioCustomVariables({
        useOverride: true,
        overridePercentage: 80,
        isfAndCr: false,
        isf: false,
        cr: true,
        duration: 30,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 184: both isf and cr false
  it('override with isfAndCr false, both cr and isf false — nothing divided', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 160, date: FIXED_DATE - 60_000 }),
      trio_custom_variables: defaultTrioCustomVariables({
        useOverride: true,
        overridePercentage: 120,
        isfAndCr: false,
        isf: false,
        cr: false,
        duration: 30,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 66: startTime == endTime && currentHour == startTime — SMB scheduling
  // Note: enable_smb is called only when microBolusAllowed && enableSMB criteria pass
  // We need smbIsScheduledOff=true, startTime==endTime, and currentHour==startTime
  it('SMB scheduling: startTime == endTime == currentHour disables SMB', () => {
    const localHour = new Date(FIXED_DATE).getHours();
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 180, date: FIXED_DATE - 60_000 }),
      microBolusAllowed: true,
      profile: defaultProfile({
        enableSMB_always: true,
      }),
      trio_custom_variables: defaultTrioCustomVariables({
        smbIsScheduledOff: true,
        start: localHour,
        end: localHour,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 576: sensitivity_raises_target with autosens_data.ratio < 1
  it('sensitivity_raises_target with low autosens ratio adjusts target', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 115, date: FIXED_DATE - 60_000 }),
      profile: defaultProfile({
        sensitivity_raises_target: true,
        resistance_lowers_target: false,
        temptargetSet: false,
      }),
      autosens_data: defaultAutosensData({ ratio: 0.8 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 576: resistance_lowers_target with autosens_data.ratio > 1
  it('resistance_lowers_target with high autosens ratio adjusts target', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 150, date: FIXED_DATE - 60_000 }),
      profile: defaultProfile({
        sensitivity_raises_target: false,
        resistance_lowers_target: true,
        temptargetSet: false,
      }),
      autosens_data: defaultAutosensData({ ratio: 1.15 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 606: noise >= 2 path — raise target for noisy CGM
  it('noisy CGM data (noise=2) raises target BG', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 120,
        noise: 2,
        date: FIXED_DATE - 60_000,
      }),
      profile: defaultProfile({ noisyCGMTargetMultiplier: 1.3 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 655: iob_data.length <= 1 (single element, not array) — false branch
  // When iob_data is a single object (not array), typeof(iob_data.length) is undefined
  // This is already covered by default tests. But ensure the inner false branch:
  it('iob_data as single object (not array) enters length check false branch', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
      iob_data: defaultIOBData(), // single object, not array
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 802/808: meal_data.carbs > 0 path with COB — ci > maxCI and sensitivityRatio adjustments
  it('meal with COB triggers carb impact paths', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 150,
        delta: 5,
        short_avgdelta: 4,
        long_avgdelta: 3,
        date: FIXED_DATE - 60_000,
      }),
      meal_data: defaultMealData({
        carbs: 60,
        mealCOB: 40,
        lastCarbTime: FIXED_DATE - 30 * 60_000,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1285: skip_neutral_temps with deliverAt near top of hour
  // Need profile.skip_neutral_temps=true and deliverAt.getMinutes() >= 55
  // Set currentTime so that minutes >= 55
  it('skip_neutral_temps at 55+ minutes past hour cancels temp (non-SMB)', () => {
    const nearTopOfHour = '2025-01-15T12:57:00.000Z';
    const nearTopDate = new Date(nearTopOfHour).getTime();
    const output = callDetermineBasal({
      currentTime: nearTopOfHour,
      glucose_status: defaultGlucoseStatus({
        glucose: 115,
        date: nearTopDate - 60_000,
      }),
      profile: defaultProfile({ skip_neutral_temps: true }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1285: skip_neutral_temps with SMBs enabled — should NOT skip
  it('skip_neutral_temps at 55+ minutes with SMBs enabled — continues', () => {
    const nearTopOfHour = '2025-01-15T12:57:00.000Z';
    const nearTopDate = new Date(nearTopOfHour).getTime();
    const output = callDetermineBasal({
      currentTime: nearTopOfHour,
      microBolusAllowed: true,
      glucose_status: defaultGlucoseStatus({
        glucose: 180,
        delta: 3,
        short_avgdelta: 3,
        long_avgdelta: 3,
        date: nearTopDate - 60_000,
      }),
      profile: defaultProfile({
        skip_neutral_temps: true,
        enableSMB_always: true,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1297-1318: eventualBG < min_bg, rising, !carbsReq path
  // Need: eventualBG < min_bg, minDelta > expectedDelta, minDelta > 0, carbsReq = 0
  // carbsReq = (bgUndershoot - zeroTempEffect) / csf - COBforCarbsReq
  // bgUndershoot = threshold - carbsReqBG where carbsReqBG = naive_eventualBG (if > 40)
  // For carbsReq to be 0: bgUndershoot - zeroTempEffect must be ~0
  // Need: threshold ~ naive_eventualBG + zeroTempEffect/csf
  // With sens=40, bg=109, iob=0, eventualBG slightly < min_bg=110
  // deviation = 30/5 * (minDelta - bgi) with bgi = -activity * sens * 5
  // If activity=0, bgi=0, deviation = 6 * minDelta
  // eventualBG = naive_eventualBG + deviation = bg + deviation (iob=0)
  // For eventualBG < 110: bg + 6*minDelta < 110
  // Need bg < 110 but minDelta > 0, so e.g. bg=106, minDelta=0.5 => eventualBG=109
  // carbsReqBG = naive_eventualBG = 106 (since iob=0)
  // threshold = 75 (110 - 0.5*(110-40))
  // bgUndershoot = 75 - 106 = -31
  // zeroTempEffect = 0.9 * 40 * 240/60 = 144 (with minutesAboveThreshold=240)
  // carbsReq = (-31 - 144) / (40/10) - 0 = -175/4 = -43.75 -> -44 (truthy!)
  // The problem is that carbsReq is always truthy because zeroTempEffect is huge.
  // To make carbsReq=0, need bgUndershoot - zeroTempEffect to be close to 0
  // That means bgUndershoot ~ zeroTempEffect, i.e., threshold - naive_eventualBG ~ zeroTempEffect
  // zeroTempEffect = 0.9*1*40*240/60 = 144
  // threshold - naive_eventualBG = 144 => naive_eventualBG = 75 - 144 = -69
  // That's impossible since BG can't be negative. So carbsReq is always negative (truthy).
  // The ONLY way to make !carbsReq true is if carbsReq rounds to 0.
  // carbsReq = (bgUndershoot - zeroTempEffect) / csf = (-31 - 144)/4 = -43.75
  // We need the numerator to be between -0.5*csf and 0.5*csf (so it rounds to 0)
  // (bgUndershoot - zeroTempEffect) must be between -2 and 2
  // bgUndershoot = threshold - naive_eventualBG = 75 - naive_eventualBG
  // zeroTempEffect = basal*sens*minutesAboveThreshold/60
  // If minutesAboveThreshold is small (say 5), zeroTempEffect = 0.9*40*5/60 = 3
  // Then bgUndershoot must be ~3, meaning naive_eventualBG ~ 72
  // But for eventualBG < min_bg=110 with positive minDelta:
  // eventualBG = naive_eventualBG + 6*minDelta = 72 + 6*0.1 = 72.6 < 110 ✓
  // minutesAboveThreshold = 5 means IOBpredBGs[1] < threshold (bg after 5min < threshold)
  // That requires IOBpredBG to be < 75 quickly, meaning bg must be near 75
  // And bg < threshold triggers LGS at line 1261/1265!
  // So bg=72 would trigger bg < threshold at line 1265.
  // We need bg >= threshold AND naive_eventualBG near threshold for carbsReq~0
  // If bg=75 (== threshold), bg < threshold is false, but minGuardBG < threshold could still trigger
  // With no iobArray (prediction loop catches exception), minGuardBG = minIOBGuardBG = 999
  // So minGuardBG = 999 > threshold, and we skip LGS!
  // naive_eventualBG = 75 (iob=0), threshold=75, bgUndershoot=0
  // zeroTempEffect: minutesAboveThreshold. IOBpredBGs from catch path = [eventualBG]?
  // Actually without iobArray, the try/catch means IOBpredBGs = [bg], ZTpredBGs = [bg]
  // minutesAboveMinBG: bg=75 < min_bg=110 => minutesAboveMinBG=0
  // minutesAboveThreshold: bg=75 >= threshold=75 => stays 240
  // zeroTempEffect = 0.9*40*240/60 = 144
  // carbsReq = (0 - 144)/4 = -36 (truthy)
  // Still can't get carbsReq=0. The zero temp effect always dominates.

  // Alternative: make zeroTempEffect very small by using a very low basal
  // basal = 0.1 U/hr, sens=40, minutesAboveThreshold=240
  // zeroTempEffect = 0.1*40*240/60 = 16
  // bgUndershoot = threshold - naive_eventualBG
  // For carbsReq~0: (bgUndershoot - 16)/csf ~ 0 => bgUndershoot ~ 16
  // naive_eventualBG = threshold - 16 = 75 - 16 = 59
  // But that's below 40, so carbsReqBG = min(minGuardBG, naive_eventualBG)
  // That makes the whole calculation different.
  //
  // Actually carbsReqBG < 40 path: carbsReqBG = min(minGuardBG, carbsReqBG) = min(999, 59) = 59
  // bgUndershoot = 75 - 59 = 16
  // carbsReq = (16 - 16)/csf = 0!
  // Let me verify: bg = 76 (just above threshold), iob = 0 (so bgi=0),
  // minDelta = 0.5, short_avgdelta = 0.5
  // deviation = 6 * 0.5 = 3
  // naive_eventualBG = 76, eventualBG = 76 + 3 = 79
  // threshold = min_bg - 0.5*(min_bg-40) = 110 - 35 = 75
  // But wait, with bg=76 we need bg >= threshold AND eventualBG < min_bg (110)
  // ✓ bg=76 > threshold=75 (or ==, check: bg < threshold is false if bg >= 75)
  // Wait, line 1265: else if (bg < threshold || minGuardBG < threshold)
  // bg=76 >= 75, minGuardBG=999 >= 75 => false ✓
  // eventualBG = 79 < min_bg = 110 ✓
  // minDelta = 0.5 > 0 ✓
  // expectedDelta = bgi + (target_bg - eventualBG)/24 = 0 + (115 - 79)/24 = 1.5
  // minDelta (0.5) > expectedDelta (1.5)? NO! 0.5 < 1.5
  // Need minDelta > expectedDelta. expectedDelta decreases when eventualBG is close to target.
  // eventualBG = 108 => expectedDelta = 0 + (115-108)/24 = 0.29
  // Need bg + 6*minDelta = 108, bg = 76: 76 + 6*minDelta = 108 => minDelta = 5.33
  // minDelta=5.33 > expectedDelta=0.29 ✓, minDelta > 0 ✓
  // naive_eventualBG = 76 (iob=0)
  // carbsReqBG = 76 (> 40)
  // bgUndershoot = 75 - 76 = -1
  // Now, minutesAboveThreshold: IOBpredBGs=[bg] (no iobArray), bg=76 >= threshold=75 => 240
  // zeroTempEffect = 0.1*40*240/60 = 16
  // csf = sens/carbRatio = 40/10 = 4
  // carbsReq = (-1 - 16)/4 = -4.25 => -4 (truthy!)
  // Still non-zero. Need to make it even closer.

  // With current_basal=0.01: zeroTempEffect = 0.01*40*240/60 = 1.6
  // carbsReq = (-1 - 1.6)/4 = -0.65 => -1 (truthy!)
  // With current_basal=0.001: zeroTempEffect = 0.001*40*240/60 = 0.16
  // carbsReq = (-1 - 0.16)/4 = -0.29 => 0!! (rounds to 0)
  // ✓ !carbsReq = !0 = true!

  // But need: minDelta > 0 AND eventualBG < min_bg AND bg >= threshold
  // bg=76, minDelta=5.33, eventualBG=108 < 110, sens=40, basal=0.001
  // Also need glucose_status.delta and short_avgdelta to make minDelta=5.33
  // minDelta = Math.min(delta, short_avgdelta)
  // delta=6, short_avgdelta=5.33 => minDelta=5.33

  it('eventualBG < min_bg, rising, carbsReq==0 — enters neutral temp path (line 1300)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 76,
        delta: 6,
        short_avgdelta: 5.33,
        long_avgdelta: 4,
        date: FIXED_DATE - 60_000,
      }),
      profile: defaultProfile({
        current_basal: 0.001,
        max_daily_basal: 0.001,
        max_basal: 3.5,
        sens: 40,
        carb_ratio: 10,
        min_bg: 110,
        max_bg: 120,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1302: naive_eventualBG < 40 within the carbsReq==0 rising path
  // Need naive_eventualBG < 40. With iob=0, naive_eventualBG = bg = 76 (too high)
  // With iob > 0: naive_eventualBG = bg - iob*sens = 76 - iob*40
  // For naive_eventualBG < 40: iob > (76-40)/40 = 0.9
  // But iob > 0 gives bgi = -activity*sens*5 which changes everything
  // Need activity small so bgi ~0 but iob > 0.9
  // Say iob=1, activity=0.001
  // bgi = -0.001 * 40 * 5 = -0.2
  // naive_eventualBG = 76 - 1*40 = 36 < 40 ✓
  // deviation = 6 * (minDelta - bgi) = 6 * (5.33 - (-0.2)) = 6 * 5.53 = 33.18
  // eventualBG = 36 + 33 = 69 < 110 ✓
  // expectedDelta = bgi + (target_bg - eventualBG)/24 = -0.2 + (115-69)/24 = -0.2+1.92 = 1.72
  // minDelta=5.33 > expectedDelta=1.72 ✓, minDelta > 0 ✓
  // carbsReqBG: naive_eventualBG=36 < 40, carbsReqBG = min(minGuardBG, 36) = min(999,36)=36
  // bgUndershoot = 75 - 36 = 39
  // zeroTempEffect = 0.001*40*240/60 = 0.16
  // carbsReq = (39 - 0.16)/4 = 9.71 => 10 (truthy!)
  // carbsReq > 0 so !carbsReq is false. Need it = 0.
  // The issue is bgUndershoot is now large.
  // To get carbsReq~0: bgUndershoot - zeroTempEffect ~0 => bgUndershoot ~ 0.16
  // threshold - carbsReqBG ~ 0.16 => carbsReqBG ~ threshold - 0.16 ~ 74.84
  // carbsReqBG = min(minGuardBG, naive_eventualBG) when naive_eventualBG < 40
  // naive_eventualBG < 40 but carbsReqBG ~ 75? That requires minGuardBG ~ 75 AND naive_eventualBG < 40 AND minGuardBG < naive_eventualBG
  // But min(minGuardBG, naive_eventualBG) when naive < 40 can't be 75 unless minGuardBG >= 75 and naive >= 75
  // Contradiction. So naive_eventualBG < 40 with carbsReq=0 is very hard to achieve.
  // Skip line 1302 for now.

  // Lines 1306-1317: Within carbsReq==0 path, need glucose_status.delta > minDelta or not
  // Line 1306: if (glucose_status.delta > minDelta) - when delta != short_avgdelta
  // Already covered if we get to line 1300. In the test above, delta=6, short_avgdelta=5.33
  // minDelta = min(6, 5.33) = 5.33, delta=6 > 5.33 => enters line 1306 ✓

  // Line 1311: if (currenttemp.duration > 15 && basal ~= currenttemp.rate)
  // Need currenttemp matching basal to return early
  it('eventualBG < min_bg, rising, carbsReq==0 with matching temp — returns unchanged', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 76,
        delta: 6,
        short_avgdelta: 5.33,
        long_avgdelta: 4,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({
        rate: 0.001,
        duration: 30,
      }),
      profile: defaultProfile({
        current_basal: 0.001,
        max_daily_basal: 0.001,
        max_basal: 3.5,
        sens: 40,
        carb_ratio: 10,
        min_bg: 110,
        max_bg: 120,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1308: delta <= minDelta (they're equal) in the rising carbsReq==0 path
  it('eventualBG < min_bg, rising, carbsReq==0, delta==minDelta — uses Min. Delta', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 76,
        delta: 5.33,
        short_avgdelta: 5.33,
        long_avgdelta: 4,
        date: FIXED_DATE - 60_000,
      }),
      profile: defaultProfile({
        current_basal: 0.001,
        max_daily_basal: 0.001,
        max_basal: 3.5,
        sens: 40,
        carb_ratio: 10,
        min_bg: 110,
        max_bg: 120,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1382-1416: eventualBG >= min_bg but minDelta < expectedDelta, non-SMB mode
  // Need eventualBG >= min_bg, minDelta < expectedDelta
  // bg=115, delta=-2, short_avgdelta=-2, iob=0
  // bgi=0, deviation=6*min(-2,-2) = -12... wait, deviation is recalculated
  // Actually deviation goes through negative fallback:
  // minDelta = min(-2,-2) = -2, minAvgDelta = min(-2, long_avgdelta)
  // deviation = 6*(minDelta - bgi) = 6*(-2 - 0) = -12 (negative)
  // Then: deviation = 6*(minAvgDelta - bgi) where minAvgDelta = min(-2, long_avgdelta)
  // If long_avgdelta = -3: minAvgDelta = -3, deviation = 6*(-3) = -18 (still negative)
  // Then: deviation = 6*(long_avgdelta - bgi) = 6*(-3) = -18
  // eventualBG = 115 + (-18) = 97... wait that's < min_bg=110, so we'd enter line 1297
  // Need eventualBG >= min_bg=110. With bg=125, deviation=-18: eventualBG=107 < 110
  // With bg=130: eventualBG=112 >= 110 ✓
  // expectedDelta = bgi + (target_bg - eventualBG)/24 = 0 + (115-112)/24 = 0.125
  // minDelta = -2 < expectedDelta = 0.125 ✓
  // This enters the minDelta < expectedDelta block (line 1382)

  it('eventualBG >= min_bg, minDelta < expectedDelta, non-SMB — sets neutral temp (line 1388)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 130,
        delta: -2,
        short_avgdelta: -2,
        long_avgdelta: -3,
        date: FIXED_DATE - 60_000,
      }),
      // microBolusAllowed=false (default) means !(microBolusAllowed && enableSMB) = true => enters line 1403
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1389: minDelta >= 0 && expectedDelta > 0 within the minDelta < expectedDelta path
  // Need: minDelta >= 0, expectedDelta > 0, but minDelta < expectedDelta
  // bg=115, delta=0, short_avgdelta=0: minDelta=0
  // With iob > 0: eventualBG = bg - iob*sens + deviation = 115 - 1*40 + 0 = 75
  // Wait, that's < min_bg. Need eventualBG >= min_bg.
  // Let me try: bg=150, iob=0: eventualBG = 150 + deviation
  // deviation: with delta=0.5, short_avgdelta=0.3: minDelta=0.3
  // bgi=0 (activity=0), deviation = 6*0.3 = 1.8 => 2
  // eventualBG = 150 + 2 = 152 > min_bg=110 ✓
  // expectedDelta = 0 + (115 - 152)/24 = -1.54
  // minDelta=0.3 > expectedDelta=-1.54 — so minDelta >= expectedDelta, doesn't enter line 1382!
  // Need minDelta < expectedDelta. That means BG trending down faster than expected.
  // When eventualBG > target_bg, expectedDelta = bgi + (target-eventual)/24 which is negative.
  // So minDelta must be even more negative. But we need minDelta >= 0 for line 1389.
  // This seems contradictory: minDelta >= 0 AND minDelta < expectedDelta AND expectedDelta > 0
  // expectedDelta > 0 means target > eventual, i.e., eventualBG < target_bg
  // With min_bg=110, target_bg=115 (avg of 110,120)
  // eventualBG < 115 and eventualBG >= min_bg=110
  // So 110 <= eventualBG < 115
  // expectedDelta = bgi + (115 - eventualBG)/24 = bgi + (5 to 0)/24
  // If bgi is large enough, expectedDelta > minDelta >= 0
  // With iob=0.5, activity=0.01: bgi = -0.01*40*5 = -2
  // naive_eventualBG = 115 - 0.5*40 = 95
  // deviation: need to be positive to bring eventualBG >= 110
  // eventualBG = 95 + deviation >= 110 => deviation >= 15
  // deviation = 6*(minDelta - bgi) = 6*(minDelta + 2)
  // deviation >= 15 => minDelta >= 0.5
  // eventualBG = 95 + 6*(minDelta+2) = 95 + 6*minDelta + 12 = 107 + 6*minDelta
  // For eventualBG=112: minDelta = (112-107)/6 = 0.83
  // expectedDelta = bgi + (115-112)/24 = -2 + 0.125 = -1.875
  // minDelta=0.83 > -1.875 — doesn't enter line 1382!
  // The problem: when BG is rising (minDelta > 0), expectedDelta is typically more negative.
  // Line 1389 requires: all of minDelta >= 0 && expectedDelta > 0 && minDelta < expectedDelta
  // AND (expectedDelta - minDelta >= 2 || expectedDelta + (-1 * minDelta) >= 2)
  // This seems nearly impossible in practice because expectedDelta > minDelta >= 0 requires
  // very specific conditions where BG is rising but not fast enough to reach target.
  // Skip line 1389 for now.

  // Lines 1403-1416: Within minDelta < expectedDelta, non-SMB path
  // Test with matching current temp (line 1409)
  it('eventualBG >= min_bg, falling, non-SMB, matching temp — returns unchanged', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 130,
        delta: -2,
        short_avgdelta: -2,
        long_avgdelta: -3,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({
        rate: 0.9,  // matches basal
        duration: 20,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1404: glucose_status.delta < minDelta in falling non-SMB path
  // Need delta < short_avgdelta (and both making minDelta=delta)
  // minDelta = min(delta, short_avgdelta)
  // If delta=-3, short_avgdelta=-2: minDelta=-3 (delta < minDelta? No, delta IS minDelta)
  // The condition is glucose_status.delta < minDelta. Since minDelta = min(delta, short_avgdelta),
  // delta can only be < minDelta if... delta < min(delta, short_avgdelta)? That's impossible.
  // Wait, minDelta is computed at line 411 before entering this path.
  // Actually, let me re-check: minDelta = Math.min(glucose_status.delta, glucose_status.short_avgdelta);
  // So delta >= minDelta always. Therefore delta < minDelta is ALWAYS false at line 1404.
  // The only way this branch is TRUE is if delta < minDelta which can't happen by construction.
  // Actually wait — minDelta is always <= delta, so delta < minDelta is always false.
  // This means line 1404 arm 0 (true) can never be reached. Skip it.
  // Line 1404 arm 1 (false) = the else branch (line 1406) is always taken instead.
  // Our test above should cover the else (line 1406/1407).

  // Lines 1419-1437: eventualBG/minPredBG in range, non-SMB path
  // Need eventualBG >= min_bg, minDelta >= expectedDelta (skip line 1382),
  // and Math.min(eventualBG, minPredBG) < max_bg
  // With bg=115, delta=0, iob=0: eventualBG=115, minPredBG~115
  // min(115,115) < max_bg=120 ✓
  // expectedDelta = 0 + (115-115)/24 = 0, minDelta=0 >= 0 ✓ (skip 1382)
  // Non-SMB => enters line 1429

  it('in-range, non-SMB — sets neutral temp (line 1429)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 115,
        delta: 0,
        short_avgdelta: 0,
        long_avgdelta: 0,
        date: FIXED_DATE - 60_000,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1431: in-range with matching temp — returns unchanged
  it('in-range, non-SMB, matching temp — returns unchanged (line 1431)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 115,
        delta: 0,
        short_avgdelta: 0,
        long_avgdelta: 0,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({
        rate: 0.9,
        duration: 20,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1489-1631: SMB calculation paths — need microBolusAllowed && enableSMB && bg > threshold
  // This is the core SMB path with many uncovered branches

  // Line 1489: microBolusAllowed && enableSMB && bg > threshold
  // Need: SMB enabled AND eventualBG >= max_bg (to enter line 1443/1460)
  it('SMB enabled, high BG — enters SMB calculation (line 1489)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 180,
        delta: 3,
        short_avgdelta: 3,
        long_avgdelta: 2,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      profile: defaultProfile({
        enableSMB_always: true,
        maxSMBBasalMinutes: 30,
        maxUAMSMBBasalMinutes: 30,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1502: override with advancedSettings and smbMinutes override
  it('SMB with override advancedSettings and smbMinutes', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 180,
        delta: 3,
        short_avgdelta: 3,
        long_avgdelta: 2,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      profile: defaultProfile({
        enableSMB_always: true,
        maxSMBBasalMinutes: 30,
        maxUAMSMBBasalMinutes: 30,
      }),
      trio_custom_variables: defaultTrioCustomVariables({
        useOverride: true,
        advancedSettings: true,
        smbMinutes: 60,
        uamMinutes: 60,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1506: override with advancedSettings and uamMinutes override (with high IOB for UAM path)
  it('SMB with UAM minutes override and high IOB', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 200,
        delta: 5,
        short_avgdelta: 5,
        long_avgdelta: 4,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      iob_data: defaultIOBData({ iob: 2.0, activity: 0.02, bolusiob: 2.0 }),
      profile: defaultProfile({
        enableSMB_always: true,
        maxSMBBasalMinutes: 30,
        maxUAMSMBBasalMinutes: 30,
      }),
      trio_custom_variables: defaultTrioCustomVariables({
        useOverride: true,
        advancedSettings: true,
        smbMinutes: 60,
        uamMinutes: 45,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1546: smb_delivery_ratio != 0.5
  it('SMB with non-default delivery ratio', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 180,
        delta: 3,
        short_avgdelta: 3,
        long_avgdelta: 2,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      profile: defaultProfile({
        enableSMB_always: true,
        smb_delivery_ratio: 0.8,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1563-1573: durationReq paths
  // durationReq = round(60*worstCaseInsulinReq / profile.current_basal * overrideFactor)
  // worstCaseInsulinReq = (smbTarget - (naive_eventualBG + minIOBPredBG)/2 ) / sens
  // When naive_eventualBG and minIOBPredBG are high (bg well above target):
  // worstCaseInsulinReq < 0 => durationReq < 0 => enters line 1563 (durationReq <= 0)

  it('SMB with negative durationReq — sets durationReq to 0 (line 1563)', () => {
    // High BG close to target so worstCaseInsulinReq is small/negative
    // naive_eventualBG = bg - iob*sens. With bg=130, iob=0.3, sens=40:
    // naive_eventualBG = 130 - 12 = 118. minIOBPredBG = 999 (no iobArray)
    // worstCaseInsulinReq = (115 - (118+999)/2)/40 = (115 - 558.5)/40 = -11.09
    // durationReq = round(60*(-11.09)/0.9*1) = round(-739.3) = -739
    // durationReq <= 0 ✓
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 130,
        delta: 2,
        short_avgdelta: 2,
        long_avgdelta: 1,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      iob_data: defaultIOBData({ iob: 0.3, activity: 0.003 }),
      profile: defaultProfile({
        enableSMB_always: true,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1566: durationReq >= 30 — need large positive durationReq
  // worstCaseInsulinReq positive: smbTarget > (naive_eventualBG + minIOBPredBG)/2
  // Need naive_eventualBG and minIOBPredBG well below target
  // With iobArray, minIOBPredBG can be determined from predictions
  // Without iobArray, minIOBPredBG=999 (catch path), so always negative durationReq
  // Need to use iobArray to get proper minIOBPredBG
  // Let's craft an iobArray where predictions go below target

  it('SMB with durationReq >= 30 — rounds and caps (line 1566)', () => {
    // bg=150 with high IOB causing predictions to drop
    // iobArray: IOB=3, activity=0.03, dia=5
    // naive_eventualBG = 150 - 3*40 = 30
    // IOB predictions will drop significantly
    // minIOBPredBG will be low
    // worstCaseInsulinReq = (115 - (30+low_pred)/2)/40 — positive
    const iobArr = [];
    const now = FIXED_DATE;
    for (let i = 0; i < 48; i++) {
      const t = i * 5;
      const fraction = Math.max(0, 1 - t / (5 * 60));
      iobArr.push({
        iob: +(3 * fraction).toFixed(3),
        activity: +(0.03 * fraction).toFixed(5),
        basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
        time: new Date(now + t * 60000),
        iobWithZeroTemp: {
          iob: +(3 * fraction * 0.5).toFixed(3),
          activity: +(0.03 * fraction * 0.5).toFixed(5),
          basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
          time: new Date(now + t * 60000),
        },
      });
    }
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 150,
        delta: 2,
        short_avgdelta: 2,
        long_avgdelta: 1,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      iob_data: iobArr as any,
      iob_data_raw: true,
      profile: defaultProfile({
        enableSMB_always: true,
        max_iob: 5,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1575-1605: microBolus >= maxBolus, durationReq > 0
  // These are reached in the SMB calculation. The test above should hit some.

  // Line 1585: if (profile.SMBInterval) — false: no SMBInterval
  it('SMB without SMBInterval setting — uses default 3m', () => {
    const profile = defaultProfile({ enableSMB_always: true });
    delete (profile as any).SMBInterval;
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 180,
        delta: 3,
        short_avgdelta: 3,
        long_avgdelta: 2,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      profile,
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1595: if (microBolus > 0) — need microBolus > 0 and lastBolusAge > SMBInterval
  // Already covered when SMB is enabled with high BG

  // Line 1615: if (rate > maxSafeBasal) — need very high rate
  it('rate exceeds maxSafeBasal — gets capped (line 1615)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 300,
        delta: 10,
        short_avgdelta: 10,
        long_avgdelta: 8,
        date: FIXED_DATE - 60_000,
      }),
      profile: defaultProfile({
        max_basal: 2.0,
        max_daily_basal: 1.0,
        current_basal: 0.5,
        max_daily_safety_multiplier: 3,
        current_basal_safety_multiplier: 4,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1621: insulinScheduled >= insulinReq * 2 — current temp delivers much more than needed
  it('current temp delivers >2x insulinReq — lowers rate (line 1621)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 140,
        delta: 1,
        short_avgdelta: 1,
        long_avgdelta: 1,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({
        rate: 3.5,
        duration: 25,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1626: currenttemp.duration === 0 — no temp is set
  // Already covered by most tests since default currenttemp has duration=0
  it('no current temp set (duration=0) — sets new temp (line 1626)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 160,
        delta: 2,
        short_avgdelta: 2,
        long_avgdelta: 1,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({ rate: 0, duration: 0 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1631: currenttemp.duration > 5 && rate <= currenttemp.rate — existing temp sufficient
  it('existing high temp sufficient — keeps temp (line 1631)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 160,
        delta: 2,
        short_avgdelta: 2,
        long_avgdelta: 1,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({
        rate: 3.0,
        duration: 20,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1638: required temp > existing temp — sets new higher temp
  it('required temp > existing temp — sets higher temp (line 1638)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 200,
        delta: 5,
        short_avgdelta: 5,
        long_avgdelta: 4,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({
        rate: 1.0,
        duration: 10,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 480: if (typeof profileTarget !== 'undefined') — false
  // profileTarget = profile.min_bg, if undefined the block is skipped
  // Already tested in error path tests.

  // Line 508-527: high_temptarget_raises_sensitivity or low_temptarget_lowers_sensitivity
  // Need temp target set with exercise_mode or high_temptarget_raises_sensitivity
  it('high temp target with exercise_mode raises sensitivity', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 150,
        date: FIXED_DATE - 60_000,
      }),
      profile: defaultProfile({
        temptargetSet: true,
        min_bg: 140,
        max_bg: 140,
        exercise_mode: true,
        half_basal_exercise_target: 160,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 508-527: low_temptarget_lowers_sensitivity
  it('low temp target with low_temptarget_lowers_sensitivity', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 120,
        date: FIXED_DATE - 60_000,
      }),
      profile: defaultProfile({
        temptargetSet: true,
        min_bg: 80,
        max_bg: 80,
        low_temptarget_lowers_sensitivity: true,
        half_basal_exercise_target: 160,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 560: dynISF enabled, tddAdjBasal=true, average_total_data=0 — false branch for line 563
  it('dynISF with tddAdjBasal and zero average_total_data', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 150, date: FIXED_DATE - 60_000 }),
      profile: defaultProfile({
        useNewFormula: true,
        tddAdjBasal: true,
        autosens_min: 0.7,
        autosens_max: 1.2,
      }),
      preferences: defaultPreferences({ useNewFormula: true }),
      trio_custom_variables: defaultTrioCustomVariables({
        currentTDD: 40,
        weightedAverage: 40,
        average_total_data: 0,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 333: newRatio < minLimitChris — need very low adjustment factor
  it('dynISF with newRatio below autosens_min limit', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 80, date: FIXED_DATE - 60_000 }),
      profile: defaultProfile({
        useNewFormula: true,
        tddAdjBasal: false,
        autosens_min: 0.8,
        autosens_max: 1.2,
        sens: 40,
      }),
      preferences: defaultPreferences({
        useNewFormula: true,
        adjustmentFactor: 0.1, // very low so newRatio is small
        sigmoid: false,
      }),
      trio_custom_variables: defaultTrioCustomVariables({
        currentTDD: 10, // low TDD to make newRatio smaller
        weightedAverage: 10,
        average_total_data: 10,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 595: target_bg != profileTarget with override target — display log
  it('override target differs from profileTarget and target_bg — triple arrow display', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 150, date: FIXED_DATE - 60_000 }),
      profile: defaultProfile({
        sensitivity_raises_target: true,
        temptargetSet: false,
      }),
      autosens_data: defaultAutosensData({ ratio: 0.8 }),
      trio_custom_variables: defaultTrioCustomVariables({
        useOverride: true,
        overrideTarget: 100,
        overridePercentage: 100,
        duration: 0,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1009: ZTpredBGs display trimming — ZTpredBGs[i-1] >= ZTpredBGs[i] || ZTpredBGs[i] <= target_bg
  // The binary-expr arm 0 means ZTpredBGs[i-1] >= ZTpredBGs[i] (ZT is falling, break)
  // This happens when predictions are declining — need iobArray where ZT predictions fall
  // The iobArray test above should cover this.

  // Lines 1014-1045: COB/UAM prediction paths with meal data and enableUAM
  it('COB and UAM predictions with carbs and enableUAM', () => {
    const iobArr = [];
    const now = FIXED_DATE;
    for (let i = 0; i < 48; i++) {
      const t = i * 5;
      const fraction = Math.max(0, 1 - t / (5 * 60));
      iobArr.push({
        iob: +(0.5 * fraction).toFixed(3),
        activity: +(0.005 * fraction).toFixed(5),
        basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
        time: new Date(now + t * 60000),
        iobWithZeroTemp: {
          iob: +(0.5 * fraction * 0.8).toFixed(3),
          activity: +(0.005 * fraction * 0.8).toFixed(5),
          basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
          time: new Date(now + t * 60000),
        },
      });
    }
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 150,
        delta: 3,
        short_avgdelta: 3,
        long_avgdelta: 2,
        date: FIXED_DATE - 60_000,
      }),
      iob_data: iobArr as any,
      iob_data_raw: true,
      profile: defaultProfile({
        enableUAM: true,
        enableSMB_with_COB: true,
      }),
      meal_data: defaultMealData({
        carbs: 40,
        mealCOB: 30,
        lastCarbTime: FIXED_DATE - 30 * 60_000,
      }),
      microBolusAllowed: true,
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1069/1102: minZTGuardBG > avgPredBG, minZTGuardBG > minUAMPredBG
  // Need UAM enabled with predictions where ZT guard is above avg
  it('UAM enabled with iobArray — UAM predictions', () => {
    const iobArr = [];
    const now = FIXED_DATE;
    for (let i = 0; i < 48; i++) {
      const t = i * 5;
      const fraction = Math.max(0, 1 - t / (5 * 60));
      iobArr.push({
        iob: +(1.0 * fraction).toFixed(3),
        activity: +(0.01 * fraction).toFixed(5),
        basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
        time: new Date(now + t * 60000),
        iobWithZeroTemp: {
          iob: +(1.0 * fraction * 0.6).toFixed(3),
          activity: +(0.01 * fraction * 0.6).toFixed(5),
          basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
          time: new Date(now + t * 60000),
        },
      });
    }
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 160,
        delta: 4,
        short_avgdelta: 4,
        long_avgdelta: 3,
        date: FIXED_DATE - 60_000,
      }),
      iob_data: iobArr as any,
      iob_data_raw: true,
      profile: defaultProfile({
        enableUAM: true,
        enableSMB_always: true,
        max_iob: 5,
      }),
      microBolusAllowed: true,
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1227: maxDelta > maxDelta_bg_threshold * bg — SMB disabled for sudden rise
  it('maxDelta exceeding threshold disables SMB', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 100,
        delta: 30,
        short_avgdelta: 25,
        long_avgdelta: 30,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      profile: defaultProfile({
        enableSMB_always: true,
        maxDelta_bg_threshold: 0.2,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1209: enableSMB && minGuardBG < threshold — disables SMB
  it('minGuardBG below threshold disables SMB (line 1209)', () => {
    // Need: SMB initially enabled but minGuardBG < threshold
    // With iobArray where predictions go very low
    const iobArr = [];
    const now = FIXED_DATE;
    for (let i = 0; i < 48; i++) {
      const t = i * 5;
      const fraction = Math.max(0, 1 - t / (5 * 60));
      iobArr.push({
        iob: +(4.0 * fraction).toFixed(3),
        activity: +(0.04 * fraction).toFixed(5),
        basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
        time: new Date(now + t * 60000),
        iobWithZeroTemp: {
          iob: +(4.0 * fraction * 0.3).toFixed(3),
          activity: +(0.04 * fraction * 0.3).toFixed(5),
          basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
          time: new Date(now + t * 60000),
        },
      });
    }
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 180,
        delta: 2,
        short_avgdelta: 2,
        long_avgdelta: 1,
        date: FIXED_DATE - 60_000,
      }),
      iob_data: iobArr as any,
      iob_data_raw: true,
      microBolusAllowed: true,
      profile: defaultProfile({
        enableSMB_always: true,
        max_iob: 10,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1265: bg < threshold — enters LGS directly (not via minGuardBG)
  it('bg below threshold triggers direct LGS (line 1265)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 60,
        delta: -5,
        short_avgdelta: -5,
        long_avgdelta: -4,
        date: FIXED_DATE - 60_000,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1251: carbsReq >= carbsReqThreshold && minutesAboveThreshold <= 45
  it('carbsReq triggered with minutesAboveThreshold <= 45', () => {
    // Need: low eventualBG, minutesAboveThreshold <= 45
    // With iobArray where IOBpredBGs drop below threshold within 45 min (9 data points)
    const iobArr = [];
    const now = FIXED_DATE;
    for (let i = 0; i < 48; i++) {
      const t = i * 5;
      const fraction = Math.max(0, 1 - t / (5 * 60));
      iobArr.push({
        iob: +(2.0 * fraction).toFixed(3),
        activity: +(0.02 * fraction).toFixed(5),
        basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
        time: new Date(now + t * 60000),
        iobWithZeroTemp: {
          iob: +(2.0 * fraction * 0.4).toFixed(3),
          activity: +(0.02 * fraction * 0.4).toFixed(5),
          basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
          time: new Date(now + t * 60000),
        },
      });
    }
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 90,
        delta: -3,
        short_avgdelta: -3,
        long_avgdelta: -2,
        date: FIXED_DATE - 60_000,
      }),
      iob_data: iobArr as any,
      iob_data_raw: true,
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1345: eventualBG < min_bg, insulinScheduled < minInsulinReq - basal*0.3
  // Need: eventualBG < min_bg, NOT rising (!carbsReq path), current temp delivering much less
  it('eventualBG < min_bg, current temp delivering too little — raises rate', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 100,
        delta: -3,
        short_avgdelta: -3,
        long_avgdelta: -2,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({ rate: 0, duration: 5 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1327: eventualBG < min_bg with minDelta < 0 && minDelta > expectedDelta
  it('eventualBG < min_bg, barely falling, minDelta > expectedDelta — adjusts insulinReq', () => {
    // Need: eventualBG < min_bg, minDelta < 0, minDelta > expectedDelta
    // expectedDelta = bgi + (target_bg - eventualBG) / 24
    // With bg=108, delta=-0.5, short_avgdelta=-0.3, iob=0.5, activity=0.005
    // bgi = -0.005*40*5 = -1
    // minDelta = min(-0.5, -0.3) = -0.5, minAvgDelta = min(-0.3, long_avgdelta)
    // deviation: minDelta - bgi = -0.5-(-1) = 0.5, deviation=6*0.5=3 (positive)
    // Actually wait, deviation is only negative if (minDelta - bgi) < 0
    // With bgi=-1, minDelta=-0.5: minDelta-bgi = 0.5, deviation = 6*0.5 = 3 (positive, no fallback)
    // naive_eventualBG = 108 - 0.5*40 = 88
    // eventualBG = 88 + 3 = 91 < min_bg=110 ✓
    // target_bg = 115
    // expectedDelta = -1 + (115-91)/24 = -1 + 1.0 = 0.0
    // minDelta=-0.5 < 0 ✓, minDelta=-0.5 > expectedDelta=0.0? NO, -0.5 < 0.0
    // Need minDelta > expectedDelta with both negative
    // expectedDelta = bgi + (target_bg - eventualBG)/24
    // eventualBG very close to target makes (target-eventual)/24 small
    // eventualBG = 109: expectedDelta = -1 + 6/24 = -1 + 0.25 = -0.75
    // minDelta = -0.5 > -0.75 ✓
    // eventualBG = naive_eventualBG + deviation = 88 + deviation = 109 => deviation = 21
    // deviation = 6*(minDelta - bgi) = 6*(-0.5+1) = 3... deviation=3 gives eventualBG=91
    // Need larger deviation or higher bg.
    // bg=120, iob=0.5, activity=0.005: naive_eventualBG = 120 - 20 = 100
    // delta=-0.3, short_avgdelta=-0.5: minDelta=-0.5
    // bgi = -0.005*40*5 = -1
    // minDelta-bgi = -0.5+1 = 0.5, deviation=3 (positive)
    // eventualBG = 100+3 = 103 < 110 ✓
    // expectedDelta = -1 + (115-103)/24 = -1 + 0.5 = -0.5
    // minDelta=-0.5 > expectedDelta=-0.5? NO, equal! Need strictly greater.
    // minDelta=-0.4: min(-0.3, -0.4) = -0.4
    // Wait, min(delta, short_avgdelta) = min(-0.3, -0.5) = -0.5
    // Try delta=-0.2, short_avgdelta=-0.4: minDelta=-0.4
    // minDelta-bgi = -0.4+1 = 0.6, deviation=6*0.6=3.6=>4 (rounded)
    // eventualBG = 100+4 = 104
    // expectedDelta = -1 + (115-104)/24 = -1+0.458 = -0.54
    // minDelta=-0.4 > -0.54 ✓, minDelta < 0 ✓
    // carbsReq check: minDelta > expectedDelta AND minDelta > 0? NO (minDelta < 0), so NOT line 1300
    // Enters the else path (line 1320+): insulinReq calculation
    // Then: minDelta < 0 && minDelta > expectedDelta at line 1327 ✓
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 120,
        delta: -0.2,
        short_avgdelta: -0.4,
        long_avgdelta: -0.5,
        date: FIXED_DATE - 60_000,
      }),
      iob_data: defaultIOBData({ iob: 0.5, activity: 0.005 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1349-1377: eventualBG < min_bg, rate calculations
  // Test with existing temp that's close to required rate
  it('eventualBG < min_bg, current temp ~= required rate — returns unchanged', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 105,
        delta: -1,
        short_avgdelta: -1,
        long_avgdelta: -1,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({ rate: 0.5, duration: 15 }),
      iob_data: defaultIOBData({ iob: 0.1, activity: 0.001 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1354-1377: rate <= 0 path with zero/negative insulinReq
  it('eventualBG < min_bg, rate <= 0 — sets zero temp with duration', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 90,
        delta: -4,
        short_avgdelta: -4,
        long_avgdelta: -3,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({ rate: 0, duration: 0 }),
      iob_data: defaultIOBData({ iob: 0.2, activity: 0.002 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1382+: minDelta < expectedDelta with SMB enabled — skips the non-SMB return
  it('minDelta < expectedDelta with SMB enabled — continues past line 1403', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 130,
        delta: -2,
        short_avgdelta: -2,
        long_avgdelta: -3,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      profile: defaultProfile({
        enableSMB_always: true,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1419-1437: in-range with SMB enabled — continues past line 1429
  it('in-range with SMB enabled — continues to eventualBG >= max_bg (line 1419 true, 1429 false)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 115,
        delta: 0,
        short_avgdelta: 0,
        long_avgdelta: 0,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      profile: defaultProfile({
        enableSMB_always: true,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1443/1449: iob > max_iob path
  it('IOB exceeds max_iob — cancels temp to reduce IOB (line 1449)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 160,
        delta: 2,
        short_avgdelta: 2,
        long_avgdelta: 1,
        date: FIXED_DATE - 60_000,
      }),
      iob_data: defaultIOBData({ iob: 3.0, activity: 0.03 }),
      profile: defaultProfile({ max_iob: 2.5 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1449 with matching temp:
  it('IOB exceeds max_iob with matching temp — returns unchanged', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 160,
        delta: 2,
        short_avgdelta: 2,
        long_avgdelta: 1,
        date: FIXED_DATE - 60_000,
      }),
      iob_data: defaultIOBData({ iob: 3.0, activity: 0.03 }),
      profile: defaultProfile({ max_iob: 2.5 }),
      currenttemp: defaultCurrentTemp({ rate: 0.9, duration: 20 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 362: dynISFenabled && !profile.tddAdjBasal — the else if branch
  it('dynISF enabled with tddAdjBasal false — enters line 362 branch', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 150, date: FIXED_DATE - 60_000 }),
      profile: defaultProfile({
        useNewFormula: true,
        tddAdjBasal: false,
        autosens_min: 0.7,
        autosens_max: 1.2,
      }),
      preferences: defaultPreferences({ useNewFormula: true }),
      trio_custom_variables: defaultTrioCustomVariables({
        currentTDD: 40,
        weightedAverage: 40,
        average_total_data: 40,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 369: middleWare not empty — middleware reason appended
  it('middleware string appended to tddReason', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 150, date: FIXED_DATE - 60_000 }),
      middleWare: 'Custom adjustment applied',
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 389: override with duration=0 (indefinite) vs duration > 0
  it('override with indefinite duration prints different message', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 150, date: FIXED_DATE - 60_000 }),
      trio_custom_variables: defaultTrioCustomVariables({
        useOverride: true,
        overridePercentage: 110,
        duration: 0,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // CGM error conditions: bg <= 10
  it('bg <= 10 triggers CGM error path with high temp replacement', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 5,
        delta: 0,
        short_avgdelta: 0,
        long_avgdelta: 0,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({ rate: 2.0, duration: 20 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // CGM error: bg=38 (xDrip error state)
  it('bg=38 xDrip error with low/zero temp', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 38,
        delta: 0,
        short_avgdelta: 0,
        long_avgdelta: 0,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({ rate: 0, duration: 0 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // CGM error: noise >= 3
  it('noise >= 3 triggers CGM error path', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 120,
        noise: 3,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({ rate: 0, duration: 60 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // BG data too old (minAgo > 12)
  it('BG data too old (>12min) triggers stale data error', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 120,
        date: FIXED_DATE - 15 * 60_000, // 15 min ago
      }),
      currenttemp: defaultCurrentTemp({ rate: 0, duration: 0 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // CGM just calibrated (last_cal < 3)
  it('CGM just calibrated with unchanged data', () => {
    const output = callDetermineBasal({
      glucose_status: {
        glucose: 120,
        delta: 0,
        short_avgdelta: 0,
        long_avgdelta: 0,
        date: FIXED_DATE - 60_000,
        noise: 1,
        device: 'fakecgm',
        last_cal: 2,
      },
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 453: currenttemp.rate === 0 && currenttemp.duration > 30 — shorten zero temp
  it('CGM error with long zero temp — shortens to 30m', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 5,
        delta: 0,
        short_avgdelta: 0,
        long_avgdelta: 0,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({ rate: 0, duration: 60 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 678: microBolusAllowed && currenttemp.rate !== lastTemp.rate with lastTempAge > 10
  it('currenttemp rate mismatch with lastTemp — cancels temp', () => {
    const FIXED_TEMP_DATE = FIXED_DATE - 15 * 60_000; // 15 min ago
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
      microBolusAllowed: true,
      currenttemp: defaultCurrentTemp({ rate: 1.5, duration: 20 }),
      iob_data: defaultIOBData({
        lastTemp: {
          rate: 1.0,
          duration: 30,
          date: FIXED_TEMP_DATE,
        } as any,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 685: lastTemp ended > 5min ago with current temp running
  it('currenttemp running but lastTemp ended > 5m ago — cancels temp', () => {
    const FIXED_TEMP_DATE = FIXED_DATE - 40 * 60_000; // 40 min ago
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
      currenttemp: defaultCurrentTemp({ rate: 1.5, duration: 20 }),
      iob_data: defaultIOBData({
        lastTemp: {
          rate: 1.5,
          duration: 20,
          date: FIXED_TEMP_DATE,
        } as any,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1170: carbsReqBG < 40 path
  it('very low naive_eventualBG triggers carbsReqBG < 40 adjustment', () => {
    // Need naive_eventualBG < 40: bg - iob*sens < 40
    // bg=80, iob=1.5, sens=40: naive=80-60=20 < 40 ✓
    // minGuardBG from predictions — without iobArray = 999
    // But we need bg >= threshold to not trigger LGS
    // threshold = 110 - 0.5*(110-40) = 75
    // bg=80 >= 75 ✓
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 80,
        delta: -1,
        short_avgdelta: -1,
        long_avgdelta: -1,
        date: FIXED_DATE - 60_000,
      }),
      iob_data: defaultIOBData({ iob: 1.5, activity: 0.015 }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Sigmoid dynamic ISF path (line 298)
  it('sigmoid dynamic ISF calculation', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({ glucose: 150, date: FIXED_DATE - 60_000 }),
      profile: defaultProfile({
        useNewFormula: true,
        sigmoid: true,
        autosens_min: 0.7,
        autosens_max: 1.5,
      }),
      preferences: defaultPreferences({
        useNewFormula: true,
        sigmoid: true,
        adjustmentFactor: 0.8,
        adjustmentFactorSigmoid: 0.5,
      }),
      trio_custom_variables: defaultTrioCustomVariables({
        currentTDD: 40,
        weightedAverage: 40,
        average_total_data: 40,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // dynISF logarithmic in prediction loop (line 904-910)
  it('dynISF logarithmic predictions in iobArray loop', () => {
    const iobArr = [];
    const now = FIXED_DATE;
    for (let i = 0; i < 48; i++) {
      const t = i * 5;
      const fraction = Math.max(0, 1 - t / (5 * 60));
      iobArr.push({
        iob: +(1.0 * fraction).toFixed(3),
        activity: +(0.01 * fraction).toFixed(5),
        basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
        time: new Date(now + t * 60000),
        iobWithZeroTemp: {
          iob: +(1.0 * fraction * 0.7).toFixed(3),
          activity: +(0.01 * fraction * 0.7).toFixed(5),
          basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
          time: new Date(now + t * 60000),
        },
      });
    }
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 150,
        delta: 2,
        short_avgdelta: 2,
        long_avgdelta: 1,
        date: FIXED_DATE - 60_000,
      }),
      iob_data: iobArr as any,
      iob_data_raw: true,
      profile: defaultProfile({
        useNewFormula: true,
        sigmoid: false,
        autosens_min: 0.7,
        autosens_max: 1.5,
        enableUAM: true,
      }),
      preferences: defaultPreferences({
        useNewFormula: true,
        sigmoid: false,
        adjustmentFactor: 0.8,
      }),
      trio_custom_variables: defaultTrioCustomVariables({
        currentTDD: 40,
        weightedAverage: 40,
        average_total_data: 40,
      }),
      microBolusAllowed: true,
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // =========================================================================
  // DEEP BRANCH COVERAGE — targeting specific uncovered V8 branches
  // =========================================================================

  // Line 1513: smbMinutesSetting becomes undefined when override sets it
  // via trio_custom_variables.smbMinutes being undefined
  it('smbMinutesSetting undefined via override — defaults to 30m (line 1513)', () => {
    const trio = defaultTrioCustomVariables({
      useOverride: true,
      advancedSettings: true,
      uamMinutes: 30,
    });
    // Delete smbMinutes so the override assignment sets smbMinutesSetting = undefined
    delete (trio as any).smbMinutes;
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 180,
        delta: 3,
        short_avgdelta: 3,
        long_avgdelta: 2,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      profile: defaultProfile({
        enableSMB_always: true,
        maxSMBBasalMinutes: 30,
        maxUAMSMBBasalMinutes: 30,
      }),
      trio_custom_variables: trio,
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1513 variant: insulinReq > maxBolus within smbMinutesSetting undefined path
  it('smbMinutesSetting undefined with high insulinReq — SMB limited by maxBolus (line 1517)', () => {
    const trio = defaultTrioCustomVariables({
      useOverride: true,
      advancedSettings: true,
      uamMinutes: 30,
    });
    delete (trio as any).smbMinutes;
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 250,
        delta: 8,
        short_avgdelta: 8,
        long_avgdelta: 6,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      iob_data: defaultIOBData({ iob: 0.5, activity: 0.005 }),
      profile: defaultProfile({
        enableSMB_always: true,
        maxSMBBasalMinutes: 30,
        maxUAMSMBBasalMinutes: 30,
        max_iob: 10,
      }),
      trio_custom_variables: trio,
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1563-1564: durationReq <= 0 in SMB path (with iobArray so predictions work)
  it('SMB with iobArray where durationReq <= 0 (line 1563)', () => {
    // Need worstCaseInsulinReq < 0: smbTarget < (naive_eventualBG + minIOBPredBG)/2
    // With bg=130, iob=0.2, sens=40: naive_eventualBG = 130-8 = 122
    // With iobArray where IOB is low, minIOBPredBG stays high
    const iobArr = [];
    const now = FIXED_DATE;
    for (let i = 0; i < 48; i++) {
      const t = i * 5;
      const fraction = Math.max(0, 1 - t / (5 * 60));
      iobArr.push({
        iob: +(0.2 * fraction).toFixed(3),
        activity: +(0.002 * fraction).toFixed(5),
        basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
        time: new Date(now + t * 60000),
        iobWithZeroTemp: {
          iob: +(0.2 * fraction * 0.8).toFixed(3),
          activity: +(0.002 * fraction * 0.8).toFixed(5),
          basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
          time: new Date(now + t * 60000),
        },
      });
    }
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 130,
        delta: 1,
        short_avgdelta: 1,
        long_avgdelta: 1,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      iob_data: iobArr as any,
      iob_data_raw: true,
      profile: defaultProfile({
        enableSMB_always: true,
        max_iob: 5,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1566-1568: durationReq >= 30 in SMB path
  it('SMB with iobArray where durationReq >= 30 — rounds and caps (line 1566)', () => {
    // Need large worstCaseInsulinReq: smbTarget >> (naive_eventualBG + minIOBPredBG)/2
    // High IOB causing predictions to drop significantly
    const iobArr = [];
    const now = FIXED_DATE;
    for (let i = 0; i < 48; i++) {
      const t = i * 5;
      const fraction = Math.max(0, 1 - t / (5 * 60));
      iobArr.push({
        iob: +(5.0 * fraction).toFixed(3),
        activity: +(0.05 * fraction).toFixed(5),
        basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
        time: new Date(now + t * 60000),
        iobWithZeroTemp: {
          iob: +(5.0 * fraction * 0.3).toFixed(3),
          activity: +(0.05 * fraction * 0.3).toFixed(5),
          basaliob: 0, bolusiob: 0, netbasalinsulin: 0, bolusinsulin: 0,
          time: new Date(now + t * 60000),
        },
      });
    }
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 200,
        delta: 5,
        short_avgdelta: 5,
        long_avgdelta: 4,
        date: FIXED_DATE - 60_000,
      }),
      microBolusAllowed: true,
      iob_data: iobArr as any,
      iob_data_raw: true,
      profile: defaultProfile({
        enableSMB_always: true,
        max_iob: 10,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Line 1638: required temp > existing temp — set new temp
  // Need: eventualBG >= max_bg, iob <= max_iob, rate > currenttemp.rate, currenttemp.duration > 5
  it('high BG with low existing temp — replaces with higher temp (line 1638)', () => {
    const output = callDetermineBasal({
      glucose_status: defaultGlucoseStatus({
        glucose: 200,
        delta: 3,
        short_avgdelta: 3,
        long_avgdelta: 2,
        date: FIXED_DATE - 60_000,
      }),
      currenttemp: defaultCurrentTemp({
        rate: 0.5,  // Low rate that will be less than required
        duration: 10,
      }),
    });
    expect(normalizeOutput(output)).toMatchSnapshot();
  });

  // Lines 1388-1397: manualBolusErrorString paths in minDelta < expectedDelta
  // Analysis shows: manualBolusErrorString=3 (L1389-1390) requires minDelta >= 0 AND
  // expectedDelta > 0 AND minDelta < expectedDelta. Since expectedDelta = bgi + (target-eventual)/24
  // and bgi is always negative when insulin is active, expectedDelta > 0 requires eventualBG <<
  // target, which contradicts eventualBG >= min_bg. This path is unreachable with realistic params.
  // manualBolusErrorString=5 (L1395-1396) requires minDelta >= 0 AND expectedDelta <= 0, which
  // combined with minDelta < expectedDelta gives 0 <= minDelta < expectedDelta <= 0, a contradiction.
  // Both paths are dead code.

  // Lines 1302-1305: naive_eventualBG < 40 in rising+!carbsReq path
  // Requires the conflicting constraints of !carbsReq (carbsReq rounds to 0) while
  // naive_eventualBG < 40 (which makes bgUndershoot large, forcing carbsReq nonzero).
  // Effectively dead code.

  // Line 66-69: startTime == endTime && currentHour == startTime
  // Dead code: currentHour is `new Date(time.getHours())` (a Date object),
  // and `Date == number` uses string coercion via ToPrimitive("default") which always fails.
});
