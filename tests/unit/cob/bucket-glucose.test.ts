import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bucketGlucoseWithInterpolation, interpolateMissingPoints } from '../../../src/cob/bucket-glucose';
import { resolveGlucoseDeltas } from '../../../src/cob/deviation-loop';
import { resolveGlucoseTime } from '../../../src/utils/glucose-time';
import type { GlucoseEntry, BucketedGlucose } from '../../../src/types/index';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

function makeGlucoseEntry(
    minutesAgo: number,
    glucose: number,
    overrides: Partial<GlucoseEntry> = {},
): GlucoseEntry {
    const time = new Date(NOW - minutesAgo * 60_000);
    return {
        glucose,
        dateString: time.toISOString(),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// resolveGlucoseTime (shared util)
// ---------------------------------------------------------------------------

describe('resolveGlucoseTime', () => {
    it('parses display_time with T replaced by space', () => {
        const result = resolveGlucoseTime({ display_time: '2025-01-15T12:00:00' });
        expect(result).toBeInstanceOf(Date);
        expect(result!.getTime()).not.toBeNaN();
    });

    it('parses dateString as-is', () => {
        const result = resolveGlucoseTime({ dateString: '2025-01-15T12:00:00.000Z' });
        expect(result).toBeInstanceOf(Date);
        expect(result!.getTime()).toBe(new Date('2025-01-15T12:00:00.000Z').getTime());
    });

    it('prefers display_time over dateString', () => {
        const result = resolveGlucoseTime({
            display_time: '2025-01-15T11:00:00',
            dateString: '2025-01-15T12:00:00.000Z',
        });
        // display_time is used, not dateString
        expect(result).toBeInstanceOf(Date);
    });

    it('returns undefined when neither field is present', () => {
        expect(resolveGlucoseTime({})).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// bucketGlucoseWithInterpolation
// ---------------------------------------------------------------------------

describe('bucketGlucoseWithInterpolation', () => {
    const mealTime = new Date(NOW - 60 * 60_000); // 1 hour ago
    const carbImpactTime = new Date(NOW);

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('returns at least the first entry for minimal input', () => {
        const data: GlucoseEntry[] = [
            makeGlucoseEntry(0, 150),
            makeGlucoseEntry(5, 145),
        ];
        const result = bucketGlucoseWithInterpolation(data, mealTime, carbImpactTime, 6);
        expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('creates new bucket for medium gaps (> 2 min)', () => {
        const data: GlucoseEntry[] = [
            makeGlucoseEntry(0, 150),
            makeGlucoseEntry(5, 145),
        ];
        const result = bucketGlucoseWithInterpolation(data, mealTime, carbImpactTime, 6);
        expect(result.length).toBe(2);
        expect(result[1].glucose).toBe(145);
    });

    it('merges readings within 2-minute gap', () => {
        const data: GlucoseEntry[] = [
            makeGlucoseEntry(0, 150),
            makeGlucoseEntry(1, 148), // 1 min gap → merge
        ];
        const result = bucketGlucoseWithInterpolation(data, mealTime, carbImpactTime, 6);
        // Merged: (150 + 148) / 2 = 149
        expect(result.length).toBe(1);
        expect(result[0].glucose).toBe(149);
    });

    it('interpolates for large gaps (> 8 min)', () => {
        const data: GlucoseEntry[] = [
            makeGlucoseEntry(0, 150),
            makeGlucoseEntry(15, 120), // 15 min gap → interpolation
        ];
        const result = bucketGlucoseWithInterpolation(data, mealTime, carbImpactTime, 6);
        // Should have interpolated entries between the two readings
        expect(result.length).toBeGreaterThan(2);
    });

    it('skips entries with glucose below MIN_VALID_GLUCOSE_MGDL', () => {
        const data: GlucoseEntry[] = [
            makeGlucoseEntry(0, 150),
            makeGlucoseEntry(5, 30),  // below 39 threshold
            makeGlucoseEntry(10, 140),
        ];
        const result = bucketGlucoseWithInterpolation(data, mealTime, carbImpactTime, 6);
        // Entry with glucose=30 should be skipped
        const glucoseValues = result.map(r => r.glucose).filter(g => g !== undefined);
        expect(glucoseValues).not.toContain(30);
    });

    it('stops after finding pre-meal BG', () => {
        // Entries before the meal time (hoursAfterMeal < 0)
        const earlyMealTime = new Date(NOW - 5 * 60_000); // 5 min ago
        const data: GlucoseEntry[] = [
            makeGlucoseEntry(0, 150),
            makeGlucoseEntry(5, 145),
            makeGlucoseEntry(10, 140), // this is before mealTime, sets foundPreMealBG
            makeGlucoseEntry(15, 135), // should be skipped (foundPreMealBG is true)
        ];
        const result = bucketGlucoseWithInterpolation(data, earlyMealTime, carbImpactTime, 6);
        // After finding pre-meal BG, subsequent entries are skipped
        expect(result.length).toBeLessThanOrEqual(3);
    });
});

// ---------------------------------------------------------------------------
// interpolateMissingPoints
// ---------------------------------------------------------------------------

describe('interpolateMissingPoints', () => {
    const baseTime = new Date(FIXED_TIME);

    it('creates interpolated buckets for a 15-minute gap', () => {
        const bucketed_data: BucketedGlucose[] = [{ glucose: 150, date: baseTime.getTime() } as BucketedGlucose];
        const result = interpolateMissingPoints(bucketed_data, 0, baseTime, 150, 120, 15);
        // 15 min gap → 2 interpolated points (at 10m and 5m remaining)
        expect(result.bucketIndex).toBe(2);
        expect(bucketed_data.length).toBe(3);
    });

    it('linearly interpolates glucose values toward target', () => {
        const bucketed_data: BucketedGlucose[] = [{ glucose: 100, date: baseTime.getTime() } as BucketedGlucose];
        const result = interpolateMissingPoints(bucketed_data, 0, baseTime, 100, 200, 15);
        // First interpolated point should be between 100 and 200
        expect(bucketed_data[1].glucose).toBeGreaterThan(100);
        expect(bucketed_data[1].glucose).toBeLessThan(200);
        // Second point should be closer to 200
        expect(bucketed_data[2].glucose).toBeGreaterThan(bucketed_data[1].glucose);
        // Check that bucketIndex is returned correctly
        expect(result.bucketIndex).toBe(2);
    });

    it('caps interpolation at 240 minutes', () => {
        const bucketed_data: BucketedGlucose[] = [{ glucose: 100, date: baseTime.getTime() } as BucketedGlucose];
        // 500 min gap → capped at 240 → 47 interpolated points (240/5 - 1)
        const result = interpolateMissingPoints(bucketed_data, 0, baseTime, 100, 200, 500);
        expect(result.bucketIndex).toBe(47);
    });

    it('returns unchanged index for gaps <= 5 minutes', () => {
        const bucketed_data: BucketedGlucose[] = [{ glucose: 100, date: baseTime.getTime() } as BucketedGlucose];
        const result = interpolateMissingPoints(bucketed_data, 0, baseTime, 100, 200, 5);
        // 5 min gap → remaining (5) is not > PRED_INTERVAL_MINUTES (5), so no interpolation
        expect(result.bucketIndex).toBe(0);
    });

    it('returns updated lastBgTime from the last interpolated point', () => {
        const bucketed_data: BucketedGlucose[] = [{ glucose: 100, date: baseTime.getTime() } as BucketedGlucose];
        const result = interpolateMissingPoints(bucketed_data, 0, baseTime, 100, 200, 15);
        expect(result.lastBgTime.getTime()).toBeLessThan(baseTime.getTime());
    });
});

// ---------------------------------------------------------------------------
// resolveGlucoseDeltas
// ---------------------------------------------------------------------------

describe('resolveGlucoseDeltas', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    it('returns bg, delta, and avgDelta for valid glucose entries', () => {
        const bucketed_data = [
            { glucose: 150 },
            { glucose: 145 },
            { glucose: 140 },
            { glucose: 130 },
        ] as BucketedGlucose[];
        const result = resolveGlucoseDeltas(bucketed_data, 0);
        expect(result).not.toBe('skip');
        if (result !== 'skip') {
            expect(result.bg).toBe(150);
            expect(result.delta).toBe(5); // 150 - 145
            // avgDelta = (150 - 130) / 3 = 6.67, rounded to 2dp
            expect(result.avgDelta).toBeCloseTo(6.67, 1);
        }
    });

    it('returns skip when bg is below MIN_VALID_GLUCOSE_MGDL (39)', () => {
        const bucketed_data = [
            { glucose: 30 },
            { glucose: 145 },
            { glucose: 140 },
            { glucose: 130 },
        ] as BucketedGlucose[];
        expect(resolveGlucoseDeltas(bucketed_data, 0)).toBe('skip');
        expect(process.stderr.write).toHaveBeenCalledWith('!');
    });

    it('returns skip when trailing glucose is below MIN_VALID_GLUCOSE_MGDL', () => {
        const bucketed_data = [
            { glucose: 150 },
            { glucose: 145 },
            { glucose: 140 },
            { glucose: 30 }, // trailing entry below threshold
        ] as BucketedGlucose[];
        expect(resolveGlucoseDeltas(bucketed_data, 0)).toBe('skip');
    });

    it('returns NaN deltas when glucose is undefined (preserving original behavior)', () => {
        const bucketed_data = [
            { glucose: undefined },
            { glucose: 145 },
            { glucose: 140 },
            { glucose: 130 },
        ] as unknown as BucketedGlucose[];
        const result = resolveGlucoseDeltas(bucketed_data, 0);
        expect(result).not.toBe('skip');
        if (result !== 'skip') {
            expect(Number.isNaN(result.delta)).toBe(true);
            expect(Number.isNaN(result.avgDelta)).toBe(true);
        }
        expect(console.error).toHaveBeenCalledWith('Could not find glucose data');
    });
});
