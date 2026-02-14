import { describe, it, expect, vi } from 'vitest';
import {
    getLastGlucose,
    getDateFromEntry,
    filterValidGlucoseData,
    average,
    roundTo2dp,
    computeAvgDelta,
} from '../../src/glucose/index';
import type { GlucoseEntry } from '../../src/types/index';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const FIXED_DATE = Date.parse(FIXED_TIME);
const MS_PER_MINUTE = 60_000;

/** Helper: create a GlucoseEntry at a given number of minutes before FIXED_TIME */
function entry(
    glucose: number,
    minutesAgo: number,
    overrides: Partial<GlucoseEntry> = {},
): GlucoseEntry {
    return {
        glucose,
        date: FIXED_DATE - minutesAgo * MS_PER_MINUTE,
        device: 'TestCGM',
        noise: 1,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// getDateFromEntry
// ---------------------------------------------------------------------------

describe('getDateFromEntry', () => {
    it('returns entry.date when present', () => {
        expect(getDateFromEntry({ glucose: 100, date: FIXED_DATE })).toBe(FIXED_DATE);
    });

    it('falls back to display_time when date is missing', () => {
        expect(getDateFromEntry({ glucose: 100, display_time: FIXED_TIME })).toBe(FIXED_DATE);
    });

    it('falls back to dateString when date and display_time are missing', () => {
        expect(getDateFromEntry({ glucose: 100, dateString: FIXED_TIME })).toBe(FIXED_DATE);
    });

    it('returns NaN-ish value when no date fields are present', () => {
        const result = getDateFromEntry({ glucose: 100 });
        expect(result).toBeFalsy();
    });

    it('falls through invalid display_time to dateString', () => {
        const result = getDateFromEntry({
            glucose: 100,
            date: 0,
            display_time: 'not-a-date',
            dateString: FIXED_TIME,
        });
        expect(result).toBe(FIXED_DATE);
    });
});

// ---------------------------------------------------------------------------
// filterValidGlucoseData
// ---------------------------------------------------------------------------

describe('filterValidGlucoseData', () => {
    it('removes entries with no glucose or sgv', () => {
        const data: GlucoseEntry[] = [
            { glucose: 100, date: FIXED_DATE },
            { date: FIXED_DATE - MS_PER_MINUTE },
            { glucose: 120, date: FIXED_DATE - 2 * MS_PER_MINUTE },
        ];
        const result = filterValidGlucoseData(data);
        expect(result).toHaveLength(2);
    });

    it('normalizes sgv to glucose', () => {
        const data: GlucoseEntry[] = [
            { sgv: 130, date: FIXED_DATE },
        ];
        const result = filterValidGlucoseData(data);
        expect(result[0].glucose).toBe(130);
    });

    it('removes entries with glucose=0', () => {
        const data: GlucoseEntry[] = [
            { glucose: 0, date: FIXED_DATE },
            { glucose: 100, date: FIXED_DATE - MS_PER_MINUTE },
        ];
        const result = filterValidGlucoseData(data);
        expect(result).toHaveLength(1);
        expect(result[0].glucose).toBe(100);
    });
});

// ---------------------------------------------------------------------------
// average
// ---------------------------------------------------------------------------

describe('average', () => {
    it('returns 0 for empty array', () => {
        expect(average([])).toBe(0);
    });

    it('returns the single value for a one-element array', () => {
        expect(average([42])).toBe(42);
    });

    it('computes the mean of multiple values', () => {
        expect(average([10, 20, 30])).toBe(20);
    });

    it('handles negative values', () => {
        expect(average([-10, 10])).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// roundTo2dp
// ---------------------------------------------------------------------------

describe('roundTo2dp', () => {
    it('rounds to 2 decimal places', () => {
        expect(roundTo2dp(1.234)).toBe(1.23);
        expect(roundTo2dp(1.235)).toBe(1.24);
        expect(roundTo2dp(1.2)).toBe(1.2);
        expect(roundTo2dp(1)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// computeAvgDelta
// ---------------------------------------------------------------------------

describe('computeAvgDelta', () => {
    it('computes rate of change in mg/dL per 5 minutes', () => {
        // (130 - 120) / 5 * 5 = 10
        expect(computeAvgDelta(130, 120, 5)).toBe(10);
    });

    it('handles 10-minute gap (normalizes to 5-minute rate)', () => {
        // (130 - 120) / 10 * 5 = 5
        expect(computeAvgDelta(130, 120, 10)).toBe(5);
    });

    it('returns negative for falling glucose', () => {
        // (100 - 120) / 5 * 5 = -20
        expect(computeAvgDelta(100, 120, 5)).toBe(-20);
    });
});

// ---------------------------------------------------------------------------
// getLastGlucose (integration)
// ---------------------------------------------------------------------------

describe('getLastGlucose', () => {

    // --- Basic: single entry ---

    it('returns glucose and delta=0 for a single entry', () => {
        const result = getLastGlucose([entry(120, 0)]);

        expect(result.glucose).toBe(120);
        expect(result.delta).toBe(0);
        expect(result.short_avgdelta).toBe(0);
        expect(result.long_avgdelta).toBe(0);
        expect(result.noise).toBe(1);
        expect(result.date).toBe(FIXED_DATE);
        expect(result.last_cal).toBe(0);
        expect(result.device).toBe('TestCGM');
    });

    // --- Two entries 5 min apart ---

    it('computes delta correctly for two entries 5 minutes apart', () => {
        const data = [
            entry(130, 0),
            entry(120, 5),
        ];
        const result = getLastGlucose(data);

        // delta = (130-120)/5 * 5 = 10
        expect(result.glucose).toBe(130);
        expect(result.delta).toBe(10);
        // 5 min falls in short_delta range (2.5 < 5 <= 17.5) and last_delta (2.5 < 5 < 7.5)
        expect(result.short_avgdelta).toBe(10);
    });

    it('computes negative delta when glucose is falling', () => {
        const data = [
            entry(100, 0),
            entry(120, 5),
        ];
        const result = getLastGlucose(data);

        // delta = (100-120)/5 * 5 = -20
        expect(result.delta).toBe(-20);
    });

    // --- Multiple entries: short and long avgdeltas ---

    it('computes short and long avgdeltas from multiple entries', () => {
        const data = [
            entry(150, 0),   // now
            entry(140, 5),   // short + last: avgdelta = (150-140)/5*5 = 10
            entry(130, 10),  // short: avgdelta = (150-130)/10*5 = 10
            entry(120, 15),  // short: avgdelta = (150-120)/15*5 = 10
            entry(110, 20),  // long: avgdelta = (150-110)/20*5 = 10
            entry(100, 25),  // long: avgdelta = (150-100)/25*5 = 10
            entry(90, 30),   // long: avgdelta = (150-90)/30*5 = 10
        ];
        const result = getLastGlucose(data);

        expect(result.delta).toBe(10);
        expect(result.short_avgdelta).toBe(10);
        expect(result.long_avgdelta).toBe(10);
    });

    it('computes different short and long avgdeltas when trend changes', () => {
        const data = [
            entry(150, 0),   // now
            entry(145, 5),   // short+last: (150-145)/5*5 = 5
            entry(140, 10),  // short: (150-140)/10*5 = 5
            entry(130, 20),  // long: (150-130)/20*5 = 5
            entry(100, 30),  // long: (150-100)/30*5 = 8.33
            entry(70, 40),   // long: (150-70)/40*5 = 10
        ];
        const result = getLastGlucose(data);

        expect(result.delta).toBe(5);
        expect(result.short_avgdelta).toBe(5);
        // long_avgdelta = (5 + 8.333... + 10) / 3 = 7.777...
        expect(result.long_avgdelta).toBe(7.78);
    });

    // --- Device filtering ---

    it('only uses entries from the same device as the most recent entry', () => {
        const data = [
            entry(150, 0, { device: 'DeviceA' }),
            entry(120, 5, { device: 'DeviceB' }),  // different device, ignored
            entry(140, 5, { device: 'DeviceA' }),   // same device, used
        ];
        const result = getLastGlucose(data);

        // delta should be based on DeviceA entry: (150-140)/5*5 = 10
        expect(result.delta).toBe(10);
        expect(result.device).toBe('DeviceA');
    });

    // --- Calibration record ---

    it('stops processing entries after a calibration record', () => {
        const data = [
            entry(150, 0),
            entry(140, 5),                              // used: delta = 10
            entry(0, 10, { type: 'cal', glucose: 0 }),   // calibration - stop here
            entry(100, 15),                              // should be ignored
        ];
        // The cal entry has glucose=0, which gets filtered out by the initial filter
        // Let's give it a glucose value so it passes the filter
        const dataWithCal = [
            entry(150, 0),
            entry(140, 5),
            { ...entry(130, 10), type: 'cal' as const },  // cal with valid glucose passes filter
            entry(100, 15),                                // should be ignored
        ];
        const result = getLastGlucose(dataWithCal);

        expect(result.delta).toBe(10);
        // last_cal should be the index of the cal record (2)
        expect(result.last_cal).toBe(2);
    });

    // --- BG averaging ---

    it('averages entries within 2.5 minutes into the current reading', () => {
        // Entry 1 minute ago is within the -2 to 2.5 range, so averaged with "now"
        const data = [
            entry(100, 0),
            entry(110, 1),  // within 2.5 min: averaged with now
            entry(80, 5),   // normal delta calculation
        ];
        const result = getLastGlucose(data);

        // now.glucose = (100 + 110) / 2 = 105
        expect(result.glucose).toBe(105);
    });

    it('averages entry at 2 minutes ago into current reading', () => {
        const data = [
            entry(100, 0),
            entry(120, 2),  // within 2.5 min: averaged with now
        ];
        const result = getLastGlucose(data);

        // now.glucose = (100 + 120) / 2 = 110
        expect(result.glucose).toBe(110);
    });

    // --- Below-39 entries are skipped ---

    it('skips entries with glucose below 39', () => {
        const data = [
            entry(120, 0),
            entry(38, 5),    // below MIN_VALID_GLUCOSE_MGDL (39), skipped
            entry(110, 10),  // valid, used for short delta
        ];
        const result = getLastGlucose(data);

        // Only the entry at 10 min contributes: (120-110)/10*5 = 5
        expect(result.short_avgdelta).toBe(5);
        expect(result.delta).toBe(0); // 10 min is not in last_delta range (2.5-7.5)
    });

    it('filters out entries with glucose=0 at initial filter step', () => {
        const data = [
            entry(120, 0),
            entry(0, 5),     // removed by initial filter (falsy)
            entry(110, 10),
        ];
        const result = getLastGlucose(data);

        // Entry at 5m was removed entirely; only 10m entry used
        expect(result.short_avgdelta).toBe(5);
    });

    // --- sgv field used when glucose field missing ---

    it('uses sgv field when glucose field is missing', () => {
        const data: GlucoseEntry[] = [
            { sgv: 130, date: FIXED_DATE, device: 'TestCGM', noise: 1 },
            { sgv: 120, date: FIXED_DATE - 5 * MS_PER_MINUTE, device: 'TestCGM', noise: 1 },
        ];
        const result = getLastGlucose(data);

        expect(result.glucose).toBe(130);
        // delta = (130-120)/5*5 = 10
        expect(result.delta).toBe(10);
    });

    it('uses sgv as fallback when glucose is undefined', () => {
        const data: GlucoseEntry[] = [
            { glucose: undefined, sgv: 100, date: FIXED_DATE, device: 'TestCGM', noise: 1 },
            { glucose: 90, date: FIXED_DATE - 5 * MS_PER_MINUTE, device: 'TestCGM', noise: 1 },
        ];
        const result = getLastGlucose(data);

        expect(result.glucose).toBe(100);
        expect(result.delta).toBe(10);
    });

    // --- Rounding to 2 decimal places ---

    it('rounds delta and avgdeltas to 2 decimal places', () => {
        // Create entries that produce non-round deltas
        const data = [
            entry(100, 0),
            entry(97, 6),   // last+short: (100-97)/6*5 = 2.5
            entry(91, 15),  // short: (100-91)/15*5 = 3
            entry(80, 20),  // long: (100-80)/20*5 = 5
            entry(60, 30),  // long: (100-60)/30*5 = 6.666...
            entry(40, 40),  // long: (100-40)/40*5 = 7.5
        ];
        const result = getLastGlucose(data);

        // delta = 2.5 (rounded = 2.5)
        expect(result.delta).toBe(2.5);
        // short = (2.5 + 3) / 2 = 2.75
        expect(result.short_avgdelta).toBe(2.75);
        // long = (5 + 6.666... + 7.5) / 3 = 6.388...
        expect(result.long_avgdelta).toBe(6.39);
    });

    it('rounds glucose to 2 decimal places after averaging', () => {
        // Entries that produce a non-round average
        const data = [
            entry(101, 0),
            entry(102, 1),  // averaged: (101+102)/2 = 101.5
        ];
        const result = getLastGlucose(data);

        expect(result.glucose).toBe(101.5);
    });

    it('rounds glucose with repeating decimals', () => {
        // Two readings that produce a repeating decimal average
        const data = [
            entry(100, 0),
            entry(103, 1),  // averaged: (100+103)/2 = 101.5
            entry(101, 2),  // averaged again: (101.5+101)/2 = 101.25
        ];
        const result = getLastGlucose(data);

        expect(result.glucose).toBe(101.25);
    });

    // --- Edge cases ---

    it('handles entries using display_time instead of date', () => {
        const data: GlucoseEntry[] = [
            { glucose: 120, display_time: FIXED_TIME, device: 'TestCGM', noise: 1 },
            {
                glucose: 110,
                display_time: new Date(FIXED_DATE - 5 * MS_PER_MINUTE).toISOString(),
                device: 'TestCGM',
                noise: 1,
            },
        ];
        const result = getLastGlucose(data);

        expect(result.glucose).toBe(120);
        expect(result.delta).toBe(10);
    });

    it('handles entries using dateString instead of date', () => {
        const data: GlucoseEntry[] = [
            { glucose: 120, dateString: FIXED_TIME, device: 'TestCGM', noise: 1 },
            {
                glucose: 110,
                dateString: new Date(FIXED_DATE - 5 * MS_PER_MINUTE).toISOString(),
                device: 'TestCGM',
                noise: 1,
            },
        ];
        const result = getLastGlucose(data);

        expect(result.glucose).toBe(120);
        expect(result.delta).toBe(10);
    });

    it('returns noise rounded to integer', () => {
        const data = [entry(120, 0, { noise: 2.7 })];
        const result = getLastGlucose(data);

        expect(result.noise).toBe(3);
    });

    it('handles entry exactly at 39 mg/dL (not skipped)', () => {
        const data = [
            entry(120, 0),
            entry(39, 5),  // exactly at MIN_VALID_GLUCOSE_MGDL, should be used
        ];
        const result = getLastGlucose(data);

        // delta = (120-39)/5*5 = 81
        expect(result.delta).toBe(81);
    });

    it('logs error and skips entry when date fields are missing', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        // Second entry has glucose but no date fields → getDateFromEntry returns falsy
        const data: GlucoseEntry[] = [
            entry(120, 0),
            { glucose: 110, device: 'TestCGM', noise: 1 }, // no date, display_time, or dateString
        ];
        const result = getLastGlucose(data);
        expect(consoleSpy).toHaveBeenCalledWith('Error: date field not found: cannot calculate avgdelta');
        // Only 1 entry processed (the second was skipped), so delta = 0
        expect(result.delta).toBe(0);
        consoleSpy.mockRestore();
    });

    it('handles entry with glucose null (skipped by loop guard)', () => {
        // entry.glucose == null path at line 46
        const data: GlucoseEntry[] = [
            entry(120, 0),
            { glucose: null as unknown as number, date: FIXED_DATE - 5 * MS_PER_MINUTE, device: 'TestCGM', noise: 1 },
            entry(110, 10),
        ];
        const result = getLastGlucose(data);
        // The null-glucose entry is skipped; only 10m entry used
        expect(result.short_avgdelta).toBe(5);
    });

    it('assigns short delta entries in 2.5-7.5 range to both short and last deltas', () => {
        const data = [
            entry(150, 0),
            entry(140, 5),  // short + last: (150-140)/5*5 = 10
            entry(130, 7),  // short + last: (150-130)/7*5 = 14.29 (rounded)
            entry(120, 10), // short only: (150-120)/10*5 = 15
        ];
        const result = getLastGlucose(data);

        // last_delta (entries at 5m and 7m): (10 + 14.285714...) / 2 = 12.142857...
        expect(result.delta).toBe(12.14);
        // short_delta (all three): (10 + 14.285714... + 15) / 3 = 13.095238...
        expect(result.short_avgdelta).toBe(13.1);
    });
});
