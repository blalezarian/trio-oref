import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    convertToHourlyProfile,
    parseHourFromDatum,
    sumDeviationsByHour,
    adjustBasalsByDeviations,
    capBasalRates,
    smoothUntunedHours,
    tuneBasalProfile,
} from '../../../src/autotune/tune-basal-profile';
import type {
    AutotuneBasalProfileEntry,
    AutotuneGlucoseDatum,
    AutotunePumpProfile,
    AutotuneBounds,
} from '../../../src/autotune/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBasalEntry(overrides: Partial<AutotuneBasalProfileEntry> = {}): AutotuneBasalProfileEntry {
    return {
        i: 0,
        start: '00:00:00',
        rate: 1.0,
        minutes: 0,
        ...overrides,
    };
}

/** Build a 24-element hourly profile with a uniform rate */
function makeHourlyProfile(rate = 1.0): AutotuneBasalProfileEntry[] {
    return Array.from({ length: 24 }, (_, hour) => ({
        i: hour,
        start: ('000' + hour).slice(-2) + ':00:00',
        rate,
        minutes: hour * 60,
    }));
}

function makeGlucoseDatum(overrides: Partial<AutotuneGlucoseDatum> = {}): AutotuneGlucoseDatum {
    return {
        deviation: '0',
        BGI: -1.5,
        avgDelta: '-2',
        date: new Date('2025-01-15T08:00:00.000Z').getTime(),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// convertToHourlyProfile
// ---------------------------------------------------------------------------

describe('convertToHourlyProfile', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('expands a single-entry basal profile to 24 hours', () => {
        const profile = [makeBasalEntry({ i: 0, start: '00:00:00', rate: 0.8, minutes: 0 })];
        const result = convertToHourlyProfile(profile, 'basal');
        expect(result).toBeDefined();
        expect(result!.length).toBe(24);
        for (let hour = 0; hour < 24; hour++) {
            expect(result![hour].i).toBe(hour);
            expect(result![hour].minutes).toBe(hour * 60);
            expect(result![hour].rate).toBe(0.8);
        }
    });

    it('expands a multi-entry basal profile with different rates per time block', () => {
        const profile = [
            makeBasalEntry({ i: 0, start: '00:00:00', rate: 0.5, minutes: 0 }),
            makeBasalEntry({ i: 1, start: '06:00:00', rate: 1.0, minutes: 360 }),
            makeBasalEntry({ i: 2, start: '12:00:00', rate: 0.75, minutes: 720 }),
        ];
        const result = convertToHourlyProfile(profile, 'basal');
        expect(result).toBeDefined();
        // Hours 0-5 should be 0.5, hours 6-11 should be 1.0, hours 12-23 should be 0.75
        expect(result![0].rate).toBe(0.5);
        expect(result![5].rate).toBe(0.5);
        expect(result![6].rate).toBe(1.0);
        expect(result![11].rate).toBe(1.0);
        expect(result![12].rate).toBe(0.75);
        expect(result![23].rate).toBe(0.75);
    });

    it('returns undefined for basal profile with rate 0 on matching entry', () => {
        const profile = [makeBasalEntry({ rate: 0, minutes: 0 })];
        const result = convertToHourlyProfile(profile, 'basal');
        expect(result).toBeUndefined();
        expect(console.error).toHaveBeenCalledWith(
            'ERROR: bad basalProfile',
            expect.objectContaining({ rate: 0 }),
        );
    });

    it('returns undefined for pump profile with any rate 0 entry', () => {
        const profile = [
            makeBasalEntry({ rate: 1.0, minutes: 0 }),
            makeBasalEntry({ rate: 0, minutes: 360 }),
        ];
        const result = convertToHourlyProfile(profile, 'pump');
        expect(result).toBeUndefined();
        expect(console.error).toHaveBeenCalledWith(
            'ERROR: bad pumpBasalProfile',
            expect.objectContaining({ rate: 0 }),
        );
    });

    it('rounds rate to 3 decimal places', () => {
        const profile = [makeBasalEntry({ rate: 1.1115, minutes: 0 })];
        const result = convertToHourlyProfile(profile, 'basal');
        expect(result).toBeDefined();
        expect(result![0].rate).toBe(1.112);
    });

    it('formats start as HH:00:00 with zero-padded hour', () => {
        const profile = [makeBasalEntry({ rate: 1.0, minutes: 0 })];
        const result = convertToHourlyProfile(profile, 'basal');
        expect(result).toBeDefined();
        expect(result![0].start).toBe('00:00:00');
        expect(result![9].start).toBe('09:00:00');
        expect(result![23].start).toBe('23:00:00');
    });

    it('makes shallow copies of entries (does not alias original)', () => {
        const original = makeBasalEntry({ rate: 1.0, minutes: 0 });
        const result = convertToHourlyProfile([original], 'basal');
        expect(result).toBeDefined();
        result![0].rate = 999;
        expect(original.rate).toBe(1.0);
    });
});

// ---------------------------------------------------------------------------
// parseHourFromDatum
// ---------------------------------------------------------------------------

describe('parseHourFromDatum', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('parses hour from date (numeric timestamp)', () => {
        const datum = makeGlucoseDatum({
            date: new Date('2025-01-15T14:30:00.000Z').getTime(),
        });
        const hour = parseHourFromDatum(datum);
        // getHours() is timezone-dependent, just verify it returns a number 0-23
        expect(hour).toBeGreaterThanOrEqual(0);
        expect(hour).toBeLessThanOrEqual(23);
    });

    it('parses hour from displayTime', () => {
        const datum = makeGlucoseDatum({
            date: undefined,
            displayTime: '2025-01-15T08:15:00',
        });
        const hour = parseHourFromDatum(datum);
        expect(hour).toBeGreaterThanOrEqual(0);
        expect(hour).toBeLessThanOrEqual(23);
    });

    it('parses hour from dateString when date and displayTime missing', () => {
        const datum = makeGlucoseDatum({
            date: undefined,
            displayTime: undefined,
            dateString: '2025-01-15T20:00:00.000Z',
        });
        const hour = parseHourFromDatum(datum);
        expect(hour).toBeGreaterThanOrEqual(0);
        expect(hour).toBeLessThanOrEqual(23);
    });

    it('prefers date over displayTime over dateString', () => {
        // All three present — date should win
        const datum = makeGlucoseDatum({
            date: new Date('2025-01-15T10:00:00.000Z').getTime(),
            displayTime: '2025-01-15T15:00:00',
            dateString: '2025-01-15T20:00:00.000Z',
        });
        // Should use date field
        const hourFromDate = new Date(datum.date!).getHours();
        expect(parseHourFromDatum(datum)).toBe(hourFromDate);
    });

    it('crashes when no time field is present (preserves original behavior)', () => {
        const datum = makeGlucoseDatum({
            date: undefined,
            displayTime: undefined,
            dateString: undefined,
        });
        expect(() => parseHourFromDatum(datum)).toThrow();
    });
});

