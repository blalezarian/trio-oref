import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeAbsorption, resolveGlucoseDeltas } from '../../../src/cob/deviation-loop';
import { resetISFCache } from '../../../src/profile/isf';
import type { BucketedGlucose } from '../../../src/types/index';
import type { IobProfile, HistoryBasalProfileEntry } from '../../../src/iob/types';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();
const MS_PER_5_MIN = 300_000;

// Mock get_iob to avoid full IOB calculation
vi.mock('../../../src/iob/index', () => ({
    generate: () => [{ iob: 0.5, activity: 0.01 }],
}));

function makeBasalProfile(): HistoryBasalProfileEntry[] {
    return [{ i: 0, start: '00:00:00', rate: 1.0, minutes: 0 }] as HistoryBasalProfileEntry[];
}

function makeProfile(): IobProfile {
    return {
        dia: 6,
        current_basal: 1.0,
        isfProfile: {
            sensitivities: [{ offset: 0, sensitivity: 40 }],
        },
        min_5m_carbimpact: 8,
        carb_ratio: 10,
    } as IobProfile;
}

/** Create bucketed glucose data going back in time from NOW */
function makeBucketedData(count: number, baseGlucose: number = 150): BucketedGlucose[] {
    return Array.from({ length: count }, (_, idx) => ({
        glucose: baseGlucose - idx * 2,
        date: NOW - idx * MS_PER_5_MIN,
    })) as BucketedGlucose[];
}

describe('analyzeAbsorption', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        resetISFCache();
    });

    it('pushes to allDeviations when carbImpactTime > bgTime at first entry (line 86)', () => {
        // Need at least TRAILING_BUCKETS_REQUIRED + 1 = 4 entries
        const bucketedData = makeBucketedData(6);

        // carbImpactTime is in the future relative to bgTime of entry 0
        const carbImpactTime = new Date(NOW + MS_PER_5_MIN);
        // mealTime is in the past
        const mealTime = new Date(NOW - 60 * 60_000);

        const iobInputs = {
            profile: makeProfile(),
            history: [],
            clock: FIXED_TIME,
        };

        const result = analyzeAbsorption(
            bucketedData,
            iobInputs,
            makeBasalProfile(),
            makeProfile(),
            [],
            mealTime,
            carbImpactTime,
        );

        // Should have at least one deviation in allDeviations from the first entry
        expect(result.allDeviations.length).toBeGreaterThan(0);
        expect(result.currentDeviation).toBeDefined();
        expect(typeof result.carbsAbsorbed).toBe('number');
    });

    it('tracks deviation slopes for subsequent entries within CI window', () => {
        const bucketedData = makeBucketedData(8);
        const carbImpactTime = new Date(NOW + 10 * MS_PER_5_MIN); // far in the future
        const mealTime = new Date(NOW - 60 * 60_000);

        const result = analyzeAbsorption(
            bucketedData,
            { profile: makeProfile(), history: [], clock: FIXED_TIME },
            makeBasalProfile(),
            makeProfile(),
            [],
            mealTime,
            carbImpactTime,
        );

        // Should have multiple deviations from multiple entries
        expect(result.allDeviations.length).toBeGreaterThan(1);
    });

    it('returns zero carbsAbsorbed when all entries are before mealTime', () => {
        const bucketedData = makeBucketedData(6);
        const carbImpactTime = new Date(NOW + MS_PER_5_MIN);
        const mealTime = new Date(NOW + 60 * 60_000); // mealTime in the future

        const result = analyzeAbsorption(
            bucketedData,
            { profile: makeProfile(), history: [], clock: FIXED_TIME },
            makeBasalProfile(),
            makeProfile(),
            [],
            mealTime,
            carbImpactTime,
        );

        expect(result.carbsAbsorbed).toBe(0);
    });
});
