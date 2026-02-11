/**
 * Characterization tests for determine-basal/autosens.js (detectSensitivity)
 *
 * Tests the auto-sensitivity detection function that analyzes glucose data
 * to detect insulin sensitivity/resistance changes and compute adjustment
 * ratios. The function returns { ratio, newisf }.
 *
 * SAFETY: This is a characterization test suite. Snapshots capture the EXACT
 * current behavior. Do not update snapshots without understanding why they changed.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const detectSensitivity = require('../../../lib/determine-basal/autosens');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

/**
 * Creates a glucose data array in newest-first order.
 * @param readings Array of {bg, minsAgo} objects
 */
function makeGlucoseData(readings: Array<{ bg: number; minsAgo: number }>) {
  return readings.map((r) => ({
    glucose: r.bg,
    dateString: new Date(NOW - r.minsAgo * 60_000).toISOString(),
    date: NOW - r.minsAgo * 60_000,
  }));
}

/**
 * Create a series of glucose readings at 5-min intervals (newest-first).
 * @param startBG BG at most recent time
 * @param count Number of readings
 * @param deltaPerReading BG change per 5-min interval (positive = rising from past to present)
 */
function makeUniformGlucoseData(
  startBG: number,
  count: number,
  deltaPerReading: number = 0,
) {
  const data = [];
  for (let i = 0; i < count; i++) {
    const bg = Math.round(startBG - deltaPerReading * i);
    data.push({
      glucose: bg,
      dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
      date: NOW - i * 5 * 60_000,
    });
  }
  return data;
}

const BASAL_PROFILE = [{ i: 0, start: '00:00:00', rate: 1, minutes: 0 }];

