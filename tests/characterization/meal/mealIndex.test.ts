/**
 * Characterization tests for meal/index.js (generate)
 *
 * Tests the thin wrapper function that:
 * 1. Calls meal/history (findMealInputs) to extract treatments
 * 2. Calls meal/total (recentCarbs) with those treatments + other inputs
 *
 * Provides full inputs: { clock, history, carbs, profile, glucose, basalprofile }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generate as mealGenerate } from '../../../src/meal/index';
import type { PumpHistoryEvent, GlucoseEntry, BasalProfileEntry } from '../../../src/types/index';
import type { IobProfile } from '../../../src/iob/types';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

const BASAL_PROFILE = [{ i: 0, start: '00:00:00', rate: 1, minutes: 0 }];

function ts(minsAgo: number): string {
  return new Date(NOW - minsAgo * 60_000).toISOString();
}

/**
 * Creates reverse-chronological glucose array (newest first).
 */
function makeGlucoseData(
  startBG: number,
  deltas: number[],
): Array<{ glucose: number; dateString: string }> {
  const data: Array<{ glucose: number; dateString: string }> = [];
  let bg = startBG;
  for (let i = 0; i <= deltas.length; i++) {
    data.push({
      glucose: Math.round(bg),
      dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
    });
    if (i < deltas.length) bg -= deltas[i];
  }
  return data;
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    dia: 5,
    curve: 'rapid-acting' as const,
    useCustomPeakTime: false,
    insulinPeakTime: 75,
    current_basal: 1,
    basalprofile: BASAL_PROFILE,
    min_5m_carbimpact: 8,
    carb_ratio: 10,
    sens: 40,
    isfProfile: { sensitivities: [{ offset: 0, sensitivity: 40 }] },
    maxMealAbsorptionTime: 6,
    max_daily_basal: 1,
    maxCOB: 120,
    ...overrides,
  };
}

function defaultGlucose() {
  return makeGlucoseData(120, [0, 0, 0, 0, 0, 0]);
}

function risingGlucose() {
  return makeGlucoseData(160, [5, 5, 5, 5, 5, 5]);
}

function makeInputs(overrides: {
  history?: PumpHistoryEvent[];
  carbs?: PumpHistoryEvent[];
  profile?: IobProfile & Record<string, unknown>;
  glucose?: GlucoseEntry[];
  basalprofile?: BasalProfileEntry[];
} = {}) {
  return {
    clock: FIXED_TIME,
    history: overrides.history ?? [],
    carbs: overrides.carbs ?? [],
    profile: overrides.profile ?? makeProfile(),
    glucose: overrides.glucose ?? defaultGlucose(),
    basalprofile: overrides.basalprofile ?? BASAL_PROFILE,
  };
}

describe('meal/index (generate) characterization tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // No carbs, no history
  // -------------------------------------------------------------------------
  describe('empty inputs', () => {
    it('returns zero carbs and zero COB with empty history and carbs', () => {
      const inputs = makeInputs();
      const result = mealGenerate(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Simple carb entry from NS
  // -------------------------------------------------------------------------
  describe('simple NS carb entry', () => {
    it('processes a single carb entry from carbs array', () => {
      const inputs = makeInputs({
        carbs: [{ created_at: ts(30), carbs: 45 }],
        glucose: risingGlucose(),
      });
      const result = mealGenerate(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Pump history bolus + carbs
  // -------------------------------------------------------------------------
  describe('pump history bolus with NS carbs', () => {
    it('processes bolus from pump history combined with NS carbs', () => {
      const bolusTime = ts(30);
      const inputs = makeInputs({
        carbs: [{ created_at: ts(30), carbs: 40 }],
        history: [
          { _type: 'Bolus', timestamp: bolusTime, amount: 4.0 },
        ],
        glucose: risingGlucose(),
      });
      const result = mealGenerate(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Mixed sources
  // -------------------------------------------------------------------------
  describe('mixed sources', () => {
    it('processes NS carbs + pump boluses + BolusWizard entries', () => {
      const bolusTime = ts(60);
      const inputs = makeInputs({
        carbs: [
          { created_at: ts(90), carbs: 50 },
          { created_at: ts(30), carbs: 20 },
        ],
        history: [
          { _type: 'Bolus', timestamp: bolusTime, amount: 3.0 },
          { _type: 'BolusWizard', timestamp: bolusTime, carb_input: 35 },
          { _type: 'Meal Bolus', created_at: ts(45), carbs: 15 },
        ],
        glucose: risingGlucose(),
      });
      const result = mealGenerate(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Flat glucose (no absorption detected)
  // -------------------------------------------------------------------------
  describe('flat glucose with carbs', () => {
    it('shows low COB when glucose is flat despite carbs', () => {
      const inputs = makeInputs({
        carbs: [{ created_at: ts(30), carbs: 40 }],
        glucose: defaultGlucose(), // flat at 120
      });
      const result = mealGenerate(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Custom profile settings
  // -------------------------------------------------------------------------
  describe('custom profile', () => {
    it('uses custom maxCOB to cap COB value', () => {
      const inputs = makeInputs({
        carbs: [{ created_at: ts(10), carbs: 200 }],
        profile: makeProfile({ maxCOB: 10 }),
        glucose: risingGlucose(),
      });
      const result = mealGenerate(inputs);
      expect(result).toMatchSnapshot();
    });
  });
});
