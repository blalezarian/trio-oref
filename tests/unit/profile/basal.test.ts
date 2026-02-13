import { describe, it, expect, vi } from 'vitest';
import {
    getCurrentBasalRate,
    getMaxDailyBasalRate,
    getMaxBasalRate,
    sortByScheduleIndex,
    findActiveRate,
    toMinuteOfDay,
} from '../../../src/profile/basal';
import type { BasalScheduleEntry, BasalInputs } from '../../../src/profile/basal';

/** Create a Date at a specific local hour:minute (avoids UTC vs local issues) */
function localTime(hours: number, minutes: number = 0): Date {
    const d = new Date(2025, 0, 15, hours, minutes, 0, 0);
    return d;
}

// ---------------------------------------------------------------------------
// toMinuteOfDay
// ---------------------------------------------------------------------------

describe('toMinuteOfDay', () => {
    it('returns 0 for midnight', () => {
        expect(toMinuteOfDay(localTime(0, 0))).toBe(0);
    });

    it('returns 720 for noon', () => {
        expect(toMinuteOfDay(localTime(12, 0))).toBe(720);
    });

    it('returns 1439 for 23:59', () => {
        expect(toMinuteOfDay(localTime(23, 59))).toBe(1439);
    });

    it('handles 06:30 correctly', () => {
        expect(toMinuteOfDay(localTime(6, 30))).toBe(390);
    });
});

// ---------------------------------------------------------------------------
// sortByScheduleIndex
// ---------------------------------------------------------------------------

describe('sortByScheduleIndex', () => {
    it('sorts entries by their i field', () => {
        const schedules: BasalScheduleEntry[] = [
            { i: 2, minutes: 480, rate: 1.2 },
            { i: 0, minutes: 0, rate: 0.8 },
            { i: 1, minutes: 360, rate: 1.0 },
        ];
        const sorted = sortByScheduleIndex(schedules);
        expect(sorted.map(s => s.i)).toEqual([0, 1, 2]);
    });

    it('does not mutate the original array', () => {
        const schedules: BasalScheduleEntry[] = [
            { i: 2, minutes: 480, rate: 1.2 },
            { i: 0, minutes: 0, rate: 0.8 },
        ];
        const original = [...schedules];
        sortByScheduleIndex(schedules);
        expect(schedules).toEqual(original);
    });

    it('handles entries with undefined i (treated as 0)', () => {
        const schedules: BasalScheduleEntry[] = [
            { i: 1, minutes: 360, rate: 1.0 },
            { minutes: 0, rate: 0.8 },
        ];
        const sorted = sortByScheduleIndex(schedules);
        expect(sorted[0].rate).toBe(0.8);
        expect(sorted[1].rate).toBe(1.0);
    });
});

// ---------------------------------------------------------------------------
// findActiveRate
// ---------------------------------------------------------------------------

describe('findActiveRate', () => {
    const sorted: BasalScheduleEntry[] = [
        { i: 0, minutes: 0, rate: 0.8 },
        { i: 1, minutes: 360, rate: 1.0 },
        { i: 2, minutes: 480, rate: 1.2 },
    ];

    it('returns first entry rate for minute 0', () => {
        expect(findActiveRate(sorted, 0)).toBe(0.8);
    });

    it('returns first entry rate for minute 359', () => {
        expect(findActiveRate(sorted, 359)).toBe(0.8);
    });

    it('returns second entry rate for minute 360', () => {
        expect(findActiveRate(sorted, 360)).toBe(1.0);
    });

    it('returns second entry rate for minute 479', () => {
        expect(findActiveRate(sorted, 479)).toBe(1.0);
    });

    it('returns last entry rate for minute beyond all entries', () => {
        expect(findActiveRate(sorted, 1000)).toBe(1.2);
    });

    it('returns the only rate for single-entry schedule', () => {
        const single: BasalScheduleEntry[] = [{ i: 0, minutes: 0, rate: 0.5 }];
        expect(findActiveRate(single, 720)).toBe(0.5);
    });
});

// ---------------------------------------------------------------------------
// getCurrentBasalRate
// ---------------------------------------------------------------------------

describe('getCurrentBasalRate', () => {
    const schedules: BasalScheduleEntry[] = [
        { i: 0, minutes: 0, rate: 0.8 },
        { i: 1, minutes: 360, rate: 1.0 },
        { i: 2, minutes: 480, rate: 1.2 },
    ];

    it('returns the correct rate for noon (falls in last entry)', () => {
        expect(getCurrentBasalRate(schedules, localTime(12, 0))).toBe(1.2);
    });

    it('returns the first rate for early morning', () => {
        expect(getCurrentBasalRate(schedules, localTime(2, 0))).toBe(0.8);
    });

    it('returns the second rate for a time in that range', () => {
        // 400 minutes = 6h40m → between 360 and 480
        expect(getCurrentBasalRate(schedules, localTime(6, 40))).toBe(1.0);
    });

    it('returns undefined and logs error when last entry rate is 0', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const badSchedules: BasalScheduleEntry[] = [
            { i: 0, minutes: 0, rate: 0.5 },
            { i: 1, minutes: 360, rate: 0 },
        ];
        expect(getCurrentBasalRate(badSchedules, localTime(12, 0))).toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith(`ERROR: bad basal schedule ${JSON.stringify(badSchedules)}`);
        errorSpy.mockRestore();
    });

    it('rounds to 3 decimal places', () => {
        const preciseSchedules: BasalScheduleEntry[] = [
            { i: 0, minutes: 0, rate: 0.12345 },
        ];
        expect(getCurrentBasalRate(preciseSchedules, localTime(12, 0))).toBe(0.123);
    });

    it('sorts unsorted schedules before lookup', () => {
        const unsorted: BasalScheduleEntry[] = [
            { i: 2, minutes: 480, rate: 1.2 },
            { i: 0, minutes: 0, rate: 0.8 },
            { i: 1, minutes: 360, rate: 1.0 },
        ];
        // 6h40m = 400 minutes → between 360 and 480 → rate 1.0
        expect(getCurrentBasalRate(unsorted, localTime(6, 40))).toBe(1.0);
    });
});

// ---------------------------------------------------------------------------
// getMaxDailyBasalRate
// ---------------------------------------------------------------------------

describe('getMaxDailyBasalRate', () => {
    it('returns the highest rate from the schedule', () => {
        const inputs: BasalInputs = {
            basals: [
                { i: 0, minutes: 0, rate: 0.8 },
                { i: 1, minutes: 360, rate: 1.5 },
                { i: 2, minutes: 480, rate: 1.2 },
            ],
            settings: { maxBasal: 3.0 },
        };
        expect(getMaxDailyBasalRate(inputs)).toBe(1.5);
    });

    it('handles single-entry schedule', () => {
        const inputs: BasalInputs = {
            basals: [{ i: 0, minutes: 0, rate: 0.95 }],
            settings: { maxBasal: 3.0 },
        };
        expect(getMaxDailyBasalRate(inputs)).toBe(0.95);
    });
});

// ---------------------------------------------------------------------------
// getMaxBasalRate
// ---------------------------------------------------------------------------

describe('getMaxBasalRate', () => {
    it('returns the maxBasal from settings', () => {
        const inputs: BasalInputs = {
            basals: [{ i: 0, minutes: 0, rate: 0.8 }],
            settings: { maxBasal: 4.5 },
        };
        expect(getMaxBasalRate(inputs)).toBe(4.5);
    });
});
