/**
 * Characterization tests for determine-basal/cob.js (detectCarbAbsorption)
 *
 * Tests the carb absorption detection function that buckets glucose data
 * into 5-minute intervals, calculates BGI (blood glucose impact from insulin),
 * computes deviations (actual BG change vs expected from insulin), and tracks
 * carb absorption from those deviations.
 *
 * Note: The implicit global `profile` in the original JS is now declared
 * with `var` in the TypeScript version, so ESM import works correctly.
 */

import { describe, it, expect } from 'vitest';
import detectCarbAbsorption from '../../../lib/determine-basal/cob';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

const BASAL_PROFILE = [{ i: 0, start: '00:00:00', rate: 1, minutes: 0 }];

/**
 * Creates reverse-chronological glucose array (newest first).
 * startBG is the most recent reading.
 * deltas[0] is change from entry[1] to entry[0], deltas[1] from [2] to [1], etc.
 * So if startBG=150 and deltas=[5,5,5], readings are: 150, 145, 140, 135 (rising BG).
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
    if (i < deltas.length) bg -= deltas[i]; // going backwards in time
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
    ...overrides,
  };
}

function makeInputs(
  glucose_data: unknown[],
  mealTimeMinsAgo: number,
  overrides: {
    profile?: Record<string, unknown>;
    history?: unknown[];
    ciTime?: number | string;
  } = {},
) {
  const profile = makeProfile(overrides.profile || {});
  return {
    glucose_data,
    iob_inputs: {
      profile,
      history: overrides.history || [],
      clock: FIXED_TIME,
    },
    basalprofile: BASAL_PROFILE,
    mealTime: NOW - mealTimeMinsAgo * 60_000,
    ...(overrides.ciTime !== undefined ? { ciTime: overrides.ciTime } : {}),
  } as any;
}

describe('determine-basal/cob (detectCarbAbsorption) characterization tests', () => {
  describe('steady BG, no meal', () => {
    it('flat glucose with meal in the past produces minimal deviations and near-zero carbsAbsorbed', () => {
      // Flat BG at 120 for 7 readings (35 min of data)
      const glucose = makeGlucoseData(120, [0, 0, 0, 0, 0, 0]);
      // Meal was 60 minutes ago, well within maxMealAbsorptionTime
      const inputs = makeInputs(glucose, 60);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  describe('rising BG after meal', () => {
    it('glucose rising 5-10 mg/dL per 5min after meal produces positive deviations and carbsAbsorbed', () => {
      // Rising BG: 180, 172, 164, 156, 148, 140, 132 (rising by 8 per interval)
      const glucose = makeGlucoseData(180, [8, 8, 8, 8, 8, 8]);
      // Meal was 30 minutes ago
      const inputs = makeInputs(glucose, 30);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  describe('falling BG', () => {
    it('glucose falling produces negative deviations', () => {
      // Falling BG: 100, 108, 116, 124, 132, 140, 148 (falling by -8 each interval)
      const glucose = makeGlucoseData(100, [-8, -8, -8, -8, -8, -8]);
      // Meal was 60 minutes ago
      const inputs = makeInputs(glucose, 60);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  describe('sgv field compatibility', () => {
    it('uses sgv field when glucose is not present', () => {
      // Build glucose data using sgv instead of glucose
      const data = [];
      for (let i = 0; i <= 6; i++) {
        data.push({
          sgv: 120,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
        });
      }
      const inputs = makeInputs(data, 60);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  describe('display_time field compatibility', () => {
    it('uses display_time instead of dateString for timestamps', () => {
      // Build glucose data using display_time
      const data = [];
      for (let i = 0; i <= 6; i++) {
        data.push({
          glucose: 130,
          display_time: new Date(NOW - i * 5 * 60_000).toISOString(),
        });
      }
      const inputs = makeInputs(data, 60);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  describe('BG below 39 skipped', () => {
    it('glucose entries below 39 are skipped in the bucketing loop', () => {
      // Readings: 120, 38 (skipped), 120, 120, 120, 120, 120
      const data = [
        { glucose: 120, dateString: new Date(NOW - 0 * 5 * 60_000).toISOString() },
        { glucose: 38, dateString: new Date(NOW - 1 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 2 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 3 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 4 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 5 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 6 * 5 * 60_000).toISOString() },
      ];
      const inputs = makeInputs(data, 60);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  describe('first glucose entry below 39', () => {
    it('sets lastbgi to -1 when first glucose entry is below 39', () => {
      // First entry (newest) has glucose < 39, rest are normal
      const data = [
        { glucose: 30, dateString: new Date(NOW - 0 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 1 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 2 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 3 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 4 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 5 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 6 * 5 * 60_000).toISOString() },
      ];
      const inputs = makeInputs(data, 60);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  describe('gap interpolation', () => {
    it('glucose entries more than 8 minutes apart triggers interpolation', () => {
      // Gap of 15 minutes between entry 0 and entry 1, then normal 5-min spacing
      const data = [
        { glucose: 150, dateString: new Date(NOW - 0 * 5 * 60_000).toISOString() },
        { glucose: 140, dateString: new Date(NOW - 3 * 5 * 60_000).toISOString() }, // 15 min gap
        { glucose: 135, dateString: new Date(NOW - 4 * 5 * 60_000).toISOString() },
        { glucose: 130, dateString: new Date(NOW - 5 * 5 * 60_000).toISOString() },
        { glucose: 125, dateString: new Date(NOW - 6 * 5 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(NOW - 7 * 5 * 60_000).toISOString() },
        { glucose: 115, dateString: new Date(NOW - 8 * 5 * 60_000).toISOString() },
      ];
      const inputs = makeInputs(data, 60);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  describe('ciTime filtering', () => {
    it('only considers last ~45min of data when ciTime is set', () => {
      // 10 readings spanning 50 minutes; ciTime = NOW means only ~45 min considered
      const glucose = makeGlucoseData(150, [2, 2, 2, 2, 2, 2, 2, 2, 2]);
      const inputs = makeInputs(glucose, 60, { ciTime: NOW });
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  describe('empty glucose data edge case', () => {
    it('handles minimal glucose data gracefully', () => {
      // Only 1 entry means the for loop never executes and bucketed_data stays minimal
      const glucose = [
        { glucose: 120, dateString: new Date(NOW).toISOString() },
      ];
      const inputs = makeInputs(glucose, 60);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Glucose entry without display_time or dateString (line 47)
  // -------------------------------------------------------------------------
  describe('glucose entry without display_time or dateString', () => {
    it('logs error when BG entry has neither display_time nor dateString', () => {
      // First entry needs dateString for bucketed_data[0], but second entry has neither
      const data = [
        { glucose: 120, dateString: new Date(NOW).toISOString() },
        { glucose: 115 },  // no display_time or dateString => line 47
        { glucose: 110, dateString: new Date(NOW - 2 * 5 * 60_000).toISOString() },
        { glucose: 105, dateString: new Date(NOW - 3 * 5 * 60_000).toISOString() },
        { glucose: 100, dateString: new Date(NOW - 4 * 5 * 60_000).toISOString() },
        { glucose: 95, dateString: new Date(NOW - 5 * 5 * 60_000).toISOString() },
        { glucose: 90, dateString: new Date(NOW - 6 * 5 * 60_000).toISOString() },
      ];
      const inputs = makeInputs(data, 60);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // ciTime filter: hoursAgo < 0 (line 65)
  // Glucose entries more recent than ciTime are skipped
  // -------------------------------------------------------------------------
  describe('ciTime filter: entries more recent than ciTime skipped', () => {
    it('skips BG entries that are after ciTime (hoursAgo < 0)', () => {
      // Set ciTime to 15 minutes ago; glucose entries span from now to 30m ago
      // Entries at NOW, NOW-5m, NOW-10m will be more recent than ciTime (NOW-15m) => hoursAgo < 0
      const ciTime = NOW - 15 * 60_000;
      const glucose = makeGlucoseData(150, [2, 2, 2, 2, 2, 2]);
      const inputs = makeInputs(glucose, 60, { ciTime });
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // lastbgTime from glucose_data[lastbgi].display_time (line 71)
  // This path is taken when bucketed_data[last] has no display_time
  // but glucose_data[lastbgi] does have display_time.
  // -------------------------------------------------------------------------
  describe('lastbgTime from glucose_data[lastbgi].display_time', () => {
    it('uses display_time from glucose_data when bucketed_data lacks display_time', () => {
      // Create glucose data where:
      // First entry has dateString (goes into bucketed_data[0])
      // After gap interpolation, bucketed_data entries won't have display_time
      // Second entry has display_time (so glucose_data[lastbgi] has display_time)
      const data = [
        { glucose: 150, dateString: new Date(NOW).toISOString() },
        // 15-min gap triggers interpolation; lastbgi=0 has dateString, no display_time
        // After interpolation, bucketed_data[last] won't have display_time
        // Next entry with display_time:
        { glucose: 140, display_time: new Date(NOW - 3 * 5 * 60_000).toISOString() },
        { glucose: 135, display_time: new Date(NOW - 4 * 5 * 60_000).toISOString() },
        { glucose: 130, display_time: new Date(NOW - 5 * 5 * 60_000).toISOString() },
        { glucose: 125, display_time: new Date(NOW - 6 * 5 * 60_000).toISOString() },
        { glucose: 120, display_time: new Date(NOW - 7 * 5 * 60_000).toISOString() },
        { glucose: 115, display_time: new Date(NOW - 8 * 5 * 60_000).toISOString() },
      ];
      const inputs = makeInputs(data, 60);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // bucketed BG < 39 in deviation loop (line 129)
  // -------------------------------------------------------------------------
  describe('bucketed BG below 39 in deviation loop', () => {
    it('skips deviation calculation when bucketed BG or BG+3 is below 39', () => {
      // Create data where glucose drops to < 39 at the +3 position
      // Need at least 7 entries for bucketed_data.length-3 to have loop iterations
      const data = [
        { glucose: 120, dateString: new Date(NOW).toISOString() },
        { glucose: 100, dateString: new Date(NOW - 5 * 60_000).toISOString() },
        { glucose: 80, dateString: new Date(NOW - 10 * 60_000).toISOString() },
        { glucose: 35, dateString: new Date(NOW - 15 * 60_000).toISOString() }, // < 39 at i+3
        { glucose: 30, dateString: new Date(NOW - 20 * 60_000).toISOString() },
        { glucose: 25, dateString: new Date(NOW - 25 * 60_000).toISOString() },
        { glucose: 20, dateString: new Date(NOW - 30 * 60_000).toISOString() },
      ];
      const inputs = makeInputs(data, 60);
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // ciTime > bgTime at i===0 (line 155 true branch)
  // -------------------------------------------------------------------------
  describe('ciTime strictly greater than bgTime at i===0', () => {
    it('pushes currentDeviation to allDeviations when ciTime > bgTime at first iteration', () => {
      // Set ciTime to slightly in the future of the newest glucose entry
      const ciTime = NOW + 1 * 60_000; // 1 minute after newest BG
      const glucose = makeGlucoseData(150, [3, 3, 3, 3, 3, 3]);
      const inputs = makeInputs(glucose, 60, { ciTime });
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Large currentDeviation / 2 > min_5m_carbimpact (line 159 true branch)
  // -------------------------------------------------------------------------
  describe('large currentDeviation exceeds min_5m_carbimpact', () => {
    it('hits the large deviation path when BG is rising rapidly', () => {
      // Very rapidly rising BG: each 5-min interval has +20 mg/dL delta
      // avgDelta = (bg - bg[i+3])/3 = ~20
      // bgi from no IOB is ~0
      // currentDeviation = 20 - 0 = 20; 20/2 = 10 > 8 (min_5m_carbimpact)
      const glucose = makeGlucoseData(200, [20, 20, 20, 20, 20, 20]);
      const inputs = makeInputs(glucose, 30, { ciTime: NOW + 60_000 });
      const result = detectCarbAbsorption(inputs);
      expect(result).toMatchSnapshot();
    });
  });
});
