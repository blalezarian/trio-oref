/**
 * Characterization tests for glucose-stats.js
 *
 * Tests four exported functions:
 *   - calcSensorNoise: computes noise from glucose history + optional raw data
 *   - calcTrend: computes 10-minute glucose trend
 *   - calcNSNoise: maps noise value + glucose history to Nightscout noise level 0-4
 *   - NSNoiseString: maps noise level integer to human-readable string
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import glucoseStats from '../../../lib/glucose-stats.js';

const BASE_TIME = new Date('2025-01-15T12:00:00.000Z').getTime();

/** A simple calcGlucose function that simulates calibration-based glucose calculation */
function mockCalcGlucose(entry: { unfiltered: number }, lastCal: { scale: number; intercept: number; slope: number }) {
  return lastCal.scale * (entry.unfiltered - lastCal.intercept) / lastCal.slope;
}

/** Generate glucose history entries at 5-minute intervals going backwards from BASE_TIME */
function makeGlucoseHist(
  values: number[],
  options?: {
    unfiltered?: number[];
    startTime?: number;
  },
): Array<{ glucose: number; readDateMills: number; unfiltered?: number; [key: string]: unknown }> {
  const startTime = options?.startTime ?? BASE_TIME;
  return values.map((glucose, i) => {
    const entry: { glucose: number; readDateMills: number; unfiltered?: number; [key: string]: unknown } = {
      glucose,
      readDateMills: startTime - i * 5 * 60_000,
    };
    if (options?.unfiltered) {
      entry.unfiltered = options.unfiltered[i];
    }
    return entry;
  });
}

/** Default calibration object */
function makeLastCal() {
  return { scale: 1.0, intercept: 25000, slope: 750 };
}

