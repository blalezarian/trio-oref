/**
 * Characterization tests for profile/isf.js (isfLookup)
 *
 * Tests the ISF (Insulin Sensitivity Factor) lookup function including:
 * - Single sensitivity entry
 * - Multiple sensitivities at different time-of-day offsets
 * - Time-of-day lookup with optional timestamp parameter
 * - First entry offset != 0 returning -1
 * - Caching behavior (lastResult reuse)
 */

import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const require = createRequire(import.meta.url);

const FIXED_TIME = '2025-01-15T12:00:00.000Z';

describe('profile/isf (isfLookup) characterization tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
    // Re-require to reset the lastResult module-level cache
    vi.resetModules();
  });

  function getIsfLookup() {
    // Fresh require each time to avoid cached lastResult
    const req = createRequire(import.meta.url);
    return req('../../../lib/profile/isf');
  }

  // -------------------------------------------------------------------------
  // Single sensitivity entry
  // -------------------------------------------------------------------------
  describe('single sensitivity entry', () => {
    it('returns the single sensitivity value', () => {
      const isfLookup = getIsfLookup();
      const isf_data = {
        sensitivities: [{ offset: 0, sensitivity: 40 }],
      };
      const result = isfLookup(isf_data);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Multiple sensitivity entries — time-of-day lookup
  // -------------------------------------------------------------------------
  describe('multiple sensitivity entries with time-of-day lookup', () => {
    it('selects the correct ISF for 12:00 UTC (720 min) with timestamp param', () => {
      const isfLookup = getIsfLookup();
      // 720 minutes should match entry at offset 480 (before 960)
      const isf_data = {
        sensitivities: [
          { offset: 0, sensitivity: 50 },
          { offset: 480, sensitivity: 40 },
          { offset: 960, sensitivity: 35 },
        ],
      };
      const result = isfLookup(isf_data, new Date(FIXED_TIME));
      expect(result).toMatchSnapshot();
    });

    it('selects last entry when time is past all offsets', () => {
      const isfLookup = getIsfLookup();
      // 23:00 UTC = 1380 minutes, past offset 960
      const isf_data = {
        sensitivities: [
          { offset: 0, sensitivity: 50 },
          { offset: 480, sensitivity: 40 },
          { offset: 960, sensitivity: 35 },
        ],
      };
      const result = isfLookup(isf_data, new Date('2025-01-15T23:00:00.000Z'));
      expect(result).toMatchSnapshot();
    });

    it('selects first entry when time is before second offset', () => {
      const isfLookup = getIsfLookup();
      // 02:00 UTC = 120 minutes, before offset 480
      const isf_data = {
        sensitivities: [
          { offset: 0, sensitivity: 50 },
          { offset: 480, sensitivity: 40 },
          { offset: 960, sensitivity: 35 },
        ],
      };
      const result = isfLookup(isf_data, new Date('2025-01-15T02:00:00.000Z'));
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // First entry offset != 0 returns -1
  // -------------------------------------------------------------------------
  describe('first entry offset != 0', () => {
    it('returns -1 when first sensitivity offset is not 0', () => {
      const isfLookup = getIsfLookup();
      const isf_data = {
        sensitivities: [
          { offset: 60, sensitivity: 50 },
          { offset: 480, sensitivity: 40 },
        ],
      };
      const result = isfLookup(isf_data, new Date(FIXED_TIME));
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Timestamp parameter behavior
  // -------------------------------------------------------------------------
  describe('timestamp parameter', () => {
    it('uses system time when timestamp is undefined', () => {
      const isfLookup = getIsfLookup();
      // System time is set to 12:00 UTC = 720 minutes
      const isf_data = {
        sensitivities: [
          { offset: 0, sensitivity: 50 },
          { offset: 480, sensitivity: 40 },
          { offset: 960, sensitivity: 35 },
        ],
      };
      const result = isfLookup(isf_data);
      expect(result).toMatchSnapshot();
    });

    it('uses provided timestamp for lookup', () => {
      const isfLookup = getIsfLookup();
      // Provide a timestamp at 06:00 UTC = 360 minutes (before offset 480)
      const isf_data = {
        sensitivities: [
          { offset: 0, sensitivity: 50 },
          { offset: 480, sensitivity: 40 },
        ],
      };
      const result = isfLookup(isf_data, new Date('2025-01-15T06:00:00.000Z'));
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Caching behavior (lastResult)
  // -------------------------------------------------------------------------
  describe('caching behavior', () => {
    it('returns cached result on second call within same offset window', () => {
      const isfLookup = getIsfLookup();
      const isf_data = {
        sensitivities: [
          { offset: 0, sensitivity: 50 },
          { offset: 480, sensitivity: 40 },
          { offset: 960, sensitivity: 35 },
        ],
      };
      // First call at 12:00 UTC
      const result1 = isfLookup(isf_data, new Date(FIXED_TIME));
      // Second call at 12:30 UTC — same offset window (480-960)
      const result2 = isfLookup(isf_data, new Date('2025-01-15T12:30:00.000Z'));
      expect(result1).toMatchSnapshot();
      expect(result2).toMatchSnapshot();
      // Both should be the same value
      expect(result1).toBe(result2);
    });
  });

  // -------------------------------------------------------------------------
  // Unsorted sensitivities
  // -------------------------------------------------------------------------
  describe('unsorted sensitivities', () => {
    it('sorts sensitivities by offset before lookup', () => {
      const isfLookup = getIsfLookup();
      // Provide entries in reverse order — lodash sortBy should sort them
      const isf_data = {
        sensitivities: [
          { offset: 960, sensitivity: 35 },
          { offset: 0, sensitivity: 50 },
          { offset: 480, sensitivity: 40 },
        ],
      };
      const result = isfLookup(isf_data, new Date(FIXED_TIME));
      expect(result).toMatchSnapshot();
    });
  });
});
