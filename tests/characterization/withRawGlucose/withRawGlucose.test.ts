/**
 * Characterization tests for with-raw-glucose.js
 *
 * Tests withRawGlucose(entry, cals, maxRaw) which adds raw glucose
 * calculation to a CGM entry using calibration data.
 *
 * This module has 'use strict' so it can be imported directly via createRequire.
 */

import { describe, it, expect } from 'vitest';
import { withRawGlucose } from '../../../src/glucose/withRawGlucose';

/** Create a standard calibration object */
function makeCal(overrides: Record<string, unknown> = {}) {
  return {
    scale: 1.0,
    intercept: 25000,
    slope: 750,
    ...overrides,
  };
}

/** Create a standard CGM entry */
function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    glucose: 120,
    unfiltered: 90000,
    filtered: 85000,
    ...overrides,
  };
}

describe('with-raw-glucose characterization tests', () => {
  // ─── Entry type bypass ─────────────────────────────────────────────────
  describe('entry type bypass', () => {
    it('entry type "mbg" — returned unchanged', () => {
      const entry = { type: 'mbg', glucose: 150 };
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('entry type "cal" — returned unchanged', () => {
      const entry = { type: 'cal', glucose: 0 };
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── No calibration ────────────────────────────────────────────────────
  describe('no calibration data', () => {
    it('null cals — no raw calculation', () => {
      const entry = makeEntry();
      const result = withRawGlucose(entry, null, 200);
      expect(result).toMatchSnapshot();
    });

    it('undefined cals — no raw calculation', () => {
      const entry = makeEntry();
      const result = withRawGlucose(entry, undefined, 200);
      expect(result).toMatchSnapshot();
    });

    it('empty cals array — no raw calculation', () => {
      const entry = makeEntry();
      const result = withRawGlucose(entry, [], 200);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── Invalid calibration ──────────────────────────────────────────────
  describe('invalid calibration', () => {
    it('cal with slope = 0 — invalid, no raw calculation', () => {
      const entry = makeEntry();
      const result = withRawGlucose(entry, [makeCal({ slope: 0 })], 200);
      expect(result).toMatchSnapshot();
    });

    it('cal with scale = 0 — invalid, no raw calculation', () => {
      const entry = makeEntry();
      const result = withRawGlucose(entry, [makeCal({ scale: 0 })], 200);
      expect(result).toMatchSnapshot();
    });

    it('cal with non-numeric slope — parsed to NaN then 0, invalid', () => {
      const entry = makeEntry();
      const result = withRawGlucose(entry, [makeCal({ slope: 'abc' })], 200);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── Valid calibration — standard raw calculation ─────────────────────
  describe('valid calibration — standard path (egv >= 40, filtered != 0)', () => {
    it('normal entry with glucose field', () => {
      const entry = makeEntry();
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('entry with sgv field instead of glucose', () => {
      const entry = makeEntry({ glucose: undefined, sgv: 120 });
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('entry with both glucose and sgv — glucose takes precedence', () => {
      const entry = makeEntry({ glucose: 120, sgv: 110 });
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('entry with no glucose or sgv — egv defaults to 0', () => {
      const entry = { unfiltered: 90000, filtered: 85000 };
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('entry already has noise set — noise not overwritten', () => {
      const entry = makeEntry({ noise: 3 });
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('entry with noise = 0 (falsy) — noise set to 0 again', () => {
      const entry = makeEntry({ noise: 0 });
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('entry without noise — noise set to 0', () => {
      const entry = makeEntry();
      delete (entry as Record<string, unknown>).noise;
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── cal.filtered === 0 path ──────────────────────────────────────────
  describe('cal.filtered === 0 path', () => {
    it('cal.filtered is 0 — uses direct formula (no ratio)', () => {
      // Note: cleanCal does not set filtered, so cal.filtered is undefined
      // The check is `cal.filtered === 0`, and undefined !== 0, so this
      // branch is only hit if egv < 40. But we can test with egv < 40 separately.
      // Actually, cleanCal returns {scale, intercept, slope, valid}, not filtered.
      // So cal.filtered will always be undefined. This path is only reached via egv < 40.
      const entry = makeEntry({ glucose: 30 }); // egv < 40
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── egv < 40 paths ──────────────────────────────────────────────────
  describe('egv < 40 — raw glucose substitution', () => {
    it('egv < 40 with raw <= maxRaw — glucose replaced, noise = 2', () => {
      const entry = makeEntry({ glucose: 35, unfiltered: 90000, filtered: 85000 });
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('egv < 40 with raw > maxRaw — glucose replaced, noise = 3', () => {
      const entry = makeEntry({ glucose: 35, unfiltered: 200000, filtered: 85000 });
      const result = withRawGlucose(entry, [makeCal()], 100);
      expect(result).toMatchSnapshot();
    });

    it('egv < 40 with raw = 0 — glucose not replaced, noise = 3', () => {
      // When unfiltered equals intercept, raw becomes 0
      const entry = makeEntry({ glucose: 35, unfiltered: 25000, filtered: 85000 });
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('egv = 0 (no glucose or sgv) with valid raw', () => {
      const entry = { unfiltered: 90000, filtered: 85000 };
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('egv = 39 — just under threshold', () => {
      const entry = makeEntry({ glucose: 39, unfiltered: 90000, filtered: 85000 });
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('egv = 40 — at threshold, standard path (not <40)', () => {
      const entry = makeEntry({ glucose: 40, unfiltered: 90000, filtered: 85000 });
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── maxRaw default ───────────────────────────────────────────────────
  describe('maxRaw parameter', () => {
    it('maxRaw defaults to 200 when not provided', () => {
      const entry = makeEntry({ glucose: 35, unfiltered: 90000, filtered: 85000 });
      const result = withRawGlucose(entry, [makeCal()]);
      expect(result).toMatchSnapshot();
    });

    it('maxRaw = 0 — uses default of 200', () => {
      // maxRaw || 200 means 0 is falsy, so defaults to 200
      const entry = makeEntry({ glucose: 35, unfiltered: 90000, filtered: 85000 });
      const result = withRawGlucose(entry, [makeCal()], 0);
      expect(result).toMatchSnapshot();
    });

    it('maxRaw = 50 — low threshold', () => {
      const entry = makeEntry({ glucose: 35, unfiltered: 90000, filtered: 85000 });
      const result = withRawGlucose(entry, [makeCal()], 50);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── unfiltered/filtered parsing ──────────────────────────────────────
  describe('unfiltered/filtered parsing', () => {
    it('string unfiltered/filtered — parsed to int', () => {
      const entry = makeEntry({ unfiltered: '90000', filtered: '85000' });
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('undefined unfiltered/filtered — parsed to 0', () => {
      const entry = { glucose: 120 };
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });

    it('NaN unfiltered — parsed to 0', () => {
      const entry = makeEntry({ unfiltered: 'not-a-number', filtered: 85000 });
      const result = withRawGlucose(entry, [makeCal()], 200);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── Multiple calibrations — only first used ─────────────────────────
  describe('multiple calibrations', () => {
    it('uses only the first calibration from cals array', () => {
      const entry = makeEntry();
      const cals = [
        makeCal({ scale: 1.0, intercept: 25000, slope: 750 }),
        makeCal({ scale: 2.0, intercept: 30000, slope: 900 }),
      ];
      const result = withRawGlucose(entry, cals, 200);
      expect(result).toMatchSnapshot();
    });
  });

  // ─── Calibration value parsing ────────────────────────────────────────
  describe('calibration value parsing', () => {
    it('string cal values — parsed to float', () => {
      const entry = makeEntry();
      const cals = [{ scale: '1.0', intercept: '25000', slope: '750' }];
      const result = withRawGlucose(entry, cals, 200);
      expect(result).toMatchSnapshot();
    });

    it('cal with all zero — invalid', () => {
      const entry = makeEntry();
      const cals = [{ scale: 0, intercept: 0, slope: 0 }];
      const result = withRawGlucose(entry, cals, 200);
      expect(result).toMatchSnapshot();
    });
  });
});
