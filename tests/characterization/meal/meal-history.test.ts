/**
 * Characterization tests for meal/history.js (findMealInputs)
 *
 * Tests the meal history parsing function that extracts carb and bolus
 * treatments from pump history and Nightscout carb history.
 */

import { describe, it, expect } from 'vitest';
import findMealInputs from '../../../lib/meal/history.js';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

/** Return an ISO timestamp string for `minsAgo` minutes before NOW. */
function ts(minsAgo: number): string {
  return new Date(NOW - minsAgo * 60_000).toISOString();
}

/** Return an ISO timestamp string offset from `base` by `ms` milliseconds. */
function tsOffset(base: string, ms: number): string {
  return new Date(new Date(base).getTime() + ms).toISOString();
}

/** Convenience: empty inputs with overrides. */
function inputs(
  overrides: {
    history?: any[];
    carbs?: any[];
    profile?: any;
  } = {},
) {
  return {
    history: overrides.history ?? [],
    carbs: overrides.carbs ?? [],
    profile: overrides.profile ?? {},
  };
}

/** Sort results by timestamp for stable snapshot comparisons. */
function sorted(results: any[]): any[] {
  return [...results].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

describe('meal/history (findMealInputs) characterization tests', () => {
  // ---------------------------------------------------------------------------
  // carbHistory processing
  // ---------------------------------------------------------------------------
  describe('carbHistory processing', () => {
    it('1. single carb entry from NS produces { timestamp, carbs, nsCarbs }', () => {
      const result = findMealInputs(
        inputs({
          carbs: [{ created_at: ts(30), carbs: 45 }],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('2. multiple carb entries at different times', () => {
      const result = findMealInputs(
        inputs({
          carbs: [
            { created_at: ts(60), carbs: 30 },
            { created_at: ts(30), carbs: 45 },
            { created_at: ts(10), carbs: 15 },
          ],
        }),
      );
      expect(sorted(result)).toMatchSnapshot();
    });

    it('3. carb entry without carbs field is skipped', () => {
      const result = findMealInputs(
        inputs({
          carbs: [{ created_at: ts(30) }],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('4. carb entry without created_at is skipped', () => {
      const result = findMealInputs(
        inputs({
          carbs: [{ carbs: 45 }],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('5. duplicate carb entries with same timestamp are deduped', () => {
      const time = ts(30);
      const result = findMealInputs(
        inputs({
          carbs: [
            { created_at: time, carbs: 45 },
            { created_at: time, carbs: 45 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // pumpHistory - Bolus type
  // ---------------------------------------------------------------------------
  describe('pumpHistory - Bolus type', () => {
    it('6. Bolus with amount produces { timestamp, bolus }', () => {
      const result = findMealInputs(
        inputs({
          history: [{ _type: 'Bolus', timestamp: ts(20), amount: 3.5 }],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('7. duplicate boluses at same time are deduped', () => {
      const time = ts(20);
      const result = findMealInputs(
        inputs({
          history: [
            { _type: 'Bolus', timestamp: time, amount: 3.5 },
            { _type: 'Bolus', timestamp: time, amount: 3.5 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // pumpHistory - BolusWizard
  // ---------------------------------------------------------------------------
  describe('pumpHistory - BolusWizard', () => {
    it('8. BolusWizard with matching Bolus at same timestamp produces { timestamp, carbs, bwCarbs }', () => {
      const time = ts(25);
      const result = findMealInputs(
        inputs({
          history: [
            { _type: 'Bolus', timestamp: time, amount: 2.0 },
            { _type: 'BolusWizard', timestamp: time, carb_input: 40 },
          ],
        }),
      );
      expect(sorted(result)).toMatchSnapshot();
    });

    it('9. BolusWizard WITHOUT matching Bolus is skipped (logged as error)', () => {
      const result = findMealInputs(
        inputs({
          history: [
            { _type: 'BolusWizard', timestamp: ts(25), carb_input: 40 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('10. BolusWizard with carb_input: 0 is skipped (different error message)', () => {
      const result = findMealInputs(
        inputs({
          history: [
            { _type: 'BolusWizard', timestamp: ts(25), carb_input: 0 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('11. BolusWizard with carbs already present at that timestamp is deduped', () => {
      const time = ts(25);
      const result = findMealInputs(
        inputs({
          // NS carb entry at same timestamp as BolusWizard
          carbs: [{ created_at: time, carbs: 40 }],
          history: [
            { _type: 'Bolus', timestamp: time, amount: 2.0 },
            { _type: 'BolusWizard', timestamp: time, carb_input: 40 },
          ],
        }),
      );
      expect(sorted(result)).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // pumpHistory - Nightscout Care Portal
  // ---------------------------------------------------------------------------
  describe('pumpHistory - Nightscout Care Portal', () => {
    it('12. Meal Bolus with created_at and carbs', () => {
      const result = findMealInputs(
        inputs({
          history: [
            { _type: 'Meal Bolus', created_at: ts(15), carbs: 50 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('13. Correction Bolus with created_at and carbs', () => {
      const result = findMealInputs(
        inputs({
          history: [
            { _type: 'Correction Bolus', created_at: ts(15), carbs: 20 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('14. Snack Bolus with created_at and carbs', () => {
      const result = findMealInputs(
        inputs({
          history: [
            { _type: 'Snack Bolus', created_at: ts(15), carbs: 10 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('15. Bolus Wizard (NS version) with created_at and carbs', () => {
      const result = findMealInputs(
        inputs({
          history: [
            { _type: 'Bolus Wizard', created_at: ts(15), carbs: 35 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('16. Carb Correction with created_at and carbs', () => {
      const result = findMealInputs(
        inputs({
          history: [
            { _type: 'Carb Correction', created_at: ts(15), carbs: 15 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('17. duplicate NS entries are deduped', () => {
      const time = ts(15);
      const result = findMealInputs(
        inputs({
          history: [
            { _type: 'Meal Bolus', created_at: time, carbs: 50 },
            { _type: 'Snack Bolus', created_at: time, carbs: 50 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // pumpHistory - xdrip
  // ---------------------------------------------------------------------------
  describe('pumpHistory - xdrip', () => {
    it('18. xdrip entry with carbs, insulin, created_at produces { timestamp, carbs, nsCarbs, bolus }', () => {
      const result = findMealInputs(
        inputs({
          history: [
            {
              enteredBy: 'xdrip',
              created_at: ts(20),
              timestamp: ts(20),
              carbs: 30,
              insulin: 2.5,
            },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // pumpHistory - generic carbs > 0
  // ---------------------------------------------------------------------------
  describe('pumpHistory - generic carbs > 0', () => {
    it('19. generic entry with carbs > 0 and created_at produces { timestamp, carbs, nsCarbs, bolus }', () => {
      const result = findMealInputs(
        inputs({
          history: [
            {
              created_at: ts(20),
              timestamp: ts(20),
              carbs: 25,
              insulin: 1.5,
            },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // pumpHistory - JournalEntryMealMarker
  // ---------------------------------------------------------------------------
  describe('pumpHistory - JournalEntryMealMarker', () => {
    it('20. JournalEntryMealMarker with carb_input > 0 produces { timestamp, carbs, journalCarbs }', () => {
      const result = findMealInputs(
        inputs({
          history: [
            {
              _type: 'JournalEntryMealMarker',
              timestamp: ts(10),
              carb_input: 20,
            },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('21. JournalEntryMealMarker with carb_input: 0 is skipped', () => {
      const result = findMealInputs(
        inputs({
          history: [
            {
              _type: 'JournalEntryMealMarker',
              timestamp: ts(10),
              carb_input: 0,
            },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // Deduplication (2-second tolerance window)
  // ---------------------------------------------------------------------------
  describe('deduplication - 2-second tolerance window', () => {
    it('22. timestamp within 2s window (1s apart) is treated as duplicate', () => {
      const baseTime = ts(30);
      const nearTime = tsOffset(baseTime, 1000); // 1 second later
      const result = findMealInputs(
        inputs({
          carbs: [
            { created_at: baseTime, carbs: 45 },
            { created_at: nearTime, carbs: 30 },
          ],
        }),
      );
      // Only the first should be kept
      expect(result).toMatchSnapshot();
    });

    it('23. timestamp outside 2s window (exactly 2s apart) is NOT a duplicate', () => {
      // The check uses strict < and >, so exactly 2000ms is NOT within the window
      const baseTime = ts(30);
      const farTime = tsOffset(baseTime, 2000); // exactly 2 seconds later
      const result = findMealInputs(
        inputs({
          carbs: [
            { created_at: baseTime, carbs: 45 },
            { created_at: farTime, carbs: 30 },
          ],
        }),
      );
      expect(sorted(result)).toMatchSnapshot();
    });

    it('timestamp 1999ms apart is still treated as duplicate', () => {
      const baseTime = ts(30);
      const nearTime = tsOffset(baseTime, 1999);
      const result = findMealInputs(
        inputs({
          carbs: [
            { created_at: baseTime, carbs: 45 },
            { created_at: nearTime, carbs: 30 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('timestamp 2001ms apart is NOT a duplicate', () => {
      const baseTime = ts(30);
      const farTime = tsOffset(baseTime, 2001);
      const result = findMealInputs(
        inputs({
          carbs: [
            { created_at: baseTime, carbs: 45 },
            { created_at: farTime, carbs: 30 },
          ],
        }),
      );
      expect(sorted(result)).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('24. empty history and carbs returns empty array', () => {
      const result = findMealInputs(inputs());
      expect(result).toMatchSnapshot();
    });

    it('25. mixed sources: NS carbs + pump boluses + BolusWizard entries', () => {
      const bolusTime = ts(30);
      const bwTime = ts(30); // same as bolus so BW can pair with it
      const result = findMealInputs(
        inputs({
          carbs: [
            { created_at: ts(60), carbs: 50 },
            { created_at: ts(15), carbs: 20 },
          ],
          history: [
            { _type: 'Bolus', timestamp: bolusTime, amount: 4.0 },
            { _type: 'BolusWizard', timestamp: bwTime, carb_input: 60 },
            { _type: 'Meal Bolus', created_at: ts(45), carbs: 35 },
          ],
        }),
      );
      expect(sorted(result)).toMatchSnapshot();
    });

    it('Bolus without timestamp is skipped', () => {
      const result = findMealInputs(
        inputs({
          history: [{ _type: 'Bolus', amount: 3.0 }],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('BolusWizard without timestamp is skipped', () => {
      const result = findMealInputs(
        inputs({
          history: [{ _type: 'BolusWizard', carb_input: 40 }],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('NS Care Portal entry without created_at is skipped', () => {
      const result = findMealInputs(
        inputs({
          history: [{ _type: 'Meal Bolus', carbs: 50 }],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('JournalEntryMealMarker without timestamp is skipped', () => {
      const result = findMealInputs(
        inputs({
          history: [
            { _type: 'JournalEntryMealMarker', carb_input: 20 },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('cross-source dedup: NS carb and NS Care Portal at same timestamp', () => {
      const time = ts(20);
      const result = findMealInputs(
        inputs({
          carbs: [{ created_at: time, carbs: 45 }],
          history: [{ _type: 'Meal Bolus', created_at: time, carbs: 45 }],
        }),
      );
      expect(result).toMatchSnapshot();
    });

    it('xdrip entry uses created_at for output timestamp but timestamp for dedup', () => {
      // Provide created_at and timestamp as different values to verify which is used
      const result = findMealInputs(
        inputs({
          history: [
            {
              enteredBy: 'xdrip',
              created_at: ts(20),
              timestamp: ts(21), // different from created_at
              carbs: 30,
              insulin: 2.5,
            },
          ],
        }),
      );
      // The output timestamp should be created_at, not timestamp
      expect(result).toMatchSnapshot();
    });

    it('generic carbs>0 entry uses created_at for output timestamp but timestamp for dedup', () => {
      const result = findMealInputs(
        inputs({
          history: [
            {
              created_at: ts(20),
              timestamp: ts(21), // different from created_at
              carbs: 25,
              insulin: 1.0,
            },
          ],
        }),
      );
      expect(result).toMatchSnapshot();
    });
  });

  // ---------------------------------------------------------------------------
  // Complex realistic scenario
  // ---------------------------------------------------------------------------
  describe('complex realistic scenario', () => {
    it('26. full realistic pump history with multiple event types', () => {
      const result = findMealInputs(
        inputs({
          carbs: [
            // NS carb entries (e.g. from Loop or AAPS)
            { created_at: ts(180), carbs: 60 },
            { created_at: ts(90), carbs: 25 },
            { created_at: ts(30), carbs: 15 },
          ],
          history: [
            // Pump boluses
            { _type: 'Bolus', timestamp: ts(180), amount: 5.0 },
            { _type: 'Bolus', timestamp: ts(90), amount: 2.5 },
            { _type: 'Bolus', timestamp: ts(60), amount: 1.0 },

            // BolusWizard paired with the 60min-ago bolus
            { _type: 'BolusWizard', timestamp: ts(60), carb_input: 30 },

            // NS Care Portal entries
            { _type: 'Meal Bolus', created_at: ts(120), carbs: 40 },
            { _type: 'Snack Bolus', created_at: ts(45), carbs: 10 },
            { _type: 'Carb Correction', created_at: ts(15), carbs: 8 },

            // xdrip entry
            {
              enteredBy: 'xdrip',
              created_at: ts(150),
              timestamp: ts(150),
              carbs: 20,
              insulin: 1.5,
            },

            // Journal entry
            {
              _type: 'JournalEntryMealMarker',
              timestamp: ts(75),
              carb_input: 12,
            },

            // Duplicate of NS carb at 90 min ago (should be deduped)
            { _type: 'Correction Bolus', created_at: ts(90), carbs: 25 },

            // Entry that should be skipped: JournalEntry with 0 carbs
            {
              _type: 'JournalEntryMealMarker',
              timestamp: ts(5),
              carb_input: 0,
            },

            // Entry that should be skipped: BolusWizard with no matching bolus
            { _type: 'BolusWizard', timestamp: ts(200), carb_input: 10 },
          ],
        }),
      );

      expect(sorted(result)).toMatchSnapshot();
    });
  });
});
