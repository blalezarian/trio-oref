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

import { describe, it, expect } from 'vitest';
import { recentCarbs } from '../../../src/meal/total';
import type { CarbTreatment, GlucoseEntry } from '../../../src/types/index';

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
    curve: 'rapid-acting' as const,
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
  treatments: CarbTreatment[] | null,
  overrides: {
    profile?: Record<string, unknown>;
    pumphistory?: Array<Record<string, unknown>>;
    glucose?: GlucoseEntry[];
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

  // -------------------------------------------------------------------------
  // Unclassified carbs (line 73-74): carbs >= 1 but no nsCarbs/bwCarbs/journalCarbs
  // -------------------------------------------------------------------------
  describe('unclassified carbs', () => {
    it('logs error for treatment with carbs but no nsCarbs/bwCarbs/journalCarbs', () => {
      const opts = makeOpts(
        [
          {
            timestamp: ts(30),
            carbs: 25,
            // No nsCarbs, bwCarbs, or journalCarbs => unclassified path
          },
        ],
        { glucose: risingGlucose() },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // carbsToRemove path (lines 87-94): myMealCOB < mealCOB triggers removal
  // When iterating treatments newest-to-oldest, if a subsequent (older) treatment
  // results in lower myMealCOB than the current max, carbsToRemove fires.
  // Use extended glucose data (many 5-min readings) so calcMealCOB can compute
  // significant absorption for older treatments.
  // -------------------------------------------------------------------------
  describe('carbsToRemove logic with multiple treatments', () => {
    /** Generate extended glucose data: 60 readings (5 hours) of steady BG */
    function extendedGlucose(bg = 130) {
      const data: Array<{ glucose: number; dateString: string }> = [];
      for (let i = 0; i < 60; i++) {
        data.push({
          glucose: bg,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
        });
      }
      return data;
    }

    it('removes carbs from older nsCarbs treatment when myMealCOB decreases', () => {
      // Recent treatment (5m ago) with 80g => high mealCOB (little absorption)
      // Older treatment (240m ago) with 20g => total 100g, but heavy absorption
      // over 4 hours makes myMealCOB < mealCOB
      const opts = makeOpts(
        [
          { timestamp: ts(5), carbs: 80, nsCarbs: 80 },
          { timestamp: ts(240), carbs: 20, nsCarbs: 20 },
        ],
        { glucose: extendedGlucose() },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });

    it('removes carbs from older bwCarbs treatment', () => {
      const opts = makeOpts(
        [
          { timestamp: ts(5), carbs: 80, nsCarbs: 80 },
          { timestamp: ts(240), carbs: 20, bwCarbs: 20 },
        ],
        { glucose: extendedGlucose() },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });

    it('removes carbs from older journalCarbs treatment', () => {
      const opts = makeOpts(
        [
          { timestamp: ts(5), carbs: 80, nsCarbs: 80 },
          { timestamp: ts(240), carbs: 20, journalCarbs: 20 },
        ],
        { glucose: extendedGlucose() },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // currentDeviation null/undefined (lines 128-131) and maxDeviation null/undefined (lines 133-136)
  // When glucose_data has too few entries for cob.js to compute deviations,
  // currentDeviation and maxDeviation come back as undefined.
  // -------------------------------------------------------------------------
  describe('zombie-carb safety: null/undefined deviations', () => {
    it('sets mealCOB to 0 when glucose data is too sparse for deviation calculation', () => {
      // Provide only 3 glucose readings: bucketed_data will be short,
      // and the deviation loop (bucketed_data.length-3) won't iterate,
      // leaving currentDeviation undefined
      const sparseGlucose = [
        { glucose: 120, dateString: new Date(NOW).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 10 * 60_000).toISOString() },
      ];
      const opts = makeOpts(
        [
          {
            timestamp: ts(30),
            carbs: 50,
            nsCarbs: 50,
          },
        ],
        { glucose: sparseGlucose },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // NaN myMealCOB (line 84-85): when carbsAbsorbed is NaN because
  // profile.carb_ratio is undefined, making absorbed = NaN.
  // This triggers the typeof(myMealCOB) !== 'number' || isNaN safety check.
  // -------------------------------------------------------------------------
  describe('NaN myMealCOB safety path', () => {
    it('logs error when myMealCOB is NaN due to undefined carb_ratio', () => {
      const opts = makeOpts(
        [
          {
            timestamp: ts(15),
            carbs: 30,
            nsCarbs: 30,
          },
        ],
        {
          profile: { carb_ratio: undefined as unknown },
          glucose: risingGlucose(),
        },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Treatment in the future (treatmentTime > now) - should be skipped
  // -------------------------------------------------------------------------
  describe('future treatment', () => {
    it('does not count treatment with timestamp in the future', () => {
      const futureTime = new Date(NOW + 30 * 60_000).toISOString();
      const opts = makeOpts(
        [
          {
            timestamp: futureTime,
            carbs: 50,
            nsCarbs: 50,
          },
        ],
        { glucose: risingGlucose() },
      );
      const result = recentCarbs(opts, TIME);
      expect(result).toMatchSnapshot();
    });
  });
});
