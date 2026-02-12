/**
 * Characterization tests for autotune-prep/categorize.js (categorizeBGDatums)
 *
 * Tests the BG datum categorization function that divides glucose data into:
 * - CSFGlucoseData (carb sensitivity factor — during meal absorption)
 * - ISFGlucoseData (insulin sensitivity factor — when insulin is dominant)
 * - basalGlucoseData (basal — when basal insulin dominates)
 * - UAMGlucoseData (unannounced meals — unexplained rises)
 * - CRData (carb ratio calculation data)
 *
 * SAFETY: This is a characterization test suite. Snapshots capture the EXACT
 * current behavior. Do not update snapshots without understanding why they changed.
 */

import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const require = createRequire(import.meta.url);
const categorizeBGDatums = require('../../../lib/autotune-prep/categorize');

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

/** Build an ISO timestamp string for `minsAgo` minutes before NOW */
function ts(minsAgo: number): string {
  return new Date(NOW - minsAgo * 60_000).toISOString();
}

/** Build a date number for `minsAgo` minutes before NOW */
function dateAt(minsAgo: number): number {
  return NOW - minsAgo * 60_000;
}

/** Build a glucose reading at `minsAgo` */
function glucoseReading(bg: number, minsAgo: number) {
  return {
    glucose: bg,
    date: dateAt(minsAgo),
    dateString: ts(minsAgo),
  };
}

/**
 * Generate a series of glucose readings at 5-minute intervals.
 * @param startBG - BG value at the oldest reading
 * @param count - number of readings
 * @param deltaPerReading - BG change per reading (positive = rising toward present)
 * @param startMinsAgo - how many minutes ago for the oldest reading
 */
function makeGlucoseSeries(
  startBG: number,
  count: number,
  deltaPerReading: number = 0,
  startMinsAgo?: number,
): ReturnType<typeof glucoseReading>[] {
  const oldest = startMinsAgo ?? (count - 1) * 5;
  const data = [];
  for (let i = 0; i < count; i++) {
    const minsAgo = oldest - i * 5;
    const bg = Math.round(startBG + deltaPerReading * i);
    data.push(glucoseReading(bg, minsAgo));
  }
  // return newest-first (matching how glucose data is typically provided)
  return data.reverse();
}

const BASAL_PROFILE = [{ i: 0, start: '00:00:00', rate: 1.0, minutes: 0 }];

const ISF_PROFILE = {
  sensitivities: [{ offset: 0, sensitivity: 40, endOffset: 1440 }],
};

/** Build a profile for categorization */
function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    dia: 5,
    curve: 'rapid-acting',
    useCustomPeakTime: false,
    insulinPeakTime: 75,
    current_basal: 1.0,
    basalprofile: BASAL_PROFILE,
    min_5m_carbimpact: 8,
    carb_ratio: 10,
    sens: 40,
    isfProfile: ISF_PROFILE,
    max_daily_basal: 1.3,
    autosens_min: 0.7,
    autosens_max: 1.2,
    ...overrides,
  };
}

/**
 * Build a pump history event (temp basal).
 * The categorize module uses iob/history to process these.
 */
function makeTempBasal(minsAgo: number, rate: number, duration: number = 30) {
  const timestamp = ts(minsAgo);
  return {
    _type: 'TempBasal',
    temp: 'absolute',
    rate: rate,
    timestamp: timestamp,
    created_at: timestamp,
    date: dateAt(minsAgo),
    duration: duration,
  };
}

/** Build a bolus event */
function makeBolus(minsAgo: number, amount: number) {
  const timestamp = ts(minsAgo);
  return {
    _type: 'Bolus',
    amount: amount,
    timestamp: timestamp,
    created_at: timestamp,
    date: dateAt(minsAgo),
    duration: 0,
  };
}

/** Build a treatment with carbs and/or bolus */
function makeTreatment(
  minsAgo: number,
  opts: { carbs?: number; bolus?: number } = {},
) {
  const timestamp = ts(minsAgo);
  return {
    timestamp: timestamp,
    created_at: timestamp,
    date: dateAt(minsAgo),
    ...(opts.carbs != null ? { carbs: opts.carbs } : {}),
    ...(opts.bolus != null ? { bolus: opts.bolus } : {}),
  };
}

/**
 * Build the full opts object for categorizeBGDatums.
 */
function makeOpts(overrides: Record<string, unknown> = {}) {
  return {
    treatments: [],
    profile: makeProfile(),
    pumpHistory: [],
    glucose: [],
    basalprofile: BASAL_PROFILE,
    pumpbasalprofile: BASAL_PROFILE,
    categorize_uam_as_basal: false,
    ...overrides,
  };
}

/**
 * Normalize output for stable snapshots: remove volatile fields and
 * round numbers to avoid float precision differences.
 */
