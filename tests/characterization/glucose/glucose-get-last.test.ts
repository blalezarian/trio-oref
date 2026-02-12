/**
 * Characterization tests for glucose-get-last.js
 *
 * Tests the glucose status calculation: current BG, delta, short/long
 * avgdelta, noise detection, and device filtering.
 */

import { describe, it, expect } from 'vitest';
import getLastGlucose from '../../../lib/glucose-get-last';

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

  describe('calibration record handling (lines 28-29)', () => {
    it('cal record with nonzero glucose stops processing older entries', () => {
      // The cal record needs a truthy glucose value to pass the initial filter,
      // and type === "cal" to trigger the early break at lines 27-29
      const data = [
        { glucose: 120, date: BASE_TIME, device: 'fakecgm', noise: 1 },
        { glucose: 118, date: BASE_TIME - 5 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 116, date: BASE_TIME - 10 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 100, date: BASE_TIME - 15 * 60_000, device: 'fakecgm', noise: 1, type: 'cal' },
        { glucose: 200, date: BASE_TIME - 20 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 200, date: BASE_TIME - 25 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 200, date: BASE_TIME - 30 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 200, date: BASE_TIME - 35 * 60_000, device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      // last_cal should be set to the index of the cal record
      expect(result).toMatchSnapshot();
    });

    it('cal record at index 1 stops all delta calculations', () => {
      const data = [
        { glucose: 120, date: BASE_TIME, device: 'fakecgm', noise: 1 },
        { glucose: 115, date: BASE_TIME - 5 * 60_000, device: 'fakecgm', noise: 1, type: 'cal' },
        { glucose: 110, date: BASE_TIME - 10 * 60_000, device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });
  });

  describe('missing date fields (line 42)', () => {
    it('entry without date, display_time, or dateString triggers error path', () => {
      // getDateFromEntry returns undefined (or NaN) when all date fields are missing
      // This hits the else branch at line 42
      const data = [
        { glucose: 120, date: BASE_TIME, device: 'fakecgm', noise: 1 },
        { glucose: 115, device: 'fakecgm', noise: 1 },  // no date fields at all
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });

    it('entry with invalid display_time and no date field', () => {
      const data = [
        { glucose: 120, date: BASE_TIME, device: 'fakecgm', noise: 1 },
        { glucose: 115, date: 0, display_time: 'not-a-date', dateString: 'also-not-a-date', device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });
  });

  describe('close-in-time averaging (lines 47-49)', () => {
    it('two readings within 2.5 minutes get averaged', () => {
      // Second reading at 2 minutes ago -- within the [-2, 2.5] range
      const data = [
        { glucose: 130, date: BASE_TIME, device: 'fakecgm', noise: 1 },
        { glucose: 120, date: BASE_TIME - 2 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 115, date: BASE_TIME - 5 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 110, date: BASE_TIME - 10 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 105, date: BASE_TIME - 15 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 100, date: BASE_TIME - 20 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 95, date: BASE_TIME - 25 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 90, date: BASE_TIME - 30 * 60_000, device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      // glucose should be averaged: (130 + 120) / 2 = 125
      expect(result).toMatchSnapshot();
    });

    it('reading at exactly 2.5 minutes gets averaged', () => {
      const data = [
        { glucose: 140, date: BASE_TIME, device: 'fakecgm', noise: 1 },
        { glucose: 130, date: BASE_TIME - 2.5 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 120, date: BASE_TIME - 5 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 110, date: BASE_TIME - 10 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 100, date: BASE_TIME - 20 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 90, date: BASE_TIME - 30 * 60_000, device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });

    it('reading at 1 minute ago gets averaged', () => {
      const data = [
        { glucose: 150, date: BASE_TIME, device: 'fakecgm', noise: 1 },
        { glucose: 140, date: BASE_TIME - 1 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 130, date: BASE_TIME - 5 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 120, date: BASE_TIME - 10 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 110, date: BASE_TIME - 20 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 100, date: BASE_TIME - 30 * 60_000, device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });

    it('multiple close-in-time readings get progressively averaged', () => {
      // Multiple readings within 2.5m window
      const data = [
        { glucose: 130, date: BASE_TIME, device: 'fakecgm', noise: 1 },
        { glucose: 126, date: BASE_TIME - 1 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 122, date: BASE_TIME - 2 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 115, date: BASE_TIME - 5 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 110, date: BASE_TIME - 10 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 100, date: BASE_TIME - 20 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 90, date: BASE_TIME - 30 * 60_000, device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });
  });

  describe('device filtering', () => {
    it('entries from different devices are ignored for delta calculation', () => {
      const data = [
        { glucose: 120, date: BASE_TIME, device: 'deviceA', noise: 1 },
        { glucose: 100, date: BASE_TIME - 5 * 60_000, device: 'deviceB', noise: 1 },
        { glucose: 115, date: BASE_TIME - 10 * 60_000, device: 'deviceA', noise: 1 },
        { glucose: 110, date: BASE_TIME - 15 * 60_000, device: 'deviceA', noise: 1 },
        { glucose: 105, date: BASE_TIME - 20 * 60_000, device: 'deviceA', noise: 1 },
        { glucose: 100, date: BASE_TIME - 25 * 60_000, device: 'deviceA', noise: 1 },
        { glucose: 95, date: BASE_TIME - 30 * 60_000, device: 'deviceA', noise: 1 },
        { glucose: 90, date: BASE_TIME - 35 * 60_000, device: 'deviceA', noise: 1 },
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });
  });

  describe('glucose <= 38 filtered out for delta', () => {
    it('low glucose entries (<=38) are skipped in delta calculations', () => {
      const data = [
        { glucose: 120, date: BASE_TIME, device: 'fakecgm', noise: 1 },
        { glucose: 38, date: BASE_TIME - 5 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 30, date: BASE_TIME - 10 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 115, date: BASE_TIME - 15 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 110, date: BASE_TIME - 20 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 105, date: BASE_TIME - 30 * 60_000, device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });
  });

  describe('dateString field fallback', () => {
    it('entries with dateString but no date or display_time', () => {
      const data = [
        { glucose: 120, dateString: new Date(BASE_TIME).toISOString(), device: 'fakecgm', noise: 1 },
        { glucose: 115, dateString: new Date(BASE_TIME - 5 * 60_000).toISOString(), device: 'fakecgm', noise: 1 },
        { glucose: 110, dateString: new Date(BASE_TIME - 10 * 60_000).toISOString(), device: 'fakecgm', noise: 1 },
        { glucose: 105, dateString: new Date(BASE_TIME - 20 * 60_000).toISOString(), device: 'fakecgm', noise: 1 },
        { glucose: 100, dateString: new Date(BASE_TIME - 30 * 60_000).toISOString(), device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });

    it('entries with display_time but no date', () => {
      const data = [
        { glucose: 120, display_time: new Date(BASE_TIME).toISOString(), device: 'fakecgm', noise: 1 },
        { glucose: 115, display_time: new Date(BASE_TIME - 5 * 60_000).toISOString(), device: 'fakecgm', noise: 1 },
        { glucose: 110, display_time: new Date(BASE_TIME - 10 * 60_000).toISOString(), device: 'fakecgm', noise: 1 },
        { glucose: 105, display_time: new Date(BASE_TIME - 20 * 60_000).toISOString(), device: 'fakecgm', noise: 1 },
        { glucose: 100, display_time: new Date(BASE_TIME - 30 * 60_000).toISOString(), device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });
  });

  describe('long delta range (17.5-42.5m)', () => {
    it('entries only in long delta range', () => {
      const data = [
        { glucose: 120, date: BASE_TIME, device: 'fakecgm', noise: 1 },
        { glucose: 110, date: BASE_TIME - 20 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 100, date: BASE_TIME - 30 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 90, date: BASE_TIME - 40 * 60_000, device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });
  });

  describe('three data points (sparse data)', () => {
    it('three entries at 5m intervals', () => {
      const data = makeGlucoseEntries([120, 115, 110]);
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });
  });

  describe('noise field variations', () => {
    it('high noise value', () => {
      const data = makeGlucoseEntries([120, 118, 116, 114, 112, 110, 108, 106], { noise: 4 });
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });

    it('noise is NaN', () => {
      const data = makeGlucoseEntries([120, 118, 116, 114, 112], { noise: NaN });
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });

    it('noise is undefined', () => {
      const data = [120, 118, 116, 114, 112].map((glucose, i) => ({
        glucose,
        date: BASE_TIME - i * 5 * 60_000,
        device: 'fakecgm',
      }));
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });
  });

  describe('large time gaps between entries', () => {
    it('30-minute gap between entries', () => {
      const data = [
        { glucose: 150, date: BASE_TIME, device: 'fakecgm', noise: 1 },
        { glucose: 120, date: BASE_TIME - 30 * 60_000, device: 'fakecgm', noise: 1 },
        { glucose: 100, date: BASE_TIME - 60 * 60_000, device: 'fakecgm', noise: 1 },
      ];
      const result = getLastGlucose(data);
      expect(result).toMatchSnapshot();
    });
  });
});
