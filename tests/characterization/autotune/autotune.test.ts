/**
 * Characterization tests for autotune/index.js (tuneAllTheThings)
 *
 * Tests the core autotune algorithm that adjusts:
 * - Basal rates (hourly adjustments based on deviations)
 * - ISF (insulin sensitivity factor)
 * - CSF (carb sensitivity factor)
 * - CR (carb ratio)
 * - DIA (duration of insulin action) if diaDeviations provided
 * - Peak time if peakDeviations provided
 *
 * Input: { previousAutotune, pumpProfile, preppedGlucose }
 * Output: Updated autotune profile with adjusted parameters
 *
 * SAFETY: This is a characterization test suite. Snapshots capture the EXACT
 * current behavior. Do not update snapshots without understanding why they changed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import tuneAllTheThings from '../../../lib/autotune/index';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const BASAL_PROFILE = [
  { i: 0, start: '00:00:00', rate: 0.8, minutes: 0 },
];

const ISF_PROFILE = {
  sensitivities: [{ offset: 0, sensitivity: 100, endOffset: 1440 }],
};

/**
 * Build a previousAutotune profile (the autotuned profile from the prior run).
 */
function makePreviousAutotune(overrides: Record<string, unknown> = {}) {
  return {
    basalprofile: JSON.parse(JSON.stringify(BASAL_PROFILE)),
    isfProfile: JSON.parse(JSON.stringify(ISF_PROFILE)),
    sens: 100,
    carb_ratio: 10,
    csf: 10, // ISF / carb_ratio
    dia: 5,
    curve: 'rapid-acting',
    useCustomPeakTime: false,
    insulinPeakTime: 75,
    min_5m_carbimpact: 8,
    ...overrides,
  };
}

/**
 * Build a pump profile.
 */
function makePumpProfile(overrides: Record<string, unknown> = {}) {
  return {
    basalprofile: JSON.parse(JSON.stringify(BASAL_PROFILE)),
    isfProfile: JSON.parse(JSON.stringify(ISF_PROFILE)),
    sens: 100,
    carb_ratio: 10,
    dia: 5,
    curve: 'rapid-acting',
    useCustomPeakTime: false,
    insulinPeakTime: 75,
    autosens_min: 0.7,
    autosens_max: 1.2,
    autotune_isf_adjustmentFraction: 1.0,
    ...overrides,
  };
}

/**
 * Build a basal glucose datum — what categorize.js produces for basal periods.
 * The tuning algorithm reads: date, dateString, deviation, BGI, avgDelta
 */
function makeBasalDatum(
  hour: number,
  deviation: number,
  overrides: Record<string, unknown> = {},
) {
  // Create a date at the specified hour on 2025-01-15
  const d = new Date(`2025-01-15T${String(hour).padStart(2, '0')}:00:00.000Z`);
  return {
    glucose: 120,
    date: d.getTime(),
    dateString: d.toISOString(),
    deviation: String(deviation),
    BGI: -1.0,
    avgDelta: '0.00',
    ...overrides,
  };
}

/**
 * Build an ISF glucose datum — used for ISF tuning (median ratio method).
 */
function makeISFDatum(
  hour: number,
  deviation: number,
  BGI: number,
  overrides: Record<string, unknown> = {},
) {
  const d = new Date(`2025-01-15T${String(hour).padStart(2, '0')}:15:00.000Z`);
  return {
    glucose: 180,
    date: d.getTime(),
    dateString: d.toISOString(),
    deviation: String(deviation),
    BGI: BGI,
    avgDelta: String(deviation + BGI),
    ...overrides,
  };
}

/**
 * Build a CSF glucose datum — used for carb sensitivity tuning.
 */
function makeCSFDatum(
  hour: number,
  deviation: number,
  mealCarbs: number,
  mealAbsorption?: string,
  overrides: Record<string, unknown> = {},
) {
  const d = new Date(`2025-01-15T${String(hour).padStart(2, '0')}:30:00.000Z`);
  return {
    glucose: 140,
    date: d.getTime(),
    dateString: d.toISOString(),
    deviation: String(deviation),
    BGI: -0.5,
    avgDelta: String(deviation - 0.5),
    mealCarbs: mealCarbs,
    ...(mealAbsorption ? { mealAbsorption } : {}),
    ...overrides,
  };
}

