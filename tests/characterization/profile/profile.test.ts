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

    // -----------------------------------------------------------------------
    // Model handling
    // -----------------------------------------------------------------------
    it('profile with model set stores model in output', () => {
      const result = profileModule(makeInputs({
        model: '723',
      }));
      expect(result).toMatchSnapshot();
    });

    it('profile without model does not set model property', () => {
      const result = profileModule(makeInputs());
      expect(result).toMatchSnapshot();
    });

    // -----------------------------------------------------------------------
    // Zero basal validation
    // -----------------------------------------------------------------------
    it('returns -1 when current_basal is 0', () => {
      // All rates are 0, which means basalLookup returns undefined (bad schedule)
      // But current_basal === 0 triggers the guard
      const result = profileModule(makeInputs({
        basals: [
          { minutes: 0, rate: 0 },
        ],
      }));
      expect(result).toMatchSnapshot();
    });

    it('returns -1 when max_daily_basal is 0 (all rates are 0)', () => {
      // Need at least one non-zero rate so basalLookup doesn't fail,
      // but max_daily_basal looks at all entries.
      // Actually, if current_basal is 0 it returns -1 first.
      // We need a scenario where current_basal != 0 but max_daily_basal == 0.
      // Since max_daily_basal is max of all rates, this only happens when all rates are 0,
      // which also causes current_basal == 0. So this branch is hit in same scenario.
      // Let's test with a single zero-rate entry.
      const result = profileModule(makeInputs({
        basals: [
          { minutes: 0, rate: 0 },
          { minutes: 720, rate: 0 },
        ],
      }));
      expect(result).toMatchSnapshot();
    });

    // -----------------------------------------------------------------------
    // max_basal < 0.1
    // -----------------------------------------------------------------------
    it('returns -1 when max_basal (settings.maxBasal) is < 0.1', () => {
      const result = profileModule(makeInputs({
        settings: { insulin_action_curve: 5, maxBasal: 0.05 },
      }));
      expect(result).toMatchSnapshot();
    });

    it('returns -1 when max_basal is 0', () => {
      const result = profileModule(makeInputs({
        settings: { insulin_action_curve: 5, maxBasal: 0 },
      }));
      expect(result).toMatchSnapshot();
    });

    // -----------------------------------------------------------------------
    // ISF < 5
    // -----------------------------------------------------------------------
    it('returns -1 when ISF is < 5', () => {
      const result = profileModule(makeInputs({
        isf: {
          sensitivities: [{ offset: 0, sensitivity: 3 }],
        },
      }));
      expect(result).toMatchSnapshot();
    });

    it('returns -1 when ISF is exactly 0', () => {
      const result = profileModule(makeInputs({
        isf: {
          sensitivities: [{ offset: 0, sensitivity: 0 }],
        },
      }));
      expect(result).toMatchSnapshot();
    });

    it('returns -1 when ISF is -1 (bad first offset)', () => {
      const result = profileModule(makeInputs({
        isf: {
          sensitivities: [{ offset: 60, sensitivity: 40 }],
        },
      }));
      expect(result).toMatchSnapshot();
    });

    // -----------------------------------------------------------------------
    // Missing carbratio
    // -----------------------------------------------------------------------
    it('generates profile without carb_ratio when carbratio is missing', () => {
      const inputs = makeInputs();
      delete (inputs as any).carbratio;
      const result = profileModule(inputs);
      expect(result).toMatchSnapshot();
    });

    // -----------------------------------------------------------------------
    // opts parameter with type property
    // -----------------------------------------------------------------------
    it('uses opts as profile when opts has type property', () => {
      const customOpts = {
        type: 'custom',
        max_iob: 10,
        max_daily_safety_multiplier: 3,
        current_basal_safety_multiplier: 4,
      };
      const result = profileModule(makeInputs(), customOpts);
      expect(result).toMatchSnapshot();
    });

    // -----------------------------------------------------------------------
    // displayedDefaults() — covers lines 84-117
    // -----------------------------------------------------------------------
    it('returns displayedDefaults subset of default profile', () => {
      const result = profileModule.displayedDefaults();
      expect(result).toMatchSnapshot();
    });

    // -----------------------------------------------------------------------
    // current_basal === 0 guard (line 153-155)
    // Need a basal schedule where basalLookup returns exactly 0 at noon
    // (last entry non-zero so basalLookup doesn't bail, but noon entry rate=0)
    // -----------------------------------------------------------------------
    it('returns -1 when current_basal is exactly 0 from basalLookup', () => {
      const result = profileModule(makeInputs({
        basals: [
          { minutes: 0, rate: 0 },       // midnight to noon: rate 0
          { minutes: 720, rate: 0 },      // noon to 6pm: rate 0
          { minutes: 1080, rate: 0.5 },   // 6pm onwards: rate 0.5 (non-zero so basalLookup doesn't bail)
        ],
      }));
      expect(result).toMatchSnapshot();
    });

    // -----------------------------------------------------------------------
    // ISF < 5 guard (line 184-186)
    // Need to pass through basal checks first, then fail at ISF check.
    // Must avoid ISF cache issues by using a fresh sensitivity value.
    // -----------------------------------------------------------------------
    it('returns -1 when ISF is less than 5 (with valid basals)', () => {
      const result = profileModule(makeInputs({
        isf: {
          sensitivities: [{ offset: 0, sensitivity: 2 }],
        },
      }));
      expect(result).toMatchSnapshot();
    });
  });
});
