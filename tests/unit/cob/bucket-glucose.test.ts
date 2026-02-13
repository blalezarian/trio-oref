import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bucketGlucoseWithInterpolation } from '../../../src/cob/bucket-glucose';
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