// ---------------------------------------------------------------------------
// sumDeviationsByHour
// ---------------------------------------------------------------------------

describe('sumDeviationsByHour', () => {
    it('returns 24-element array of zeros for empty input', () => {
        const result = sumDeviationsByHour([]);
        expect(result.length).toBe(24);
        expect(result.every(d => d === 0)).toBe(true);
    });

    it('sums deviations per hour', () => {
        // Two data points at the same hour
        const hour = new Date('2025-01-15T10:00:00.000Z').getHours();
        const data = [
            makeGlucoseDatum({ date: new Date('2025-01-15T10:05:00.000Z').getTime(), deviation: '5.5' }),
            makeGlucoseDatum({ date: new Date('2025-01-15T10:10:00.000Z').getTime(), deviation: '3.2' }),
        ];
        const result = sumDeviationsByHour(data);
        expect(result[hour]).toBe(8.7);
    });

    it('rounds to 3 decimal places', () => {
        const hour = new Date('2025-01-15T10:00:00.000Z').getHours();
        const data = [
            makeGlucoseDatum({ date: new Date('2025-01-15T10:00:00.000Z').getTime(), deviation: '1.1111' }),
            makeGlucoseDatum({ date: new Date('2025-01-15T10:05:00.000Z').getTime(), deviation: '2.2222' }),
        ];
        const result = sumDeviationsByHour(data);
        expect(result[hour]).toBe(3.333);
    });
});

// ---------------------------------------------------------------------------
// adjustBasalsByDeviations
// ---------------------------------------------------------------------------

