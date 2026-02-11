/**
 * Characterization tests for meal/total.js (recentCarbs)
 *
 * Tests the meal totals function that aggregates carb treatments,
 * calculates meal COB (carbs on board), and computes deviation data
 * by calling into cob.js (detectCarbAbsorption) for each treatment.
 *
 * This function handles multiple carb sources (nsCarbs, bwCarbs, journalCarbs),
 * enforces maxCOB, and zeroes COB when deviations are null/undefined.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const recentCarbs = require('../../../lib/meal/total');

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

const BASAL_PROFILE = [{ i: 0, start: '00:00:00', rate: 1, minutes: 0 }];

/**
 * Creates reverse-chronological glucose array (newest first).
 * startBG is the most recent reading.
 * deltas[0] is change from entry[1] to entry[0], etc.
 * e.g., makeGlucoseData(150, [5,5,5,5,5,5]) => 150, 145, 140, 135, 130, 125, 120
 */
function makeGlucoseData(
  startBG: number,
  deltas: number[],
): Array<{ glucose: number; dateString: string }> {
  const data: Array<{ glucose: number; dateString: string }> = [];
  let bg = startBG;
  for (let i = 0; i <= deltas.length; i++) {
    data.push({
      glucose: Math.round(bg),
      dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
    });
    if (i < deltas.length) bg -= deltas[i];
  }
  return data;
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    dia: 5,
    curve: 'rapid-acting',
    useCustomPeakTime: false,
    insulinPeakTime: 75,
    current_basal: 1,
    basalprofile: BASAL_PROFILE,
    min_5m_carbimpact: 8,
    carb_ratio: 10,
    sens: 40,
    isfProfile: { sensitivities: [{ offset: 0, sensitivity: 40 }] },
    maxMealAbsorptionTime: 6,
    max_daily_basal: 1,
    maxCOB: 120,
    ...overrides,
  };
}

/** Default glucose data: steady 120 mg/dL for 7 readings (35 min of 5-min intervals) */
function defaultGlucose() {
  return makeGlucoseData(120, [0, 0, 0, 0, 0, 0]);
}

/** Realistic rising glucose for meal absorption tests */
function risingGlucose() {
  return makeGlucoseData(160, [5, 5, 5, 5, 5, 5]);
}

function makeOpts(
  treatments: unknown[] | null,
  overrides: {
    profile?: Record<string, unknown>;
    pumphistory?: unknown[];
    glucose?: unknown[];
  } = {},
) {
  return {
    treatments,
    profile: makeProfile(overrides.profile || {}),
    pumphistory: overrides.pumphistory || [],
    glucose: overrides.glucose || defaultGlucose(),
    basalprofile: BASAL_PROFILE,
  };
}

function ts(minsAgo: number): string {
  return new Date(NOW - minsAgo * 60_000).toISOString();
}

const TIME = new Date(FIXED_TIME);

describe('meal/total (recentCarbs) characterization tests', () => {
  describe('no treatments', () => {
    it('returns zero carbs and zero COB when treatments array is empty', () => {
      const opts = makeOpts([]);
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  describe('null treatments', () => {
    it('returns empty object when treatments is null', () => {
      const opts = makeOpts(null);
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  describe('single nsCarb treatment within window', () => {
    it('counts nsCarbs from a treatment within the absorption window', () => {
      const opts = makeOpts(
        [
          {
            timestamp: ts(30),
            carbs: 45,
            nsCarbs: 45,
          },
        ],
        { glucose: risingGlucose() },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  describe('single bwCarb treatment', () => {
    it('counts bwCarbs and sets bwFound to true', () => {
      const opts = makeOpts(
        [
          {
            timestamp: ts(30),
            carbs: 30,
            bwCarbs: 30,
          },
        ],
        { glucose: risingGlucose() },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  describe('single journalCarb treatment', () => {
    it('counts journalCarbs from a journal entry', () => {
      const opts = makeOpts(
        [
          {
            timestamp: ts(45),
            carbs: 20,
            journalCarbs: 20,
          },
        ],
        { glucose: risingGlucose() },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  describe('treatment outside maxMealAbsorptionTime window', () => {
    it('does not count treatment that is older than maxMealAbsorptionTime', () => {
      // Default maxMealAbsorptionTime is 6 hours = 360 minutes
      // Place treatment 7 hours (420 min) ago
      const opts = makeOpts(
        [
          {
            timestamp: ts(420),
            carbs: 50,
            nsCarbs: 50,
          },
        ],
        { glucose: defaultGlucose() },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  describe('multiple carb treatments', () => {
    it('sums carbs from multiple treatments properly', () => {
      const opts = makeOpts(
        [
          {
            timestamp: ts(30),
            carbs: 25,
            nsCarbs: 25,
          },
          {
            timestamp: ts(120),
            carbs: 35,
            nsCarbs: 35,
          },
        ],
        { glucose: risingGlucose() },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  describe('maxCOB enforcement', () => {
    it('caps mealCOB at profile.maxCOB value', () => {
      // Set maxCOB very low so it caps the result
      const opts = makeOpts(
        [
          {
            timestamp: ts(10),
            carbs: 200,
            nsCarbs: 200,
          },
        ],
        {
          profile: { maxCOB: 5 },
          glucose: risingGlucose(),
        },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  describe('bad maxCOB', () => {
    it('handles non-number maxCOB without crashing', () => {
      const opts = makeOpts(
        [
          {
            timestamp: ts(30),
            carbs: 40,
            nsCarbs: 40,
          },
        ],
        {
          profile: { maxCOB: 'invalid' as unknown },
          glucose: risingGlucose(),
        },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  describe('bad maxMealAbsorptionTime', () => {
    it('falls back to 6h when maxMealAbsorptionTime is not a number', () => {
      const opts = makeOpts(
        [
          {
            timestamp: ts(30),
            carbs: 30,
            nsCarbs: 30,
          },
        ],
        {
          profile: { maxMealAbsorptionTime: 'bad' as unknown },
          glucose: risingGlucose(),
        },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });
});
