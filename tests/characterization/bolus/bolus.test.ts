/**
 * Characterization tests for bolus.js
 *
 * Tests the reduce(treatments) function which groups and annotates
 * bolus/wizard events from pump history into structured treatment records.
 *
 * WARNING: The source module reads from the filesystem (./monitor/iob.json)
 * when a bolus has insulin. We mock fs.existsSync to return false so the
 * filesystem read is skipped, isolating the pure logic.
 */

import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

// We need to mock fs.existsSync before requiring the module, but since
// bolus.js calls require('fs') at runtime (inside the bolus function),
// we can spy on the fs module methods directly.
let existsSyncSpy: ReturnType<typeof vi.spyOn>;
let readFileSyncSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Default: iob.json does not exist
  existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
  // Suppress console.error from the "XXX" guard in bolus()
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The module uses require('fs') at runtime — Node caches the fs module,
// so our spies on the imported fs will apply to the module's calls too.
const reduce = require('../../../lib/bolus');

const TIMESTAMP_1 = '2025-01-15T12:00:00-05:00';
const TIMESTAMP_2 = '2025-01-15T12:01:00-05:00';
const TIMESTAMP_3 = '2025-01-15T12:01:30-05:00';
const TIMESTAMP_FAR = '2025-01-15T12:10:00-05:00';

function makeBolus(overrides: Record<string, unknown> = {}) {
  return {
    _type: 'Bolus',
    timestamp: TIMESTAMP_1,
    programmed: 2.0,
    amount: 2.0,
    duration: 0,
    type: 'normal',
    ...overrides,
  };
}

function makeWizard(overrides: Record<string, unknown> = {}) {
  return {
    _type: 'BolusWizard',
    timestamp: TIMESTAMP_1,
    carb_input: 45,
    carb_ratio: 10,
    bg: 150,
    food_estimate: 4.5,
    correction_estimate: 1.0,
    bolus_estimate: 5.5,
    bg_target_low: 100,
    bg_target_high: 120,
    sensitivity: 50,
    ...overrides,
  };
}

