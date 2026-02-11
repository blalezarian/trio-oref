/**
 * Characterization tests for profile/index.js
 *
 * Tests profile generation from pump settings, including defaults,
 * basal lookups, ISF/CR lookups, target processing, and temp targets.
 */

import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const require = createRequire(import.meta.url);
const profileModule = require('../../../lib/profile/index');

// Pin clock to 12:00 UTC so basalLookup (which calls new Date()) is deterministic
const FIXED_TIME = new Date('2025-01-15T12:00:00.000Z');

function makeInputs(overrides: Record<string, unknown> = {}) {
  return {
    settings: { insulin_action_curve: 5, maxBasal: 3.5 },
    basals: [
      { minutes: 0, rate: 0.8 },
      { minutes: 360, rate: 0.9 },
      { minutes: 720, rate: 1.0 },
      { minutes: 1080, rate: 0.85 },
    ],
    targets: {
      user_preferred_units: 'mg/dL',
      targets: [
        { offset: 0, low: 110, high: 120, min_bg: 110, max_bg: 120 },
      ],
    },
    isf: {
      sensitivities: [{ offset: 0, sensitivity: 40 }],
    },
    carbratio: {
      units: 'grams',
      schedule: [{ offset: 0, ratio: 10 }],
    },
    temptargets: [],
    skip_neutral_temps: false,
    ...overrides,
  };
}

describe('profile characterization tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('defaults', () => {
    it('returns full default profile', () => {
      expect(profileModule.defaults()).toMatchSnapshot();
    });
  });

  describe('generate', () => {
    it('standard profile from pump settings', () => {
      const result = profileModule(makeInputs());
      expect(result).toMatchSnapshot();
    });

    it('profile with DIA=3', () => {
      const result = profileModule(makeInputs({
        settings: { insulin_action_curve: 3, maxBasal: 3.5 },
      }));
      expect(result).toMatchSnapshot();
    });

    it('profile with DIA=7', () => {
      const result = profileModule(makeInputs({
        settings: { insulin_action_curve: 7, maxBasal: 3.5 },
      }));
      expect(result).toMatchSnapshot();
    });

    it('profile with custom preferences overrides', () => {
      const result = profileModule(makeInputs({
        enableSMB_always: true,
        enableUAM: true,
        max_iob: 5,
        curve: 'ultra-rapid',
      }));
      expect(result).toMatchSnapshot();
    });

    it('profile with mmol/L units', () => {
      const result = profileModule(makeInputs({
        targets: {
          user_preferred_units: 'mmol/L',
          targets: [{ offset: 0, low: 110, high: 120, min_bg: 110, max_bg: 120 }],
        },
      }));
      expect(result).toMatchSnapshot();
    });

    it('invalid DIA (<= 1) returns -1', () => {
      const result = profileModule(makeInputs({
        settings: { insulin_action_curve: 0.5, maxBasal: 3.5 },
      }));
      expect(result).toMatchSnapshot();
    });

    it('profile with multiple basal periods', () => {
      const result = profileModule(makeInputs({
        basals: [
          { minutes: 0, rate: 0.6 },
          { minutes: 180, rate: 0.8 },
          { minutes: 360, rate: 1.1 },
          { minutes: 540, rate: 0.9 },
          { minutes: 720, rate: 0.7 },
          { minutes: 900, rate: 0.8 },
          { minutes: 1080, rate: 0.65 },
          { minutes: 1260, rate: 0.6 },
        ],
      }));
      expect(result).toMatchSnapshot();
    });

    it('profile with multiple ISF entries', () => {
      const result = profileModule(makeInputs({
        isf: {
          sensitivities: [
            { offset: 0, sensitivity: 50 },
            { offset: 360, sensitivity: 40 },
            { offset: 720, sensitivity: 35 },
          ],
        },
      }));
      expect(result).toMatchSnapshot();
    });
  });
});
