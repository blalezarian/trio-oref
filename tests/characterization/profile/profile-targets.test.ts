/**
 * Characterization tests for profile/targets.js (bgTargetsLookup)
 *
 * Tests the BG target lookup function including:
 * - Single target entry
 * - Multiple target entries at different time-of-day offsets
 * - Temp targets (temptargets array in inputs)
 * - mmol/L unit conversion (values < 20 are multiplied by 18)
 * - High/low temp target sensitivity adjustments
 * - Bound clamping (min 80, max 200)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import bgTargetsLookup from '../../../lib/profile/targets.js';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';

function makeInputs(overrides: Record<string, unknown> = {}) {
  return {
    targets: {
      user_preferred_units: 'mg/dL',
      targets: [{ offset: 0, low: 110, high: 120, min_bg: 110, max_bg: 120 }],
      ...(overrides.targets as Record<string, unknown> || {}),
    },
    temptargets: overrides.temptargets ?? [],
  };
}

describe('profile/targets (bgTargetsLookup) characterization tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Single target entry
  // -------------------------------------------------------------------------
  describe('single target entry', () => {
    it('returns the single target with bound clamping applied', () => {
      const inputs = makeInputs();
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Multiple target entries — time-of-day lookup
  // -------------------------------------------------------------------------
  describe('multiple target entries with time-of-day lookup', () => {
    it('selects the correct target for 12:00 UTC (720 min offset)', () => {
      // At 12:00 UTC = 720 minutes. Should match the entry at offset 480 (before 960).
      const inputs = {
        targets: {
          user_preferred_units: 'mg/dL',
          targets: [
            { offset: 0, low: 100, high: 110 },
            { offset: 480, low: 105, high: 115 },
            { offset: 960, low: 110, high: 120 },
          ],
        },
        temptargets: [],
      };
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('selects last entry when time is past all offsets', () => {
      // Set time to 23:00 UTC = 1380 minutes, past offset 960
      vi.setSystemTime(new Date('2025-01-15T23:00:00.000Z'));
      const inputs = {
        targets: {
          user_preferred_units: 'mg/dL',
          targets: [
            { offset: 0, low: 100, high: 110 },
            { offset: 480, low: 105, high: 115 },
            { offset: 960, low: 110, high: 120 },
          ],
        },
        temptargets: [],
      };
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('selects the first entry when time is before second offset', () => {
      // Set time to 02:00 UTC = 120 minutes, before offset 480
      vi.setSystemTime(new Date('2025-01-15T02:00:00.000Z'));
      const inputs = {
        targets: {
          user_preferred_units: 'mg/dL',
          targets: [
            { offset: 0, low: 100, high: 110 },
            { offset: 480, low: 105, high: 115 },
            { offset: 960, low: 110, high: 120 },
          ],
        },
        temptargets: [],
      };
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // profile.target_bg override
  // -------------------------------------------------------------------------
  describe('profile.target_bg override', () => {
    it('overrides low target when profile.target_bg is set', () => {
      const inputs = makeInputs();
      const result = bgTargetsLookup(inputs, { target_bg: 100 });
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Temp targets
  // -------------------------------------------------------------------------
  describe('temp targets', () => {
    it('applies an active temp target within duration window', () => {
      // Temp target started 30 min ago with 60 min duration => still active
      const inputs = makeInputs({
        temptargets: [
          {
            created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            duration: 60,
            targetTop: 150,
            targetBottom: 140,
          },
        ],
      });
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('cancels temp target when duration is 0', () => {
      // Duration 0 means cancel
      const inputs = makeInputs({
        temptargets: [
          {
            created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            duration: 0,
            targetTop: 150,
            targetBottom: 140,
          },
        ],
      });
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('ignores expired temp target', () => {
      // Temp target started 120 min ago with 60 min duration => expired
      const inputs = makeInputs({
        temptargets: [
          {
            created_at: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
            duration: 60,
            targetTop: 150,
            targetBottom: 140,
          },
        ],
      });
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('handles temp target with missing targetBottom/targetTop (logs error and breaks)', () => {
      const inputs = makeInputs({
        temptargets: [
          {
            created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            duration: 60,
            // Missing targetTop and targetBottom
          },
        ],
      });
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('processes most recent temp target first (sorted by created_at desc)', () => {
      // Two temp targets: older one is active, newer one cancels
      const inputs = makeInputs({
        temptargets: [
          {
            created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            duration: 120,
            targetTop: 160,
            targetBottom: 150,
          },
          {
            created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            duration: 0,
            targetTop: 160,
            targetBottom: 150,
          },
        ],
      });
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // mmol/L conversion
  // -------------------------------------------------------------------------
  describe('mmol/L conversion (values < 20)', () => {
    it('converts low and high from mmol/L to mg/dL when both < 20', () => {
      const inputs = {
        targets: {
          user_preferred_units: 'mmol/L',
          targets: [{ offset: 0, low: 5.5, high: 6.5 }],
        },
        temptargets: [],
      };
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('does not convert values already >= 20 (mg/dL)', () => {
      const inputs = {
        targets: {
          user_preferred_units: 'mg/dL',
          targets: [{ offset: 0, low: 110, high: 120 }],
        },
        temptargets: [],
      };
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Bound clamping
  // -------------------------------------------------------------------------
  describe('bound clamping', () => {
    it('clamps min_bg and max_bg to at least 80', () => {
      // Even with very low values, bound_target_range clamps to 80
      const inputs = {
        targets: {
          user_preferred_units: 'mg/dL',
          targets: [{ offset: 0, low: 50, high: 50 }],
        },
        temptargets: [],
      };
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });

    it('clamps min_bg and max_bg to at most 200', () => {
      const inputs = {
        targets: {
          user_preferred_units: 'mg/dL',
          targets: [{ offset: 0, low: 250, high: 250 }],
        },
        temptargets: [],
      };
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // bound_target_range (exported)
  // -------------------------------------------------------------------------
  describe('bound_target_range', () => {
    it('directly calling bound_target_range with normal values', () => {
      const result = bgTargetsLookup.bound_target_range({ low: 100, high: 120 });
      expect(result).toMatchSnapshot();
    });

    it('directly calling bound_target_range with mmol values < 20', () => {
      const result = bgTargetsLookup.bound_target_range({ low: 5.5, high: 6.5 });
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // temptargets error handling (non-array / undefined)
  // -------------------------------------------------------------------------
  describe('temptargets error handling', () => {
    it('handles non-sortable temptargets gracefully (catch block, then loop skips)', () => {
      // {} has no .sort() method, so the try block throws.
      // The catch block logs "No temptargets found."
      // Then ({}).length is undefined, so the for-loop condition (0 < undefined) is false, loop skips.
      const inputs = {
        targets: {
          user_preferred_units: 'mg/dL',
          targets: [{ offset: 0, low: 110, high: 120 }],
        },
        temptargets: {} as any,
      };
      const result = bgTargetsLookup(inputs, {});
      expect(result).toMatchSnapshot();
    });
  });
});
