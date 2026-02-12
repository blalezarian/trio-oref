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

  // =========================================================================
  // tune_insulin_curve — bilinear curve rejection (line 26-27)
  // =========================================================================
  describe('tune_insulin_curve with bilinear curve', () => {
    it('logs error and skips tuning when curve is bilinear', () => {
      const glucose = makeGlucoseSeries(110, 20, 0, 95);
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({ curve: 'bilinear' }),
        pumpprofile: makePumpProfile({ curve: 'bilinear' }),
      });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
      // Should have logged the bilinear warning
      expect(console.error).toHaveBeenCalledWith(
        '--tune-insulin-curve is set but only valid for exponential curves',
      );
    });
  });

  // =========================================================================
  // tune_insulin_curve — DIA tuning loop (lines 29-92)
  // =========================================================================
  describe('tune_insulin_curve with exponential curve (DIA tuning)', () => {
    it('runs DIA loop with rapid-acting curve and flat glucose', () => {
      const glucose = makeGlucoseSeries(110, 30, 0, 145);
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({ curve: 'rapid-acting', dia: 5 }),
      });
      const result = generate(inputs);
      // Should have diaDeviations and peakDeviations arrays
      expect(result.diaDeviations).toBeDefined();
      expect(result.peakDeviations).toBeDefined();
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('runs DIA loop with rising glucose producing non-zero deviations', () => {
      const glucose = makeGlucoseSeries(100, 30, 2, 145);
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 6,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({ curve: 'rapid-acting', dia: 6 }),
      });
      const result = generate(inputs);
      expect(result.diaDeviations).toBeDefined();
      expect(result.diaDeviations.length).toBeGreaterThan(0);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('runs DIA loop with falling glucose after bolus', () => {
      const glucose = makeGlucoseSeries(180, 30, -2, 145);
      const history = [
        {
          _type: 'Bolus',
          amount: 4.0,
          timestamp: ts(200),
          created_at: ts(200),
          date: dateAt(200),
          duration: 0,
        },
      ];
      const inputs = makeInputs({
        glucose,
        history,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({ curve: 'rapid-acting', dia: 5 }),
      });
      const result = generate(inputs);
      expect(result.diaDeviations).toBeDefined();
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('DIA loop selects new DIA with minimum deviations', () => {
      // Use enough glucose data with varied readings to produce
      // different deviation sums for different DIA values
      const glucose = makeGlucoseSeries(120, 40, 1, 195);
      const history = [
        {
          _type: 'Bolus',
          amount: 2.0,
          timestamp: ts(180),
          created_at: ts(180),
          date: dateAt(180),
          duration: 0,
        },
      ];
      const inputs = makeInputs({
        glucose,
        history,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 7,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({ curve: 'rapid-acting', dia: 7 }),
      });
      const result = generate(inputs);
      expect(result.diaDeviations).toBeDefined();
      // DIA range should be currentDIA-2 to currentDIA+2 = 5 entries
      expect(result.diaDeviations.length).toBe(5);
      // Each entry should have the expected structure
      for (const entry of result.diaDeviations) {
        expect(entry).toHaveProperty('dia');
        expect(entry).toHaveProperty('meanDeviation');
        expect(entry).toHaveProperty('SMRDeviation');
        expect(entry).toHaveProperty('RMSDeviation');
      }
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // tune_insulin_curve — peak tuning loop (lines 97-166)
  // =========================================================================
  describe('tune_insulin_curve peak tuning', () => {
    it('peak tuning with ultra-rapid curve defaults peak to 55', () => {
      const glucose = makeGlucoseSeries(110, 30, 0, 145);
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'ultra-rapid',
          dia: 5,
          useCustomPeakTime: false,
          insulinPeakTime: 55,
        }),
        pumpprofile: makePumpProfile({
          curve: 'ultra-rapid',
          dia: 5,
          insulinPeakTime: 55,
        }),
      });
      const result = generate(inputs);
      expect(result.peakDeviations).toBeDefined();
      expect(result.peakDeviations.length).toBeGreaterThan(0);
      // Peak range: 55-10=45 to 55+10=65 step 5 => 5 entries
      expect(result.peakDeviations.length).toBe(5);
      for (const entry of result.peakDeviations) {
        expect(entry).toHaveProperty('peak');
        expect(entry).toHaveProperty('meanDeviation');
        expect(entry).toHaveProperty('SMRDeviation');
        expect(entry).toHaveProperty('RMSDeviation');
      }
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('peak tuning with non-ultra-rapid curve defaults peak to 75', () => {
      const glucose = makeGlucoseSeries(110, 30, 0, 145);
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({
          curve: 'rapid-acting',
          dia: 5,
          insulinPeakTime: 75,
        }),
      });
      const result = generate(inputs);
      expect(result.peakDeviations).toBeDefined();
      // Peak range: 75-10=65 to 75+10=85 step 5 => 5 entries
      expect(result.peakDeviations.length).toBe(5);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('peak tuning with useCustomPeakTime keeps custom peak', () => {
      const glucose = makeGlucoseSeries(120, 30, -1, 145);
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          useCustomPeakTime: true,
          insulinPeakTime: 60,
        }),
        pumpprofile: makePumpProfile({
          curve: 'rapid-acting',
          dia: 5,
          insulinPeakTime: 60,
        }),
      });
      const result = generate(inputs);
      expect(result.peakDeviations).toBeDefined();
      // Peak range: 60-10=50 to 60+10=70 step 5 => 5 entries
      expect(result.peakDeviations.length).toBe(5);
      // First peak should be 50
      expect(result.peakDeviations[0].peak).toBe(50);
      // Last peak should be 70
      expect(result.peakDeviations[4].peak).toBe(70);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('peak tuning selects new peak with minimum deviations', () => {
      const glucose = makeGlucoseSeries(130, 40, -1, 195);
      const history = [
        {
          _type: 'Bolus',
          amount: 3.0,
          timestamp: ts(200),
          created_at: ts(200),
          date: dateAt(200),
          duration: 0,
        },
      ];
      const inputs = makeInputs({
        glucose,
        history,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({
          curve: 'rapid-acting',
          dia: 5,
          insulinPeakTime: 75,
        }),
      });
      const result = generate(inputs);
      expect(result.peakDeviations).toBeDefined();
      expect(result.diaDeviations).toBeDefined();
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // tune_insulin_curve — combined scenarios
  // =========================================================================
  describe('tune_insulin_curve combined scenarios', () => {
    it('tuning with carb absorption and bolus history', () => {
      const glucose = makeGlucoseSeries(100, 30, 3, 145);
      const history = [
        {
          _type: 'Bolus',
          amount: 2.5,
          timestamp: ts(120),
          created_at: ts(120),
          date: dateAt(120),
          duration: 0,
        },
      ];
      const carbHistory = [{ carbs: 40, created_at: ts(120) }];
      const inputs = makeInputs({
        glucose,
        history,
        carbs: carbHistory,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({
          curve: 'rapid-acting',
          dia: 5,
          insulinPeakTime: 75,
        }),
      });
      const result = generate(inputs);
      expect(result.diaDeviations).toBeDefined();
      expect(result.peakDeviations).toBeDefined();
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('tuning with temp basal history', () => {
      const glucose = makeGlucoseSeries(140, 30, -1, 145);
      const history = [
        {
          _type: 'TempBasal',
          temp: 'absolute',
          rate: 2.5,
          timestamp: ts(130),
          created_at: ts(130),
          date: dateAt(130),
          duration: 30,
        },
        {
          _type: 'TempBasalDuration',
          'duration (min)': 30,
          timestamp: ts(130),
          created_at: ts(130),
          date: dateAt(130),
        },
      ];
      const inputs = makeInputs({
        glucose,
        history,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({
          curve: 'rapid-acting',
          dia: 5,
          insulinPeakTime: 75,
        }),
      });
      const result = generate(inputs);
      expect(result.diaDeviations).toBeDefined();
      expect(result.peakDeviations).toBeDefined();
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('tuning with categorize_uam_as_basal enabled', () => {
      const glucose = makeGlucoseSeries(100, 30, 3, 145);
      const inputs = makeInputs({
        glucose,
        categorize_uam_as_basal: true,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({
          curve: 'rapid-acting',
          dia: 5,
          insulinPeakTime: 75,
        }),
      });
      const result = generate(inputs);
      expect(result.diaDeviations).toBeDefined();
      expect(result.peakDeviations).toBeDefined();
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // tune_insulin_curve — glucose data with different date field formats
  // =========================================================================
  describe('tune_insulin_curve with displayTime glucose data', () => {
    it('handles glucose data that has displayTime field', () => {
      // Create glucose readings with displayTime instead of date for variety
      // Note: categorize.js normalizes to date, but the source data format matters
      const glucose = [];
      for (let i = 29; i >= 0; i--) {
        const minsAgo = i * 5;
        glucose.push({
          glucose: 110 + (29 - i),
          displayTime: ts(minsAgo).replace('Z', ''),
          dateString: ts(minsAgo),
        });
      }
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({
          curve: 'rapid-acting',
          dia: 5,
          insulinPeakTime: 75,
        }),
      });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // tune_insulin_curve — edge cases
  // =========================================================================
  describe('tune_insulin_curve edge cases', () => {
    it('DIA at boundary value (dia=3) produces small DIA range', () => {
      const glucose = makeGlucoseSeries(120, 30, 0, 145);
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 3,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({ curve: 'rapid-acting', dia: 3 }),
      });
      const result = generate(inputs);
      expect(result.diaDeviations).toBeDefined();
      // DIA range: 3-2=1 to 3+2=5 => 5 entries
      expect(result.diaDeviations.length).toBe(5);
      expect(result.diaDeviations[0].dia).toBe(1);
      expect(result.diaDeviations[4].dia).toBe(5);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('large DIA value (dia=10) produces high DIA range', () => {
      const glucose = makeGlucoseSeries(120, 30, 0, 145);
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 10,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({ curve: 'rapid-acting', dia: 10 }),
      });
      const result = generate(inputs);
      expect(result.diaDeviations).toBeDefined();
      // DIA range: 10-2=8 to 10+2=12 => 5 entries
      expect(result.diaDeviations.length).toBe(5);
      expect(result.diaDeviations[0].dia).toBe(8);
      expect(result.diaDeviations[4].dia).toBe(12);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('ultra-rapid curve with useCustomPeakTime=true preserves custom peak', () => {
      const glucose = makeGlucoseSeries(115, 30, 0, 145);
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'ultra-rapid',
          dia: 5,
          useCustomPeakTime: true,
          insulinPeakTime: 45,
        }),
        pumpprofile: makePumpProfile({
          curve: 'ultra-rapid',
          dia: 5,
          insulinPeakTime: 45,
        }),
      });
      const result = generate(inputs);
      expect(result.peakDeviations).toBeDefined();
      // Custom peak 45: range 35-55 step 5 => 5 entries
      expect(result.peakDeviations.length).toBe(5);
      expect(result.peakDeviations[0].peak).toBe(35);
      expect(result.peakDeviations[4].peak).toBe(55);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('tune with volatile glucose produces deviation stats', () => {
      // Create a volatile glucose series with alternating rises and falls
      const glucose = [];
      for (let i = 39; i >= 0; i--) {
        const minsAgo = i * 5;
        // Oscillate: 100, 120, 100, 120, ...
        const bg = i % 2 === 0 ? 120 : 100;
        glucose.push(glucoseReading(bg, minsAgo));
      }
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({
          curve: 'rapid-acting',
          dia: 5,
          insulinPeakTime: 75,
        }),
      });
      const result = generate(inputs);
      expect(result.diaDeviations).toBeDefined();
      expect(result.peakDeviations).toBeDefined();
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('tune with significant IOB from multiple boluses', () => {
      const glucose = makeGlucoseSeries(160, 40, -2, 195);
      const history = [
        {
          _type: 'Bolus',
          amount: 2.0,
          timestamp: ts(180),
          created_at: ts(180),
          date: dateAt(180),
          duration: 0,
        },
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
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({
          curve: 'rapid-acting',
          dia: 5,
          insulinPeakTime: 75,
        }),
      });
      const result = generate(inputs);
      expect(result.diaDeviations).toBeDefined();
      expect(result.peakDeviations).toBeDefined();
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Multiple profile configurations for completeness
  // =========================================================================
  describe('different profile configurations', () => {
    it('high sensitivity profile changes deviation scaling', () => {
      const glucose = makeGlucoseSeries(110, 20, 1, 95);
      const inputs = makeInputs({
        glucose,
        profile: makeProfile({
          sens: 100,
          isfProfile: {
            sensitivities: [{ offset: 0, sensitivity: 100, endOffset: 1440 }],
          },
        }),
        pumpprofile: makePumpProfile({
          sens: 100,
          isfProfile: {
            sensitivities: [{ offset: 0, sensitivity: 100, endOffset: 1440 }],
          },
        }),
      });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('multiple basal profile segments', () => {
      const multiBasal = [
        { i: 0, start: '00:00:00', rate: 0.8, minutes: 0 },
        { i: 1, start: '06:00:00', rate: 1.2, minutes: 360 },
        { i: 2, start: '12:00:00', rate: 1.0, minutes: 720 },
        { i: 3, start: '18:00:00', rate: 0.9, minutes: 1080 },
      ];
      const glucose = makeGlucoseSeries(110, 20, 0, 95);
      const inputs = makeInputs({
        glucose,
        profile: makeProfile({ basalprofile: multiBasal }),
        pumpprofile: makePumpProfile({ basalprofile: multiBasal }),
      });
      const result = generate(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('tune_insulin_curve with multiple basal segments', () => {
      const multiBasal = [
        { i: 0, start: '00:00:00', rate: 0.8, minutes: 0 },
        { i: 1, start: '06:00:00', rate: 1.2, minutes: 360 },
        { i: 2, start: '12:00:00', rate: 1.0, minutes: 720 },
        { i: 3, start: '18:00:00', rate: 0.9, minutes: 1080 },
      ];
      const glucose = makeGlucoseSeries(120, 30, 0, 145);
      const inputs = makeInputs({
        glucose,
        tune_insulin_curve: true,
        profile: makeProfile({
          curve: 'rapid-acting',
          dia: 5,
          basalprofile: multiBasal,
          useCustomPeakTime: false,
          insulinPeakTime: 75,
        }),
        pumpprofile: makePumpProfile({
          curve: 'rapid-acting',
          dia: 5,
          basalprofile: multiBasal,
          insulinPeakTime: 75,
        }),
      });
      const result = generate(inputs);
      expect(result.diaDeviations).toBeDefined();
      expect(result.peakDeviations).toBeDefined();
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });
});
