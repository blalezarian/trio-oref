/**
 * Characterization tests for basal-set-temp.js
 *
 * Tests getMaxSafeBasal safety calculations and setTempBasal logic
 * including rate clamping, neutral temp handling, and skip_neutral_temps.
 */

import { describe, it, expect } from 'vitest';
import tempBasalFunctions from '../../../src/basal/index';

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    current_basal: 0.9,
    max_daily_basal: 1.3,
    max_basal: 3.5,
    max_daily_safety_multiplier: 3,
    current_basal_safety_multiplier: 4,
    skip_neutral_temps: false,
    ...overrides,
  };
}

describe('basal-set-temp characterization tests', () => {
  describe('getMaxSafeBasal', () => {
    it('standard profile', () => {
      const profile = makeProfile();
      expect(tempBasalFunctions.getMaxSafeBasal(profile)).toMatchSnapshot();
    });

    it('max_basal is the limiting factor', () => {
      const profile = makeProfile({ max_basal: 2.0 });
      expect(tempBasalFunctions.getMaxSafeBasal(profile)).toMatchSnapshot();
    });

    it('daily safety multiplier is the limiting factor', () => {
      const profile = makeProfile({ max_daily_basal: 0.5, max_daily_safety_multiplier: 3 });
      expect(tempBasalFunctions.getMaxSafeBasal(profile)).toMatchSnapshot();
    });

    it('current basal multiplier is the limiting factor', () => {
      const profile = makeProfile({ current_basal: 0.3, current_basal_safety_multiplier: 4 });
      expect(tempBasalFunctions.getMaxSafeBasal(profile)).toMatchSnapshot();
    });

    it('NaN safety multiplier defaults to 3/4', () => {
      const profile = makeProfile({
        max_daily_safety_multiplier: NaN,
        current_basal_safety_multiplier: NaN,
      });
      expect(tempBasalFunctions.getMaxSafeBasal(profile)).toMatchSnapshot();
    });

    it('null safety multiplier defaults to 3/4', () => {
      const profile = makeProfile({
        max_daily_safety_multiplier: null,
        current_basal_safety_multiplier: null,
      });
      expect(tempBasalFunctions.getMaxSafeBasal(profile)).toMatchSnapshot();
    });
  });

  describe('setTempBasal', () => {
    it('set high temp when no temp running', () => {
      const profile = makeProfile();
      const requestedTempBasalResult = { reason: '' };
      const currenttemp = { duration: 0, rate: 0 };
      const result = tempBasalFunctions.setTempBasal(2.0, 30, profile, requestedTempBasalResult, currenttemp);
      expect(result).toMatchSnapshot();
    });

    it('set zero temp when no temp running', () => {
      const profile = makeProfile();
      const requestedTempBasalResult = { reason: '' };
      const currenttemp = { duration: 0, rate: 0 };
      const result = tempBasalFunctions.setTempBasal(0, 30, profile, requestedTempBasalResult, currenttemp);
      expect(result).toMatchSnapshot();
    });

    it('rate clamped to zero when negative', () => {
      const profile = makeProfile();
      const requestedTempBasalResult = { reason: '' };
      const currenttemp = { duration: 0, rate: 0 };
      const result = tempBasalFunctions.setTempBasal(-1, 30, profile, requestedTempBasalResult, currenttemp);
      expect(result).toMatchSnapshot();
    });

    it('rate clamped to maxSafeBasal when too high', () => {
      const profile = makeProfile({ max_basal: 2.0 });
      const requestedTempBasalResult = { reason: '' };
      const currenttemp = { duration: 0, rate: 0 };
      const result = tempBasalFunctions.setTempBasal(5.0, 30, profile, requestedTempBasalResult, currenttemp);
      expect(result).toMatchSnapshot();
    });

    it('similar temp already running — no change needed', () => {
      const profile = makeProfile();
      const requestedTempBasalResult = { reason: '' };
      const currenttemp = { duration: 25, rate: 1.9 };
      const result = tempBasalFunctions.setTempBasal(2.0, 30, profile, requestedTempBasalResult, currenttemp);
      expect(result).toMatchSnapshot();
    });

    it('neutral temp — rate equals current basal', () => {
      const profile = makeProfile();
      const requestedTempBasalResult = { reason: '' };
      const currenttemp = { duration: 0, rate: 0 };
      const result = tempBasalFunctions.setTempBasal(0.9, 30, profile, requestedTempBasalResult, currenttemp);
      expect(result).toMatchSnapshot();
    });

    it('neutral temp with skip_neutral_temps — does nothing', () => {
      const profile = makeProfile({ skip_neutral_temps: true });
      const requestedTempBasalResult = { reason: '' };
      const currenttemp = { duration: 0, rate: 0 };
      const result = tempBasalFunctions.setTempBasal(0.9, 30, profile, requestedTempBasalResult, currenttemp);
      expect(result).toMatchSnapshot();
    });

    it('neutral temp with skip_neutral_temps and active temp — cancels', () => {
      const profile = makeProfile({ skip_neutral_temps: true });
      const requestedTempBasalResult = { reason: '' };
      const currenttemp = { duration: 20, rate: 1.5 };
      const result = tempBasalFunctions.setTempBasal(0.9, 30, profile, requestedTempBasalResult, currenttemp);
      expect(result).toMatchSnapshot();
    });
  });
});
