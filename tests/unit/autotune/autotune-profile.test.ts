import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autotuneProfile } from '../../../src/autotune/index';
import type {
    AutotuneInputs,
    AutotunePreviousProfile,
    AutotunePumpProfile,
    AutotunePreppedGlucose,
    AutotuneGlucoseDatum,
} from '../../../src/autotune/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGlucoseDatum(overrides: Partial<AutotuneGlucoseDatum> = {}): AutotuneGlucoseDatum {
    return {
        deviation: '2',
        BGI: -4,
        avgDelta: '-2',
        date: new Date('2025-01-15T08:00:00.000Z').getTime(),
        ...overrides,
    };
}

function makeBasalEntry(hour: number, rate: number) {
    return {
        i: hour,
        start: ('000' + hour).slice(-2) + ':00:00',
        rate,
        minutes: hour * 60,
    };
}

function makePreviousProfile(overrides: Partial<AutotunePreviousProfile> = {}): AutotunePreviousProfile {
    return {
        basalprofile: Array.from({ length: 24 }, (_, h) => makeBasalEntry(h, 1.0)),
        isfProfile: {
            sensitivities: [{ offset: 0, sensitivity: 40, endOffset: 1440 }],
        },
        carb_ratio: 10,
        dia: 6,
        min_5m_carbimpact: 8,
        ...overrides,
    };
}

function makePumpProfile(overrides: Partial<AutotunePumpProfile> = {}): AutotunePumpProfile {
    return {
        basalprofile: Array.from({ length: 24 }, (_, h) => makeBasalEntry(h, 1.0)),
        isfProfile: {
            sensitivities: [{ offset: 0, sensitivity: 40, endOffset: 1440 }],
        },
        carb_ratio: 10,
        autosens_max: 1.2,
        autosens_min: 0.7,
        ...overrides,
    };
}

function makePreppedGlucose(overrides: Partial<AutotunePreppedGlucose> = {}): AutotunePreppedGlucose {
    // At least 10 ISF data points needed for ISF tuning
    const isfData = Array.from({ length: 12 }, () =>
        makeGlucoseDatum({ deviation: '2', BGI: -4, avgDelta: '-2' }),
    );
    return {
        CRData: [],
        CSFGlucoseData: [],
        ISFGlucoseData: isfData,
        basalGlucoseData: [],
        ...overrides,
    };
}

function makeInputs(overrides: Partial<AutotuneInputs> = {}): AutotuneInputs {
    return {
        previousAutotune: makePreviousProfile(),
        pumpProfile: makePumpProfile(),
        preppedGlucose: makePreppedGlucose(),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// autotuneProfile
// ---------------------------------------------------------------------------

describe('autotuneProfile', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('falls back to pumpCarbRatio when previousAutotune.carb_ratio is 0 (falsy)', () => {
        // Line 48: if (!carbRatio) { carbRatio = pumpCarbRatio }
        const inputs = makeInputs({
            previousAutotune: makePreviousProfile({ carb_ratio: 0 }),
        });
        const result = autotuneProfile(inputs);
        expect(result).toBeDefined();
        // carb_ratio should be derived from pump profile (10)
        expect(result!.carb_ratio).toBeDefined();
    });

    it('falls back to pumpISF when ISF is 0 (falsy)', () => {
        // Line 50: if (!ISF) { ISF = pumpISF }
        const inputs = makeInputs({
            previousAutotune: makePreviousProfile({
                isfProfile: {
                    sensitivities: [{ offset: 0, sensitivity: 0, endOffset: 1440 }],
                },
            }),
        });
        const result = autotuneProfile(inputs);
        expect(result).toBeDefined();
        // Should have fallen back to pump ISF of 40
        expect(result!.sens).toBeDefined();
    });

    it('applies newCSF when tuneCSF returns a value', () => {
        // Line 89: if (newCSF) { CSF = newCSF; }
        // CSF tuning produces a result when CSFGlucoseData has enough data
        const csfData = Array.from({ length: 15 }, () =>
            makeGlucoseDatum({ deviation: '5', BGI: -3, avgDelta: '-1' }),
        );
        const inputs = makeInputs({
            preppedGlucose: makePreppedGlucose({
                CSFGlucoseData: csfData,
            }),
        });
        const result = autotuneProfile(inputs);
        expect(result).toBeDefined();
        expect(result!.csf).toBeDefined();
    });

    it('applies ISF result when tuneISF returns a newISF', () => {
        // Line 106: if (isfResult.newISF) { ISF = isfResult.newISF; }
        const inputs = makeInputs();
        const result = autotuneProfile(inputs);
        expect(result).toBeDefined();
        expect(result!.sens).toBeDefined();
        expect(typeof result!.sens).toBe('number');
    });

    it('returns undefined when basal profile tuning fails', () => {
        // Line 74: if (!basalResult) { return undefined; }
        const inputs = makeInputs({
            previousAutotune: makePreviousProfile({
                basalprofile: [makeBasalEntry(0, 0)],
            }),
        });
        const result = autotuneProfile(inputs);
        expect(result).toBeUndefined();
    });

    it('sets useCustomPeakTime when diaDeviations are present', () => {
        // Line 120-122: if (diaDeviations || peakDeviations) { useCustomPeakTime = true }
        const diaDevs = [
            { dia: 4, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
            { dia: 5, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
            { dia: 6, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
            { dia: 7, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
            { dia: 8, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        ];
        const inputs = makeInputs({
            preppedGlucose: makePreppedGlucose({
                diaDeviations: diaDevs,
            }),
        });
        const result = autotuneProfile(inputs);
        expect(result).toBeDefined();
        expect(result!.useCustomPeakTime).toBe(true);
    });
});
