/**
 * Characterization tests for calc-glucose-stats.js
 *
 * Tests updateGlucoseStats(options) which sorts glucose history by dateString,
 * calculates sensor noise via glucose-stats, and annotates the first entry
 * with a noise level value.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import calcGlucoseStats from '../../../src/deprecated/calc-glucose-stats';

const BASE_TIME = new Date('2025-01-15T12:00:00.000Z').getTime();

/** Generate glucose history entries at 5-minute intervals going backwards from BASE_TIME */
function makeGlucoseHist(
  values: number[],
  overrides?: Record<string, unknown>,
): Array<{ glucose: number; dateString: string; noise?: number; [key: string]: unknown }> {
  return values.map((glucose, i) => ({
    glucose,
    dateString: new Date(BASE_TIME - i * 5 * 60_000).toISOString(),
    ...overrides,
  }));
}

describe('calc-glucose-stats characterization tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('empty glucose history', () => {
    it('returns empty array for empty glucose_hist', () => {
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist: [] });
      expect(result).toMatchSnapshot();
    });
  });

  describe('single entry', () => {
    it('single glucose entry — insufficient data for noise calculation', () => {
      const glucose_hist = makeGlucoseHist([120]);
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });
  });

  describe('few entries (below MINRECORDS threshold)', () => {
    it('two entries — still below noise calculation threshold', () => {
      const glucose_hist = makeGlucoseHist([120, 118]);
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });

    it('three entries — still below noise calculation threshold', () => {
      const glucose_hist = makeGlucoseHist([120, 118, 116]);
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });
  });

  describe('enough entries for noise calculation', () => {
    it('stable glucose — minimal noise', () => {
      const glucose_hist = makeGlucoseHist([120, 120, 120, 120, 120, 120]);
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });

    it('steadily rising glucose — low noise', () => {
      const glucose_hist = makeGlucoseHist([140, 135, 130, 125, 120, 115]);
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });

    it('steadily falling glucose — low noise', () => {
      const glucose_hist = makeGlucoseHist([100, 105, 110, 115, 120, 125]);
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });

    it('noisy glucose — zigzag pattern', () => {
      const glucose_hist = makeGlucoseHist([130, 110, 140, 100, 135, 105]);
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });
  });

  describe('many entries (above MAXRECORDS threshold)', () => {
    it('10 entries with steady values', () => {
      const glucose_hist = makeGlucoseHist([
        120, 119, 118, 117, 116, 115, 114, 113, 112, 111,
      ]);
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });
  });

  describe('pre-existing noise field on first entry', () => {
    it('CGM-reported noise value is taken as minimum', () => {
      const glucose_hist = makeGlucoseHist([120, 120, 120, 120, 120, 120]);
      glucose_hist[0].noise = 3;
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });

    it('CGM-reported noise value lower than calculated is overridden', () => {
      // Zigzag pattern => high calculated noise, CGM reports 1
      const glucose_hist = makeGlucoseHist([130, 110, 140, 100, 135, 105]);
      glucose_hist[0].noise = 1;
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });
  });

  describe('high glucose triggering heavy noise', () => {
    it('glucose above 400 triggers heavy noise level', () => {
      const glucose_hist = makeGlucoseHist([410, 405, 400, 395, 390, 385]);
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });
  });

  describe('low glucose triggering light noise', () => {
    it('glucose below 40 triggers light noise level', () => {
      const glucose_hist = makeGlucoseHist([35, 36, 37, 38, 39, 40]);
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });
  });

  describe('large delta between last two entries', () => {
    it('delta > 30 triggers heavy noise', () => {
      const glucose_hist = makeGlucoseHist([180, 140, 138, 136, 134, 132]);
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });
  });

  describe('unsorted input', () => {
    it('entries not in dateString order are sorted internally', () => {
      // Provide entries in reverse chronological order (newest last)
      const glucose_hist = [
        { glucose: 110, dateString: new Date(BASE_TIME - 20 * 60_000).toISOString() },
        { glucose: 115, dateString: new Date(BASE_TIME - 10 * 60_000).toISOString() },
        { glucose: 120, dateString: new Date(BASE_TIME).toISOString() },
        { glucose: 105, dateString: new Date(BASE_TIME - 30 * 60_000).toISOString() },
        { glucose: 100, dateString: new Date(BASE_TIME - 40 * 60_000).toISOString() },
      ];
      const result = calcGlucoseStats.updateGlucoseStats({ glucose_hist });
      expect(result).toMatchSnapshot();
    });
  });
});