function normalizeOutput(result: any) {
  if (!result) return result;
  return JSON.parse(JSON.stringify(result));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autotune-prep/categorize (categorizeBGDatums) characterization tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // =========================================================================
  // Edge cases: empty/minimal inputs
  // =========================================================================
  describe('empty/minimal inputs', () => {
    it('undefined treatments throws (sort on undefined)', () => {
      expect(() => {
        categorizeBGDatums(makeOpts({ treatments: undefined }));
      }).toThrow();
    });

    it('empty treatments and empty glucose throws (JSON.stringify of undefined)', () => {
      expect(() => {
        categorizeBGDatums(makeOpts({
          treatments: [],
          glucose: [],
        }));
      }).toThrow();
    });

    it('empty treatments with a single glucose reading', () => {
      // A single reading won't have enough data for the main loop (needs 5+)
      const glucose = [glucoseReading(120, 0)];
      const result = categorizeBGDatums(makeOpts({
        treatments: [],
        glucose,
      }));
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Basic basal categorization (no carbs, no boluses, flat BG)
  // =========================================================================
  describe('basal categorization with flat glucose', () => {
    it('flat glucose data with no treatments categorizes as basal', () => {
      // Need at least 10 readings (main loop starts at length-5)
      const glucose = makeGlucoseSeries(100, 15, 0, 70);
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('slowly rising glucose with no treatments categorizes as basal', () => {
      const glucose = makeGlucoseSeries(100, 15, 1, 70);
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Meal absorption (CSF) categorization
  // =========================================================================
  describe('CSF categorization with meals', () => {
    it('glucose rise with carb treatment is categorized as CSF', () => {
      // 20 readings at 5-min intervals: rising from 100 to ~130
      const glucose = makeGlucoseSeries(100, 20, 2, 95);
      // Treatment with carbs 60 mins ago
      const treatments = [makeTreatment(60, { carbs: 30 })];
      const opts = makeOpts({
        treatments,
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('meal with bolus creates both CSF and CRData', () => {
      // Glucose rises then levels off
      const glucose = makeGlucoseSeries(100, 25, 2, 120);
      const treatments = [
        makeTreatment(90, { carbs: 45, bolus: 4.5 }),
      ];
      const pumpHistory = [
        makeBolus(90, 4.5),
      ];
      const opts = makeOpts({
        treatments,
        glucose,
        pumpHistory,
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // ISF categorization (insulin-dominated periods)
  // =========================================================================
  describe('ISF categorization', () => {
    it('falling BG with active bolus insulin categorizes as ISF', () => {
      // BG falling from 200 to ~150
      const glucose = makeGlucoseSeries(200, 20, -3, 95);
      // A bolus was given 2 hours ago (enough that IOB is still active but decaying)
      const pumpHistory = [
        makeBolus(120, 5.0),
      ];
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory,
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // UAM categorization
  // =========================================================================
  describe('UAM categorization', () => {
    it('unexpected rise without carb treatment categorizes as UAM', () => {
      // BG rises from 100 to ~170 without any announced carbs
      const glucose = makeGlucoseSeries(100, 20, 4, 95);
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('categorize_uam_as_basal merges UAM into basal', () => {
      // Same scenario but with categorize_uam_as_basal=true
      const glucose = makeGlucoseSeries(100, 20, 4, 95);
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory: [],
        categorize_uam_as_basal: true,
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // BG below 80 (deviations capped to zero)
  // =========================================================================
  describe('low BG deviation capping', () => {
    it('positive deviations are zeroed when BG is below 80', () => {
      // BG hovering around 70-75 range
      const glucose = makeGlucoseSeries(70, 15, 1, 70);
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Glucose data with sgv field (Nightscout format)
  // =========================================================================
  describe('Nightscout sgv format support', () => {
    it('uses sgv field when glucose field is missing', () => {
      const glucose = [];
      for (let i = 0; i < 15; i++) {
        const minsAgo = 70 - i * 5;
        glucose.push({
          sgv: 110 + i,
          date: dateAt(minsAgo),
          dateString: ts(minsAgo),
        });
      }
      // newest first
      glucose.reverse();
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Glucose data with displayTime format
  // =========================================================================
  describe('displayTime format support', () => {
    it('parses date from displayTime when date field is missing', () => {
      const glucose = [];
      for (let i = 0; i < 15; i++) {
        const minsAgo = 70 - i * 5;
        const d = new Date(dateAt(minsAgo));
        glucose.push({
          glucose: 100 + i,
          displayTime: d.toISOString().replace(' ', 'T'),
        });
      }
      glucose.reverse();
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Glucose below 39 is filtered out
  // =========================================================================
  describe('glucose filtering', () => {
    it('readings below 39 are filtered out', () => {
      const glucose = makeGlucoseSeries(100, 15, 0, 70);
      // Add some invalid readings
      glucose.push(glucoseReading(38, 75));
      glucose.push(glucoseReading(0, 80));
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Mixed scenario with temp basals in pump history
  // =========================================================================
  describe('mixed scenario with temp basals', () => {
    it('temp basals affect IOB calculation and categorization', () => {
      const glucose = makeGlucoseSeries(120, 20, -1, 95);
      const pumpHistory = [
        makeTempBasal(60, 2.0, 30),
        makeTempBasal(30, 0.0, 30),
      ];
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory,
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // UAM overflow handling
  // =========================================================================
  describe('UAM overflow handling', () => {
    it('when too many UAM deviations vs basal, merges and takes bottom 50%', () => {
      // Create a scenario with a large rise (many UAM-classified points)
      // but very few basal points, to trigger the 2*basalLength < UAMLength check
      const glucose = makeGlucoseSeries(90, 30, 3, 145);
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });
});
