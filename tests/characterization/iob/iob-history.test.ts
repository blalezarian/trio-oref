/**
 * Characterization tests for iob/history.js (calcTempTreatments)
 *
 * Tests the pump history parsing pipeline that converts raw pump events
 * into treatment boluses for IOB calculation. Covers:
 * - TempBasal + TempBasalDuration pairing
 * - Temp basal with percent type (should be skipped)
 * - Multiple consecutive temp basals (overlap trimming)
 * - PumpSuspend + PumpResume events
 * - suspend_zeros_iob profile setting
 * - Nightscout-style Temp Basal treatments (HAPP_App, AndroidAPS, Loop)
 * - Care Portal entries (Meal Bolus, Correction Bolus, Snack Bolus, Bolus Wizard)
 * - xdrip entries
 * - HAPP_App bolus entries
 * - Bolus events with nested bolus object
 * - Zero-rate temp basals
 * - Profile basal subtraction logic
 * - splitTimespan / splitTimespanWithOneSplitter
 * - splitAroundSuspends
 * - Deduplication of out-of-order records
 * - zeroTempDuration parameter
 * - exercise_mode and temptargetSet sensitivity adjustments
 * - autosens ratio adjustments
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const calcTempTreatments = require('../../../lib/iob/history');

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

function ts(minsAgo: number): string {
  return new Date(NOW - minsAgo * 60_000).toISOString();
}

const BASAL_PROFILE = [{ i: 0, start: '00:00:00', rate: 1, minutes: 0 }];

function makeInputs(
  history: unknown[],
  profileOverrides: Record<string, unknown> = {},
  extras: Record<string, unknown> = {},
) {
  return {
    clock: FIXED_TIME,
    history,
    profile: {
      dia: 5,
      curve: 'rapid-acting',
      basalprofile: BASAL_PROFILE,
      current_basal: 1,
      max_daily_basal: 1,
      ...profileOverrides,
    },
    ...extras,
  };
}

/** Strip non-deterministic date objects for stable snapshots */
function normalizeResults(results: any[]) {
  return results.map((item) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(item)) {
      if (key === 'date') {
        // Normalize date relative to NOW
        out[key] = `[NOW${item[key] >= NOW ? '+' : ''}${Math.round((item[key] - NOW) / 60000)}m]`;
      } else if (key === 'started_at' || key === 'created_at') {
        if (item[key] instanceof Date) {
          const diff = Math.round((item[key].getTime() - NOW) / 60000);
          out[key] = `[NOW${diff >= 0 ? '+' : ''}${diff}m]`;
        } else {
          out[key] = item[key];
        }
      } else {
        out[key] = item[key];
      }
    }
    return out;
  });
}

