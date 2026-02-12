/**
 * Characterization tests for autotune-prep/index.js (generate)
 *
 * Tests the autotune data preparation orchestrator. This function:
 * 1. Calls meal/history (find_meals) to extract treatments from pump history
 * 2. Calls categorize.js to divide glucose data into CSF, ISF, basal, UAM, CR categories
 * 3. Optionally tunes insulin curve by running categorize with different DIA/peak values
 *
 * SAFETY: This is a characterization test suite. Snapshots capture the EXACT
 * current behavior. Do not update snapshots without understanding why they changed.
 */

import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const require = createRequire(import.meta.url);
const generate = require('../../../lib/autotune-prep/index');

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

function ts(minsAgo: number): string {
  return new Date(NOW - minsAgo * 60_000).toISOString();
}

function dateAt(minsAgo: number): number {
  return NOW - minsAgo * 60_000;
}

function glucoseReading(bg: number, minsAgo: number) {
  return {
    glucose: bg,
    date: dateAt(minsAgo),
    dateString: ts(minsAgo),
  };
}

function makeGlucoseSeries(
  startBG: number,
  count: number,
  deltaPerReading: number = 0,
  startMinsAgo?: number,
) {
  const oldest = startMinsAgo ?? (count - 1) * 5;
  const data = [];
  for (let i = 0; i < count; i++) {
    const minsAgo = oldest - i * 5;
    const bg = Math.round(startBG + deltaPerReading * i);
    data.push(glucoseReading(bg, minsAgo));
  }
  return data.reverse(); // newest first
}

const BASAL_PROFILE = [{ i: 0, start: '00:00:00', rate: 1.0, minutes: 0 }];

const ISF_PROFILE = {
  sensitivities: [{ offset: 0, sensitivity: 40, endOffset: 1440 }],
};

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    dia: 5,
    curve: 'rapid-acting',
    useCustomPeakTime: false,
    insulinPeakTime: 75,
    current_basal: 1.0,
    basalprofile: BASAL_PROFILE,
    min_5m_carbimpact: 8,
    carb_ratio: 10,
    sens: 40,
    isfProfile: ISF_PROFILE,
    max_daily_basal: 1.3,
    autosens_min: 0.7,
    autosens_max: 1.2,
    ...overrides,
  };
}

function makePumpProfile(overrides: Record<string, unknown> = {}) {
  return {
    basalprofile: BASAL_PROFILE,
    dia: 5,
    curve: 'rapid-acting',
    useCustomPeakTime: false,
    insulinPeakTime: 75,
    current_basal: 1.0,
    carb_ratio: 10,
    sens: 40,
    isfProfile: ISF_PROFILE,
    autosens_min: 0.7,
    autosens_max: 1.2,
    ...overrides,
  };
}

/**
 * Build inputs for the generate function.
 * generate(inputs) expects:
 *   { history, profile, pumpprofile, carbs, glucose, categorize_uam_as_basal, tune_insulin_curve }
 */
function makeInputs(overrides: Record<string, unknown> = {}) {
  return {
    history: [],
    profile: makeProfile(),
    pumpprofile: makePumpProfile(),
    carbs: [],
    glucose: [],
    categorize_uam_as_basal: false,
    tune_insulin_curve: false,
    ...overrides,
  };
}

function normalizeOutput(result: any) {
  if (!result) return result;
  return JSON.parse(JSON.stringify(result));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autotune-prep/index (generate) characterization tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // =========================================================================
  // Basic invocations
  // =========================================================================
  describe('minimal inputs', () => {
    it('empty history and glucose returns base structure', () => {
      // With no glucose data, categorize will crash at bucketedData[0]
      // because glucoseData[0] is undefined. We capture this behavior.
      const inputs = makeInputs({
        history: [],
        glucose: [],
      });
      // This may throw or return empty - capture either way
      let result: any;
      try {
        result = generate(inputs);
      } catch (e: any) {
        result = { error: e.message };
      }
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('flat glucose with no pump history produces basal-dominated output', () => {
      const glucose = makeGlucoseSeries(110, 20, 0, 95);
      const inputs = makeInputs({ glucose });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // With carb history
  // =========================================================================
  describe('with carb entries', () => {
    it('carb entry in NS carb history creates treatments', () => {
      const glucose = makeGlucoseSeries(100, 20, 2, 95);
      const carbHistory = [
        { carbs: 30, created_at: ts(60) },
      ];
      const inputs = makeInputs({
        glucose,
        carbs: carbHistory,
      });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('carb entry via pump history meal bolus', () => {
      const glucose = makeGlucoseSeries(100, 20, 2, 95);
      const history = [
        {
          _type: 'Meal Bolus',
          carbs: 45,
          created_at: ts(60),
          timestamp: ts(60),
        },
      ];
      const inputs = makeInputs({
        glucose,
        history,
        carbs: [],
      });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // With pump history (temp basals and boluses)
  // =========================================================================
  describe('with pump history', () => {
    it('temp basals affect IOB and categorization', () => {
      const glucose = makeGlucoseSeries(130, 20, -1, 95);
      const history = [
        {
          _type: 'TempBasal',
          temp: 'absolute',
          rate: 2.0,
          timestamp: ts(90),
          created_at: ts(90),
          date: dateAt(90),
          duration: 30,
        },
        {
          _type: 'TempBasalDuration',
          'duration (min)': 30,
          timestamp: ts(90),
          created_at: ts(90),
          date: dateAt(90),
        },
      ];
      const inputs = makeInputs({
        glucose,
        history,
      });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('bolus in pump history affects IOB', () => {
      const glucose = makeGlucoseSeries(180, 20, -2, 95);
      const history = [
        {
          _type: 'Bolus',
          amount: 3.0,
          timestamp: ts(120),
          created_at: ts(120),
          date: dateAt(120),
          duration: 0,
        },
      ];
      const inputs = makeInputs({
        glucose,
        history,
      });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // categorize_uam_as_basal option
  // =========================================================================
  describe('categorize_uam_as_basal option', () => {
    it('merges UAM data into basal when enabled', () => {
      const glucose = makeGlucoseSeries(100, 20, 3, 95);
      const inputs = makeInputs({
        glucose,
        categorize_uam_as_basal: true,
      });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Rising BG scenario (likely UAM)
  // =========================================================================
  describe('rising BG scenario', () => {
    it('strong rise without carbs produces UAM-classified data', () => {
      const glucose = makeGlucoseSeries(100, 20, 4, 95);
      const inputs = makeInputs({ glucose });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Falling BG with high IOB (ISF scenario)
  // =========================================================================
  describe('falling BG with correction bolus', () => {
    it('falling BG after large bolus produces ISF-classified data', () => {
      const glucose = makeGlucoseSeries(200, 20, -3, 95);
      const history = [
        {
          _type: 'Bolus',
          amount: 5.0,
          timestamp: ts(150),
          created_at: ts(150),
          date: dateAt(150),
          duration: 0,
        },
      ];
      const inputs = makeInputs({
        glucose,
        history,
      });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });
});
