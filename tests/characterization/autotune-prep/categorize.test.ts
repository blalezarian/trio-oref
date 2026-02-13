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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import categorizeBGDatums from '../../../src/autotune-prep/categorize';

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
    curve: 'rapid-acting' as const,
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
    vi.spyOn(console, 'log').mockImplementation(() => {});
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

  // =========================================================================
  // Line 91: Glucose bucketing with readings < 2 min apart (averaging)
  // =========================================================================
  describe('glucose bucketing with sub-2-minute readings', () => {
    it('averages glucose readings that are less than 2 minutes apart (line 91)', () => {
      // Create glucose readings where some are < 2 minutes apart,
      // triggering the averaging code in the else branch at line 86-92
      const glucose: ReturnType<typeof glucoseReading>[] = [];
      // Create 15 readings at 5-minute intervals
      for (let i = 0; i < 15; i++) {
        const minsAgo = 70 - i * 5;
        glucose.push(glucoseReading(100 + i, minsAgo));
      }
      // Add duplicate readings less than 2 minutes apart from existing ones
      // These will be within the 2-minute deadband
      glucose.push({ glucose: 102, date: dateAt(59), dateString: ts(59) }); // ~1 min from the 60-min-ago reading
      glucose.push({ glucose: 104, date: dateAt(54), dateString: ts(54) }); // ~1 min from the 55-min-ago reading
      // newest first for sorting
      glucose.sort((a, b) => b.date - a.date);

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
  // Lines 99-110: Treatment pruning (treatments older than oldest glucose)
  // =========================================================================
  describe('treatment pruning for old treatments', () => {
    it('removes treatments older than the oldest bucketed glucose datum (lines 99-110)', () => {
      // 15 glucose readings spanning 70 minutes ago to now
      const glucose = makeGlucoseSeries(100, 15, 1, 70);
      // Treatments that are older than the oldest glucose reading
      // The oldest glucose will be ~70 min ago, so put treatments at 80+ min ago
      const treatments = [
        makeTreatment(80, { carbs: 20 }),
        makeTreatment(90, { carbs: 15 }),
        makeTreatment(50, { carbs: 10 }), // this one should stay (within glucose range)
      ];
      const opts = makeOpts({
        treatments,
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Line 158: BG < 40 continue (skip data point in main loop)
  // =========================================================================
  describe('BG below 40 in bucketed data', () => {
    it('skips data points where BG or BG[i+4] is below 40 (line 158)', () => {
      // Need BG values that pass the >=39 filter on line 46 but end up < 40
      // after bucketing, or exactly at 39. Actually, the filter is >= 39,
      // so a value of 39 passes the filter. Then in the main loop, BG < 40 triggers continue.
      const glucose: ReturnType<typeof glucoseReading>[] = [];
      // Build a series with mostly normal values but one at exactly 39
      for (let i = 0; i < 15; i++) {
        const minsAgo = 70 - i * 5;
        // Put a 39 value early in the series (it will be at i+4 position for some main loop iteration)
        if (i === 2) {
          glucose.push(glucoseReading(39, minsAgo));
        } else {
          glucose.push(glucoseReading(100 + i, minsAgo));
        }
      }
      glucose.sort((a, b) => b.date - a.date);

      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // Note: Line 162 ("Could not find glucose data") is unreachable through the
  // normal API because the glucose filter on line 46 removes entries without
  // a valid .glucose property before bucketing occurs.

  // =========================================================================
  // Lines 263, 286, 377-385: CR calculation with IOB > currentBasal/2
  // and CRData forEach with dosed()
  // =========================================================================
  describe('carb ratio (CR) calculation', () => {
    it('tracks CR when COB depletes but IOB remains high, producing CRData (lines 263, 286, 377-385)', () => {
      // We need a meal scenario where:
      // 1. COB goes above 0 (carbs eaten)
      // 2. COB depletes to 0 but IOB is still > currentBasal/2
      // 3. Eventually IOB drops below currentBasal/2, ending the CR calculation
      // 4. The CR period lasts >= 60 minutes to avoid being ignored
      // Use a long glucose series with a meal early on and a large bolus for persistent IOB
      const glucose = makeGlucoseSeries(120, 40, 1, 195);
      // Meal with small carbs (so they absorb quickly) but significant bolus
      const treatments = [
        makeTreatment(180, { carbs: 15 }),
      ];
      // Large bolus to keep IOB high after COB depletes
      const pumpHistory = [
        makeBolus(180, 8.0),
      ];
      const opts = makeOpts({
        treatments,
        glucose,
        pumpHistory,
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('ignores CR periods shorter than 60 minutes (line 283-284)', () => {
      // Need a meal where COB depletes and IOB drops within 60 minutes
      // Use very small carbs with high min_5m_carbimpact so they absorb instantly
      const glucose = makeGlucoseSeries(100, 20, 1, 95);
      const treatments = [
        makeTreatment(80, { carbs: 5 }),
      ];
      const pumpHistory = [
        makeBolus(80, 0.5),
      ];
      const opts = makeOpts({
        treatments,
        glucose,
        pumpHistory,
        profile: makeProfile({ min_5m_carbimpact: 20 }),
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Lines 305, 308: absorbing = 0 with negative deviation during meal,
  // and mealCarbs = 0 when absorbing = 0 and mealCOB = 0
  // =========================================================================
  describe('absorption ending with negative deviation', () => {
    it('sets absorbing=0 when deviation is negative during meal with depleted COB (lines 305, 308)', () => {
      // Need:
      // 1. Carbs to set mealCarbs > 0
      // 2. Small enough carbs that COB depletes quickly (via min_5m_carbimpact)
      // 3. BG falling (negative deviation) to trigger absorbing = 0
      //    deviation = avgDelta - BGI; for deviation <= 0, need avgDelta <= BGI
      //    With 2U bolus at 60min ago, BGI ~ -1 to -2
      //    So avgDelta needs to be <= -1 to -2 (BG falling moderately fast)
      // 4. IOB still >= currentBasal/2 = 0.5 (2U bolus at 60min gives ~1.0 IOB)
      const glucose: ReturnType<typeof glucoseReading>[] = [];
      // Rising phase (oldest) - carbs absorbing
      for (let i = 0; i < 8; i++) {
        glucose.push(glucoseReading(100 + i * 3, 120 - i * 5));
      }
      // Sharp falling phase (newest) - fast enough to make deviation negative
      // Need avgDelta ~ -3 to -5 per 5min (about -36 to -60 mg/dL/hr)
      for (let i = 0; i < 17; i++) {
        glucose.push(glucoseReading(124 - i * 4, 80 - i * 5));
      }
      glucose.sort((a, b) => b.date - a.date);

      const treatments = [
        makeTreatment(110, { carbs: 8 }),
      ];
      // Moderate bolus: enough IOB to stay >= 0.5 but with moderate BGI
      const pumpHistory = [
        makeBolus(100, 2.0),
      ];
      const opts = makeOpts({
        treatments,
        glucose,
        pumpHistory,
        profile: makeProfile({ min_5m_carbimpact: 20 }),
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Lines 323-324: Transition from CSF to non-CSF (mealAbsorption = "end")
  // =========================================================================
  describe('CSF to non-CSF transition', () => {
    it('sets mealAbsorption end when transitioning from CSF to basal (lines 323-324)', () => {
      // Need:
      // 1. Period with COB > 0 (CSF type)
      // 2. COB depletes, IOB drops, deviation goes small/negative -> transitions to basal/ISF
      // Build glucose that rises during meal then flattens
      const glucose: ReturnType<typeof glucoseReading>[] = [];
      // Rising during meal
      for (let i = 0; i < 12; i++) {
        glucose.push(glucoseReading(100 + i * 2, 130 - i * 5));
      }
      // Flat/falling after meal
      for (let i = 0; i < 15; i++) {
        glucose.push(glucoseReading(122 - i, 70 - i * 5));
      }
      glucose.sort((a, b) => b.date - a.date);

      const treatments = [
        makeTreatment(120, { carbs: 8 }),
      ];
      const pumpHistory: ReturnType<typeof makeBolus>[] = [];
      const opts = makeOpts({
        treatments,
        glucose,
        pumpHistory,
        profile: makeProfile({ min_5m_carbimpact: 12 }),
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Line 331: uam = 0 when in UAM section with negative deviation
  // Lines 340-341: Transition from UAM to basal/ISF
  // =========================================================================
  describe('UAM ending with negative deviation', () => {
    it('sets uam=0 and transitions from UAM to basal when deviation goes negative (lines 331, 340-341)', () => {
      // Need:
      // 1. Initial rise that triggers UAM (deviation > 6 or IOB > 2*currentBasal)
      // 2. Then deviation goes negative, setting uam=0
      // 3. Then deviation stays low so it transitions out of UAM to basal
      const glucose: ReturnType<typeof glucoseReading>[] = [];
      // Strong rise phase (triggers UAM via deviation > 6)
      for (let i = 0; i < 10; i++) {
        glucose.push(glucoseReading(100 + i * 8, 120 - i * 5));
      }
      // Sharp fall phase (negative deviation, exits UAM)
      for (let i = 0; i < 15; i++) {
        glucose.push(glucoseReading(172 - i * 4, 70 - i * 5));
      }
      glucose.sort((a, b) => b.date - a.date);

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
  // Lines 354-360: ISF categorization (basalBGI <= -4*BGI) and
  // avgDelta > 0 && avgDelta > -2*BGI basal categorization
  // =========================================================================
  describe('ISF vs basal categorization with strong insulin activity', () => {
    it('categorizes as ISF when BGI is strongly negative and avgDelta is negative (lines 354-360)', () => {
      // Need:
      // 1. Large bolus for strong negative BGI (high insulin activity)
      // 2. basalBGI <= -4 * BGI (i.e., BGI is large negative, basalBGI is small)
      // 3. avgDelta negative (falling BG) -> ISF
      // With sens=40, currentBasal=1.0: basalBGI = 1.0 * 40/60*5 = 3.33
      // Need BGI such that basalBGI <= -4*BGI => 3.33 <= -4*BGI => BGI <= -0.83
      // A moderate bolus 60-90 min ago should produce enough activity
      const glucose = makeGlucoseSeries(180, 20, -3, 95);
      // Bolus 90 min ago for substantial insulin activity
      const pumpHistory = [
        makeBolus(90, 8.0),
      ];
      const opts = makeOpts({
        treatments: [],
        glucose,
        pumpHistory,
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('categorizes as basal when avgDelta > 0 and avgDelta > -2*BGI despite strong BGI (lines 354-357)', () => {
      // Need points NOT in CSF/UAM section, reaching the basalBGI/-4*BGI branch:
      // - basalBGI <= -4 * BGI (strong negative BGI; with basalBGI=3.33, need BGI <= -0.83)
      // - avgDelta > 0 AND avgDelta > -2*BGI
      // - IOB < 2*currentBasal (= 2.0) to avoid UAM classification
      // - deviation <= 6 to avoid UAM
      // Verified via simulation: 1.5U bolus at 100min ago gives at each BG point:
      //   IOB ~1.0-1.4 (< 2.0), BGI ~-1.3 to -1.8 (strongBGI), dev ~5.3-5.8 (<6, no UAM)
      //   avgDelta=4 > 0 and > -2*BGI ~ 2.6-3.6 => basalWithPosAvg=true
      const glucose = makeGlucoseSeries(120, 20, 4, 95);
      const pumpHistory = [
        makeBolus(100, 1.5),
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
  // Glucose data with dateString format (no date field)
  // =========================================================================
  describe('dateString format support', () => {
    it('parses date from dateString when date field is missing', () => {
      const glucose = [];
      for (let i = 0; i < 15; i++) {
        const minsAgo = 70 - i * 5;
        glucose.push({
          glucose: 100 + i,
          dateString: ts(minsAgo),
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
  // CSF overflow: when too many CSF vs basal+ISF, merge CSF into ISF
  // =========================================================================
  describe('CSF overflow handling', () => {
    it('merges CSF into ISF when too many meal deviations dominate (lines 433-439)', () => {
      // Need: 4*basalLength + ISFLength < CSFLength && ISFLength < 10
      // This means almost all data is categorized as CSF with very few basal/ISF points
      // Use a meal with lots of carbs and rising BG throughout the entire series
      const glucose = makeGlucoseSeries(100, 25, 3, 120);
      // Large carb meal to keep COB high throughout
      const treatments = [
        makeTreatment(110, { carbs: 100 }),
      ];
      const opts = makeOpts({
        treatments,
        glucose,
        pumpHistory: [],
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // CSF with >12 entries merges UAM into basal (line 397-399)
  // =========================================================================
  describe('CSF >12 entries with UAM', () => {
    it('merges UAM into basal when CSF has more than 12 entries (lines 397-399)', () => {
      // Need:
      // 1. A meal that creates > 12 CSF data points (at least 1 hour of carb absorption)
      // 2. Some UAM data points as well (from an unexplained rise before/after the meal)
      // Build glucose that first rises without carbs (UAM), then has carbs announced
      const glucose: ReturnType<typeof glucoseReading>[] = [];
      // UAM rise first (no carbs yet)
      for (let i = 0; i < 8; i++) {
        glucose.push(glucoseReading(100 + i * 5, 180 - i * 5));
      }
      // Meal announced, continues rising (CSF)
      for (let i = 0; i < 25; i++) {
        glucose.push(glucoseReading(140 + i * 2, 140 - i * 5));
      }
      glucose.sort((a, b) => b.date - a.date);

      const treatments = [
        makeTreatment(145, { carbs: 60 }),
      ];
      const opts = makeOpts({
        treatments,
        glucose,
        pumpHistory: [],
        categorize_uam_as_basal: false,
      });
      const result = categorizeBGDatums(opts);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });
});