describe('bolus characterization tests', () => {
  describe('empty and trivial inputs', () => {
    it('empty array returns empty results', () => {
      const result = reduce([]);
      expect(result).toMatchSnapshot();
    });
  });

  describe('single Bolus event', () => {
    it('normal bolus without wizard', () => {
      const result = reduce([makeBolus()]);
      expect(result).toMatchSnapshot();
    });

    it('bolus with zero amount', () => {
      const result = reduce([makeBolus({ amount: 0, programmed: 0 })]);
      expect(result).toMatchSnapshot();
    });

    it('bolus with partial delivery (amount < programmed)', () => {
      const result = reduce([makeBolus({ amount: 1.5, programmed: 2.0 })]);
      expect(result).toMatchSnapshot();
    });
  });

  describe('single BolusWizard event', () => {
    it('wizard alone without bolus', () => {
      const result = reduce([makeWizard()]);
      expect(result).toMatchSnapshot();
    });

    it('wizard with zero bg', () => {
      const result = reduce([makeWizard({ bg: 0 })]);
      expect(result).toMatchSnapshot();
    });

    it('wizard with no bg field', () => {
      const result = reduce([makeWizard({ bg: undefined })]);
      expect(result).toMatchSnapshot();
    });

    it('wizard with zero carbs', () => {
      const result = reduce([makeWizard({ carb_input: 0 })]);
      expect(result).toMatchSnapshot();
    });
  });

  describe('wizard + bolus pair (within 2 minutes)', () => {
    it('wizard followed by bolus — normal meal bolus', () => {
      const result = reduce([
        makeWizard({ timestamp: TIMESTAMP_1 }),
        makeBolus({ timestamp: TIMESTAMP_2 }),
      ]);
      expect(result).toMatchSnapshot();
    });

    it('bolus followed by wizard — normal meal bolus (reversed order)', () => {
      const result = reduce([
        makeBolus({ timestamp: TIMESTAMP_1 }),
        makeWizard({ timestamp: TIMESTAMP_2 }),
      ]);
      expect(result).toMatchSnapshot();
    });

    it('wizard + bolus with zero carbs — correction bolus', () => {
      const result = reduce([
        makeWizard({ timestamp: TIMESTAMP_1, carb_input: 0 }),
        makeBolus({ timestamp: TIMESTAMP_2 }),
      ]);
      expect(result).toMatchSnapshot();
    });

    it('wizard + bolus with zero bg — no glucose annotation', () => {
      const result = reduce([
        makeWizard({ timestamp: TIMESTAMP_1, bg: 0 }),
        makeBolus({ timestamp: TIMESTAMP_2 }),
      ]);
      expect(result).toMatchSnapshot();
    });
  });

  describe('square wave bolus', () => {
    it('square wave bolus alone (duration > 0, no wizard)', () => {
      const result = reduce([
        makeBolus({ duration: 30, amount: 3.0, programmed: 3.0 }),
      ]);
      expect(result).toMatchSnapshot();
    });

    it('square wave with wizard (no normal bolus)', () => {
      const result = reduce([
        makeWizard({ timestamp: TIMESTAMP_1 }),
        makeBolus({ timestamp: TIMESTAMP_2, duration: 30, amount: 3.0, programmed: 3.0 }),
      ]);
      expect(result).toMatchSnapshot();
    });
  });

  describe('dual wave bolus', () => {
    it('wizard + normal bolus + square bolus — dual wave', () => {
      // Wizard first, then normal bolus matches wizard (within 2 min),
      // then square bolus also within range
      const result = reduce([
        makeWizard({ timestamp: TIMESTAMP_1 }),
        makeBolus({ timestamp: TIMESTAMP_2, amount: 2.0, programmed: 2.0, duration: 0 }),
        makeBolus({ timestamp: TIMESTAMP_3, amount: 1.5, programmed: 1.5, duration: 30 }),
      ]);
      expect(result).toMatchSnapshot();
    });

    it('normal bolus + square bolus without wizard', () => {
      const result = reduce([
        makeBolus({ timestamp: TIMESTAMP_1, amount: 2.0, programmed: 2.0, duration: 0 }),
        makeBolus({ timestamp: TIMESTAMP_2, amount: 1.5, programmed: 1.5, duration: 30 }),
      ]);
      expect(result).toMatchSnapshot();
    });
  });

  describe('multiple independent boluses', () => {
    it('two boluses far apart — separate results', () => {
      const result = reduce([
        makeBolus({ timestamp: TIMESTAMP_1, amount: 2.0, programmed: 2.0 }),
        makeBolus({ timestamp: TIMESTAMP_FAR, amount: 1.0, programmed: 1.0 }),
      ]);
      expect(result).toMatchSnapshot();
    });

    it('two closely-timed boluses — combined (existing mocha test case)', () => {
      const bolushistory = [
        {
          _type: 'Bolus',
          timestamp: '2017-04-12T12:49:49-05:00',
          programmed: 3.0,
          amount: 3.0,
          duration: 0,
          type: 'normal',
        },
        {
          _type: 'Bolus',
          timestamp: '2017-04-12T12:47:53-05:00',
          programmed: 0.2,
          amount: 0.2,
          duration: 0,
          type: 'normal',
        },
      ];
      const result = reduce(bolushistory);
      expect(result).toMatchSnapshot();
      // Verify the specific behavior the mocha test checks
      expect(result.length).toBe(1);
      expect(result[0].insulin).toBe('3.2');
    });
  });

  describe('JournalEntryMealMarker', () => {
    it('single meal marker', () => {
      const result = reduce([
        {
          _type: 'JournalEntryMealMarker',
          timestamp: TIMESTAMP_1,
          carb_input: 30,
        },
      ]);
      expect(result).toMatchSnapshot();
    });

    it('meal marker among bolus events', () => {
      const result = reduce([
        makeBolus({ timestamp: TIMESTAMP_1 }),
        {
          _type: 'JournalEntryMealMarker',
          timestamp: TIMESTAMP_FAR,
          carb_input: 25,
        },
      ]);
      expect(result).toMatchSnapshot();
    });
  });

  describe('unknown _type events', () => {
    it('unknown type passes through to results', () => {
      const result = reduce([
        {
          _type: 'SomeOtherEvent',
          timestamp: TIMESTAMP_1,
          data: 'test',
        },
      ]);
      expect(result).toMatchSnapshot();
    });

    it('mixed known and unknown types', () => {
      const result = reduce([
        { _type: 'SomeOtherEvent', timestamp: TIMESTAMP_1 },
        makeBolus({ timestamp: TIMESTAMP_FAR }),
      ]);
      expect(result).toMatchSnapshot();
    });
  });

  describe('iob.json filesystem interaction', () => {
    it('reads iob.json when it exists and annotates IOB', () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(
        JSON.stringify([{ iob: 2.5 }])
      );

      const result = reduce([makeBolus()]);
      expect(result).toMatchSnapshot();
    });

    it('reads iob.json with empty array — no IOB annotation', () => {
      existsSyncSpy.mockReturnValue(true);
      readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(
        JSON.stringify([])
      );

      const result = reduce([makeBolus()]);
      expect(result).toMatchSnapshot();
    });

    it('iob.json does not exist — no IOB annotation', () => {
      existsSyncSpy.mockReturnValue(false);

      const result = reduce([makeBolus()]);
      expect(result).toMatchSnapshot();
    });
  });

  describe('event type classification', () => {
    it('meal bolus — has carbs and insulin', () => {
      const result = reduce([
        makeWizard({ timestamp: TIMESTAMP_1, carb_input: 45 }),
        makeBolus({ timestamp: TIMESTAMP_2, amount: 2.0, programmed: 2.0 }),
      ]);
      expect(result[0].eventType).toBe('Meal Bolus');
      expect(result).toMatchSnapshot();
    });

    it('correction bolus — has insulin but no carbs', () => {
      const result = reduce([
        makeWizard({ timestamp: TIMESTAMP_1, carb_input: 0 }),
        makeBolus({ timestamp: TIMESTAMP_2, amount: 2.0, programmed: 2.0 }),
      ]);
      expect(result[0].eventType).toBe('Correction Bolus');
      expect(result).toMatchSnapshot();
    });

    it('carb correction — wizard with carbs but wizard alone has no insulin', () => {
      // Wizard alone: no bolus event means state.bolus is undefined,
      // so insulin comes only from state.square (also undefined) = 0
      const result = reduce([
        makeWizard({ carb_input: 30 }),
      ]);
      expect(result[0].eventType).toBe('Carb Correction');
      expect(result).toMatchSnapshot();
    });
  });

  describe('edge cases', () => {
    it('bolus with undefined event triggers console.error guard', () => {
      // The bolus() function has a guard: if (!ev) { console.error(...); return; }
      // This triggers when the recursive call gets an empty object with wizard+bolus set
      // We verify the function handles it without throwing
      const result = reduce([
        makeWizard({ timestamp: TIMESTAMP_1 }),
        makeBolus({ timestamp: TIMESTAMP_2 }),
      ]);
      expect(result).toMatchSnapshot();
    });

    it('multiple wizard+bolus pairs far apart', () => {
      const result = reduce([
        makeWizard({ timestamp: TIMESTAMP_1 }),
        makeBolus({ timestamp: TIMESTAMP_2 }),
        makeWizard({ timestamp: TIMESTAMP_FAR, carb_input: 20, bg: 180 }),
        makeBolus({
          timestamp: '2025-01-15T12:11:00-05:00',
          amount: 1.0,
          programmed: 1.0,
        }),
      ]);
      expect(result).toMatchSnapshot();
    });

    it('bolus with very large amount', () => {
      const result = reduce([makeBolus({ amount: 25.0, programmed: 25.0 })]);
      expect(result).toMatchSnapshot();
    });

    it('square bolus with partial delivery', () => {
      const result = reduce([
        makeBolus({ duration: 60, amount: 2.0, programmed: 4.0 }),
      ]);
      expect(result).toMatchSnapshot();
    });
  });
});
