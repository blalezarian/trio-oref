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

import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const require = createRequire(import.meta.url);
const tuneAllTheThings = require('../../../lib/autotune/index');

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
});
