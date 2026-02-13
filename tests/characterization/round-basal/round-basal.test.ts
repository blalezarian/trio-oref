/**
 * Characterization tests for round-basal.js
 *
 * Tests the basal rate rounding function including:
 * - Default rounding (no profile): 0.05 increments for < 1, 0.05 for 1-10, 0.1 for >= 10
 * - x23 and x54 pump models: 0.025 increments for < 1
 * - No profile passed
 * - Profile without model string
 * - Various basal rate ranges
 */

import { describe, it, expect } from 'vitest';
import { round_basal } from '../../../src/utils/rounding';

describe('round-basal characterization tests', () => {
  // -------------------------------------------------------------------------
  // No profile (undefined)
  // -------------------------------------------------------------------------
  describe('no profile (undefined)', () => {
    it('rounds basal < 1 with default scale (1/20 = 0.05 increments)', () => {
      const result = round_basal(0.123);
      expect(result).toMatchSnapshot();
    });

    it('rounds basal in 1-10 range with 0.05 increments', () => {
      const result = round_basal(3.123);
      expect(result).toMatchSnapshot();
    });

    it('rounds basal >= 10 with 0.1 increments', () => {
      const result = round_basal(12.34);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Profile without model
  // -------------------------------------------------------------------------
  describe('profile without model', () => {
    it('rounds basal < 1 with default scale when model is not set', () => {
      const result = round_basal(0.567, {});
      expect(result).toMatchSnapshot();
    });

    it('rounds basal < 1 with default scale when model is a number (not string)', () => {
      // @ts-expect-error testing defensive typeof check with wrong type
      const result = round_basal(0.567, { model: 123 });
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // x23 pump model (0.025 increments for < 1)
  // -------------------------------------------------------------------------
  describe('x23 pump model', () => {
    const profile = { model: '723' };

    it('rounds basal < 1 with 0.025 increments (scale 40)', () => {
      const result = round_basal(0.123, profile);
      expect(result).toMatchSnapshot();
    });

    it('rounds 0.0125 to 0.025 (nearest 0.025)', () => {
      const result = round_basal(0.0125, profile);
      expect(result).toMatchSnapshot();
    });

    it('rounds 0.037 to 0.025 (nearest 0.025)', () => {
      const result = round_basal(0.037, profile);
      expect(result).toMatchSnapshot();
    });

    it('rounds 0.975 correctly', () => {
      const result = round_basal(0.975, profile);
      expect(result).toMatchSnapshot();
    });

    it('rounds basal in 1-10 range with 0.05 increments (same as default)', () => {
      const result = round_basal(3.123, profile);
      expect(result).toMatchSnapshot();
    });

    it('rounds basal >= 10 with 0.1 increments (same as default)', () => {
      const result = round_basal(12.34, profile);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // x54 pump model (0.025 increments for < 1)
  // -------------------------------------------------------------------------
  describe('x54 pump model', () => {
    const profile = { model: '554' };

    it('rounds basal < 1 with 0.025 increments (scale 40)', () => {
      const result = round_basal(0.123, profile);
      expect(result).toMatchSnapshot();
    });

    it('rounds basal in 1-10 range with 0.05 increments', () => {
      const result = round_basal(5.567, profile);
      expect(result).toMatchSnapshot();
    });

    it('rounds basal >= 10 with 0.1 increments', () => {
      const result = round_basal(15.67, profile);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Non-x23/x54 model (uses default scale 20)
  // -------------------------------------------------------------------------
  describe('non-x23/x54 model', () => {
    const profile = { model: '522' };

    it('rounds basal < 1 with default 0.05 increments', () => {
      const result = round_basal(0.123, profile);
      expect(result).toMatchSnapshot();
    });

    it('rounds basal in 1-10 range with 0.05 increments', () => {
      const result = round_basal(3.123, profile);
      expect(result).toMatchSnapshot();
    });

    it('rounds basal >= 10 with 0.1 increments', () => {
      const result = round_basal(12.34, profile);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('rounds 0 to 0', () => {
      const result = round_basal(0);
      expect(result).toMatchSnapshot();
    });

    it('rounds exactly 1.0 with 1-10 range logic', () => {
      const result = round_basal(1.0);
      expect(result).toMatchSnapshot();
    });

    it('rounds exactly 10.0 with >= 10 range logic', () => {
      const result = round_basal(10.0);
      expect(result).toMatchSnapshot();
    });

    it('rounds 0.999 with < 1 range logic', () => {
      const result = round_basal(0.999);
      expect(result).toMatchSnapshot();
    });

    it('rounds 9.99 with 1-10 range logic', () => {
      const result = round_basal(9.99);
      expect(result).toMatchSnapshot();
    });

    it('handles negative basal gracefully', () => {
      const result = round_basal(-0.5);
      expect(result).toMatchSnapshot();
    });

    it('handles very small basal', () => {
      const result = round_basal(0.001);
      expect(result).toMatchSnapshot();
    });

    it('handles very large basal', () => {
      const result = round_basal(35.555);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Model string matching (endsWith)
  // -------------------------------------------------------------------------
  describe('model string matching', () => {
    it('model ending with "23" uses scale 40', () => {
      const result = round_basal(0.123, { model: 'MMT-1823' });
      expect(result).toMatchSnapshot();
    });

    it('model ending with "54" uses scale 40', () => {
      const result = round_basal(0.123, { model: 'MMT-1754' });
      expect(result).toMatchSnapshot();
    });

    it('model ending with "22" uses default scale 20', () => {
      const result = round_basal(0.123, { model: 'MMT-1722' });
      expect(result).toMatchSnapshot();
    });

    it('model that does not end with 23 or 54 uses default scale 20', () => {
      const result = round_basal(0.123, { model: 'OtherPump' });
      expect(result).toMatchSnapshot();
    });
  });
});