describe('adjustBasalsByDeviations', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('does not modify profile when all deviations are zero', () => {
        const profile = makeHourlyProfile(1.0);
        const deviations = new Array(24).fill(0);
        adjustBasalsByDeviations(profile, deviations, 40);
        for (const entry of profile) {
            expect(entry.rate).toBe(1.0);
        }
    });

    it('increases prior 3 hours equally for positive deviations', () => {
        const profile = makeHourlyProfile(1.0);
        const deviations = new Array(24).fill(0);
        // Positive deviation at hour 6 → adjusts hours 3,4,5
        deviations[6] = 12; // basalNeeded = 0.2 * 12 / 40 * 100 / 100 = 0.06
        adjustBasalsByDeviations(profile, deviations, 40);
        // Each of hours 3,4,5 gets +0.06/3 = +0.02
        expect(profile[3].rate).toBe(1.02);
        expect(profile[4].rate).toBe(1.02);
        expect(profile[5].rate).toBe(1.02);
        // Other hours unchanged
        expect(profile[6].rate).toBe(1.0);
        expect(profile[0].rate).toBe(1.0);
    });

    it('decreases prior 3 hours proportionally for negative deviations', () => {
        const profile = makeHourlyProfile(1.0);
        const deviations = new Array(24).fill(0);
        // Negative deviation at hour 6 → decreases hours 3,4,5 proportionally
        deviations[6] = -12; // basalNeeded = -0.06
        adjustBasalsByDeviations(profile, deviations, 40);
        // threeHourBasal = 3.0, adjustmentRatio = 1 + (-0.06/3.0) = 0.98
        expect(profile[3].rate).toBe(0.98);
        expect(profile[4].rate).toBe(0.98);
        expect(profile[5].rate).toBe(0.98);
    });

    it('wraps hours across midnight for hour 0-2', () => {
        const profile = makeHourlyProfile(1.0);
        const deviations = new Array(24).fill(0);
        // Positive deviation at hour 1 → adjusts hours 22,23,0
        deviations[1] = 12;
        adjustBasalsByDeviations(profile, deviations, 40);
        expect(profile[22].rate).toBe(1.02);
        expect(profile[23].rate).toBe(1.02);
        expect(profile[0].rate).toBe(1.02);
    });
});

// ---------------------------------------------------------------------------
// capBasalRates
// ---------------------------------------------------------------------------

describe('capBasalRates', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('caps rate at autotuneMax * pump rate', () => {
        const profile = makeHourlyProfile(2.0);
        const pumpProfile = makeHourlyProfile(1.0);
        const bounds: AutotuneBounds = { autotuneMax: 1.5, autotuneMin: 0.7 };
        capBasalRates(profile, pumpProfile, bounds);
        // 2.0 > 1.0 * 1.5 = 1.5, so capped at 1.5
        expect(profile[0].rate).toBe(1.5);
        expect(console.error).toHaveBeenCalledWith(
            'Limiting hour', 0, 'basal to', '1.50',
            '(which is', 1.5, '* pump basal of', 1.0, ')',
        );
    });

    it('caps rate at autotuneMin * pump rate', () => {
        const profile = makeHourlyProfile(0.3);
        const pumpProfile = makeHourlyProfile(1.0);
        const bounds: AutotuneBounds = { autotuneMax: 1.5, autotuneMin: 0.7 };
        capBasalRates(profile, pumpProfile, bounds);
        // 0.3 < 1.0 * 0.7 = 0.7, so capped at 0.7
        expect(profile[0].rate).toBe(0.7);
    });

    it('leaves rate unchanged when within bounds', () => {
        const profile = makeHourlyProfile(1.0);
        const pumpProfile = makeHourlyProfile(1.0);
        const bounds: AutotuneBounds = { autotuneMax: 1.5, autotuneMin: 0.7 };
        capBasalRates(profile, pumpProfile, bounds);
        expect(profile[0].rate).toBe(1.0);
    });

    it('rounds to BASAL_SCALE (1/20 = 0.05 increments)', () => {
        const profile = makeHourlyProfile(1.123);
        const pumpProfile = makeHourlyProfile(1.0);
        const bounds: AutotuneBounds = { autotuneMax: 1.5, autotuneMin: 0.7 };
        capBasalRates(profile, pumpProfile, bounds);
        // 1.123 → round(1.123 * 20) / 20 = round(22.46) / 20 = 22 / 20 = 1.1
        expect(profile[0].rate).toBe(1.1);
    });
});

// ---------------------------------------------------------------------------
// smoothUntunedHours
// ---------------------------------------------------------------------------

