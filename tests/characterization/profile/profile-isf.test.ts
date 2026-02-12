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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';

describe('profile/isf (isfLookup) characterization tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
    // Reset module cache so the module-level lastResult variable is cleared
    vi.resetModules();
  });

  async function getIsfLookup() {
    // Dynamic import after vi.resetModules() gives a fresh module instance
    const mod = await import('../../../src/profile/isf.js');
    return mod.default;
  }

  // -------------------------------------------------------------------------
  // Single sensitivity entry
  // -------------------------------------------------------------------------
  describe('single sensitivity entry', () => {
    it('returns the single sensitivity value', async () => {
      const isfLookup = await getIsfLookup();
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
    it('selects the correct ISF for 12:00 UTC (720 min) with timestamp param', async () => {
      const isfLookup = await getIsfLookup();
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

    it('selects last entry when time is past all offsets', async () => {
      const isfLookup = await getIsfLookup();
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

    it('selects first entry when time is before second offset', async () => {
      const isfLookup = await getIsfLookup();
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
    it('returns -1 when first sensitivity offset is not 0', async () => {
      const isfLookup = await getIsfLookup();
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
    it('uses system time when timestamp is undefined', async () => {
      const isfLookup = await getIsfLookup();
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

    it('uses provided timestamp for lookup', async () => {
      const isfLookup = await getIsfLookup();
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
    it('returns cached result on second call within same offset window', async () => {
      const isfLookup = await getIsfLookup();
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
    it('sorts sensitivities by offset before lookup', async () => {
      const isfLookup = await getIsfLookup();
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

  // -------------------------------------------------------------------------
  // Loop match in first entry (line 33: nowMinutes >= offset && < nextOffset)
  // -------------------------------------------------------------------------
  describe('loop match at first entry', () => {
    it('matches the first entry when time is before the second offset', async () => {
      const isfLookup = await getIsfLookup();
      // Time is 02:00 UTC = 120 min, offsets at 0 and 480
      // 120 >= 0 && 120 < 480 => match at first entry
      const isf_data = {
        sensitivities: [
          { offset: 0, sensitivity: 55 },
          { offset: 480, sensitivity: 40 },
        ],
      };
      const result = isfLookup(isf_data, new Date('2025-01-15T02:00:00.000Z'));
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Many entries to exercise loop iterations with no match until later
  // -------------------------------------------------------------------------
  describe('multiple entries with match at third entry', () => {
    it('iterates through entries and matches the third offset window', async () => {
      const isfLookup = await getIsfLookup();
      // 5 entries: 0, 360, 720, 1080, 1320
      // Time: 18:30 UTC = 1110 min => 1110 >= 1080 && 1110 < 1320 => match at entry[3]
      const isf_data = {
        sensitivities: [
          { offset: 0, sensitivity: 60 },
          { offset: 360, sensitivity: 50 },
          { offset: 720, sensitivity: 45 },
          { offset: 1080, sensitivity: 38 },
          { offset: 1320, sensitivity: 42 },
        ],
      };
      const result = isfLookup(isf_data, new Date('2025-01-15T18:30:00.000Z'));
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Two-entry schedule: match middle entry in the loop (line 33 true branch)
  // -------------------------------------------------------------------------
  describe('two-entry schedule match in loop', () => {
    it('matches in the for loop when nowMinutes falls in a middle window', async () => {
      const isfLookup = await getIsfLookup();
      // 4 entries: at 06:00 (360 min), time is 12:00 (720 min)
      // 720 >= 360 && 720 < 960 => match at index 1
      const isf_data = {
        sensitivities: [
          { offset: 0, sensitivity: 60 },
          { offset: 360, sensitivity: 45 },
          { offset: 960, sensitivity: 30 },
          { offset: 1200, sensitivity: 25 },
        ],
      };
      const result = isfLookup(isf_data, new Date(FIXED_TIME));
      expect(result).toMatchSnapshot();
    });
  });
});