/**
 * Build a CRData entry.
 */
function makeCRDatum(overrides: Record<string, unknown> = {}) {
  return {
    CRInitialIOB: 0.5,
    CRInitialBG: 110,
    CRInitialCarbTime: new Date('2025-01-15T10:00:00.000Z'),
    CREndIOB: 0.1,
    CREndBG: 140,
    CREndTime: new Date('2025-01-15T13:00:00.000Z'),
    CRCarbs: 45,
    CRInsulin: 3.0,
    ...overrides,
  };
}

/**
 * Build the full inputs object for tuneAllTheThings.
 */
function makeInputs(overrides: Record<string, unknown> = {}) {
  return {
    previousAutotune: makePreviousAutotune(),
    pumpProfile: makePumpProfile(),
    preppedGlucose: {
      CRData: [],
      CSFGlucoseData: [],
      ISFGlucoseData: [],
      basalGlucoseData: [],
    },
    ...overrides,
  };
}

function normalizeOutput(result: any) {
  if (!result) return result;
  return JSON.parse(JSON.stringify(result));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autotune/index (tuneAllTheThings) characterization tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // =========================================================================
  // Minimal inputs — no data to tune from
  // =========================================================================
  describe('minimal inputs with empty glucose data', () => {
    it('no glucose data produces unchanged profile', () => {
      const inputs = makeInputs();
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Basal tuning
  // =========================================================================
  describe('basal tuning', () => {
    it('positive deviations at one hour increase prior basals', () => {
      // All deviations at hour 10 are positive -> should increase basals at hours 7-9
      const basalGlucoseData = [
        makeBasalDatum(10, 5),
        makeBasalDatum(10, 8),
        makeBasalDatum(10, 6),
        makeBasalDatum(10, 7),
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('negative deviations at one hour decrease prior basals', () => {
      // All deviations at hour 14 are negative -> should decrease basals at hours 11-13
      const basalGlucoseData = [
        makeBasalDatum(14, -5),
        makeBasalDatum(14, -8),
        makeBasalDatum(14, -6),
        makeBasalDatum(14, -7),
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('mixed deviations across multiple hours', () => {
      const basalGlucoseData = [
        // Positive deviations in morning
        makeBasalDatum(6, 4),
        makeBasalDatum(6, 3),
        makeBasalDatum(7, 5),
        makeBasalDatum(7, 6),
        // Negative deviations at night
        makeBasalDatum(22, -4),
        makeBasalDatum(22, -3),
        makeBasalDatum(23, -5),
        makeBasalDatum(23, -6),
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('basal adjustments are capped at autosens_max and autosens_min', () => {
      // Very large positive deviations that would push basals above autosens_max
      const basalGlucoseData = [];
      for (let i = 0; i < 20; i++) {
        basalGlucoseData.push(makeBasalDatum(12, 30));
      }
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('very negative deviations push basals below minRate cap (lines 291-293)', () => {
      // Large negative deviations at many hours to push basals below autosens_min * pump basal
      // minRate = pumpBasal * autotuneMin = 0.8 * 0.7 = 0.56
      // Need enough negative deviations to drop basal below 0.56
      const basalGlucoseData = [];
      for (let h = 0; h < 24; h++) {
        for (let i = 0; i < 10; i++) {
          basalGlucoseData.push(makeBasalDatum(h, -30));
        }
      }
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('uses default autosens bounds when pumpProfile omits autosens_min/max (line 277, 282)', () => {
      // When autosens_max and autosens_min are not defined on pumpProfile,
      // the code defaults to autotuneMax=1.2 and autotuneMin=0.7
      const basalGlucoseData = [];
      for (let i = 0; i < 10; i++) {
        basalGlucoseData.push(makeBasalDatum(12, 20));
      }
      const pumpProfile = makePumpProfile();
      delete (pumpProfile as any).autosens_max;
      delete (pumpProfile as any).autosens_min;
      const inputs = makeInputs({
        pumpProfile,
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // ISF tuning
  // =========================================================================
  describe('ISF tuning', () => {
    it('fewer than 10 ISF data points leaves ISF unchanged', () => {
      const ISFGlucoseData = [];
      for (let i = 0; i < 5; i++) {
        ISFGlucoseData.push(makeISFDatum(14 + i, 2, -3));
      }
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData,
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('10+ ISF data points adjusts ISF based on median ratio', () => {
      const ISFGlucoseData = [];
      for (let i = 0; i < 15; i++) {
        // deviation=2, BGI=-3 => ratio = 1 + 2/(-3) = 0.333
        // This means ISF should increase (less sensitive)
        ISFGlucoseData.push(makeISFDatum(10 + (i % 12), 2, -3));
      }
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData,
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('ISF is capped at autosens bounds relative to pump ISF', () => {
      const ISFGlucoseData = [];
      for (let i = 0; i < 15; i++) {
        // Very large positive deviation => ratio >> 1 => would want to increase ISF a lot
        ISFGlucoseData.push(makeISFDatum(10 + (i % 12), 20, -3));
      }
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData,
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // CSF tuning
  // =========================================================================
  describe('CSF tuning', () => {
    it('CSF adjustment with meal absorption data', () => {
      const CSFGlucoseData = [
        makeCSFDatum(12, 10, 45, 'start'),
        makeCSFDatum(12, 8, 45),
        makeCSFDatum(12, 6, 45),
        makeCSFDatum(13, 4, 45),
        makeCSFDatum(13, 2, 45, 'end'),
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData,
          ISFGlucoseData: [],
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('no meals leaves CSF unchanged', () => {
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // CR tuning
  // =========================================================================
  describe('CR tuning', () => {
    it('CRData produces adjusted carb ratio', () => {
      const CRData = [
        makeCRDatum({
          CRInitialIOB: 0.5,
          CRInitialBG: 100,
          CREndBG: 140,
          CRCarbs: 45,
          CRInsulin: 3.0,
          CRInsulinTotal: undefined, // will be computed
        }),
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData,
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('multiple CR data entries compute weighted CR', () => {
      const CRData = [
        makeCRDatum({
          CRInitialIOB: 0.5,
          CRInitialBG: 100,
          CREndBG: 130,
          CRCarbs: 30,
          CRInsulin: 2.0,
        }),
        makeCRDatum({
          CRInitialIOB: 1.0,
          CRInitialBG: 110,
          CREndBG: 150,
          CRCarbs: 60,
          CRInsulin: 5.0,
        }),
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData,
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // DIA tuning (when diaDeviations provided)
  // =========================================================================
  describe('DIA tuning', () => {
    it('diaDeviations adjusts DIA when lower-index dia is better', () => {
      const diaDeviations = [
        { dia: 3, meanDeviation: 5, SMRDeviation: 4, RMSDeviation: 6 },
        { dia: 4, meanDeviation: 3, SMRDeviation: 2, RMSDeviation: 3 },
        { dia: 5, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 6, meanDeviation: 9, SMRDeviation: 8, RMSDeviation: 10 },
        { dia: 7, meanDeviation: 11, SMRDeviation: 10, RMSDeviation: 12 },
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
          diaDeviations,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('diaDeviations adjusts DIA when higher-index dia is better', () => {
      const diaDeviations = [
        { dia: 3, meanDeviation: 11, SMRDeviation: 10, RMSDeviation: 12 },
        { dia: 4, meanDeviation: 9, SMRDeviation: 8, RMSDeviation: 10 },
        { dia: 5, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 6, meanDeviation: 3, SMRDeviation: 2, RMSDeviation: 3 },
        { dia: 7, meanDeviation: 2, SMRDeviation: 1, RMSDeviation: 2 },
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
          diaDeviations,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('DIA capped at 12 hours maximum', () => {
      const diaDeviations = [
        { dia: 10, meanDeviation: 11, SMRDeviation: 10, RMSDeviation: 12 },
        { dia: 11, meanDeviation: 9, SMRDeviation: 8, RMSDeviation: 10 },
        { dia: 12, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 13, meanDeviation: 3, SMRDeviation: 2, RMSDeviation: 3 },
        { dia: 14, meanDeviation: 2, SMRDeviation: 1, RMSDeviation: 2 },
      ];
      const inputs = makeInputs({
        previousAutotune: makePreviousAutotune({ dia: 12 }),
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
          diaDeviations,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Peak time tuning (when peakDeviations provided)
  // =========================================================================
  describe('peak time tuning', () => {
    it('peakDeviations adjusts peak time when better option found', () => {
      const peakDeviations = [
        { peak: 55, meanDeviation: 5, SMRDeviation: 4, RMSDeviation: 6 },
        { peak: 60, meanDeviation: 3, SMRDeviation: 2, RMSDeviation: 3 },
        { peak: 65, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { peak: 70, meanDeviation: 9, SMRDeviation: 8, RMSDeviation: 10 },
        { peak: 75, meanDeviation: 11, SMRDeviation: 10, RMSDeviation: 12 },
      ];
      const diaDeviations = [
        { dia: 3, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 4, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 5, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 6, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 7, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
          diaDeviations,
          peakDeviations,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('peakDeviations adjusts peak when higher-index peak is better (lines 133-134)', () => {
      // meanBest > 2 and RMSBest > 2 means a higher peak index is better.
      // peakDeviations[3] must have meanDev < current*0.99 and RMSDev < current*0.99
      const peakDeviations = [
        { peak: 55, meanDeviation: 11, SMRDeviation: 10, RMSDeviation: 12 },
        { peak: 60, meanDeviation: 9, SMRDeviation: 8, RMSDeviation: 10 },
        { peak: 65, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { peak: 70, meanDeviation: 3, SMRDeviation: 2, RMSDeviation: 3 },
        { peak: 75, meanDeviation: 2, SMRDeviation: 1, RMSDeviation: 2 },
      ];
      const diaDeviations = [
        { dia: 3, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 4, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 5, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 6, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 7, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
          diaDeviations,
          peakDeviations,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('peak unchanged when current peak is already optimal (line 140)', () => {
      // meanBest=2 and RMSBest=2 means current peak (index 2) is best,
      // so newPeak === peak and the else branch at line 140 fires.
      const peakDeviations = [
        { peak: 55, meanDeviation: 10, SMRDeviation: 9, RMSDeviation: 11 },
        { peak: 60, meanDeviation: 8, SMRDeviation: 7, RMSDeviation: 9 },
        { peak: 65, meanDeviation: 5, SMRDeviation: 4, RMSDeviation: 6 },
        { peak: 70, meanDeviation: 8, SMRDeviation: 7, RMSDeviation: 9 },
        { peak: 75, meanDeviation: 10, SMRDeviation: 9, RMSDeviation: 11 },
      ];
      const diaDeviations = [
        { dia: 3, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 4, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 5, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 6, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 7, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
          diaDeviations,
          peakDeviations,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // BG time parsing fallbacks (lines 221-226)
  // =========================================================================
  describe('BG time parsing fallbacks', () => {
    it('uses displayTime when date is missing (lines 221-222)', () => {
      const basalGlucoseData = [
        {
          glucose: 120,
          displayTime: '2025-01-15T10:00:00.000Z',
          deviation: '5',
          BGI: -1.0,
          avgDelta: '0.00',
        },
        {
          glucose: 120,
          displayTime: '2025-01-15T10:05:00.000Z',
          deviation: '3',
          BGI: -1.0,
          avgDelta: '0.00',
        },
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('uses dateString when date and displayTime are missing (lines 223-224)', () => {
      const basalGlucoseData = [
        {
          glucose: 120,
          dateString: '2025-01-15T14:00:00.000Z',
          deviation: '4',
          BGI: -1.0,
          avgDelta: '0.00',
        },
        {
          glucose: 120,
          dateString: '2025-01-15T14:05:00.000Z',
          deviation: '6',
          BGI: -1.0,
          avgDelta: '0.00',
        },
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('logs error when no time field is present (lines 225-226)', () => {
      // No date, displayTime, or dateString — triggers the error log.
      // The code continues with BGTime undefined, which will cause
      // BGTime.getHours() to fail, but we characterize whatever happens.
      const basalGlucoseData = [
        {
          glucose: 120,
          deviation: '2',
          BGI: -1.0,
          avgDelta: '0.00',
        },
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData,
        },
      });
      // This may throw since BGTime will be undefined when no time field exists
      try {
        const result = tuneAllTheThings(inputs);
        expect(normalizeOutput(result)).toMatchSnapshot();
      } catch (e: any) {
        expect(e.message).toMatchSnapshot();
      }
    });
  });

  // =========================================================================
  // Full scenario using test data similar to command-behavior tests
  // =========================================================================
  describe('full scenario with realistic data', () => {
    it('processes mix of basal, ISF, CSF, and CR data', () => {
      const basalGlucoseData = [
        makeBasalDatum(9, -0.75),
        makeBasalDatum(9, -0.55),
        makeBasalDatum(9, -0.60),
        makeBasalDatum(9, -0.60),
        makeBasalDatum(9, -0.40),
        makeBasalDatum(9, -0.45),
        makeBasalDatum(9, 0.50),
        makeBasalDatum(9, 0.55),
      ];

      const ISFGlucoseData = [];
      for (let i = 0; i < 12; i++) {
        ISFGlucoseData.push(makeISFDatum(19, 2.7 + (i * 0.05), -(2.5 + i * 0.05)));
      }

      const CSFGlucoseData = [
        makeCSFDatum(13, 1.55, 15, 'start'),
        makeCSFDatum(13, 4.50, 15),
        makeCSFDatum(13, 7.75, 15),
        makeCSFDatum(13, 9.75, 15),
        makeCSFDatum(13, 9.50, 15),
        makeCSFDatum(13, 7.80, 15),
        makeCSFDatum(13, 5.55, 15, 'end'),
      ];

      const CRData = [
        makeCRDatum({
          CRInitialIOB: -1.374,
          CRInitialBG: 46,
          CRInitialCarbTime: new Date('2018-09-05T00:28:11.742Z'),
          CREndIOB: -1.136,
          CREndBG: 138,
          CREndTime: new Date('2018-09-05T01:38:12.059Z'),
          CRCarbs: 30,
          CRInsulin: -0.35,
        }),
      ];

      const inputs = makeInputs({
        preppedGlucose: {
          CRData,
          CSFGlucoseData,
          ISFGlucoseData,
          basalGlucoseData,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Custom autosens bounds
  // =========================================================================
  describe('custom autosens bounds', () => {
    it('uses pumpProfile autosens_max and autosens_min for capping', () => {
      const basalGlucoseData = [];
      for (let i = 0; i < 10; i++) {
        basalGlucoseData.push(makeBasalDatum(12, 20));
      }
      const inputs = makeInputs({
        pumpProfile: makePumpProfile({
          autosens_max: 1.5,
          autosens_min: 0.5,
        }),
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData,
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // ultra-rapid curve handling
  // =========================================================================
  describe('ultra-rapid curve', () => {
    it('uses peak=55 for ultra-rapid when useCustomPeakTime is false', () => {
      const inputs = makeInputs({
        previousAutotune: makePreviousAutotune({
          curve: 'ultra-rapid',
          useCustomPeakTime: false,
        }),
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // autotune_isf_adjustmentFraction
  // =========================================================================
  describe('ISF adjustment fraction', () => {
    it('adjustmentFraction=0 weights entirely toward pump ISF', () => {
      const ISFGlucoseData = [];
      for (let i = 0; i < 15; i++) {
        ISFGlucoseData.push(makeISFDatum(10 + (i % 12), -5, -3));
      }
      const inputs = makeInputs({
        pumpProfile: makePumpProfile({
          autotune_isf_adjustmentFraction: 0,
        }),
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData,
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('adjustmentFraction=0.5 weights 50/50 between new and pump ISF', () => {
      const ISFGlucoseData = [];
      for (let i = 0; i < 15; i++) {
        ISFGlucoseData.push(makeISFDatum(10 + (i % 12), -5, -3));
      }
      const inputs = makeInputs({
        pumpProfile: makePumpProfile({
          autotune_isf_adjustmentFraction: 0.5,
        }),
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData,
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Zero basal rate in profile (error path)
  // =========================================================================
  describe('error paths', () => {
    it('zero rate in basal profile returns undefined', () => {
      const inputs = makeInputs({
        previousAutotune: makePreviousAutotune({
          basalprofile: [{ i: 0, start: '00:00:00', rate: 0, minutes: 0 }],
        }),
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('zero rate in pump basal profile returns undefined', () => {
      const inputs = makeInputs({
        pumpProfile: makePumpProfile({
          basalprofile: [{ i: 0, start: '00:00:00', rate: 0, minutes: 0 }],
        }),
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Branch coverage: line 319 — untuned++ (pre-existing untuned property)
  // =========================================================================
  describe('basal untuned counter (line 319)', () => {
    it('increments untuned counter when basalprofile already has untuned property', () => {
      // For line 319 to fire, the hour must be "unchanged" (old rate === new rate)
      // AND the basalprofile entry must already have an `untuned` property.
      // We pass no basalGlucoseData so all hours remain unchanged, and set
      // untuned=1 on the input profile so it gets incremented to 2.
      const inputs = makeInputs({
        previousAutotune: makePreviousAutotune({
          basalprofile: [
            { i: 0, start: '00:00:00', rate: 0.8, minutes: 0, untuned: 1 },
          ],
        }),
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('increments untuned counter with higher initial untuned value', () => {
      const inputs = makeInputs({
        previousAutotune: makePreviousAutotune({
          basalprofile: [
            { i: 0, start: '00:00:00', rate: 0.8, minutes: 0, untuned: 5 },
          ],
        }),
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Branch coverage: lines 387-388 — CSF > maxCSF cap
  // =========================================================================
  describe('CSF safety caps (lines 387-391)', () => {
    it('caps CSF at maxCSF when newCSF exceeds pumpCSF * autotuneMax', () => {
      // To push CSF above maxCSF: need large totalDeviations relative to totalMealCarbs.
      // CSF = ISF / carb_ratio = 100/10 = 10
      // pumpCSF = pumpISF / pumpCarbRatio = 100/10 = 10
      // maxCSF = pumpCSF * autotuneMax = 10 * 1.2 = 12
      // fullNewCSF = totalDeviations / totalMealCarbs
      // newCSF = 0.8 * CSF + 0.2 * fullNewCSF
      // For newCSF > 12: 0.8*10 + 0.2*fullNewCSF > 12 => fullNewCSF > 20
      // So totalDeviations/totalMealCarbs > 20 => use small carbs, large deviations
      const CSFGlucoseData = [
        makeCSFDatum(12, 100, 5, 'start'),
        makeCSFDatum(12, 100, 5),
        makeCSFDatum(12, 100, 5),
        makeCSFDatum(13, 100, 5, 'end'),
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData,
          ISFGlucoseData: [],
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('caps CSF at minCSF when newCSF falls below pumpCSF * autotuneMin', () => {
      // minCSF = pumpCSF * autotuneMin = 10 * 0.7 = 7
      // For newCSF < 7: 0.8*10 + 0.2*fullNewCSF < 7 => fullNewCSF < -5
      // Negative fullNewCSF: totalDeviations / totalMealCarbs < -5
      // We need negative deviations during meal absorption
      const CSFGlucoseData = [
        makeCSFDatum(12, -50, 20, 'start'),
        makeCSFDatum(12, -50, 20),
        makeCSFDatum(12, -50, 20),
        makeCSFDatum(13, -50, 20, 'end'),
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData,
          ISFGlucoseData: [],
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Branch coverage: line 404 — totalCR === 0 (no CR data)
  // =========================================================================
  describe('CR tuning edge cases (lines 404, 418-434)', () => {
    it('totalCR of zero keeps CR unchanged (line 404)', () => {
      // CRData with entries where CRInsulinTotal <= 0 so they are skipped,
      // resulting in CRTotalCarbs=0, CRTotalInsulin=0, totalCR=0/0=NaN
      // Actually, totalCR = CRTotalCarbs / CRTotalInsulin. If both are 0, NaN.
      // But the check is totalCR === 0. For totalCR to be exactly 0,
      // CRTotalCarbs must be 0 and CRTotalInsulin non-zero... That's impossible
      // if CRInsulinTotal>0 adds CRCarbs. Let's try with CRData that has
      // negative CRInsulinTotal so none get counted. Then CRTotalInsulin=0
      // and totalCR = 0/0 = NaN. NaN === 0 is false.
      // Actually we need CRTotalCarbs = 0 with CRTotalInsulin != 0.
      // That means a CRDatum with CRCarbs=0 and CRInsulinTotal>0.
      const CRData = [
        makeCRDatum({
          CRCarbs: 0,
          CRInitialIOB: 2,
          CRInitialBG: 100,
          CREndBG: 100,
          CRInsulin: 3.0,
        }),
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData,
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('fullNewCR exceeds maxCR and gets capped (lines 418-419)', () => {
      // maxCR = pumpCarbRatio * autotuneMax = 10 * 1.2 = 12
      // totalCR = CRTotalCarbs / CRTotalInsulin must be > 12
      // fullNewCR = totalCR (since totalCR !== 0)
      // So need CRTotalCarbs / CRTotalInsulin > 12
      // e.g., CRCarbs=50, CRInsulinTotal small (say CRInitialIOB+CRInsulin+CRInsulinReq ~ 2)
      const CRData = [
        makeCRDatum({
          CRCarbs: 100,
          CRInitialIOB: 0.5,
          CRInitialBG: 100,
          CREndBG: 100, // BG change = 0, so CRInsulinReq = 0
          CRInsulin: 1.0, // CRInsulinTotal = 0.5 + 1.0 + 0 = 1.5
          // totalCR = 100 / 1.5 = 66.67 >> 12
        }),
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData,
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('fullNewCR below minCR and gets capped (lines 421-422)', () => {
      // minCR = pumpCarbRatio * autotuneMin = 10 * 0.7 = 7
      // totalCR = CRTotalCarbs / CRTotalInsulin < 7
      // Need small carbs relative to insulin total
      // e.g., CRCarbs=10, CRInsulinTotal large
      const CRData = [
        makeCRDatum({
          CRCarbs: 10,
          CRInitialIOB: 5,
          CRInitialBG: 100,
          CREndBG: 200, // BG change = 100, CRInsulinReq = 100/100 = 1
          CRInsulin: 5.0, // CRInsulinTotal = 5 + 5 + 1 = 11
          // totalCR = 10 / 11 = 0.909 << 7
        }),
      ];
      const inputs = makeInputs({
        preppedGlucose: {
          CRData,
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('newCR exceeds maxCR after 80/20 blend (lines 430-431)', () => {
      // newCR = 0.8 * carbRatio + 0.2 * fullNewCR
      // If carbRatio is already high (previousAutotune.carb_ratio high)
      // and fullNewCR is capped at maxCR, the blend can exceed maxCR.
      // maxCR = 10 * 1.2 = 12
      // We need carbRatio = 20 (from previousAutotune)
      // newCR = 0.8 * 20 + 0.2 * 12 = 16 + 2.4 = 18.4 > 12
      // Use CRData that produces fullNewCR > maxCR (gets capped at 12)
      const CRData = [
        makeCRDatum({
          CRCarbs: 100,
          CRInitialIOB: 0.5,
          CRInitialBG: 100,
          CREndBG: 100,
          CRInsulin: 1.0,
        }),
      ];
      const inputs = makeInputs({
        previousAutotune: makePreviousAutotune({ carb_ratio: 20 }),
        preppedGlucose: {
          CRData,
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('newCR below minCR after 80/20 blend (lines 433-434)', () => {
      // minCR = pumpCarbRatio * autotuneMin = 10 * 0.7 = 7
      // newCR = 0.8 * carbRatio + 0.2 * fullNewCR
      // If carbRatio is already low (say 3) and fullNewCR is capped at minCR=7:
      // newCR = 0.8 * 3 + 0.2 * 7 = 2.4 + 1.4 = 3.8 < 7
      const CRData = [
        makeCRDatum({
          CRCarbs: 10,
          CRInitialIOB: 5,
          CRInitialBG: 100,
          CREndBG: 200,
          CRInsulin: 5.0,
        }),
      ];
      const inputs = makeInputs({
        previousAutotune: makePreviousAutotune({ carb_ratio: 3 }),
        preppedGlucose: {
          CRData,
          CSFGlucoseData: [],
          ISFGlucoseData: [],
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Branch coverage: lines 514-518 — newISF cap after 80/20 blend
  // =========================================================================
  describe('ISF final cap after 80/20 blend (lines 514-518)', () => {
    it('newISF exceeds maxISF after blend — caps at maxISF (line 514-516)', () => {
      // maxISF = pumpISF / autotuneMin = 100 / 0.7 = 142.86
      // newISF = 0.8 * ISF + 0.2 * adjustedISF
      // adjustedISF is capped at maxISF = 142.86
      // For newISF > maxISF: 0.8 * ISF + 0.2 * 142.86 > 142.86
      // => ISF > 142.86
      // Set previousAutotune ISF to 200 (well above maxISF)
      const ISFGlucoseData = [];
      for (let i = 0; i < 15; i++) {
        // deviation=50, BGI=-3 => ratio = 1 + 50/(-3) = -15.67
        // fullNewISF = ISF * p50ratios = 200 * (-15.67) < 0
        // When fullNewISF < 0, adjustedISF = ISF = 200
        // adjustedISF > maxISF = 142.86, so capped to 142.86
        // newISF = 0.8 * 200 + 0.2 * 142.86 = 160 + 28.57 = 188.57 > 142.86
        ISFGlucoseData.push(makeISFDatum(10 + (i % 12), 10, -3));
      }
      const inputs = makeInputs({
        previousAutotune: makePreviousAutotune({
          isfProfile: {
            sensitivities: [{ offset: 0, sensitivity: 200, endOffset: 1440 }],
          },
        }),
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData,
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });

    it('newISF below minISF after blend — caps at minISF (lines 517-518)', () => {
      // minISF = pumpISF / autotuneMax = 100 / 1.2 = 83.33
      // For newISF < minISF: 0.8 * ISF + 0.2 * adjustedISF < 83.33
      // adjustedISF is capped at minISF = 83.33
      // 0.8 * ISF + 0.2 * 83.33 < 83.33
      // => ISF < 83.33
      // Set previousAutotune ISF to 50 (well below minISF)
      const ISFGlucoseData = [];
      for (let i = 0; i < 15; i++) {
        // deviation=-30, BGI=-3 => ratio = 1 + (-30)/(-3) = 11
        // fullNewISF = 50 * 11 = 550 > maxISF...
        // Let's use deviation that gives ratio < 1 to push ISF lower
        // deviation=5, BGI=3 (positive BGI) => ratio = 1 + 5/3 = 2.67
        // fullNewISF = 50 * 2.67 = 133.5
        // adjustedISF = 133.5, but capped at maxISF=142.86 (not capped)
        // newISF = 0.8*50 + 0.2*133.5 = 40 + 26.7 = 66.7 < 83.33
        ISFGlucoseData.push(makeISFDatum(10 + (i % 12), 5, 3));
      }
      const inputs = makeInputs({
        previousAutotune: makePreviousAutotune({
          isfProfile: {
            sensitivities: [{ offset: 0, sensitivity: 50, endOffset: 1440 }],
          },
        }),
        preppedGlucose: {
          CRData: [],
          CSFGlucoseData: [],
          ISFGlucoseData,
          basalGlucoseData: [],
        },
      });
      const result = tuneAllTheThings(inputs);
      expect(normalizeOutput(result)).toMatchSnapshot();
    });
  });

  // =========================================================================
  // Branch coverage: line 554 — module.exports (coverage artifact)
  // This line is the export statement and should always be covered.
  // Adding a test that simply verifies the module exports correctly.
  // =========================================================================
  describe('module export (line 554)', () => {
    it('exports tuneAllTheThings as a function', () => {
      expect(typeof tuneAllTheThings).toBe('function');
    });
  });
});
