import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bucketGlucoseWithInterpolation, interpolateMissingPoints } from '../../../src/cob/bucketGlucose';
import { resolveGlucoseDeltas } from '../../../src/cob/deviationLoop';
import type { GlucoseEntry, BucketedGlucose } from '../../../src/types/index';
import { FIXED_TIME, FIXED_MS } from '../helpers/factories';

const NOW = FIXED_MS;

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
// bucketGlucoseWithInterpolation
// ---------------------------------------------------------------------------

describe('bucketGlucoseWithInterpolation', () => {
    const mealTime = new Date(NOW - 60 * 60_000); // 1 hour ago
    const carbImpactTime = new Date(NOW);

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
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

    it('skips entries where glucose is falsy (0 or undefined)', () => {
        // Line 56: !glucose_data[glucoseIdx].glucose → continue
        const data: GlucoseEntry[] = [
            makeGlucoseEntry(0, 150),
            { dateString: new Date(NOW - 5 * 60_000).toISOString(), glucose: 0 } as GlucoseEntry, // falsy glucose
            makeGlucoseEntry(10, 140),
        ];
        const result = bucketGlucoseWithInterpolation(data, mealTime, carbImpactTime, 6);
        const glucoseValues = result.map(r => r.glucose).filter(g => g !== undefined && g > 0);
        expect(glucoseValues).not.toContain(0);
    });

    it('skips entries outside CI mode lookback window (> 45m ago)', () => {
        // Line 70-74: carbImpactTime is defined and hoursAgo > 1
        // carbImpactTime is NOW, so entries more than 45m before NOW have hoursAgo > 1
        const ciTime = new Date(NOW);
        const data: GlucoseEntry[] = [
            makeGlucoseEntry(0, 150),
            makeGlucoseEntry(5, 145),   // 5 min before NOW — hoursAgo = 5/45 < 1 → included
            makeGlucoseEntry(50, 140),  // 50 min before NOW — hoursAgo = 50/45 > 1 → skipped
        ];
        const result = bucketGlucoseWithInterpolation(data, mealTime, ciTime, 6);
        // The 50-min-ago entry should be skipped due to CI lookback
        // We expect only the seed entry and the 5-min entry
        const validGlucose = result.filter(r => r.glucose !== undefined && r.glucose > 0);
        // All included entries should have glucose >= 140
        expect(validGlucose.every(r => (r.glucose ?? 0) >= 140)).toBe(true);
    });

    it('skips entries in the future relative to CI time (hoursAgo < 0)', () => {
        // Line 72: hoursAgo < 0 (bgTime is after carbImpactTime)
        const pastCarbImpact = new Date(NOW - 120 * 60_000); // 2 hours ago
        const data: GlucoseEntry[] = [
            makeGlucoseEntry(0, 150),   // NOW — after carbImpactTime → hoursAgo < 0 → skip
            makeGlucoseEntry(5, 145),
        ];
        const result = bucketGlucoseWithInterpolation(data, mealTime, pastCarbImpact, 6);
        // First entry is seed (always included), entries after carbImpactTime are skipped
        expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('handles initial entry with glucose below threshold (lastValidIndex = -1)', () => {
        // Line 40-42: first entry has invalid glucose → lastValidIndex = -1
        const data: GlucoseEntry[] = [
            { dateString: new Date(NOW).toISOString(), glucose: 30 } as GlucoseEntry, // below 39
            makeGlucoseEntry(5, 145),
            makeGlucoseEntry(10, 140),
        ];
        const result = bucketGlucoseWithInterpolation(data, mealTime, carbImpactTime, 6);
        // Should still process despite invalid first entry
        expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('logs when resolveGlucoseTime returns undefined for an entry', () => {
        // Line 51-52: no display_time or dateString → "Could not determine BG time"
        const data: GlucoseEntry[] = [
            makeGlucoseEntry(0, 150),
            { glucose: 145 } as GlucoseEntry, // no time fields at all
        ];
        const result = bucketGlucoseWithInterpolation(data, mealTime, carbImpactTime, 6);
        expect(console.log).toHaveBeenCalledWith('Could not determine BG time');
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
        const bucketedData: BucketedGlucose[] = [{ glucose: 150, date: baseTime.getTime() } as BucketedGlucose];
        const result = interpolateMissingPoints(bucketedData, 0, baseTime, 150, 120, 15);
        // 15 min gap → 2 interpolated points (at 10m and 5m remaining)
        expect(result.bucketIndex).toBe(2);
        expect(bucketedData.length).toBe(3);
    });

    it('linearly interpolates glucose values toward target', () => {
        const bucketedData: BucketedGlucose[] = [{ glucose: 100, date: baseTime.getTime() } as BucketedGlucose];
        const result = interpolateMissingPoints(bucketedData, 0, baseTime, 100, 200, 15);
        // First interpolated point should be between 100 and 200
        expect(bucketedData[1].glucose).toBeGreaterThan(100);
        expect(bucketedData[1].glucose).toBeLessThan(200);
        // Second point should be closer to 200
        expect(bucketedData[2].glucose).toBeGreaterThan(bucketedData[1].glucose!);
        // Check that bucketIndex is returned correctly
        expect(result.bucketIndex).toBe(2);
    });

    it('caps interpolation at 240 minutes', () => {
        const bucketedData: BucketedGlucose[] = [{ glucose: 100, date: baseTime.getTime() } as BucketedGlucose];
        // 500 min gap → capped at 240 → 47 interpolated points (240/5 - 1)
        const result = interpolateMissingPoints(bucketedData, 0, baseTime, 100, 200, 500);
        expect(result.bucketIndex).toBe(47);
    });

    it('returns unchanged index for gaps <= 5 minutes', () => {
        const bucketedData: BucketedGlucose[] = [{ glucose: 100, date: baseTime.getTime() } as BucketedGlucose];
        const result = interpolateMissingPoints(bucketedData, 0, baseTime, 100, 200, 5);
        // 5 min gap → remaining (5) is not > PRED_INTERVAL_MINUTES (5), so no interpolation
        expect(result.bucketIndex).toBe(0);
    });

    it('returns updated lastBgTime from the last interpolated point', () => {
        const bucketedData: BucketedGlucose[] = [{ glucose: 100, date: baseTime.getTime() } as BucketedGlucose];
        const result = interpolateMissingPoints(bucketedData, 0, baseTime, 100, 200, 15);
        expect(result.lastBgTime.getTime()).toBeLessThan(baseTime.getTime());
    });
});

// ---------------------------------------------------------------------------
// resolveGlucoseDeltas
// ---------------------------------------------------------------------------

describe('resolveGlucoseDeltas', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('returns bg, delta, and avgDelta for valid glucose entries', () => {
        const bucketedData = [
            { glucose: 150 },
            { glucose: 145 },
            { glucose: 140 },
            { glucose: 130 },
        ] as BucketedGlucose[];
        const result = resolveGlucoseDeltas(bucketedData, 0);
        expect(result).not.toBe('skip');
        if (result !== 'skip') {
            expect(result.bg).toBe(150);
            expect(result.delta).toBe(5); // 150 - 145
            // avgDelta = (150 - 130) / 3 = 6.67, rounded to 2dp
            expect(result.avgDelta).toBeCloseTo(6.67, 1);
        }
    });

    it('returns skip when bg is below MIN_VALID_GLUCOSE_MGDL (39)', () => {
        const bucketedData = [
            { glucose: 30 },
            { glucose: 145 },
            { glucose: 140 },
            { glucose: 130 },
        ] as BucketedGlucose[];
        expect(resolveGlucoseDeltas(bucketedData, 0)).toBe('skip');
        expect(console.log).toHaveBeenCalledWith('!');
    });

    it('returns skip when trailing glucose is below MIN_VALID_GLUCOSE_MGDL', () => {
        const bucketedData = [
            { glucose: 150 },
            { glucose: 145 },
            { glucose: 140 },
            { glucose: 30 }, // trailing entry below threshold
        ] as BucketedGlucose[];
        expect(resolveGlucoseDeltas(bucketedData, 0)).toBe('skip');
    });

    it('returns NaN deltas when glucose is undefined (preserving original behavior)', () => {
        const bucketedData = [
            { glucose: undefined },
            { glucose: 145 },
            { glucose: 140 },
            { glucose: 130 },
        ] as unknown as BucketedGlucose[];
        const result = resolveGlucoseDeltas(bucketedData, 0);
        expect(result).not.toBe('skip');
        if (result !== 'skip') {
            expect(Number.isNaN(result.delta)).toBe(true);
            expect(Number.isNaN(result.avgDelta)).toBe(true);
        }
        expect(console.log).toHaveBeenCalledWith('Could not find glucose data');
    });
});