describe('iob/history (calcTempTreatments) characterization tests', () => {
  describe('basic Bolus events', () => {
    it('single Bolus event', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 2, timestamp: ts(30) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('multiple Bolus events at different times', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: ts(30) },
        { _type: 'Bolus', amount: 2, timestamp: ts(60) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('nested bolus object (current.bolus._type === Bolus)', () => {
      const inputs = makeInputs([
        { bolus: { _type: 'Bolus', amount: 1.5, timestamp: ts(45) } },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('TempBasal + TempBasalDuration pairing', () => {
    it('TempBasal with adjacent TempBasalDuration (i-1 match)', () => {
      const inputs = makeInputs([
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(60) },
        { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('TempBasal with non-adjacent TempBasalDuration (scan loop)', () => {
      // TempBasalDuration is not at i-1 but elsewhere in the array
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: ts(60) },
        { _type: 'TempBasal', rate: 1.5, timestamp: ts(60) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(60) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('TempBasal with no matching TempBasalDuration (undefined duration)', () => {
      const inputs = makeInputs([
        { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('TempBasal with percent type is skipped', () => {
      const inputs = makeInputs([
        { _type: 'TempBasal', rate: 50, temp: 'percent', timestamp: ts(60) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(60) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('consecutive temp basals (overlap trimming)', () => {
    it('two overlapping temp basals get durations trimmed', () => {
      const inputs = makeInputs([
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(20) },
        { _type: 'TempBasal', rate: 2, timestamp: ts(20) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(40) },
        { _type: 'TempBasal', rate: 0, timestamp: ts(40) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('temp basal with null duration successor gets spliced', () => {
      // The code checks: if (tempHistory[i+1].duration === null) splice
      const inputs = makeInputs([
        { _type: 'TempBasalDuration', 'duration (min)': 60, timestamp: ts(30) },
        { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        // A Nightscout "Cancel TBR" with null duration
        {
          eventType: 'Temp Basal',
          rate: 0,
          duration: null,
          timestamp: ts(15),
          started_at: ts(15),
        },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('Nightscout / Care Portal treatment types', () => {
    it('Meal Bolus eventType', () => {
      const inputs = makeInputs([
        { eventType: 'Meal Bolus', insulin: 3, created_at: ts(30) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('Correction Bolus eventType', () => {
      const inputs = makeInputs([
        { eventType: 'Correction Bolus', insulin: 1.5, created_at: ts(45) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('Snack Bolus eventType', () => {
      const inputs = makeInputs([
        { eventType: 'Snack Bolus', insulin: 2, created_at: ts(20) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('Bolus Wizard eventType', () => {
      const inputs = makeInputs([
        { eventType: 'Bolus Wizard', insulin: 4, created_at: ts(60) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('xdrip enteredBy', () => {
      const inputs = makeInputs([
        { enteredBy: 'xdrip', insulin: 1, timestamp: ts(30) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('HAPP_App enteredBy with insulin', () => {
      const inputs = makeInputs([
        { enteredBy: 'HAPP_App', insulin: 2, created_at: ts(30) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('HAPP_App enteredBy without insulin (no bolus created)', () => {
      const inputs = makeInputs([
        { enteredBy: 'HAPP_App', created_at: ts(30) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('Temp Basal eventType from HAPP_App (uses absolute field)', () => {
      const inputs = makeInputs([
        {
          eventType: 'Temp Basal',
          enteredBy: 'HAPP_App',
          absolute: 2.5,
          duration: 30,
          created_at: ts(60),
        },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('Temp Basal eventType from AndroidAPS (uses absolute field)', () => {
      const inputs = makeInputs([
        {
          eventType: 'Temp Basal',
          enteredBy: 'openaps://AndroidAPS',
          absolute: 1.8,
          duration: 30,
          created_at: ts(45),
        },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('Temp Basal eventType (generic, uses rate field)', () => {
      const inputs = makeInputs([
        {
          eventType: 'Temp Basal',
          rate: 2,
          duration: 30,
          timestamp: ts(60),
        },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('Temp Basal eventType with amount field (Loop style)', () => {
      // Loop reports amount of insulin actually delivered; code calculates rate from it
      const inputs = makeInputs([
        {
          eventType: 'Temp Basal',
          rate: 2,
          amount: 0.5,
          duration: 30,
          timestamp: ts(60),
        },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('PumpSuspend and PumpResume handling', () => {
    it('single suspend and resume pair', () => {
      const inputs = makeInputs([
        { _type: 'PumpResume', timestamp: ts(30) },
        { _type: 'PumpSuspend', timestamp: ts(60) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('suspend without resume (currentlySuspended)', () => {
      const inputs = makeInputs([
        { _type: 'PumpSuspend', timestamp: ts(30) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('resume without prior suspend (suspendedPrior)', () => {
      const inputs = makeInputs([
        { _type: 'PumpResume', timestamp: ts(30) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('resume before first suspend (suspendedPrior)', () => {
      const inputs = makeInputs([
        { _type: 'PumpResume', timestamp: ts(60) },
        { _type: 'PumpSuspend', timestamp: ts(30) },
        { _type: 'PumpResume', timestamp: ts(10) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('multiple suspends and resumes', () => {
      const inputs = makeInputs([
        { _type: 'PumpResume', timestamp: ts(10) },
        { _type: 'PumpSuspend', timestamp: ts(20) },
        { _type: 'PumpResume', timestamp: ts(40) },
        { _type: 'PumpSuspend', timestamp: ts(50) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('mismatched: more resumes than suspends', () => {
      const inputs = makeInputs([
        { _type: 'PumpResume', timestamp: ts(10) },
        { _type: 'PumpResume', timestamp: ts(30) },
        { _type: 'PumpSuspend', timestamp: ts(50) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('mismatched: more suspends than resumes', () => {
      const inputs = makeInputs([
        { _type: 'PumpResume', timestamp: ts(10) },
        { _type: 'PumpSuspend', timestamp: ts(20) },
        { _type: 'PumpSuspend', timestamp: ts(40) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('suspend_zeros_iob: true', () => {
    it('suspend zeros IOB with suspend/resume around a temp basal', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 60, timestamp: ts(90) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(90) },
          { _type: 'PumpSuspend', timestamp: ts(60) },
          { _type: 'PumpResume', timestamp: ts(30) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('suspend_zeros_iob with suspendedPrior', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(60) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
          { _type: 'PumpResume', timestamp: ts(45) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('suspend_zeros_iob with currentlySuspended', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(90) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(90) },
          { _type: 'PumpSuspend', timestamp: ts(30) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('suspend_zeros_iob with both suspendedPrior and currentlySuspended', () => {
      const inputs = makeInputs(
        [
          { _type: 'PumpResume', timestamp: ts(120) },
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(90) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(90) },
          { _type: 'PumpSuspend', timestamp: ts(30) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('suspend_zeros_iob: false (default path)', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(60) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
          { _type: 'PumpSuspend', timestamp: ts(45) },
          { _type: 'PumpResume', timestamp: ts(30) },
        ],
        { suspend_zeros_iob: false },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('zero-rate temp basals', () => {
    it('zero-rate temp basal produces negative IOB', () => {
      const inputs = makeInputs([
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
        { _type: 'TempBasal', rate: 0, timestamp: ts(30) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('zeroTempDuration parameter', () => {
    it('with zeroTempDuration set', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: ts(30) },
      ]);
      const result = calcTempTreatments(inputs, 30);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('without zeroTempDuration (defaults to 0)', () => {
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: ts(30) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('history24 merging', () => {
    it('merges history and history24', () => {
      const inputs = {
        clock: FIXED_TIME,
        history: [
          { _type: 'Bolus', amount: 1, timestamp: ts(30) },
        ],
        history24: [
          { _type: 'Bolus', amount: 2, timestamp: ts(120) },
        ],
        profile: {
          dia: 5,
          curve: 'rapid-acting',
          basalprofile: BASAL_PROFILE,
          current_basal: 1,
          max_daily_basal: 1,
        },
      };
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('out-of-order / duplicate record filtering', () => {
    it('ignores records with timestamps after the previous record (future relative to iteration order)', () => {
      // Records should be in reverse chronological order normally;
      // an out-of-order record (newer than previous) should be skipped
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: ts(60) },
        // This timestamp is AFTER the previous one in the iteration (ts(30) > ts(60))
        // so it should be skipped
        { _type: 'Bolus', amount: 5, timestamp: ts(30) },
        { _type: 'Bolus', amount: 2, timestamp: ts(90) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('created_at field handling', () => {
    it('uses created_at as timestamp when present', () => {
      const inputs = makeInputs([
        { eventType: 'Meal Bolus', insulin: 2, created_at: ts(45) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('profile basal subtraction and sensitivity', () => {
    it('high temp with multi-segment basal profile', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
          { _type: 'TempBasal', rate: 3, timestamp: ts(30) },
        ],
        {
          basalprofile: [
            { i: 0, start: '00:00:00', rate: 0.8, minutes: 0 },
            { i: 1, start: '08:00:00', rate: 1.2, minutes: 480 },
            { i: 2, start: '16:00:00', rate: 1.0, minutes: 960 },
          ],
          current_basal: 1.2,
        },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('temp basal rate equal to profile basal (net zero)', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
          { _type: 'TempBasal', rate: 1, timestamp: ts(30) },
        ],
        { current_basal: 1 },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('with empty basalprofile uses current_basal', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        ],
        {
          basalprofile: [],
          current_basal: 1.5,
        },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('with autosens ratio adjusting basal', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        ],
        {
          current_basal: 1,
          min_bg: 100,
          max_bg: 120,
        },
      );
      inputs.autosens = { ratio: 1.2 } as any;
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('with exercise_mode and temptargetSet', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        ],
        {
          current_basal: 1,
          min_bg: 140,
          max_bg: 160,
          exercise_mode: true,
          temptargetSet: true,
          half_basal_exercise_target: 160,
        },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('exercise_mode with custom half_basal_exercise_target', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        ],
        {
          current_basal: 1,
          min_bg: 120,
          max_bg: 120,
          exercise_mode: true,
          temptargetSet: true,
        },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('exercise_mode without temptargetSet falls through to autosens', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        ],
        {
          current_basal: 1,
          min_bg: 100,
          max_bg: 100,
          exercise_mode: true,
          temptargetSet: false,
        },
      );
      inputs.autosens = { ratio: 0.9 } as any;
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('splitTimespan with basal profile changes', () => {
    it('long temp basal spanning a basal profile change boundary', () => {
      // Temp basal that runs for 60 minutes, which exceeds 30m split threshold
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 60, timestamp: ts(60) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
        ],
        {
          basalprofile: [
            { i: 0, start: '00:00:00', rate: 0.8, minutes: 0 },
            { i: 1, start: '11:30:00', rate: 1.2, minutes: 690 },
          ],
          current_basal: 1.2,
        },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('splitAroundSuspends edge cases', () => {
    it('temp basal entirely within suspend period (duration zeroed)', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(50) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(50) },
          { _type: 'PumpSuspend', timestamp: ts(55) },
          { _type: 'PumpResume', timestamp: ts(10) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('temp basal starting before suspend and ending after resume', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 60, timestamp: ts(70) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(70) },
          { _type: 'PumpSuspend', timestamp: ts(50) },
          { _type: 'PumpResume', timestamp: ts(30) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('suspend starting after temp basal starts and ending during it', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 60, timestamp: ts(60) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
          { _type: 'PumpSuspend', timestamp: ts(40) },
          { _type: 'PumpResume', timestamp: ts(20) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('mismatched suspend/resume error paths', () => {
    it('suspendedPrior and currentlySuspended with mismatched counts', () => {
      const inputs = makeInputs(
        [
          { _type: 'PumpResume', timestamp: ts(120) },
          { _type: 'PumpSuspend', timestamp: ts(90) },
          { _type: 'PumpResume', timestamp: ts(60) },
          { _type: 'PumpSuspend', timestamp: ts(30) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('suspendedPrior with matching counts (resumes-1 === suspends)', () => {
      const inputs = makeInputs(
        [
          { _type: 'PumpResume', timestamp: ts(90) },
          { _type: 'PumpSuspend', timestamp: ts(60) },
          { _type: 'PumpResume', timestamp: ts(30) },
        ],
        { suspend_zeros_iob: false },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });

    it('currentlySuspended with matching counts (resumes === suspends-1)', () => {
      const inputs = makeInputs(
        [
          { _type: 'PumpSuspend', timestamp: ts(60) },
          { _type: 'PumpResume', timestamp: ts(90) },
          { _type: 'PumpSuspend', timestamp: ts(120) },
        ],
        { suspend_zeros_iob: false },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('temp basal below profile rate (negative net)', () => {
    it('low temp basal produces negative tempBolusSize', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
          { _type: 'TempBasal', rate: 0.2, timestamp: ts(30) },
        ],
        { current_basal: 2 },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  describe('target_bg computation with min_bg/max_bg', () => {
    it('min_bg and max_bg defined computes target_bg', () => {
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        ],
        {
          min_bg: 90,
          max_bg: 110,
        },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });
});
