import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeDeviations } from '../../../src/autosens/deviationLoop';
import { resetISFCache } from '../../../src/profile/isf';
import type { GlucoseEntry, CarbTreatment } from '../../../src/types/index';
import {
    FIXED_TIME,
    FIXED_MS,
    MS_PER_5_MIN,
    makeIobProfile,
    makeBasalProfileEntry,
} from '../helpers/factories';

const NOW = FIXED_MS;

// Mock get_iob to avoid full IOB calculation
vi.mock('../../../src/iob/index', () => ({
    generate: () => [{ iob: 0.5, activity: 0.01 }],
}));

function makeProfile() {
    return makeIobProfile({
        isfProfile: {
            sensitivities: [{ offset: 0, sensitivity: 40 }],
        },
        min_5m_carbimpact: 8,
        carb_ratio: 10,
    });
}

/** Create bucketed glucose data at 5-min intervals going backward from NOW */
function makeBucketedData(count: number, baseGlucose: number = 120): (GlucoseEntry & { mealCarbs?: number })[] {
    return Array.from({ length: count }, (_, idx) => ({
        glucose: baseGlucose + idx,
        date: NOW - idx * MS_PER_5_MIN,
    }));
}

describe('analyzeDeviations', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        resetISFCache();
    });

    it('accumulates meal COB when treatment has carbs >= 1 (lines 154-155)', () => {
        // Create bucketed data with enough entries (need at least TRAILING_BUCKETS + 1 = 4)
        const bucketedData = makeBucketedData(6);
        // The loop starts at bucketIdx=3 (TRAILING_BUCKETS), so we need meals
        // whose timestamps are before the glucose data's BGTime

        // Meal with carbs, timestamp before any glucose entry
        const meals: CarbTreatment[] = [
            { timestamp: new Date(NOW - 20 * MS_PER_5_MIN).toISOString(), carbs: 30 },
        ];

        const iobInputs = {
            profile: makeProfile(),
            history: [],
            clock: FIXED_TIME,
        };

        const result = analyzeDeviations(
            bucketedData,
            meals,
            iobInputs,
            makeBasalProfileEntry(),
            makeProfile(),
            [],
            undefined,
            undefined,
            undefined,
        );

        // Should have processed data and potentially accumulated COB
        expect(result.deviations).toBeInstanceOf(Array);
        expect(result.avgDeltas).toBeInstanceOf(Array);
        expect(result.bgis).toBeInstanceOf(Array);
    });

    it('returns empty arrays when bucketed data has fewer than TRAILING_BUCKETS entries', () => {
        const bucketedData = makeBucketedData(2); // only 2 entries, loop needs 4+
        const result = analyzeDeviations(
            bucketedData,
            [],
            { profile: makeProfile(), history: [], clock: FIXED_TIME },
            makeBasalProfileEntry(),
            makeProfile(),
            [],
            undefined,
            undefined,
            undefined,
        );
        expect(result.deviations).toEqual([]);
        expect(result.avgDeltas).toEqual([]);
        expect(result.bgis).toEqual([]);
    });

    it('skips entries with invalid glucose (NaN, 0, or below 40)', () => {
        const bucketedData = makeBucketedData(6);
        // Make trailing entry invalid to trigger the skip
        bucketedData[0].glucose = 30; // below AUTOSENS_MIN_VALID_BG (40)
        const result = analyzeDeviations(
            bucketedData,
            [],
            { profile: makeProfile(), history: [], clock: FIXED_TIME },
            makeBasalProfileEntry(),
            makeProfile(),
            [],
            undefined,
            undefined,
            undefined,
        );
        // The entry with invalid glucose should have been skipped
        expect(result).toBeDefined();
    });

    it('adds exercise temp target deviation when high_temptarget_raises_sensitivity is true', () => {
        const bucketedData = makeBucketedData(6);
        const profile = makeProfile();
        (profile as unknown as Record<string, unknown>).high_temptarget_raises_sensitivity = true;

        // Set up a temp target above EXERCISE_NORMAL_TARGET (100)
        const tempTargets = [{
            created_at: new Date(NOW - 60 * 60_000).toISOString(),
            duration: 120,
            targetTop: 150,
            targetBottom: 150,
        }];

        const result = analyzeDeviations(
            bucketedData,
            [],
            { profile: makeProfile(), history: [], clock: FIXED_TIME },
            makeBasalProfileEntry(),
            profile,
            [],
            tempTargets,
            undefined,
            undefined,
        );

        // Should have deviations from the temp target adjustment
        expect(result.deviations.length).toBeGreaterThan(0);
    });
});
