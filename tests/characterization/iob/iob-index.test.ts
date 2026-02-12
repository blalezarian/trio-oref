/**
 * Characterization tests for iob/index.js (the full IOB generation pipeline)
 *
 * Tests the complete IOB array generation from pump history events,
 * including the history parsing, treatment extraction, summation at
 * 5-minute intervals, and iobWithZeroTemp projections.
 */

import { describe, it, expect } from 'vitest';
import iob from '../../../lib/iob/index';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

function ts(minsAgo: number): string {
  return new Date(NOW - minsAgo * 60_000).toISOString();
}

const BASAL_PROFILE = [{ i: 0, start: '00:00:00', rate: 1, minutes: 0 }];

function makeInputs(history: unknown[], profileOverrides: Record<string, unknown> = {}) {
  return {
    clock: FIXED_TIME,
    history,
    profile: {
      dia: 5,
      curve: 'rapid-acting',
      basalprofile: BASAL_PROFILE,
      current_basal: 1,
      max_daily_basal: 1,
      ...profileOverrides,
    },
  };
}

/** Normalize the IOB array for stable snapshots (replace Date objects) */
function normalizeArray(arr: any[]) {
  return arr.map((entry, i) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(entry)) {
      if (key === 'time') {
        out[key] = `[TIME+${i * 5}m]`;
      } else if (key === 'iobWithZeroTemp') {
        const zt = entry[key];
        out[key] = {
          ...zt,
          time: `[TIME+${i * 5}m]`,
        };
      } else if (key === 'lastTemp') {
        const lt = entry[key];
        out[key] = lt.date === 0
          ? { date: 0 }
          : { ...lt, started_at: '[STARTED_AT]' };
      } else {
        out[key] = entry[key];
      }
    }
    return out;
  });
}

describe('iob/index (generate) characterization tests', () => {
  describe('bolus history', () => {
    it('single 2U bolus just given', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 2, timestamp: FIXED_TIME },
      ]);
      const result = iob(inputs);
      expect(result.length).toBeGreaterThan(1); // should be 48 entries (4h / 5m)
      // Snapshot first entry (current IOB) and last entry
      expect(normalizeArray([result[0]])).toMatchSnapshot('first entry (t=0)');
      expect(normalizeArray([result[result.length - 1]])).toMatchSnapshot('last entry (t=4h)');
    });

    it('single 1U bolus 1h ago', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: ts(60) },
      ]);
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('current IOB');
    });

    it('single 1U bolus past DIA (6h ago)', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: ts(360) },
      ]);
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('current IOB should be 0');
    });

    it('two boluses: 2U now + 1U 30m ago', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 2, timestamp: FIXED_TIME },
        { _type: 'Bolus', amount: 1, timestamp: ts(30) },
      ]);
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('current IOB');
    });
  });

  describe('temp basal history', () => {
    it('high temp basal (2 U/hr) for 30m ending now', () => {
      const inputs = makeInputs([
        { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
      ]);
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('current IOB from temp');
    });

    it('zero temp for 30m ending now (negative IOB)', () => {
      const inputs = makeInputs([
        { _type: 'TempBasal', rate: 0, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
      ]);
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('current IOB from zero temp');
    });

    it('two consecutive temp basals', () => {
      const inputs = makeInputs([
        { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
        { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(60) },
      ]);
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('current IOB from two temps');
    });

    it('low temp basal (below profile) produces negative IOB', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasal', rate: 0.1, timestamp: ts(30) },
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
        ],
        { current_basal: 2, max_daily_basal: 2 },
      );
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('negative IOB from low temp');
    });
  });

  describe('mixed bolus + temp basal history', () => {
    it('1U bolus + high temp 30m ago', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: ts(30) },
        { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(60) },
      ]);
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('current IOB combined');
    });
  });

  describe('different insulin curves', () => {
    it('bilinear DIA=3: 1U bolus now', () => {
      const inputs = makeInputs(
        [{ _type: 'Bolus', amount: 1, timestamp: FIXED_TIME }],
        { dia: 3, curve: 'bilinear' },
      );
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('bilinear t=0');
    });

    it('ultra-rapid DIA=5: 1U bolus now', () => {
      const inputs = makeInputs(
        [{ _type: 'Bolus', amount: 1, timestamp: FIXED_TIME }],
        { curve: 'ultra-rapid' },
      );
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('ultra-rapid t=0');
    });
  });

  describe('iobArray shape', () => {
    it('full array has 48 entries (4h at 5m intervals)', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: FIXED_TIME },
      ]);
      const result = iob(inputs);
      expect(result.length).toBe(48);
    });

    it('currentIOBOnly=true returns single entry', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: FIXED_TIME },
      ]);
      const result = iob(inputs, true);
      expect(result.length).toBe(1);
    });

    it('each entry has iobWithZeroTemp projection', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: FIXED_TIME },
      ]);
      const result = iob(inputs);
      expect(result[0].iobWithZeroTemp).toBeDefined();
      expect(result[0].iobWithZeroTemp!.iob).toBeTypeOf('number');
    });

    it('first entry has lastBolusTime and lastTemp', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: FIXED_TIME },
      ]);
      const result = iob(inputs);
      expect(result[0].lastBolusTime).toBeDefined();
      expect(result[0].lastTemp).toBeDefined();
    });
  });

  describe('pump suspend handling', () => {
    it('suspend during temp basal with suspend_zeros_iob', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(60) },
          { _type: 'PumpSuspend', timestamp: ts(45) },
          { _type: 'PumpResume', timestamp: ts(30) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('IOB with suspend');
    });
  });

  describe('Nightscout/Care Portal treatments', () => {
    it('Meal Bolus from Care Portal', () => {
      const inputs = makeInputs([
        {
          eventType: 'Meal Bolus',
          insulin: 3,
          created_at: ts(30),
        },
      ]);
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('care portal meal bolus');
    });

    it('Correction Bolus from Care Portal', () => {
      const inputs = makeInputs([
        {
          eventType: 'Correction Bolus',
          insulin: 1.5,
          created_at: ts(60),
        },
      ]);
      const result = iob(inputs);
      expect(normalizeArray([result[0]])).toMatchSnapshot('care portal correction');
    });
  });
});