describe('smoothUntunedHours', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('marks unchanged hours as untuned and blends rates', () => {
        const oldProfile = makeHourlyProfile(1.0);
        const newProfile = makeHourlyProfile(1.0);
        // Make hour 12 adjusted (different rate)
        newProfile[12].rate = 1.2;
        smoothUntunedHours(oldProfile, newProfile);
        // Hour 0 is untuned: 0.8 * 1.0 + 0.1 * oldProfile[0].rate + 0.1 * newProfile[12].rate
        // = 0.8 + 0.1 * 1.0 + 0.1 * 1.2 = 0.8 + 0.1 + 0.12 = 1.02
        // round(1.02 * 20) / 20 = round(20.4) / 20 = 20 / 20 = 1.0
        expect(newProfile[0].rate).toBe(1.0);
        expect(newProfile[0].untuned).toBe(1);
    });

    it('does not mark adjusted hours as untuned', () => {
        const oldProfile = makeHourlyProfile(1.0);
        const newProfile = makeHourlyProfile(1.0);
        newProfile[5].rate = 1.5;
        smoothUntunedHours(oldProfile, newProfile);
        expect(newProfile[5].untuned).toBeUndefined();
        expect(newProfile[5].rate).toBe(1.5);
    });

    it('increments untuned counter on successive calls', () => {
        const oldProfile = makeHourlyProfile(1.0);
        const newProfile = makeHourlyProfile(1.0);
        newProfile[12].rate = 1.2;
        smoothUntunedHours(oldProfile, newProfile);
        expect(newProfile[0].untuned).toBe(1);
        // Call again — new and old are same rate again at hour 0 (after blending)
        const oldProfile2 = newProfile.map(e => ({ ...e }));
        smoothUntunedHours(oldProfile2, newProfile);
        expect(newProfile[0].untuned).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// tuneBasalProfile (integration)
// ---------------------------------------------------------------------------

describe('tuneBasalProfile', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('returns undefined for bad basal profile (rate 0)', () => {
        const basalProfile = [makeBasalEntry({ rate: 0, minutes: 0 })];
        const pumpProfile = [makeBasalEntry({ rate: 1.0, minutes: 0 })];
        const pump: AutotunePumpProfile = {
            basalprofile: pumpProfile,
            autosens_max: 1.2,
            autosens_min: 0.7,
        };
        const result = tuneBasalProfile(basalProfile, pumpProfile, [], 40, pump);
        expect(result).toBeUndefined();
    });

    it('returns undefined for bad pump profile (rate 0)', () => {
        const basalProfile = [makeBasalEntry({ rate: 1.0, minutes: 0 })];
        const pumpProfile = [makeBasalEntry({ rate: 0, minutes: 0 })];
        const pump: AutotunePumpProfile = {
            basalprofile: pumpProfile,
            autosens_max: 1.2,
            autosens_min: 0.7,
        };
        const result = tuneBasalProfile(basalProfile, pumpProfile, [], 40, pump);
        expect(result).toBeUndefined();
    });

    it('returns 24-element basalProfile and bounds on success', () => {
        const basalProfile = [makeBasalEntry({ rate: 1.0, minutes: 0 })];
        const pumpProfile = [makeBasalEntry({ rate: 1.0, minutes: 0 })];
        const pump: AutotunePumpProfile = {
            basalprofile: pumpProfile,
            autosens_max: 1.3,
            autosens_min: 0.8,
        };
        const result = tuneBasalProfile(basalProfile, pumpProfile, [], 40, pump);
        expect(result).toBeDefined();
        expect(result!.basalProfile.length).toBe(24);
        expect(result!.bounds).toEqual({ autotuneMax: 1.3, autotuneMin: 0.8 });
    });

    it('uses default autosens bounds when pump profile omits them', () => {
        const basalProfile = [makeBasalEntry({ rate: 1.0, minutes: 0 })];
        const pumpProfile = [makeBasalEntry({ rate: 1.0, minutes: 0 })];
        const pump: AutotunePumpProfile = { basalprofile: pumpProfile };
        const result = tuneBasalProfile(basalProfile, pumpProfile, [], 40, pump);
        expect(result).toBeDefined();
        expect(result!.bounds).toEqual({ autotuneMax: 1.2, autotuneMin: 0.7 });
    });

    it('applies deviations to adjust basal rates', () => {
        const basalProfile = [makeBasalEntry({ rate: 1.0, minutes: 0 })];
        const pumpProfile = [makeBasalEntry({ rate: 1.0, minutes: 0 })];
        const pump: AutotunePumpProfile = {
            basalprofile: pumpProfile,
            autosens_max: 2.0,
            autosens_min: 0.5,
        };
        // Large positive deviation at hour 6 — should increase hours 3,4,5
        const glucoseData = [
            makeGlucoseDatum({
                date: new Date('2025-01-15T06:30:00.000Z').getTime(),
                deviation: '60',
            }),
        ];
        const result = tuneBasalProfile(basalProfile, pumpProfile, glucoseData, 40, pump);
        expect(result).toBeDefined();
        // The result should have adjusted rates at some hours
        const localHour6 = new Date('2025-01-15T06:30:00.000Z').getHours();
        const priorHours = [
            (localHour6 - 3 + 24) % 24,
            (localHour6 - 2 + 24) % 24,
            (localHour6 - 1 + 24) % 24,
        ];
        // At least one of the prior hours should have a different rate
        const anyAdjusted = priorHours.some(h => result!.basalProfile[h].rate !== 1.0);
        expect(anyAdjusted).toBe(true);
    });
});
