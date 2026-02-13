import { describe, it, expect } from 'vitest';
import {
    resolvePeakTime,
    extractPumpBaselines,
} from '../../../src/autotune/index';
import type {
    AutotunePreviousProfile,
    AutotunePumpProfile,
} from '../../../src/autotune/types';
import {
    ULTRA_RAPID_PEAK,
    RAPID_ACTING_PEAK,
} from '../../../src/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<AutotunePreviousProfile> = {}): AutotunePreviousProfile {
    return {
        basalprofile: [{ i: 0, start: '00:00:00', rate: 1.0, minutes: 0 }],
        isfProfile: { sensitivities: [{ offset: 0, sensitivity: 40, endOffset: 1440 }] },
        carb_ratio: 10,
        dia: 6,
        ...overrides,
    };
}

function makePumpProfile(overrides: Partial<AutotunePumpProfile> = {}): AutotunePumpProfile {
    return {
        basalprofile: [{ i: 0, start: '00:00:00', rate: 1.0, minutes: 0 }],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// resolvePeakTime
// ---------------------------------------------------------------------------

describe('resolvePeakTime', () => {
    it('returns custom peak time when useCustomPeakTime is true', () => {
        const profile = makeProfile({
            useCustomPeakTime: true,
            insulinPeakTime: 55,
        });
        expect(resolvePeakTime(profile)).toBe(55);
    });

    it('returns ULTRA_RAPID_PEAK for ultra-rapid curve', () => {
        const profile = makeProfile({
            useCustomPeakTime: false,
            curve: 'ultra-rapid',
        });
        expect(resolvePeakTime(profile)).toBe(ULTRA_RAPID_PEAK);
    });

    it('returns RAPID_ACTING_PEAK for rapid-acting curve', () => {
        const profile = makeProfile({
            useCustomPeakTime: false,
            curve: 'rapid-acting',
        });
        expect(resolvePeakTime(profile)).toBe(RAPID_ACTING_PEAK);
    });

    it('returns RAPID_ACTING_PEAK when curve is undefined', () => {
        const profile = makeProfile({
            useCustomPeakTime: false,
            curve: undefined,
        });
        expect(resolvePeakTime(profile)).toBe(RAPID_ACTING_PEAK);
    });

    it('returns RAPID_ACTING_PEAK when useCustomPeakTime is undefined', () => {
        const profile = makeProfile({
            useCustomPeakTime: undefined,
        });
        expect(resolvePeakTime(profile)).toBe(RAPID_ACTING_PEAK);
    });
});

// ---------------------------------------------------------------------------
// extractPumpBaselines
// ---------------------------------------------------------------------------

describe('extractPumpBaselines', () => {
    it('extracts pumpISF, pumpCarbRatio, pumpCSF from pump profile', () => {
        const pump = makePumpProfile({
            isfProfile: {
                sensitivities: [{ offset: 0, sensitivity: 50, endOffset: 1440 }],
            },
            carb_ratio: 10,
        });
        const result = extractPumpBaselines(pump);
        expect(result.pumpISF).toBe(50);
        expect(result.pumpCarbRatio).toBe(10);
        expect(result.pumpCSF).toBe(5); // 50 / 10
    });

    it('returns all undefined when pump has no ISF profile', () => {
        const pump = makePumpProfile({ isfProfile: undefined });
        const result = extractPumpBaselines(pump);
        expect(result.pumpISF).toBeUndefined();
        expect(result.pumpCarbRatio).toBeUndefined();
        expect(result.pumpCSF).toBeUndefined();
    });

    it('returns all undefined when ISF profile has no sensitivities', () => {
        const pump = makePumpProfile({
            isfProfile: { sensitivities: [] },
        });
        const result = extractPumpBaselines(pump);
        expect(result.pumpISF).toBeUndefined();
        expect(result.pumpCarbRatio).toBeUndefined();
        expect(result.pumpCSF).toBeUndefined();
    });

    it('computes pumpCSF as pumpISF / pumpCarbRatio', () => {
        const pump = makePumpProfile({
            isfProfile: {
                sensitivities: [{ offset: 0, sensitivity: 100, endOffset: 1440 }],
            },
            carb_ratio: 8,
        });
        const result = extractPumpBaselines(pump);
        expect(result.pumpCSF).toBe(12.5); // 100 / 8
    });
});
