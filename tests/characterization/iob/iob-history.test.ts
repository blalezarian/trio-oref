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

import { describe, it, expect } from 'vitest';
import calcTempTreatments from '../../../src/iob/extract-treatments';

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
      curve: 'rapid-acting' as const,
      basalprofile: BASAL_PROFILE,
      current_basal: 1,
      max_daily_basal: 1,
      ...profileOverrides,
    },
    ...extras,
  } as any;
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
          curve: 'rapid-acting' as const,
          basalprofile: BASAL_PROFILE,
          current_basal: 1,
          max_daily_basal: 1,
        },
      };
      const result = calcTempTreatments(inputs as any);
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

  // -------------------------------------------------------------------------
  // Bolus in the future (line 286): started_at > now
  // -------------------------------------------------------------------------
  describe('bolus in the future', () => {
    it('ignores a Bolus event with a timestamp in the future', () => {
      const futureTs = new Date(NOW + 30 * 60_000).toISOString();
      const inputs = makeInputs([
        { _type: 'Bolus', amount: 3, timestamp: futureTs },
        { _type: 'Bolus', amount: 1, timestamp: ts(30) },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // splitAroundSuspends: suspendedPrior with event entirely before resume (line 94-95)
  // -------------------------------------------------------------------------
  describe('splitAroundSuspends: event entirely before first resume', () => {
    it('zeros duration when event ends before first resume with suspend_zeros_iob', () => {
      // suspendedPrior: resume at 120m ago, no preceding suspend
      // TempBasal from 180m ago for 30m => ends at 150m ago, which is before resume at 120m ago
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(180) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(180) },
          { _type: 'PumpResume', timestamp: ts(120) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // splitAroundSuspends: currentlySuspended with event starting after last suspend (line 105-106)
  // -------------------------------------------------------------------------
  describe('splitAroundSuspends: event starting after last suspend', () => {
    it('zeros duration when event starts after last suspend time', () => {
      // PumpSuspend at 60m ago, no resume => currentlySuspended
      // TempBasal at 30m ago (starts AFTER suspend) => duration set to 0
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 20, timestamp: ts(30) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
          { _type: 'PumpSuspend', timestamp: ts(60) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // splitAroundSuspends: currentlySuspended with event starting before last suspend (line 107-108)
  // -------------------------------------------------------------------------
  describe('splitAroundSuspends: event straddling last suspend', () => {
    it('trims duration when event starts before last suspend but extends past it', () => {
      // PumpSuspend at 30m ago, no resume => currentlySuspended
      // TempBasal from 60m ago for 60m => starts before, ends after suspend
      // Also need a resume before the suspend so firstResumeTime is set
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 60, timestamp: ts(60) },
          { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
          { _type: 'PumpResume', timestamp: ts(90) },
          { _type: 'PumpSuspend', timestamp: ts(30) },
        ],
        { suspend_zeros_iob: true },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Mismatched suspend/resume: suspendedPrior && !currentlySuspended with mismatch (line 246-247)
  // -------------------------------------------------------------------------
  describe('mismatch: suspendedPrior && !currentlySuspended with wrong counts', () => {
    it('logs mismatch when suspendedPrior and resumes-1 != suspends', () => {
      // 2 resumes, 2 suspends; suspendedPrior because first resume < first suspend
      // For suspendedPrior && !currentlySuspended: (resumes.length-1) !== suspends.length
      // Need: resumes-1 != suspends, so 3 resumes, 1 suspend
      const inputs = makeInputs(
        [
          { _type: 'PumpResume', timestamp: ts(120) },  // first resume (earliest)
          { _type: 'PumpSuspend', timestamp: ts(90) },
          { _type: 'PumpResume', timestamp: ts(60) },
          { _type: 'PumpResume', timestamp: ts(30) },  // extra resume
        ],
        { suspend_zeros_iob: false },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Mismatched: !suspendedPrior && currentlySuspended with wrong counts (line 248-249)
  // -------------------------------------------------------------------------
  describe('mismatch: !suspendedPrior && currentlySuspended with wrong counts', () => {
    it('logs mismatch when currentlySuspended and resumes != suspends-1', () => {
      // Need: !suspendedPrior (first suspend before first resume or no resumes)
      // currentlySuspended (last suspend has no matching resume)
      // resumes != (suspends-1)
      // 3 suspends, 0 resumes => currentlySuspended at first suspend, resumes(0) != suspends-1(2)
      const inputs = makeInputs(
        [
          { _type: 'PumpSuspend', timestamp: ts(90) },
          { _type: 'PumpSuspend', timestamp: ts(60) },
          { _type: 'PumpSuspend', timestamp: ts(30) },
        ],
        { suspend_zeros_iob: false },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Mismatched: suspendedPrior && currentlySuspended with wrong counts (line 250-251)
  // -------------------------------------------------------------------------
  describe('mismatch: suspendedPrior && currentlySuspended with wrong counts', () => {
    it('logs mismatch when both suspendedPrior and currentlySuspended with mismatch', () => {
      // suspendedPrior: first resume < first suspend
      // currentlySuspended: last suspend has no resume after it
      // resumes != suspends (mismatch)
      // 1 resume at 120m, 2 suspends at 90m and 30m => resume(1) != suspends(2)
      // First resume at 120m < first suspend at 30m (sorted: 30, 90)
      // Actually suspends are sorted by date: ts(90) < ts(30) in millis => sorted [ts(90), ts(30)]
      // Resume at 120m, so resume date = NOW-120m. Suspend dates: NOW-90m, NOW-30m
      // resume(NOW-120m) < suspend(NOW-90m)? Yes => suspendedPrior
      // After matching: suspend at NOW-90m matches resume... no, resume is BEFORE suspend
      // Let me re-think: resumes sorted by date = [120m ago]. suspends sorted by date = [90m ago, 30m ago]
      // suspendedPrior: resume[0].date < suspend[0].date => (NOW-120m) < (NOW-90m) => yes
      // Matching: for suspend[0] (90m ago), find resume with date > suspend date: resume[0] date=NOW-120m < NOW-90m, no match
      // j=1 >= resumes.length(1) => currentlySuspended=true, lastSuspendTime = ts(90)
      // resumes(1) != suspends(2) => mismatch logged at line 250
      const inputs = makeInputs(
        [
          { _type: 'PumpResume', timestamp: ts(120) },
          { _type: 'PumpSuspend', timestamp: ts(90) },
          { _type: 'PumpSuspend', timestamp: ts(30) },
        ],
        { suspend_zeros_iob: false },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // splitTimespan: short event crossing a basal profile boundary (lines 28-31)
  // duration <= 30 but crosses a splitter point
  // -------------------------------------------------------------------------
  describe('splitTimespan: short event crossing basal boundary', () => {
    it('splits a short temp basal at a basal profile change point', () => {
      // Temp basal of 20min starting at 11:50 UTC, basal change at 12:00 (720 min)
      // startMinutes=710, endMinutes=730, splitter.minutes=720
      // startMinutes(710) < 720 && endMinutes(730) > 720 => split
      // duration(20) <= 30 => else branch at line 28
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 20, timestamp: '2025-01-15T11:50:00.000Z' },
          { _type: 'TempBasal', rate: 2, timestamp: '2025-01-15T11:50:00.000Z' },
        ],
        {
          basalprofile: [
            { i: 0, start: '00:00:00', rate: 0.8, minutes: 0 },
            { i: 1, start: '12:00:00', rate: 1.2, minutes: 720 },
          ],
          current_basal: 1.2,
        },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // splitTimespan: event crossing midnight (line 30: endMinutes > 1440)
  // -------------------------------------------------------------------------
  describe('splitTimespan: event crossing midnight', () => {
    it('splits a short temp basal that crosses midnight', () => {
      // Temp basal of 20min starting at 23:50 UTC (1430 min mark)
      // endMinutes = 1430 + 20 = 1450 > 1440 => midnight crossing
      // Need a splitter at minutes < (1450-1440)=10, e.g., at minute 0
      const inputs = makeInputs(
        [
          { _type: 'TempBasalDuration', 'duration (min)': 20, timestamp: '2025-01-15T23:50:00.000Z' },
          { _type: 'TempBasal', rate: 2, timestamp: '2025-01-15T23:50:00.000Z' },
        ],
        {
          basalprofile: [
            { i: 0, start: '00:00:00', rate: 0.8, minutes: 0 },
            { i: 1, start: '12:00:00', rate: 1.2, minutes: 720 },
          ],
          current_basal: 0.8,
        },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // AndroidAPS cancel TBR with null duration splice (line 389-390)
  // Need two overlapping temp basals where the second has duration === null
  // -------------------------------------------------------------------------
  describe('overlapping temp basals with null duration splice', () => {
    it('splices a temp with null duration when it overlaps the previous', () => {
      // First temp at 60m ago, duration 60m (overlaps next)
      // Second temp at 30m ago, duration null (AndroidAPS cancel TBR)
      const inputs = makeInputs([
        { _type: 'TempBasalDuration', 'duration (min)': 60, timestamp: ts(60) },
        { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
        {
          eventType: 'Temp Basal',
          rate: 0,
          duration: null,
          timestamp: ts(30),
        },
      ]);
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });

  // -------------------------------------------------------------------------
  // Truncation of extra suspends (line 254-257)
  // -------------------------------------------------------------------------
  describe('extra suspends truncated', () => {
    it('truncates extra suspends beyond matched ones', () => {
      // 3 suspends, 1 resume => first suspend matches resume, second suspend causes
      // currentlySuspended, third is extra and gets truncated
      // Suspend at 90m, Resume at 60m, Suspend at 30m, Suspend at 10m
      // Sorted suspends: [90m, 30m, 10m], Resume: [60m]
      // i=0: suspend[0]=90m, find resume > 90m date => resume[0]=60m ago, date=NOW-60m > NOW-90m? yes => break at j=0
      // pumpSuspends[0].duration = (NOW-60m - (NOW-90m))/60/1000 = 30
      // i=1: suspend[1]=30m, find resume: j=0 resume=60m ago, NOW-60m > NOW-30m? no, j=1 >= length => currentlySuspended
      // At line 254: i=1 < (3-1)=2 => splice extra suspends from index 2
      const inputs = makeInputs(
        [
          { _type: 'PumpSuspend', timestamp: ts(90) },
          { _type: 'PumpResume', timestamp: ts(60) },
          { _type: 'PumpSuspend', timestamp: ts(30) },
          { _type: 'PumpSuspend', timestamp: ts(10) },
        ],
        { suspend_zeros_iob: false },
      );
      const result = calcTempTreatments(inputs);
      expect(normalizeResults(result)).toMatchSnapshot();
    });
  });
});
