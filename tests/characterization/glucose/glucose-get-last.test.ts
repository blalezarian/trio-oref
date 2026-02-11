/**
 * Characterization tests for glucose-get-last.js
 *
 * Tests the glucose status calculation: current BG, delta, short/long
 * avgdelta, noise detection, and device filtering.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const getLastGlucose = require('../../../lib/glucose-get-last');

const BASE_TIME = new Date('2025-01-15T12:00:00.000Z').getTime();

/** Generate glucose entries at 5-minute intervals going backwards from BASE_TIME */
function makeGlucoseEntries(
  values: number[],
  options?: { device?: string; noise?: number },
) {
  const device = options?.device ?? 'fakecgm';
  const noise = options?.noise ?? 1;
  return values.map((glucose, i) => ({
    glucose,
    date: BASE_TIME - i * 5 * 60_000,
    display_time: new Date(BASE_TIME - i * 5 * 60_000).toISOString(),
    device,
    noise,
  }));
}

describe('glucose-get-last characterization tests', () => {
  describe('steady BG', () => {
    it('flat at 120 mg/dL', () => {
      const data = makeGlucoseEntries([120, 120, 120, 120, 120, 120, 120, 120, 120, 120]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });

    it('flat at 180 mg/dL', () => {
      const data = makeGlucoseEntries([180, 180, 180, 180, 180, 180, 180, 180, 180, 180]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });
  });

  describe('rising BG', () => {
    it('slow rise (+2/5m)', () => {
      // 120, 118, 116, 114, 112, 110, 108, 106, 104, 102
      const data = makeGlucoseEntries([120, 118, 116, 114, 112, 110, 108, 106, 104, 102]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });

    it('moderate rise (+5/5m)', () => {
      const data = makeGlucoseEntries([150, 145, 140, 135, 130, 125, 120, 115, 110, 105]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });

    it('fast rise (+10/5m)', () => {
      const data = makeGlucoseEntries([200, 190, 180, 170, 160, 150, 140, 130, 120, 110]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });
  });

  describe('falling BG', () => {
    it('slow fall (-2/5m)', () => {
      const data = makeGlucoseEntries([100, 102, 104, 106, 108, 110, 112, 114, 116, 118]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });

    it('moderate fall (-5/5m)', () => {
      const data = makeGlucoseEntries([100, 105, 110, 115, 120, 125, 130, 135, 140, 145]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });

    it('fast fall (-10/5m)', () => {
      const data = makeGlucoseEntries([100, 110, 120, 130, 140, 150, 160, 170, 180, 190]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });
  });

  describe('mixed trends', () => {
    it('recent rise but long-term fall', () => {
      // Recent: rising. 15m avg: rising. 30m avg: falling.
      const data = makeGlucoseEntries([130, 125, 120, 118, 119, 122, 128, 135, 140, 145]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });

    it('recent fall but long-term rise', () => {
      const data = makeGlucoseEntries([120, 125, 128, 130, 128, 122, 115, 108, 102, 100]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });
  });

  describe('edge cases', () => {
    it('single data point', () => {
      const data = makeGlucoseEntries([120]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });

    it('two data points', () => {
      const data = makeGlucoseEntries([120, 115]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });

    it('low BG values', () => {
      const data = makeGlucoseEntries([60, 62, 65, 68, 70, 72, 75, 78, 80, 82]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });

    it('very high BG', () => {
      const data = makeGlucoseEntries([350, 340, 330, 320, 310, 300, 290, 280, 270, 260]);
      expect(getLastGlucose(data)).toMatchSnapshot();
    });

    it('with calibration record', () => {
      const entries = makeGlucoseEntries([120, 118, 116, 114, 112]);
      // Insert a cal record after the 3rd entry
      entries.splice(3, 0, {
        glucose: 0,
        date: BASE_TIME - 15 * 60_000,
        display_time: new Date(BASE_TIME - 15 * 60_000).toISOString(),
        device: 'fakecgm',
        noise: 1,
        type: 'cal',
      } as any);
      expect(getLastGlucose(entries)).toMatchSnapshot();
    });

    it('with sgv field instead of glucose', () => {
      const data = [120, 118, 116, 114, 112, 110, 108, 106, 104, 102].map((sgv, i) => ({
        sgv,
        date: BASE_TIME - i * 5 * 60_000,
        display_time: new Date(BASE_TIME - i * 5 * 60_000).toISOString(),
        device: 'fakecgm',
        noise: 1,
      }));
      expect(getLastGlucose(data)).toMatchSnapshot();
    });
  });
});