describe('glucose-stats characterization tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ─── calcSensorNoise ──────────────────────────────────────────────────
  describe('calcSensorNoise', () => {
    it('returns 0 when fewer than MINRECORDS (4) entries', () => {
      const hist = makeGlucoseHist([120, 118, 116]);
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('exactly MINRECORDS (4) entries — uses transmitter glucose (no lastCal)', () => {
      const hist = makeGlucoseHist([120, 118, 116, 114]);
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('steady glucose — low noise', () => {
      const hist = makeGlucoseHist([120, 120, 120, 120, 120, 120, 120, 120]);
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('linearly rising glucose — low noise', () => {
      const hist = makeGlucoseHist([150, 145, 140, 135, 130, 125, 120, 115]);
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('oscillating glucose — high noise', () => {
      // Creates peaks and valleys to trigger delta sign changes
      const hist = makeGlucoseHist([120, 140, 110, 145, 105, 140, 115, 135]);
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('with lastCal and unfiltered data', () => {
      const hist = makeGlucoseHist(
        [120, 118, 116, 114, 112],
        { unfiltered: [90000, 88000, 86000, 84000, 82000] },
      );
      const lastCal = makeLastCal();
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, lastCal, null);
      expect(result).toMatchSnapshot();
    });

    it('with lastCal but unfiltered <= 100 — falls back to transmitter glucose', () => {
      const hist = makeGlucoseHist(
        [120, 118, 116, 114, 112],
        { unfiltered: [50, 50, 50, 50, 50] },
      );
      const lastCal = makeLastCal();
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, lastCal, null);
      expect(result).toMatchSnapshot();
    });

    it('glucose <= 30 entries are filtered out', () => {
      // Mix of valid and invalid (<=30) entries; only valid ones count
      const hist = makeGlucoseHist([120, 25, 116, 10, 112, 30, 108, 106]);
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('all glucose <= 30 — returns 0 (fewer than MINRECORDS after filtering)', () => {
      const hist = makeGlucoseHist([20, 25, 10, 15, 5, 30]);
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('with sgv parameter (no lastCal) — appends to array', () => {
      const hist = makeGlucoseHist([120, 118, 116]);
      const sgv = { glucose: 122, readDateMills: BASE_TIME + 5 * 60_000 };
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, sgv);
      expect(result).toMatchSnapshot();
    });

    it('with sgv parameter and lastCal + unfiltered — uses calcGlucose for sgv', () => {
      const hist = makeGlucoseHist(
        [120, 118, 116, 114],
        { unfiltered: [90000, 88000, 86000, 84000] },
      );
      const lastCal = makeLastCal();
      const sgv = { glucose: 122, readDateMills: BASE_TIME + 5 * 60_000, unfiltered: 92000 };
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, lastCal, sgv);
      expect(result).toMatchSnapshot();
    });

    it('with sgv parameter — sgv has unfiltered <= 100 (falls back to glucose)', () => {
      const hist = makeGlucoseHist([120, 118, 116, 114]);
      const lastCal = makeLastCal();
      const sgv = { glucose: 122, readDateMills: BASE_TIME + 5 * 60_000, unfiltered: 50 };
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, lastCal, sgv);
      expect(result).toMatchSnapshot();
    });

    it('more than MAXRECORDS (8) entries — only uses last 8', () => {
      // 12 entries; only the last 8 should be used
      const hist = makeGlucoseHist([
        120, 118, 116, 114, 112, 110, 108, 106, 104, 102, 100, 98,
      ]);
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('all identical values — sod is zero — noise is 0', () => {
      // When all glucose values and time differences produce sod = 0
      // This happens only if all entries have the same glucose AND the same readDate
      const hist = [
        { glucose: 100, readDateMills: BASE_TIME },
        { glucose: 100, readDateMills: BASE_TIME },
        { glucose: 100, readDateMills: BASE_TIME },
        { glucose: 100, readDateMills: BASE_TIME },
      ];
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('delta direction change: positive to negative (1.1x multiplier)', () => {
      // Values: rising then falling to trigger the 1.1x branch
      const hist = makeGlucoseHist([115, 125, 120, 115, 110]);
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('delta direction change: negative to positive (1.2x multiplier)', () => {
      // Values: falling then rising to trigger the 1.2x branch
      const hist = makeGlucoseHist([125, 115, 120, 125, 130]);
      const result = glucoseStats.calcSensorNoise(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── calcTrend ─────────────────────────────────────────────────────────
  describe('calcTrend', () => {
    it('empty glucoseHist — returns 0', () => {
      const result = glucoseStats.calcTrend(mockCalcGlucose, [], null, null);
      expect(result).toMatchSnapshot();
    });

    it('single entry, no sgv — returns 0 (need >1 entries for trend)', () => {
      const hist = makeGlucoseHist([120]);
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('steady glucose — trend near zero', () => {
      const hist = makeGlucoseHist([120, 120, 120]);
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('rising glucose — positive trend', () => {
      // Most recent first: 140, 135, 130 (rising by 5 per 5 min)
      const hist = makeGlucoseHist([140, 135, 130]);
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('falling glucose — negative trend', () => {
      // Most recent first: 100, 105, 110 (falling by 5 per 5 min)
      const hist = makeGlucoseHist([100, 105, 110]);
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('with sgv parameter — sgv determines currentTime', () => {
      const hist = makeGlucoseHist([120, 118, 116]);
      const sgv = { glucose: 122, readDateMills: BASE_TIME + 5 * 60_000 };
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, null, sgv);
      expect(result).toMatchSnapshot();
    });

    it('with lastCal and unfiltered data — uses calcGlucose', () => {
      const hist = makeGlucoseHist(
        [120, 118, 116],
        { unfiltered: [90000, 88000, 86000] },
      );
      const lastCal = makeLastCal();
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, lastCal, null);
      expect(result).toMatchSnapshot();
    });

    it('with lastCal and sgv with unfiltered', () => {
      const hist = makeGlucoseHist(
        [120, 118, 116],
        { unfiltered: [90000, 88000, 86000] },
      );
      const lastCal = makeLastCal();
      const sgv = { glucose: 122, readDateMills: BASE_TIME + 5 * 60_000, unfiltered: 92000 };
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, lastCal, sgv);
      expect(result).toMatchSnapshot();
    });

    it('sgv without unfiltered — uses sgv.glucose directly', () => {
      const hist = makeGlucoseHist([120, 118, 116]);
      const sgv = { glucose: 125, readDateMills: BASE_TIME + 5 * 60_000 };
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, null, sgv);
      expect(result).toMatchSnapshot();
    });

    it('entries older than 16 minutes are excluded', () => {
      // Only entries within 16 minutes of currentTime should be used
      const hist = [
        { glucose: 130, readDateMills: BASE_TIME },
        { glucose: 125, readDateMills: BASE_TIME - 5 * 60_000 },
        { glucose: 120, readDateMills: BASE_TIME - 10 * 60_000 },
        { glucose: 115, readDateMills: BASE_TIME - 15 * 60_000 },
        { glucose: 50, readDateMills: BASE_TIME - 20 * 60_000 },  // > 16 min, excluded
        { glucose: 45, readDateMills: BASE_TIME - 30 * 60_000 },  // > 16 min, excluded
      ];
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('all entries older than 16 minutes from sgv — returns 0', () => {
      // If sgv is far in the future, all hist entries are >16min old
      const hist = makeGlucoseHist([120, 118, 116]);
      const sgv = { glucose: 130, readDateMills: BASE_TIME + 30 * 60_000 };
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, null, sgv);
      expect(result).toMatchSnapshot();
    });

    it('lastCal with unfiltered <= 100 — falls back to transmitter glucose', () => {
      const hist = makeGlucoseHist(
        [120, 118, 116],
        { unfiltered: [50, 50, 50] },
      );
      const lastCal = makeLastCal();
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, lastCal, null);
      expect(result).toMatchSnapshot();
    });

    it('sgv with lastCal but unfiltered <= 100 — uses sgv.glucose', () => {
      const hist = makeGlucoseHist([120, 118, 116]);
      const lastCal = makeLastCal();
      const sgv = { glucose: 125, readDateMills: BASE_TIME + 5 * 60_000, unfiltered: 50 };
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, lastCal, sgv);
      expect(result).toMatchSnapshot();
    });

    it('rapid rise trend', () => {
      // 10 mg/dL per 5 min = 20 per 10 min trend
      const hist = makeGlucoseHist([160, 150, 140]);
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });

    it('rapid fall trend', () => {
      const hist = makeGlucoseHist([80, 90, 100]);
      const result = glucoseStats.calcTrend(mockCalcGlucose, hist, null, null);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── calcNSNoise ───────────────────────────────────────────────────────
  describe('calcNSNoise', () => {
    it('glucose > 400 — Heavy (4)', () => {
      const hist = [{ glucose: 410 }];
      const result = glucoseStats.calcNSNoise(0.1, hist);
      expect(result).toMatchSnapshot();
    });

    it('glucose < 40 — Light (2)', () => {
      const hist = [{ glucose: 35 }];
      const result = glucoseStats.calcNSNoise(0.1, hist);
      expect(result).toMatchSnapshot();
    });

    it('glucose exactly 400 — uses noise thresholds (not > 400 branch)', () => {
      const hist = [{ glucose: 400 }];
      const result = glucoseStats.calcNSNoise(0.1, hist);
      expect(result).toMatchSnapshot();
    });

    it('glucose exactly 40 — uses noise thresholds (not < 40 branch)', () => {
      const hist = [{ glucose: 40 }];
      const result = glucoseStats.calcNSNoise(0.1, hist);
      expect(result).toMatchSnapshot();
    });

    it('deltaSGV > 30 — Heavy (4)', () => {
      const hist = [
        { glucose: 100 },
        { glucose: 140 },  // delta = 100 - 140 = -40, |40| > 30
      ];
      const result = glucoseStats.calcNSNoise(0.1, hist);
      expect(result).toMatchSnapshot();
    });

    it('deltaSGV < -30 — Heavy (4)', () => {
      const hist = [
        { glucose: 100 },
        { glucose: 60 },  // delta = 100 - 60 = 40, |40| > 30
      ];
      const result = glucoseStats.calcNSNoise(0.1, hist);
      expect(result).toMatchSnapshot();
    });

    it('deltaSGV exactly 30 — not Heavy (uses noise threshold)', () => {
      const hist = [
        { glucose: 130 },
        { glucose: 100 },  // delta = 130 - 100 = 30, |30| not > 30
      ];
      const result = glucoseStats.calcNSNoise(0.1, hist);
      expect(result).toMatchSnapshot();
    });

    it('deltaSGV exactly -30 — not Heavy (uses noise threshold)', () => {
      const hist = [
        { glucose: 100 },
        { glucose: 130 },  // delta = 100 - 130 = -30, |-30| not > 30
      ];
      const result = glucoseStats.calcNSNoise(0.1, hist);
      expect(result).toMatchSnapshot();
    });

    it('noise < 0.35 — Clean (1)', () => {
      const hist = [{ glucose: 120 }, { glucose: 118 }];
      const result = glucoseStats.calcNSNoise(0.2, hist);
      expect(result).toMatchSnapshot();
    });

    it('noise exactly 0.35 — Light (2)', () => {
      const hist = [{ glucose: 120 }, { glucose: 118 }];
      const result = glucoseStats.calcNSNoise(0.35, hist);
      expect(result).toMatchSnapshot();
    });

    it('noise = 0.49 — Light (2)', () => {
      const hist = [{ glucose: 120 }, { glucose: 118 }];
      const result = glucoseStats.calcNSNoise(0.49, hist);
      expect(result).toMatchSnapshot();
    });

    it('noise exactly 0.5 — Medium (3)', () => {
      const hist = [{ glucose: 120 }, { glucose: 118 }];
      const result = glucoseStats.calcNSNoise(0.5, hist);
      expect(result).toMatchSnapshot();
    });

    it('noise = 0.69 — Medium (3)', () => {
      const hist = [{ glucose: 120 }, { glucose: 118 }];
      const result = glucoseStats.calcNSNoise(0.69, hist);
      expect(result).toMatchSnapshot();
    });

    it('noise exactly 0.7 — Heavy (4)', () => {
      const hist = [{ glucose: 120 }, { glucose: 118 }];
      const result = glucoseStats.calcNSNoise(0.7, hist);
      expect(result).toMatchSnapshot();
    });

    it('noise = 0.9 — Heavy (4)', () => {
      const hist = [{ glucose: 120 }, { glucose: 118 }];
      const result = glucoseStats.calcNSNoise(0.9, hist);
      expect(result).toMatchSnapshot();
    });

    it('single entry — deltaSGV stays 0', () => {
      const hist = [{ glucose: 120 }];
      const result = glucoseStats.calcNSNoise(0.2, hist);
      expect(result).toMatchSnapshot();
    });

    it('prior glucose <= 30 — deltaSGV stays 0', () => {
      const hist = [
        { glucose: 120 },
        { glucose: 25 },  // <= 30, so delta not computed
      ];
      const result = glucoseStats.calcNSNoise(0.2, hist);
      expect(result).toMatchSnapshot();
    });

    it('current glucose <= 30 — deltaSGV stays 0 (then < 40 branch)', () => {
      const hist = [
        { glucose: 25 },
        { glucose: 120 },
      ];
      const result = glucoseStats.calcNSNoise(0.2, hist);
      expect(result).toMatchSnapshot();
    });

    it('noise = 0 — Clean (1)', () => {
      const hist = [{ glucose: 120 }, { glucose: 118 }];
      const result = glucoseStats.calcNSNoise(0, hist);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── NSNoiseString ─────────────────────────────────────────────────────
  describe('NSNoiseString', () => {
    it('0 — Unknown', () => {
      expect(glucoseStats.NSNoiseString(0)).toMatchSnapshot();
    });

    it('1 — Clean', () => {
      expect(glucoseStats.NSNoiseString(1)).toMatchSnapshot();
    });

    it('2 — Light', () => {
      expect(glucoseStats.NSNoiseString(2)).toMatchSnapshot();
    });

    it('3 — Medium', () => {
      expect(glucoseStats.NSNoiseString(3)).toMatchSnapshot();
    });

    it('4 — Heavy', () => {
      expect(glucoseStats.NSNoiseString(4)).toMatchSnapshot();
    });

    it('unrecognized value — Unknown (default)', () => {
      expect(glucoseStats.NSNoiseString(99)).toMatchSnapshot();
    });

    it('negative value — Unknown (default)', () => {
      expect(glucoseStats.NSNoiseString(-1)).toMatchSnapshot();
    });

    it('undefined — Unknown (default)', () => {
      expect(glucoseStats.NSNoiseString(undefined)).toMatchSnapshot();
    });
  });
});