function makeInputs(
  glucoseData: any[],
  overrides: Record<string, unknown> = {},
) {
  const base = {
    glucose_data: glucoseData,
    iob_inputs: {
      profile: {
        dia: 5,
        curve: 'rapid-acting',
        useCustomPeakTime: false,
        insulinPeakTime: 75,
        current_basal: 1,
        basalprofile: BASAL_PROFILE,
        min_5m_carbimpact: 8,
        carb_ratio: 10,
        sens: 40,
        isfProfile: { sensitivities: [{ offset: 0, sensitivity: 40 }] },
        max_daily_basal: 1,
        autosens_min: 0.7,
        autosens_max: 1.2,
        rewind_resets_autosens: true,
        high_temptarget_raises_sensitivity: false,
        exercise_mode: false,
        temptargetSet: false,
        maxMealAbsorptionTime: 6,
      },
      history: [] as any[],
      clock: FIXED_TIME,
    },
    basalprofile: BASAL_PROFILE,
    carbs: [],
    temptargets: [],
    retrospective: true,
    ...overrides,
  };

  // Allow nested profile overrides
  if (overrides.profileOverrides) {
    Object.assign(
      base.iob_inputs.profile,
      overrides.profileOverrides as Record<string, unknown>,
    );
    delete (base as any).profileOverrides;
  }

  // Allow overriding history
  if (overrides.history !== undefined) {
    base.iob_inputs.history = overrides.history as any[];
    delete (base as any).history;
  }

  return base;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('determine-basal/autosens (detectSensitivity) characterization tests', () => {
  // -----------------------------------------------------------------------
  // Core sensitivity detection
  // -----------------------------------------------------------------------
  describe('core sensitivity detection', () => {
    it('flat BG ~120 with no insulin and no meals returns ratio near 1.0', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('rising BG (positive deviations) indicates resistance', () => {
      // Rising: each older reading is lower, so deltaPerReading = -1
      // present=180, 5m ago=181, 10m ago=182, etc.
      const glucose = makeUniformGlucoseData(180, 40, -1);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('falling BG (negative deviations) indicates sensitivity', () => {
      // Falling: each older reading is higher, so deltaPerReading = 1
      // present=80, 5m ago=79, 10m ago=78, etc.
      const glucose = makeUniformGlucoseData(120, 40, 1);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Ratio clamping
  // -----------------------------------------------------------------------
  describe('ratio clamping', () => {
    it('very strong resistance is clamped to autosens_max (1.2)', () => {
      // Large positive deviations: BG rising steeply
      const glucose = makeUniformGlucoseData(250, 40, -5);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result.ratio).toBeLessThanOrEqual(1.2);
      expect(result).toMatchSnapshot();
    });

    it('very strong sensitivity is clamped to autosens_min (0.7)', () => {
      // Large negative deviations: BG falling steeply
      const glucose = makeUniformGlucoseData(200, 40, 5);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result.ratio).toBeGreaterThanOrEqual(0.7);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Site change / Rewind handling
  // -----------------------------------------------------------------------
  describe('site change / Rewind handling', () => {
    it('rewind_resets_autosens with Rewind event in history', () => {
      // Put a Rewind event 2 hours ago; only data after rewind should be used
      const rewindTime = new Date(NOW - 2 * 60 * 60_000).toISOString();
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose, {
        history: [
          // history[0] is skipped (loop starts at h=1), so put dummy first
          { _type: 'Bolus', timestamp: FIXED_TIME, amount: 0 },
          { _type: 'Rewind', timestamp: rewindTime },
        ],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('rewind_resets_autosens without Rewind event falls through to 24h default', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose, {
        history: [
          { _type: 'Bolus', timestamp: FIXED_TIME, amount: 0 },
        ],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Retrospective mode
  // -----------------------------------------------------------------------
  describe('retrospective mode', () => {
    it('retrospective: true uses glucose_data[0].date for 24h lookback', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose, { retrospective: true });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('retrospective: false uses current time for lookback', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose, { retrospective: false });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Glucose data edge cases
  // -----------------------------------------------------------------------
  describe('glucose data edge cases', () => {
    it('sgv field compat: entries with sgv instead of glucose', () => {
      const data = [];
      for (let i = 0; i < 40; i++) {
        data.push({
          sgv: 120,
          dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
          date: NOW - i * 5 * 60_000,
        });
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('display_time field format instead of dateString', () => {
      const data = [];
      for (let i = 0; i < 40; i++) {
        const d = new Date(NOW - i * 5 * 60_000);
        // display_time uses space instead of T (the replace call in the code handles T too)
        const displayTime = d.toISOString().replace('T', ' ').replace('Z', '');
        data.push({
          glucose: 120,
          display_time: displayTime,
          date: NOW - i * 5 * 60_000,
        });
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('BG < 39 entries are skipped', () => {
      // Mix some sub-39 readings into normal data
      const readings: Array<{ bg: number; minsAgo: number }> = [];
      for (let i = 0; i < 40; i++) {
        const bg = i % 7 === 0 ? 30 : 120; // every 7th reading is sub-39
        readings.push({ bg, minsAgo: i * 5 });
      }
      const glucose = makeGlucoseData(readings);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('BG < 80 zeros positive deviations', () => {
      // BG at 75, slightly rising (would normally produce positive deviations)
      const glucose = makeUniformGlucoseData(75, 40, -0.5);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      // With positive deviations zeroed, ratio should stay near or below 1.0
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Meal exclusion
  // -----------------------------------------------------------------------
  describe('meal exclusion', () => {
    it('carbs present: meal deviations are excluded from autosens', () => {
      // Rising BG with carbs entered 1h ago
      const glucose = makeUniformGlucoseData(180, 40, -1);
      const carbTime = new Date(NOW - 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        carbs: [{ carbs: 50, created_at: carbTime }],
      });
      // Override profileOverrides for meal handling
      (inputs.iob_inputs.profile as any).maxMealAbsorptionTime = 6;
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // UAM exclusion
  // -----------------------------------------------------------------------
  describe('UAM exclusion', () => {
    it('UAM detected in non-retrospective mode: deviations excluded', () => {
      // non-retrospective mode with rising BG; IOB would need to be > 2*currentBasal
      // But since we have no insulin history, IOB=0, so UAM won't trigger from IOB alone.
      // However, mealStartCounter < 9 also triggers UAM-like exclusion.
      // We provide a carb entry in the near past to trigger the meal path first,
      // then after COB=0, UAM should kick in for subsequent positive deviations.
      const glucose = makeUniformGlucoseData(200, 40, -2);
      const carbTime = new Date(NOW - 150 * 60_000).toISOString(); // 2.5h ago
      const inputs = makeInputs(glucose, {
        retrospective: false,
        carbs: [{ carbs: 10, created_at: carbTime }],
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Exercise mode / temp targets
  // -----------------------------------------------------------------------
  describe('exercise mode / temp targets', () => {
    it('exercise_mode with high temp target adds negative deviations', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      // Temp target started 2 hours ago, duration 3 hours, target 120
      const ttStart = new Date(NOW - 2 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        temptargets: [
          {
            created_at: ttStart,
            duration: 180, // 3 hours
            targetTop: 120,
            targetBottom: 120,
          },
        ],
        profileOverrides: {
          exercise_mode: true,
          high_temptarget_raises_sensitivity: true,
        },
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('temp target with duration 0 (cancelled) returns 0 from tempTargetRunning', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      // First a high temp target, then cancelled
      const ttStart = new Date(NOW - 2 * 60 * 60_000).toISOString();
      const ttCancel = new Date(NOW - 1 * 60 * 60_000).toISOString();
      const inputs = makeInputs(glucose, {
        temptargets: [
          {
            created_at: ttStart,
            duration: 180,
            targetTop: 120,
            targetBottom: 120,
          },
          {
            created_at: ttCancel,
            duration: 0,
            targetTop: 120,
            targetBottom: 120,
          },
        ],
        profileOverrides: {
          exercise_mode: true,
          high_temptarget_raises_sensitivity: true,
        },
      });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // Lookback and padding
  // -----------------------------------------------------------------------
  describe('lookback and padding', () => {
    it('custom deviations lookback of 48 (4h)', () => {
      const glucose = makeUniformGlucoseData(120, 40, 0);
      const inputs = makeInputs(glucose, { deviations: 48 });
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });

    it('few data points get zero-padded', () => {
      // Only 10 data points -- far less than 96
      const glucose = makeUniformGlucoseData(120, 10, 0);
      const inputs = makeInputs(glucose);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });

  // -----------------------------------------------------------------------
  // xDrip_started_at handling
  // -----------------------------------------------------------------------
  describe('xDrip_started_at handling', () => {
    it('entries with xDrip_started_at are skipped', () => {
      // Mix normal entries with xDrip entries
      const data: any[] = [];
      for (let i = 0; i < 40; i++) {
        const entry: any = {
          glucose: 120,
          date: NOW - i * 5 * 60_000,
        };
        if (i % 5 === 2) {
          // Every 5th entry (starting at index 2) is xDrip-only
          entry.xDrip_started_at = new Date(
            NOW - i * 5 * 60_000,
          ).toISOString();
          // No dateString or display_time -> triggers xDrip_started_at continue
        } else {
          entry.dateString = new Date(NOW - i * 5 * 60_000).toISOString();
        }
        data.push(entry);
      }
      const inputs = makeInputs(data);
      const result = detectSensitivity(inputs);
      expect(result).toMatchSnapshot();
    });
  });
});
