/**
 * Characterization tests for profile/carbs.js (carbRatioLookup)
 *
 * Tests the carb ratio lookup function including:
 * - Single ratio schedule entry
 * - Multiple ratio entries at different time-of-day offsets
 * - units: "exchanges" conversion (12 / ratio)
 * - Out-of-bounds ratio (< 1 or > 150)
 * - Unsupported units
 * - Undefined carbratio data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { carbRatioLookup } from '../../../src/profile/carbs';
import type { CarbRatioUnits } from '../../../src/types/index';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';

function makeInputs(overrides: Record<string, unknown> = {}) {
  return {
    carbratio: {
      units: 'grams' as const,
      schedule: [{ offset: 0, ratio: 10 }],
      ...(overrides.carbratio as Record<string, unknown> || {}),
    },
    ...overrides,
  };
}

describe('profile/carbs (carbRatioLookup) characterization tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Single ratio schedule
  // -------------------------------------------------------------------------
  describe('single ratio schedule', () => {
    it('returns the single ratio value', () => {
      const inputs = makeInputs();
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Multiple ratio entries with time-of-day offsets
  // -------------------------------------------------------------------------
  describe('multiple ratio entries with time-of-day lookup', () => {
    it('selects the correct ratio for 12:00 UTC (720 min offset)', () => {
      // At 12:00 UTC = 720 minutes. Should match entry at offset 480 (before 960).
      const inputs = {
        carbratio: {
          units: 'grams' as const,
          schedule: [
            { offset: 0, ratio: 8 },
            { offset: 480, ratio: 12 },
            { offset: 960, ratio: 15 },
          ],
        },
      };
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('selects last entry when time is past all offsets', () => {
      // Set time to 23:00 UTC = 1380 minutes, past offset 960
      vi.setSystemTime(new Date('2025-01-15T23:00:00.000Z'));
      const inputs = {
        carbratio: {
          units: 'grams' as const,
          schedule: [
            { offset: 0, ratio: 8 },
            { offset: 480, ratio: 12 },
            { offset: 960, ratio: 15 },
          ],
        },
      };
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('selects first entry when time is before second offset', () => {
      // Set time to 02:00 UTC = 120 minutes, before offset 480
      vi.setSystemTime(new Date('2025-01-15T02:00:00.000Z'));
      const inputs = {
        carbratio: {
          units: 'grams' as const,
          schedule: [
            { offset: 0, ratio: 8 },
            { offset: 480, ratio: 12 },
            { offset: 960, ratio: 15 },
          ],
        },
      };
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Custom `now` parameter
  // -------------------------------------------------------------------------
  describe('custom now parameter', () => {
    it('uses the provided now parameter for time-of-day lookup', () => {
      const customTime = new Date('2025-01-15T06:00:00.000Z'); // 360 minutes
      const inputs = {
        carbratio: {
          units: 'grams' as const,
          schedule: [
            { offset: 0, ratio: 8 },
            { offset: 480, ratio: 12 },
            { offset: 960, ratio: 15 },
          ],
        },
      };
      // Pass custom now as 3rd parameter
      const result = carbRatioLookup(inputs, {}, customTime);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // units: "exchanges" conversion
  // -------------------------------------------------------------------------
  describe('exchanges units conversion', () => {
    it('converts exchanges to grams using 12 / ratio', () => {
      const inputs = {
        carbratio: {
          units: 'exchanges' as const,
          schedule: [{ offset: 0, ratio: 2 }],
        },
      };
      // Expected: 12 / 2 = 6
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('converts exchanges with multiple schedule entries', () => {
      const inputs = {
        carbratio: {
          units: 'exchanges' as const,
          schedule: [
            { offset: 0, ratio: 1.5 },
            { offset: 720, ratio: 3 },
          ],
        },
      };
      // At 12:00 UTC = 720 min, should match second entry at offset 720
      // But since 720 >= 720, and there's no next entry, falls through to last
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Out-of-bounds ratio
  // -------------------------------------------------------------------------
  describe('out-of-bounds ratio', () => {
    it('returns undefined for ratio < 1', () => {
      const inputs = {
        carbratio: {
          units: 'grams' as const,
          schedule: [{ offset: 0, ratio: 0.5 }],
        },
      };
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('returns undefined for ratio > 150', () => {
      const inputs = {
        carbratio: {
          units: 'grams' as const,
          schedule: [{ offset: 0, ratio: 200 }],
        },
      };
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('accepts ratio exactly equal to 1', () => {
      const inputs = {
        carbratio: {
          units: 'grams' as const,
          schedule: [{ offset: 0, ratio: 1 }],
        },
      };
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('accepts ratio exactly equal to 150', () => {
      const inputs = {
        carbratio: {
          units: 'grams' as const,
          schedule: [{ offset: 0, ratio: 150 }],
        },
      };
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Unsupported units
  // -------------------------------------------------------------------------
  describe('unsupported units', () => {
    it('returns undefined for unsupported carb_ratio units', () => {
      const inputs = {
        carbratio: {
          // Deliberately invalid units to exercise the unsupported-units error branch
          units: 'ounces' as unknown as CarbRatioUnits,
          schedule: [{ offset: 0, ratio: 10 }],
        },
      };
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Undefined / missing carbratio data
  // -------------------------------------------------------------------------
  describe('undefined carbratio data', () => {
    it('returns undefined when carbratio is undefined', () => {
      const result = carbRatioLookup({}, {});
      expect(result).toMatchSnapshot();
    });

    it('returns undefined when carbratio.schedule is undefined', () => {
      const inputs = { carbratio: { units: 'grams' as const } };
      const result = carbRatioLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });
});
